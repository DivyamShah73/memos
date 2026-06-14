---
name: scaffold-intent
description: Add a new MemOS API intent end-to-end (Zod schema, handler, route registration, test, and API docs) in the consistent project pattern. Use whenever adding or modifying an intent like fact.record, workflow.create, brief.fetch.
---

# Scaffold a MemOS Intent

You are adding one intent to the intent-RPC gateway. Every intent follows the SAME shape so the codebase stays uniform and the gateway's cross-cutting concerns (auth, envelope, rate-limit, trust) apply automatically. Do all steps; do not skip the test or the docs.

## Inputs to gather first
- Intent name (e.g. `learning.record`) — dotted, lowercase.
- Whether it requires auth (everything except `agent.enroll` does).
- Required scope (which project/team the token must have).
- Input fields + types, and which are required.
- Output shape.
- Any **business rules / invariants** it must enforce (especially the evidence gate and non-obvious gate for fact/learning writes).

If any of these are unclear, ask before scaffolding.

## Steps

### 1. Input schema — `packages/shared/src/schemas/<intent>.ts`
Define a Zod schema for the input. Required fields use `.min`/`.refine` as needed. Export the inferred TS type. For fact/learning writes, encode the evidence gate as a `.superRefine`:
```ts
// confidence >= medium requires evidence_artifact_id (and non_obvious_marker for learnings)
.superRefine((v, ctx) => {
  if (v.confidence !== 'low' && !v.evidence_artifact_id) {
    ctx.addIssue({ path: ['evidence_artifact_id'], code: 'custom',
      message: 'is required when confidence >= medium' });
  }
});
```

### 2. Handler — `packages/api/src/intents/<intent>.ts`
Signature: `(ctx: IntentContext, input: <Type>) => Promise<Envelope>`. The `ctx` carries the authed `agent`, the resolved `project`, and db/services handles. The handler:
- Re-checks scope (defense in depth; RLS is the real guard).
- Enforces business rules; on violation return `{ ok:false, error, error_type:'bad_request' }` (200-level), NOT a thrown error.
- Performs the DB write/read via Drizzle.
- Returns `{ ok:true, data }`.

### 3. Register in the dispatcher — `packages/api/src/core/registry.ts`
Add `'<intent>': { schema, handler, requiresAuth, scope }`. The single POST route looks the intent up here, validates with the schema (400 + `field_errors` on failure), runs auth, then calls the handler.

### 4. Test — `packages/api/src/intents/<intent>.test.ts` (Vitest)
Cover: (a) happy path, (b) schema rejection (missing required field → 400 with field_errors), (c) every business-rule invariant (e.g. evidence-less medium write rejected), (d) cross-tenant isolation if the intent reads data (an agent scoped to project A cannot read project B).

### 5. Docs — append to `docs/API.md`
Add a row to the intent table and a request/response example block.

### 6. Verify
Run `pnpm --filter api test` for the new file. Run `pnpm typecheck`. Confirm the envelope shape matches the project standard.

## Done when
Schema + handler + registry + test (all invariants) + docs, typecheck clean, tests green. Commit as `feat(api): add <intent> intent`.
