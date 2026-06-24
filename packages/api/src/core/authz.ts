/**
 * Authorization policy (Phase 12 / ADR-010) — the role→capability matrix, in one auditable place.
 *
 * Every authed intent is classified here. The dispatch guard calls {@link authorize} after auth and
 * before the handler. Roles: `member` (contribute), `manager` (steer: OKRs/briefs/admin), `ceo`
 * (read-only org-wide). The rules:
 *   - WRITE intents are denied for `ceo` (the read-only role) — even though ceo outranks for reads.
 *   - MANAGER intents (steering) require manager or above.
 *   - everything else is readable/usable by any role (member+).
 *
 * Intents NOT listed are treated as member-level reads (the safe default for query/introspection).
 * agent.enroll is public (no principal) and never reaches this guard.
 */
export type Role = "member" | "manager" | "ceo";

/** State-mutating intents — denied for the read-only `ceo` role. */
const WRITE_INTENTS = new Set<string>([
  // contribute (member+)
  "workflow.create",
  "checkin",
  "artifact.upload",
  "fact.record",
  "learning.record",
  "milestone.achieve",
  "key_result.update",
  "question.ask",
  "brief.ack",
  // steer (manager+) — also in MANAGER_INTENTS below
  "objective.publish",
  "objective.update",
  "brief.create",
  "question.answer",
]);

/** Steering intents (author project CONTENT) — require `manager` (and CEO is read-only, so denied). */
const MANAGER_INTENTS = new Set<string>([
  "objective.publish",
  "objective.update",
  "brief.create",
  "question.answer",
]);

/**
 * Org ADMINISTRATION intents (Phase 14) — manage the org itself: members, agent codes, lifecycle.
 * Allowed for `manager` OR `ceo`. These are deliberately NOT subject to the CEO read-only rule: the
 * CEO administers the org (invites, offboards) even though it can't author project content. Members
 * cannot administer.
 */
const ADMIN_INTENTS = new Set<string>([
  "enrollment.create",
  "user.invite",
  "agent.revoke",
  "member.offboard",
  // Admin READS (Phase 15) — listing the org's people/agents is manager/CEO-only (members can't
  // enumerate the org). Same tier: allowed for manager OR ceo, not blocked by the read-only rule.
  "member.list",
  "agent.list",
]);

export interface AuthzResult {
  allowed: boolean;
  reason?: string;
}

/** Decide whether `role` may call `intent`. Pure + table-driven so the matrix is easy to audit/test.
 * Accepts a raw string and normalizes any unrecognized value to the least-privileged `member`
 * (defense-in-depth — the DB CHECK already constrains the column, but an elevated capability must
 * never come from an unvalidated string). */
export function authorize(intent: string, rawRole: string): AuthzResult {
  const role: Role = rawRole === "manager" || rawRole === "ceo" ? rawRole : "member";

  // Org administration takes precedence and is allowed for manager OR ceo (NOT read-only-blocked):
  // the CEO runs the org even though it can't author project content.
  if (ADMIN_INTENTS.has(intent)) {
    return role === "manager" || role === "ceo"
      ? { allowed: true }
      : { allowed: false, reason: `intent ${intent} requires the manager or CEO role` };
  }

  const isWrite = WRITE_INTENTS.has(intent);
  const needsManager = MANAGER_INTENTS.has(intent);

  // CEO is read-only on CONTENT: it may read anything in its (org-wide) scope but mutate nothing.
  if (role === "ceo" && isWrite) {
    return { allowed: false, reason: "the CEO role is read-only" };
  }
  if (needsManager && role !== "manager") {
    // (ceo already returned above for these, since they're writes; so this means role === 'member')
    return { allowed: false, reason: `intent ${intent} requires the manager role` };
  }
  return { allowed: true };
}
