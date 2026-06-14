---
name: db-migration
description: Write a correct Drizzle schema change plus migration and Row-Level Security policy for MemOS. Use when adding or altering any table, index, or RLS policy.
---

# MemOS Database Migration

Schema changes are schema-as-code via Drizzle, then a generated SQL migration, then an RLS policy. Multi-tenant isolation is enforced at the DB — every table that holds tenant data MUST have RLS. Never hand-edit the live DB.

## Steps

### 1. Update the Drizzle schema — `packages/api/src/db/schema.ts`
- Add/alter the table with correct column types, FKs, defaults.
- Every tenant-scoped table carries `project_id` (and/or `team_id`).
- Add indexes for every column you'll filter/join on (`project_id`, `bd_id`, `agent_id`, `created_at`, and `embedding` via an ivfflat/hnsw index for vector columns).
- For semantic search tables (`facts`, `learnings`) include `embedding vector(1536)`.

### 2. Generate the migration
`npx drizzle-kit generate` → review the SQL in `infra/migrations/`. Read it; never apply blind.

### 3. Write the RLS policy (in the same migration or a paired one)
For each tenant-scoped table:
```sql
alter table <t> enable row level security;
create policy <t>_tenant_read on <t> for select
  using (project_id = any(current_setting('memos.agent_projects', true)::text[]));
create policy <t>_tenant_write on <t> for insert
  with check (project_id = any(current_setting('memos.agent_projects', true)::text[]));
```
The gateway sets `memos.agent_projects` per request from the authed token's scopes (via `set_config`). This is the real isolation boundary.

### 4. Apply locally and verify
`pnpm db:migrate`. Then prove isolation with a quick test: an agent scoped to project A cannot select project B's rows.

### 5. Document
If this is a non-trivial modeling choice (e.g. one table serving two roles, vector index type), write/append an ADR via the `write-adr` skill, and update `docs/DATA_MODEL.md` (ER diagram + the new table's fields/indexes).

## Invariants to never break
- No tenant-scoped table without RLS.
- No `select *` path that bypasses the project filter.
- FKs preserve the provenance chain (fact/learning/artifact/checkin → `bd_id`; workflow_run → `target_objective_id`).

## Done when
Schema updated, migration reviewed + applied, RLS policy in place and proven, DATA_MODEL.md current. Commit as `feat(db): <change>`.
