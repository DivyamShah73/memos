# 010. Roles & authorization: a central capability matrix, CEO read-only

- **Status:** accepted
- **Date:** 2026-06-24
- **Deciders:** Divyam Shah

## Context

Phase 11 answered "*which org/projects can you see?*" (isolation). It never answered "*what are you allowed to do?*" — any valid principal could call any intent in its scope, so the same agent that records facts could also publish OKRs and author org/team briefs. The product needs **steering authority** distinct from **contribution**: managers steer (OKRs, briefs), members/agents contribute, and a **CEO observes the whole org read-only**.

## Decision

A **role** on the principal + a **central authorization matrix** enforced at the single dispatch choke point.

- **`role` on `agents`** (`member` | `manager` | `ceo`, default `member`), inherited from the enrollment code (`enrollment_codes.role`). The seeded dashboard operator is `manager` (it steers in the demo). A user-session principal's role (Phase 13) will come from `memberships`.
- **`core/authz.ts`** holds the whole matrix in one auditable place — two sets (`WRITE_INTENTS`, `MANAGER_INTENTS`) and a pure `authorize(intent, role)`. Chosen over per-intent flags scattered across the 23 registry entries because the role→capability policy is a *security* surface that should be reviewable at a glance and unit-tested in isolation.
- **`dispatch` calls `authorize` after auth, before the handler**, returning the existing `403` envelope. Rules:
  - **CEO is read-only**: any `WRITE_INTENTS` member is denied for `ceo` (even though ceo outranks for reads).
  - **Steering needs manager**: `MANAGER_INTENTS` (objective.publish/update, brief.create, question.answer) require `manager`.
  - everything else (queries, introspection, brief.fetch) is allowed for any role — the safe default for intents not listed.
- Capability tiers: member = contribute (workflow/checkin/artifact/fact/learning/milestone/key_result/question.ask/brief.ack); manager = member + steer; ceo = read-only org-wide (its all-org read scope comes from Phase 11's `resolveUserScope`).

## Alternatives considered

- **Per-intent `minRole`/`write` flags on every registry entry.** Rejected: scatters the security policy across 23 edits, easy to miss one; a single matrix module is easier to audit and test.
- **A linear role rank (member<manager<ceo) for everything.** Rejected: ceo is not "more powerful" — it's *read-only*. Writes must be denied for ceo even though it outranks for reads, so the check is two-dimensional (write? + needs-manager?), not a single rank.
- **RLS-level write denial for ceo.** Rejected: capability is not tenancy; it belongs at the application choke point (the gateway), keeping RLS focused purely on row visibility.

## Consequences

- **Positive:** one place defines who-can-do-what; CEO read-only is enforced uniformly; agents are correctly limited to contribution; the guard reuses the proven dispatch pipeline + 403 envelope; trivially unit-testable (`authorize` is pure) and proven end-to-end (`phase12.sh` + the authz suite).
- **Negative / tradeoffs:** intents not listed in the matrix default to member-readable — adding a new *write* intent means remembering to add it to `WRITE_INTENTS` (mitigated by the scaffold-intent skill + the authz test). Existing agent-driven flows that publish OKRs/briefs now need a `manager` code (demo/test scripts updated accordingly). Role is per-agent, not yet per-(agent,project) — fine for the current model; revisit if an agent ever needs different roles in different projects.
