// Export Express directly so Vercel preserves its request parsing and routes.
// The port listener is only used by server/index.ts for local development.
export { default } from "../server/app.js";
