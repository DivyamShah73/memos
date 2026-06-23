/**
 * Server-only gateway client. The dashboard calls the MemOS intent gateway AS the logged-in user:
 * the user's session token lives in the signed httpOnly cookie (Phase 13 / ADR-011), so the same
 * RLS + role rules bind the UI as bind that user's agents. Import these only from server components /
 * actions / route handlers (they read cookies + never expose the token to the browser).
 */
import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "./session";

export const API_URL = process.env.MEMOS_API_URL ?? "http://127.0.0.1:8787";
/** Cookie holding the dashboard's currently-selected project (set by the project switcher). */
export const PROJECT_COOKIE = "memos_project";

/** The logged-in user's gateway token from the session cookie (null if unauthenticated). */
export async function sessionToken(): Promise<string | null> {
  const jar = await cookies();
  return readSession(jar.get(SESSION_COOKIE)?.value);
}

export async function callIntent<T = unknown>(
  name: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const token = await sessionToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/v1/intent/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? `intent ${name} failed (${res.status})`);
  return json.data as T;
}

/**
 * The dashboard's selected project: the `memos_project` cookie if set, else the logged-in user's
 * first accessible project (from agent.me). Async because it reads cookies / may query the gateway.
 */
export async function getProjectId(): Promise<string> {
  const jar = await cookies();
  const selected = jar.get(PROJECT_COOKIE)?.value;
  if (selected) return selected;
  try {
    const me = await callIntent<{ scopes: string[] }>("agent.me");
    return me.scopes?.[0] ?? "project.demo";
  } catch {
    return "project.demo";
  }
}

/** All projects the logged-in user can see (for the switcher) — from their principal scope. */
export async function getUserProjects(): Promise<string[]> {
  try {
    const me = await callIntent<{ scopes: string[] }>("agent.me");
    return me.scopes ?? [];
  } catch {
    return [];
  }
}
