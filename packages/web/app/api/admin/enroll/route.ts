/**
 * Mint-enrollment-code proxy (Phase 15). A server action can't return a value to render, but the
 * minted code must be shown + copied client-side — so the MintCodeForm posts here and we proxy to
 * the gateway's enrollment.create AS the logged-in user (token from the signed cookie, never exposed
 * to the browser — same pattern as /api/stream). The gateway enforces role + scope.
 */
import { cookies } from "next/headers";
import { API_URL } from "@/lib/memos";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const jar = await cookies();
  const token = readSession(jar.get(SESSION_COOKIE)?.value);
  if (!token) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { project_id?: string; role?: string };
  try {
    const res = await fetch(`${API_URL}/v1/intent/enrollment.create`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ project_id: body.project_id, role: body.role }),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!json) return Response.json({ ok: false, error: "gateway returned a non-JSON response" }, { status: 502 });
    return Response.json(json, { status: res.status });
  } catch {
    return Response.json({ ok: false, error: "could not reach the gateway" }, { status: 502 });
  }
}
