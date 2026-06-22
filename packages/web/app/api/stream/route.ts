/**
 * SSE proxy: the browser's EventSource connects here; this server route opens the gateway's
 * authenticated SSE stream with the operator token and pipes it through — so the token never
 * leaves the server (ADR-007).
 */
import { API_URL, OPERATOR_TOKEN } from "@/lib/memos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("project_id") ?? "project.demo";
  const upstream = await fetch(
    `${API_URL}/v1/stream/activity?project_id=${encodeURIComponent(projectId)}`,
    { headers: { authorization: `Bearer ${OPERATOR_TOKEN}` } },
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
