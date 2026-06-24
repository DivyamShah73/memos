/**
 * member.list (Phase 15, manager/CEO) — the human members of the caller's org: each user with their
 * memberships (role + scope). `users`/`memberships` are org-RLS'd, so we read through `withScope`
 * (which sets the `memos.org_id` GUC) — a raw read would return 0 rows (default-deny). Org isolation
 * is therefore enforced at the DB: a caller only ever sees their own org's people.
 */
import { eq } from "drizzle-orm";
import type { MemberListInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { memberships, users } from "../db/schema.js";

export async function memberList(ctx: IntentContext, _input: MemberListInput): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  // Single org-scoped read (memos.org_id GUC → bounded to the caller's org by RLS). One LEFT JOIN
  // instead of two transactions: a user with no memberships still appears (null membership columns),
  // and the join is read inside one transaction so users/memberships can't drift between reads.
  const rows = await withScope((tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
        role: memberships.role,
        scopeKind: memberships.scopeKind,
        scopeId: memberships.scopeId,
      })
      .from(users)
      .leftJoin(memberships, eq(memberships.userId, users.id)),
  );

  const byUser = new Map<
    string,
    {
      user_id: string;
      email: string;
      display_name: string;
      status: string;
      memberships: { role: string; scope_kind: string; scope_id: string }[];
    }
  >();
  for (const r of rows) {
    let entry = byUser.get(r.id);
    if (!entry) {
      entry = { user_id: r.id, email: r.email, display_name: r.displayName, status: r.status, memberships: [] };
      byUser.set(r.id, entry);
    }
    if (r.role !== null) {
      entry.memberships.push({ role: r.role, scope_kind: r.scopeKind!, scope_id: r.scopeId! });
    }
  }

  return ok({ members: [...byUser.values()] });
}
