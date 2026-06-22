# 006. Briefs isolation via a second RLS GUC (identity-targeting)

- **Status:** accepted
- **Date:** 2026-06-22
- **Deciders:** Divyam Shah

## Context

Briefs are **identity-targeted**: a brief has `target_kind` ∈ {org, team, project, agent} and a `target_id` (`org` / `team.x` / `project.x` / `agent.x`). An agent must see briefs aimed at itself, its team, its org, or one of its projects — but never another org/team's steering. This doesn't fit the `memos.agent_projects` GUC (ADR-004), which carries only project ids: a brief targeted at `team.x` or `org` has no `project_id` to match. The schema deferred this ("briefs... get their own identity policy in Phase 6; handler-enforced until then"). Core invariant #3 says isolation must hold at the DB via RLS, not just in handlers — so briefs need their own DB-level policy.

## Decision

Add a **second request-local GUC**, `memos.agent_identity`, carrying the agent's full identity set as a Postgres text array: `{agent.<id>, team.<id>, <org_id>, project.<a>, project.<b>, …}`. `core/scope.ts` `makeWithScope` now sets both GUCs as the transaction's first statements; `core/dispatch.ts` builds the identity set as `[agent.id, agent.teamId, agent.orgId, ...agent.scopes]` (deduped, nulls dropped). `core/auth.ts` `resolveAgent` left-joins `teams` to resolve `orgId`.

The `briefs` RLS policy (migration 0007) is:
```sql
ALTER TABLE briefs ENABLE ROW LEVEL SECURITY;  ALTER TABLE briefs FORCE ROW LEVEL SECURITY;
CREATE POLICY briefs_select ON briefs FOR SELECT
  USING (target_id = ANY (nullif(current_setting('memos.agent_identity', true), '')::text[]));
CREATE POLICY briefs_insert ON briefs FOR INSERT WITH CHECK (true);
```

A **single `target_id = ANY(identity)` membership test** suffices because the four id namespaces never collide (`org` vs `team.x` vs `project.x` vs `agent.x`) — no need to also match `target_kind`. `nullif(...,'')` mirrors ADR-004's empty-GUC hardening.

**Read-isolation is the boundary; writes are open.** The `SELECT` policy is the confidentiality guarantee (you cannot *see* another tenant's steering). `INSERT` is `WITH CHECK (true)` because a brief is an *outbound* instruction: `question.answer` files a brief targeting a **different** agent (the asker), and an identity-scoped `WITH CHECK` would wrongly reject it. Authoring a brief at someone is like sending a message — not a confidentiality concern. There is no `UPDATE`/`DELETE` policy, so agents can't mutate briefs (supersession is a *new* insert with `supersedes_id`). On top of RLS, `brief.fetch` adds an explicit `(target_kind <> 'project' OR target_id = :project_id)` narrowing, since the identity set spans *all* the agent's projects but a fetch targets one.

The **critic / escalation workers run as the owner** (the `postgres` superuser), which bypasses FORCE RLS — correct, since governance is a fleet-wide sweep across all tenants. The briefs they file are still read-isolated by `briefs_select` when agents fetch.

## Alternatives considered

- **Handler-enforced `WHERE target_id IN (…)`, no RLS.** Rejected: puts brief confidentiality solely in handler code — exactly what invariant #3 forbids; one forgotten clause leaks another org's steering.
- **Reuse `memos.agent_projects` and store all identity tokens in it.** Rejected: that GUC is semantically "the agent's projects" and is consumed by every project-scoped policy as `project_id`; stuffing `team.x`/`org`/`agent.x` into it would be matched against `project_id` columns elsewhere — confusing and fragile. A separate, purpose-named GUC is clearer.
- **A `briefs.org_id`/`team_id`/`project_id` denormalization + project-style RLS.** Rejected: briefs are inherently identity-addressed (incl. a single agent); denormalizing four nullable scope columns + a composite policy is heavier than one membership test.

## Consequences

- **Positive:** brief isolation holds at the DB regardless of handler bugs; one GUC + one policy covers all four target kinds; the identity set is set once per request alongside the project GUC; the targeting test (agent sees its own briefs, not another team's) doubles as the GUC-is-set proof.
- **Negative / tradeoffs:** every request now sets two GUCs (one extra round-trip statement inside the existing transaction — negligible). `resolveAgent` does one extra join for `orgId`. Brief INSERT is intentionally unrestricted at the DB — acceptable because reads are the boundary and no agent intent inserts an arbitrary-target brief except `question.answer` (to the asker); if agent-authored broadcast briefs are ever added, revisit the INSERT policy.
