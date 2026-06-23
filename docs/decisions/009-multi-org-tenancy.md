# 009. Multi-org tenancy: denormalized org_id, an org GUC, and DB-isolated people

- **Status:** accepted
- **Date:** 2026-06-23
- **Deciders:** Divyam Shah

## Context

v1 (Phases 0–10) is single-operator: one shared-password dashboard acting as one seeded agent, and AI agents enrolled with project scopes. Turning MemOS into a product sold to many organizations requires **human identity** (people, distinct from agents), **org-bounded membership/roles**, and **multi-org isolation enforced at the database** — org B must never read org A's data *or* its people/structure.

The data plane (facts/learnings/OKRs/…) is already cross-org isolated *for free*: it's project-scoped via the `memos.agent_projects` GUC + RLS (ADR-002/004), and an agent only ever holds its own org's project ids. The new surface is **human identity + the control plane**.

The hard constraint is an ordering deadlock: **authentication must read identity to discover the org *before* an org GUC can be set.** `resolveAgent` looked up the agent by token hash and `LEFT JOIN`ed `teams` for `orgId`; `agent.enroll` reads `enrollment_codes`. If those tables (or `teams`) were RLS'd on an org GUC that isn't set yet, the gateway would be locked out of its own auth tables — the exact reason ADR-002 left orgs/teams/projects/agents/enrollment_codes un-RLS'd.

## Decision

1. **Denormalize `org_id`** onto `agents`, `enrollment_codes`, and `projects` (and onto the new `users`/`memberships`); `teams` already has it. `resolveAgent` now reads `org_id` straight from the `agents` row (no `teams` join), and `enroll` stamps the new agent's `org_id` from the `enrollment_codes` row — each auth-bootstrap step resolves its org from a **single by-credential row**.
2. **A third request-local GUC, `memos.org_id`**, set post-auth in `makeWithScope` alongside `memos.agent_projects` and `memos.agent_identity`, from the principal's `org_id`.
3. **People are first-class and org-bounded.** New `users` (humans; scrypt password hash — a low-entropy secret, unlike the 256-bit agent tokens that stay SHA-256 per ADR-003) and `memberships` (`(user, scope_kind, scope_id) → role`, role ∈ ceo|manager|member). A user's read scope is resolved from memberships and fed into the *same* `agent_projects` GUC — one isolation mechanism serves agents and humans.
4. **DB-enforced isolation, scoped to the new people tables this phase.** `users` and `memberships` get `ENABLE`+`FORCE` RLS with the scalar policy `org_id = nullif(current_setting('memos.org_id', true), '')` (the 0004 empty-GUC hardening, scalar form). Nothing reads these tables pre-GUC (the by-email login lookup uses the owner connection), so there's no deadlock. **Structural-table (projects/teams/agents) enumeration RLS is deferred to the phase that introduces enumeration intents** (13/14) — until then no cross-org enumeration path exists, and routing handler control-plane reads through the org GUC there is safer done with those features than retrofitted blind.

## Alternatives considered

- **RLS `teams` (keep the join).** Rejected: deadlocks auth — `resolveAgent` runs before any GUC.
- **A CEO/bypass RLS policy branch.** Rejected (and is a later concern): an unauditable backdoor in every policy. The CEO role (Phase 12) is instead a *widened scope* (org GUC → all org projects), reusing RLS.
- **FORCE-RLS every control-plane table now.** Rejected for this phase: orgs/teams/projects/agents are read by existing handlers via the non-scoped `ctx.db` path, so blanket org-RLS would regress the proven core (smoke 0–10). Denormalize org_id everywhere now (cheap, non-breaking); add structural RLS with the enumeration features.
- **Owner connection for all auth.** Used only narrowly (the by-email user-login lookup); agent auth needs no owner since `agents` stays un-RLS'd and is looked up by token hash.

## Consequences

- **Positive:** people are DB-isolated across orgs from day one; `org_id` is threaded everywhere as the foundation for roles (12), per-user dashboard (13), and admin (14); the auth/enroll path is untouched (no regression); humans and agents share one RLS mechanism.
- **Negative / tradeoffs:** `org_id` is denormalized (must be set on every projects/agents/enrollment_codes insert — enforced NOT NULL + handler/seed updates); structural-table enumeration is handler-scoped until its RLS lands in 13/14 (acceptable: no enumeration intent exists yet); one narrow owner-connection use for by-email login (documented bootstrap exception).
