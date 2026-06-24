/**
 * SSE proxy: the browser's EventSource connects here; this server route opens the gateway's
 * authenticated SSE stream with the operator token and pipes it through — so the token never
 * leaves the server (ADR-007).
 */
import { cookies } from "next/headers";
import { API_URL } from "@/lib/memos";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  // The middleware only checks cookie presence (edge runtime). Verify + extract the signed session
  // token here, and open the upstream stream AS the logged-in user (Phase 13) — so the live feed is
  // scoped by that user's role + projects, just like every other read.
  const jar = await cookies();
  const token = readSession(jar.get(SESSION_COOKIE)?.value);
  if (!token) {
    return new Response("unauthorized", { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("project_id") ?? "project.demo";
  const upstream = await fetch(
    `${API_URL}/v1/stream/activity?project_id=${encodeURIComponent(projectId)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  if (!upstream.ok || !upstream.body) {
    return new Response("stream unavailable", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
