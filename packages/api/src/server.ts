/**
 * MemOS intent-RPC gateway entrypoint.
 *
 * Phase 0 placeholder so `pnpm dev:api` resolves. The real Hono gateway — single
 * `POST /v1/intent/{name}` route, uniform envelope, bearer auth, Zod validation, and the
 * per-request `memos.agent_projects` RLS context — is built in Phase 1 (see ADR-001).
 */
console.log(
  "MemOS gateway: not implemented yet (Phase 1). " +
    "For Phase 0, use `pnpm db:migrate` and `bash testing/phase0.sh`.",
);
