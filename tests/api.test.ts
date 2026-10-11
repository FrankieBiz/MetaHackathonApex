import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import handler from "../api/health";
import { requestPublic } from "../server/network";
import { syncCanvas } from "../server/canvas";

vi.mock("../server/network.js", () => ({ requestPublic: vi.fn() }));
vi.mock("../server/canvas.js", () => ({ syncCanvas: vi.fn() }));

let server: Server;
let origin: string;
beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => vi.clearAllMocks());
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const post = (path: string, body: unknown) =>
  fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("Vercel API handler", () => {
  it("exports a handler without a listener and lets Express parse bodies", async () => {
    expect(typeof handler.listen).toBe("function");
    const response = await fetch(`${origin}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("parses an imported calendar through the same-origin endpoint", async () => {
    vi.mocked(requestPublic).mockResolvedValue({
      text: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:deploy-check\r\nDTSTART:20261012T140000Z\r\nDTEND:20261012T150000Z\r\nSUMMARY:Deployment review\r\nEND:VEVENT\r\nEND:VCALENDAR",
      headers: {},
    });
    const response = await post("/api/calendar", {
      url: "https://school.instructure.com/calendar.ics",
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].title).toBe("Deployment review");
    expect(requestPublic).toHaveBeenCalledWith(
      "https://school.instructure.com/calendar.ics",
    );
  });

  it("passes Canvas credentials to the integration without returning them", async () => {
    vi.mocked(syncCanvas).mockResolvedValue({ assignments: [], events: [] });
    const response = await post("/api/canvas", {
      domain: "school.instructure.com",
      token: "test-fixture",
    });
    expect(response.status).toBe(200);
    expect(syncCanvas).toHaveBeenCalledWith(
      "school.instructure.com",
      "test-fixture",
    );
    expect(await response.json()).toEqual({ assignments: [], events: [] });
  });

  it("rejects missing fields before contacting external services", async () => {
    const response = await post("/api/calendar", {});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Provide a valid url." });
    expect(requestPublic).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and oversized request bodies", async () => {
    const malformed = await fetch(`${origin}/api/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    const oversized = await post("/api/decompose", {
      text: "x".repeat(40_000),
    });
    expect(oversized.status).toBe(400);
    expect(requestPublic).not.toHaveBeenCalled();
  });

  it("returns JSON for unknown API routes and unsupported methods", async () => {
    const missing = await fetch(`${origin}/api/missing`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Unknown API route." });
    const wrongMethod = await fetch(`${origin}/api/calendar`);
    expect(wrongMethod.status).toBe(404);
  });
});
