-- Prerequisites that MUST exist before 0001_init.sql runs.
-- drizzle-kit never emits CREATE EXTENSION, but facts/learnings declare vector(1536),
-- so the vector type has to exist first. The memos_app role is the non-owner the
-- gateway connects as (Phase 1) so RLS policies actually apply — see docs/decisions/002.

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
-- Keep this DO block a single statement (no internal breakpoint) so the dollar-quoted
-- body is not split by the migrator.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memos_app') THEN
    CREATE ROLE memos_app LOGIN PASSWORD 'memos_app';
  END IF;
END
$$;
