/**
 * The Hono app. Exported (not started) so tests can drive it in-process via
 * `app.request(...)` without binding a port. server.ts wraps it in @hono/node-server.
 *
 * The entire API is one route: POST /v1/intent/:name → dispatch. Plus a /health probe.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getConnInfo } from "@hono/node-server/conninfo";
import { dispatch } from "./core/dispatch.js";
import { ERROR_TYPE } from "./core/envelope.js";

// Cap the request body so a huge payload can't OOM the gateway before any gate runs.
// 8 MiB leaves room for Phase 3 base64 artifact uploads; tune per-intent later.
const MAX_BODY_BYTES = Number(process.env.MEMOS_MAX_BODY_BYTES) || 8 * 1024 * 1024;

export const app = new Hono();

// Final safety net: any throw that escapes a handler still returns the uniform envelope,
// never Hono's default plain-text "Internal Server Error".
app.onError((err, c) => {
  console.error("unhandled gateway error:", err);
  return c.json(
    { ok: false, error: "internal error", detail: {}, error_type: ERROR_TYPE.platform },
    500,
  );
});

app.get("/health", (c) => c.json({ ok: true, data: { status: "healthy" } }));

app.post(
  "/v1/intent/:name",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) =>
      c.json(
        { ok: false, error: "request body too large", detail: {}, error_type: ERROR_TYPE.validation },
        413,
      ),
  }),
  async (c) => {
    const name = c.req.param("name");
    // Read the raw body so the dispatcher owns JSON parsing + error shaping (a malformed
    // body must yield our 400 envelope, not Hono's default error).
    const rawBody = await c.req.text();
    const authHeader = c.req.header("authorization") ?? null;
    // Rate-limit key source is the ACTUAL connection's remote address, not a client-supplied
    // header — X-Forwarded-For is spoofable and would let a caller mint a fresh bucket per
    // request. Trusted-proxy XFF handling (with an allowlist) is Phase 6.
    let clientIp = "local";
    try {
      clientIp = getConnInfo(c).remote.address ?? "local";
    } catch {
      clientIp = "local"; // no socket (e.g. in-process app.request during tests)
    }

    const { status, body, headers } = await dispatch({ name, authHeader, rawBody, clientIp });
    if (headers) {
      for (const [k, v] of Object.entries(headers)) c.header(k, v);
    }
    return c.json(body, status as ContentfulStatusCode);
  },
);
