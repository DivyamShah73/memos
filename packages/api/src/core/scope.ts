/**
 * Per-request RLS scoping (ADR-002 / ADR-004).
 *
 * The gateway connects as the non-owner `memos_app` role, so RLS policies apply. Before any
 * query touches a tenant-scoped table, the per-request transaction sets
 * `memos.agent_projects` to the authed agent's scopes (`SET LOCAL` semantics via
 * `set_config(..., true)`). postgres-js pins every query in a `db.transaction` callback to a
 * single connection, so the GUC is correctly scoped to that transaction and auto-resets on
 * commit/rollback. RLS then filters reads (USING) and gates writes (WITH CHECK) by project.
 */
import { sql } from "drizzle-orm";
import type { GatewayDb } from "../db/gateway.js";

// The transaction handle drizzle hands the callback — derived from the live signature so it
// always matches the installed drizzle/driver version (hand-writing PgTransaction generics is
// brittle).
export type ScopedTx = Parameters<Parameters<GatewayDb["transaction"]>[0]>[0];

/**
 * Format a scopes list as a Postgres array literal, e.g. `{project.a,project.b}`. The value is
 * passed to `set_config` as a bound parameter (never interpolated into SQL); the `::text[]`
 * cast happens later inside the RLS policy. Project ids are `[a-z0-9._-]` — none of Postgres's
 * array-literal metacharacters — so a plain join is safe; we still reject anything else as a
 * defense against a corrupt `scopes` column. Empty list → `{}` (valid empty array → deny-all).
 */
export function toPgArrayLiteral(scopes: string[]): string {
  for (const s of scopes) {
    if (!/^[a-z0-9._-]+$/i.test(s)) {
      throw new Error(`unsafe scope id: ${JSON.stringify(s)}`);
    }
  }
  return `{${scopes.join(",")}}`;
}

export type WithScope = <T>(fn: (tx: ScopedTx) => Promise<T>) => Promise<T>;

/**
 * Build the agent-bound `withScope` helper. Runs `fn` inside a transaction whose first
 * statements set the three request-local GUCs so RLS sees exactly this principal:
 *  - `memos.agent_projects` — the project scopes (project-scoped tables: facts, objectives, …).
 *  - `memos.agent_identity` — the full identity set {agent.x, team.x, org, project.*}, for the
 *    identity-targeted `briefs` policy (Phase 6 / ADR-006).
 *  - `memos.org_id` — the principal's org, for the control-plane org policy on users/memberships
 *    (Phase 11 / ADR-009).
 * `identity` defaults to `scopes` and `orgId` to null so existing callers keep working unchanged.
 */
export function makeWithScope(
  db: GatewayDb,
  scopes: string[],
  identity: string[] = scopes,
  orgId: string | null = null,
): WithScope {
  const projectsLiteral = toPgArrayLiteral(scopes);
  const identityLiteral = toPgArrayLiteral(identity);
  // Scalar org id for the control-plane org policy (users/memberships). '' when absent → the
  // policy's nullif(...,'') maps it to NULL → deny (same default-deny posture as the array GUCs).
  const org = orgId ?? "";
  return function withScope<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('memos.agent_projects', ${projectsLiteral}, true),
                   set_config('memos.agent_identity', ${identityLiteral}, true),
                   set_config('memos.org_id', ${org}, true)`,
      );
      return fn(tx);
    });
  };
}
