/**
 * The Hono app. Exported (not started) so tests can drive it in-process via
 * `app.request(...)` without binding a port. server.ts wraps it in @hono/node-server.
 *
 * The entire API is one route: POST /v1/intent/:name → dispatch. Plus a /health probe.
 */
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { dispatch } from "./core/dispatch.js";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, data: { status: "healthy" } }));

app.post("/v1/intent/:name", async (c) => {
  const name = c.req.param("name");
  // Read the raw body so the dispatcher owns JSON parsing + error shaping (a malformed
  // body must yield our 400 envelope, not Hono's default error).
  const rawBody = await c.req.text();
  const authHeader = c.req.header("authorization") ?? null;
  const clientIp =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "local";

  const { status, body, headers } = await dispatch({ name, authHeader, rawBody, clientIp });
  if (headers) {
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
  }
  return c.json(body, status as ContentfulStatusCode);
});
