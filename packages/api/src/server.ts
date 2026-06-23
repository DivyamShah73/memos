/**
 * MemOS intent-RPC gateway entrypoint. Serves the Hono app (app.ts) on :8787.
 * The real logic lives in app.ts + core/* so tests can exercise it in-process.
 */
import "./env.js"; // side effect: load the repo-root .env
import { serve } from "@hono/node-server";
import { app } from "./app.js";

// PaaS hosts (Render, Fly, …) inject the port to bind on as PORT; honor it first so the
// platform health check can reach us. MEMOS_PORT stays the local-dev override; 8787 is the default.
const port = Number(process.env.PORT ?? process.env.MEMOS_PORT ?? 8787);

// Bind all interfaces (0.0.0.0), not loopback — a PaaS health check / proxy reaches the container
// on its external IP, never 127.0.0.1.
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`MemOS gateway listening on http://0.0.0.0:${info.port}`);
});
