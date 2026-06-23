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

/** Steering/admin intents — require `manager` or above. */
const MANAGER_INTENTS = new Set<string>([
  "objective.publish",
  "objective.update",
  "brief.create",
  "question.answer",
]);

export interface AuthzResult {
  allowed: boolean;
  reason?: string;
}

/** Decide whether `role` may call `intent`. Pure + table-driven so the matrix is easy to audit/test. */
export function authorize(intent: string, role: Role): AuthzResult {
  const isWrite = WRITE_INTENTS.has(intent);
  const needsManager = MANAGER_INTENTS.has(intent);

  // CEO is strictly read-only: it may read anything in its (org-wide) scope but mutate nothing.
  if (role === "ceo" && isWrite) {
    return { allowed: false, reason: "the CEO role is read-only" };
  }
  if (needsManager && role !== "manager") {
    // (ceo already returned above for these, since they're writes; so this means role === 'member')
    return { allowed: false, reason: `intent ${intent} requires the manager role` };
  }
  return { allowed: true };
}
