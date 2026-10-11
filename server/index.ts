import { createApp } from "./app.js";

const app = createApp({ serveStatic: process.env.NODE_ENV === "production" });
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () =>
  console.log(`Apex OS API ready at http://${host}:${port}`),
);
