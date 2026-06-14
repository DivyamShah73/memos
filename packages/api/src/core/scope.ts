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
 * statement sets `memos.agent_projects` to the agent's scopes, so RLS sees exactly the
 * agent's projects for the duration.
 */
export function makeWithScope(db: GatewayDb, scopes: string[]): WithScope {
  const literal = toPgArrayLiteral(scopes);
  return function withScope<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('memos.agent_projects', ${literal}, true)`);
      return fn(tx);
    });
  };
}
