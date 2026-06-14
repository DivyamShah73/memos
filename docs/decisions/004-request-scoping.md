# 004. Per-request RLS scoping via a transaction-local GUC

- **Status:** accepted
- **Date:** 2026-06-15
- **Deciders:** Divyam Shah

## Context

ADR-002 chose RLS as the isolation boundary and the `memos_app` non-owner role for the gateway, with policies keyed on a per-request `memos.agent_projects` setting. Phase 2 is the first time the gateway writes/reads RLS-protected tables (`workflow_runs`, `checkins`, `objectives`), so the *mechanism* for setting that GUC per request — safely, without leaking scope between pooled connections — has to be pinned down.

## Decision

Each request's tenant DB work runs inside a transaction whose **first statement** sets the GUC from the authed agent's scopes:

```ts
db.transaction(async (tx) => {
  await tx.execute(sql`select set_config('memos.agent_projects', ${literal}, true)`); // is_local = true
  return fn(tx);
});
```

postgres-js pins every query in a `transaction` callback to one connection, so `set_config(..., true)` (= `SET LOCAL`) is scoped to that transaction and auto-reverts on commit/rollback — no cross-request leakage on a pooled connection. This is exposed to handlers as an agent-bound `ctx.withScope(fn)` (built in the dispatcher only for authed intents; `core/scope.ts` holds the logic). `literal` is the Postgres array literal `{project.a,project.b}` passed as a bound parameter (the `::text[]` cast happens inside the policy, so there's no SQL-injection surface; ids are validated `[a-z0-9._-]` anyway).

**Layering (defense in depth):** handlers also do an explicit `project_id ∈ agent.scopes` check returning **403** before the write. This is load-bearing, not cosmetic: an out-of-scope INSERT trips RLS `WITH CHECK` and **throws `42501`** (→ a 500), so the pre-check is what produces a clean 403; a `42501` catch is kept as a backstop. (Reads are the silent case: an out-of-scope SELECT returns 0 rows, which is how "unknown workflow run" arises.)

**Policy hardening:** the policy predicate is `project_id = ANY(nullif(current_setting('memos.agent_projects', true), '')::text[])`. The `nullif(..., '')` is required because a *custom* GUC (dotted name) that was ever `SET LOCAL` reverts to an **empty string** (not NULL) after the transaction — so on a reused pooled connection a bare `''::text[]` cast raises `malformed array literal` instead of denying. `nullif` maps both unset (NULL) and empty (`''`) to NULL → `= ANY(NULL)` → 0 rows (default-deny), no error (migration 0004).

## Alternatives considered

- **Set the GUC per connection at the session level (`set_config(..., false)`).** Rejected: with a connection pool, a session-level setting leaks to the next request that reuses the connection — a cross-tenant data leak. Transaction-local is the only safe choice with pooling.
- **A dedicated pooled connection per agent.** Rejected: doesn't scale (N agents × connections), and still needs the GUC set per checkout; the transaction-local approach is simpler and stateless.
- **Skip the GUC; filter only in handler SQL (`where project_id = …`).** Rejected — this is exactly the handler-only filtering ADR-002 rejected; one forgotten clause leaks data. RLS must be the backstop.

## Consequences

- **Positive:** isolation holds at the DB regardless of handler bugs; scope is set once per request in one place (`withScope`); no cross-request leakage; the "unset → default-deny" property is robust (handles the empty-string GUC case).
- **Negative / tradeoffs:** every tenant operation runs in a transaction (fine for short writes; revisit for long-running/streaming handlers). Reads of RLS'd tables **must** go through `withScope` — a raw `gatewayDb` read of an RLS table returns 0 rows (correct, but a silent footgun), so `context.ts` documents this and handlers use the raw client only for the un-RLS'd control-plane tables. A test asserts the GUC is actually doing the gating (no-scope read → `[]`; scoped read → row) so isolation can't pass for the wrong reason.
