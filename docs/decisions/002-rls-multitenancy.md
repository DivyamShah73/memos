# 002. Multi-tenant isolation via Postgres RLS with a non-owner app role + FORCE

- **Status:** accepted
- **Date:** 2026-06-14
- **Deciders:** Divyam Shah

## Context

MemOS is multi-tenant (org → team → project). Team A must never see Team B's facts — this is a security boundary, not a nicety, and it is a core product invariant. The deliberate exception is cross-silo *learning* discovery, which is a separate, curated, problem-domain-tag-filtered read path (learnings only, never facts). Isolation must survive a bug in any single handler, so it has to live below the handlers, at the database.

## Decision

Enforce isolation with **Postgres Row-Level Security**, and make it real by **separating roles**:

- **Migrations run as the owner/superuser** (`DATABASE_URL` → `postgres`): DDL, `CREATE EXTENSION`, tables, policies, GRANTs.
- **The gateway connects at runtime as a dedicated non-owner, non-superuser role `memos_app`** (`MEMOS_APP_DATABASE_URL`). Per request it runs `set_config('memos.agent_projects', '{project.a,…}', true)` derived from the authed token's scopes.
- Every project-scoped table gets `ENABLE` **and** `FORCE ROW LEVEL SECURITY` plus four policies (select/insert/update/delete) keyed on `project_id = ANY(current_setting('memos.agent_projects', true)::text[])`, and `memos_app` receives table GRANTs.

`FORCE` is the load-bearing detail: in Postgres, **table owners and superusers BYPASS RLS by default**. If the gateway connected as the owner, policies would be silently inert and isolation would be theatre. A non-owner role + FORCE guarantees the policies bite even for the role that owns the schema. UPDATE policies carry both `USING` and `WITH CHECK` so a row cannot be moved into another tenant.

Tables that are **not** tenant-scoped get no `project_id` policy: control-plane tables (`orgs, teams, projects, agents, enrollment_codes, brief_acks, feedback`) are touched during enrollment/auth *before* any project scope exists — an RLS policy there would deadlock the gateway out of its own auth tables. `briefs` are identity-targeted (org/team/project/agent), so they get a distinct identity-based policy in Phase 6, handler-enforced until then. `milestones` and `choices`, which the spec scopes indirectly, carry a **denormalized `project_id`** so the uniform policy template applies.

## Alternatives considered

- **Handler-only filtering (every query adds `where project_id = …`).** Rejected: one forgotten clause leaks another tenant's data, and the leak is invisible until exploited. No defense in depth. RLS makes the database refuse regardless of handler bugs.
- **RLS with the app connecting as the table owner (policies only, no separate role / no FORCE).** Rejected: owners bypass RLS, so this looks enforced but isn't — the exact "passes review, fails in prod" trap. It would make the isolation test pass for the wrong reason or silently not run.
- **Schema-per-tenant or database-per-tenant.** Rejected: strong isolation but it doesn't fit a store whose value includes a *cross-tenant* learning-discovery path, and it explodes operational complexity (migrations × N tenants, connection routing) for a portfolio-scale system.
- **Defining RLS in Drizzle `pgPolicy()` schema-as-code.** Rejected for this project: drizzle-kit does not generate `FORCE ROW LEVEL SECURITY` or `GRANT`, and `.enableRLS()` is being deprecated — two of the three statements we need aren't expressible. A single hand-authored `0002_rls.sql` reads exactly like the DATA_MODEL §4 spec a reviewer checks against, and is more reviewable than a half-in-schema/half-in-SQL split.

## Consequences

- **Positive:** isolation is a DB guarantee independent of handler correctness (defense in depth: handler filter + RLS + audit log). The owner/app-role split is explicit and testable ("can Agent A read Project B?" must return zero rows).
- **Negative / tradeoffs:** two connection strings and two roles to manage. An unset GUC yields zero rows (safe default-deny) but *silently* — a forgotten per-request `set_config` looks like "no data," not "broken auth," so the gateway always sets it (ADR-004) and a test asserts the unset case returns nothing.
- **Correction (Phase 2): `FORCE` vs. superuser.** An earlier draft of this ADR (and `seed.ts`) claimed `FORCE` makes the *owner* subject to RLS, so the owner-run seed must set the GUC. That is **wrong for our config**: the owner connection (`DATABASE_URL`) is the **`postgres` superuser**, and a superuser bypasses RLS *unconditionally* — `FORCE` only removes the *non-superuser table-owner's* implicit bypass, which doesn't apply to a superuser. So fixtures/seed insert cross-tenant rows with **no GUC dance**; `FORCE` is defense-in-depth for the hypothetical future where the gateway/seed connects as a non-superuser table-owner. (If we ever switch the owner to such a role, the GUC-before-insert requirement becomes real.)
- **Follow-ups:** Phase 1 wires the gateway to connect as `memos_app` and set the GUC per request; an isolation test (A cannot read B) is part of the write-path test suite; the briefs identity policy lands in Phase 6; the curated cross-silo learning read path is an explicit, audited query, treated as privileged.
