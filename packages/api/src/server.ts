/**
 * MemOS intent-RPC gateway entrypoint. Serves the Hono app (app.ts) on :8787.
 * The real logic lives in app.ts + core/* so tests can exercise it in-process.
 */
import "./env.js"; // side effect: load the repo-root .env
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.MEMOS_PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`MemOS gateway listening on http://localhost:${info.port}`);
});
