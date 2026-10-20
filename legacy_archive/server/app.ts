import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCalendar } from "../src/lib/calendar.js";
import { requestPublic } from "./network.js";
import { syncCanvas } from "./canvas.js";
import {
  decompose,
  engineConfiguration,
  idleTelemetry,
  InferenceError,
} from "./ai.js";
export function createApp({
  serveStatic = false,
  trustProxy = process.env.VERCEL === "1",
}: { serveStatic?: boolean; trustProxy?: boolean } = {}) {
  const app = express();
  // Vercel supplies the forwarded client address through its trusted proxy.
  if (trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:"],
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (req, res, _next, options) => {
        res.status(options.statusCode).json({
          error: "Too many requests. Please try again in a few minutes.",
          ...(req.originalUrl.split("?")[0] === "/api/decompose"
            ? { telemetry: idleTelemetry() }
            : {}),
        });
      },
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      ai: engineConfiguration().provider !== "local",
      engine: engineConfiguration(),
    }),
  );
  const stringField = (req: Request, key: string, max: number) => {
    const value = req.body?.[key];
    if (typeof value !== "string" || !value.trim() || value.length > max)
      throw new Error(`Provide a valid ${key}.`);
    return value;
  };
  app.post("/api/calendar", async (req, res) => {
    try {
      const url = stringField(req, "url", 4096);
      const data = await requestPublic(url);
      res.json(parseCalendar(data.text));
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Calendar sync failed.",
      });
    }
  });
  app.post("/api/canvas", async (req, res) => {
    try {
      res.json(
        await syncCanvas(
          stringField(req, "domain", 256),
          stringField(req, "token", 2048),
        ),
      );
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Canvas sync failed.",
      });
    }
  });
  app.post(
    "/api/decompose",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: "Planning limit reached. Try again in a few minutes.",
        telemetry: idleTelemetry(),
      },
    }),
    async (req, res) => {
      let text: string;
      try {
        text = stringField(req, "text", 12000);
      } catch {
        res
          .status(400)
          .json({
            error: "Provide valid text (1–12000 characters).",
            telemetry: idleTelemetry(),
          });
        return;
      }
      try {
        res.json(await decompose(text));
      } catch (error) {
        res.status(503).json({
          error:
            "AI planning is unavailable. Use the local starter plan or try again.",
          telemetry:
            error instanceof InferenceError ? error.telemetry : idleTelemetry(),
        });
      }
    },
  );
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unknown API route." });
  });
  if (serveStatic) {
    const dist = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
    app.use(express.static(dist, { maxAge: "1h", index: false }));
    app.get("/{*path}", (req, res) => {
      if (req.path.startsWith("/api/")) {
        res.status(404).json({ error: "Unknown API route." });
        return;
      }
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(resolve(dist, "index.html"));
    });
  }
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    void error;
    void next;
    res.status(400).json({
      error: "Invalid request. Check your input and try again.",
      ...(req.path === "/api/decompose" ? { telemetry: idleTelemetry() } : {}),
    });
  });

  return app;
}

export default createApp();
