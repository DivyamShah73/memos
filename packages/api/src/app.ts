/**
 * The Hono app. Exported (not started) so tests can drive it in-process via
 * `app.request(...)` without binding a port. server.ts wraps it in @hono/node-server.
 *
 * The entire API is one route: POST /v1/intent/:name → dispatch. Plus a /health probe.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getConnInfo } from "@hono/node-server/conninfo";
import { dispatch } from "./core/dispatch.js";
import { ERROR_TYPE } from "./core/envelope.js";
import { extractBearer, resolveAgent } from "./core/auth.js";
import { resolveUserPrincipal } from "./core/users.js";
import { subscribeActivity, type ActivityEvent } from "./core/events.js";
import { gatewayDb } from "./db/gateway.js";

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

// Live activity stream (Phase 7, SSE) — the dashboard feed's real-time tail. Authenticated by
// bearer and scoped to one project. The dashboard's Next.js server proxies this with the logged-in
// USER's session token (Phase 13), so the principal may be an agent OR a user — resolve both the
// same way dispatch does (agent first, then user). The browser EventSource never holds the token.
// Subscribes to the in-process event bus; write handlers publish post-commit. See ADR-007 / ADR-011.
app.get("/v1/stream/activity", async (c) => {
  const unauthorized = { ok: false, error: "authentication required", detail: {}, error_type: ERROR_TYPE.unauthorized };
  const token = extractBearer(c.req.header("authorization"));
  if (!token) return c.json(unauthorized, 401);
  const agent = (await resolveAgent(gatewayDb, token)) ?? (await resolveUserPrincipal(token));
  if (!agent) return c.json(unauthorized, 401);

  const projectId = c.req.query("project_id") ?? "";
  if (!projectId) {
    return c.json(
      { ok: false, error: "project_id: is required", detail: { field_errors: { project_id: ["is required"] } }, error_type: ERROR_TYPE.validation },
      400,
    );
  }
  if (!agent.scopes.includes(projectId)) {
    return c.json({ ok: false, error: `project ${projectId} is not in scope`, detail: {}, error_type: ERROR_TYPE.forbidden }, 403);
  }

  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no"); // disable proxy buffering so frames flush immediately
  return streamSSE(c, async (stream) => {
    // The emitter callback is sync; buffer events and drain them in the loop (writeSSE is async).
    // Cap the queue so a stalled consumer + sustained writes can't grow the heap without bound;
    // on overflow we drop the oldest (the feed is best-effort, newest-first).
    const MAX_QUEUE = 500;
    let queue: ActivityEvent[] = [];
    const unsubscribe = subscribeActivity((ev) => {
      if (ev.projectId !== projectId) return;
      queue.push(ev);
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    });
    stream.onAbort(unsubscribe);

    await stream.writeSSE({ event: "ready", data: JSON.stringify({ project_id: projectId }) });
    let ticks = 0;
    while (!stream.aborted) {
      if (queue.length > 0) {
        const batch = queue;
        queue = [];
        for (const ev of batch) await stream.writeSSE({ event: "activity", data: JSON.stringify(ev) });
      }
      if (++ticks % 15 === 0) await stream.writeSSE({ event: "ping", data: "" }); // ~15s heartbeat
      await stream.sleep(1000);
    }
    unsubscribe();
  });
});

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
