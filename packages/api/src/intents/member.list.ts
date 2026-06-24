/**
 * member.list (Phase 15, manager/CEO) — the human members of the caller's org: each user with their
 * memberships (role + scope). `users`/`memberships` are org-RLS'd, so we read through `withScope`
 * (which sets the `memos.org_id` GUC) — a raw read would return 0 rows (default-deny). Org isolation
 * is therefore enforced at the DB: a caller only ever sees their own org's people.
 */
import type { MemberListInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { memberships, users } from "../db/schema.js";

export async function memberList(ctx: IntentContext, _input: MemberListInput): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  // Both reads run org-scoped (memos.org_id GUC) → bounded to the caller's org by RLS.
  const userRows = await withScope((tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
      })
      .from(users),
  );
  const memRows = await withScope((tx) =>
    tx
      .select({
        userId: memberships.userId,
        role: memberships.role,
        scopeKind: memberships.scopeKind,
        scopeId: memberships.scopeId,
      })
      .from(memberships),
  );

  const byUser = new Map<string, { role: string; scope_kind: string; scope_id: string }[]>();
  for (const m of memRows) {
    const list = byUser.get(m.userId) ?? [];
    list.push({ role: m.role, scope_kind: m.scopeKind, scope_id: m.scopeId });
    byUser.set(m.userId, list);
  }

  const members = userRows.map((u) => ({
    user_id: u.id,
    email: u.email,
    display_name: u.displayName,
    status: u.status,
    memberships: byUser.get(u.id) ?? [],
  }));

  return ok({ members });
}
