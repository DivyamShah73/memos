/**
 * Server-only gateway client. The dashboard never talks to Postgres directly — it calls the
 * MemOS intent gateway with a seeded OPERATOR token, so the same RLS + evidence rules apply to
 * the UI as to any agent (ADR-007). The token comes from a non-NEXT_PUBLIC env var, so Next never
 * inlines it into client bundles; import these helpers only from server components / route handlers.
 */
export const API_URL = process.env.MEMOS_API_URL ?? "http://127.0.0.1:8787";
export const OPERATOR_TOKEN = process.env.MEMOS_OPERATOR_TOKEN ?? "";

export async function callIntent<T = unknown>(
  name: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${API_URL}/v1/intent/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPERATOR_TOKEN}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? `intent ${name} failed (${res.status})`);
  return json.data as T;
}
