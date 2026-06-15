-- Phase 4: full-text search indexes for fact.query / learning.query.
-- Deferred from Phase 0 (DATA_MODEL.md §3) — no consumer existed until the query phase.
-- These live in SQL only (like the RLS policies), not in schema.ts: drizzle-kit churns
-- expression gin indexes. The expression MUST byte-for-byte match the query's
-- (to_tsvector('english', "claim")) — centralized in packages/api/src/intents/_fts.ts —
-- or the planner won't use the index.
CREATE INDEX IF NOT EXISTS "facts_claim_fts_idx"
  ON "facts" USING gin (to_tsvector('english', "claim"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learnings_claim_fts_idx"
  ON "learnings" USING gin (to_tsvector('english', "claim"));
