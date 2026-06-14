-- Row-Level Security: the tenant-isolation boundary (see docs/decisions/002).
-- Migrations run as owner; the gateway connects as the non-owner memos_app role, so
-- ENABLE + FORCE makes these policies bite even for the schema owner.
--
-- Project-scoped tables: 4 policies keyed on the per-request memos.agent_projects GUC.
-- UPDATE carries USING + WITH CHECK so a row cannot be moved into another tenant.
-- An unset GUC -> current_setting(...,true)=NULL -> = ANY(NULL) -> 0 rows (default-deny).

-- The gateway role needs schema USAGE before any table GRANT is usable. Harmless on a
-- default local Postgres (PUBLIC already has it); required if USAGE was revoked from PUBLIC.
GRANT USAGE ON SCHEMA public TO memos_app;
--> statement-breakpoint

-- facts
ALTER TABLE "facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "facts_select" ON "facts" FOR SELECT
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "facts_insert" ON "facts" FOR INSERT
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "facts_update" ON "facts" FOR UPDATE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]))
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "facts_delete" ON "facts" FOR DELETE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "facts" TO memos_app;
--> statement-breakpoint

-- learnings
ALTER TABLE "learnings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "learnings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "learnings_select" ON "learnings" FOR SELECT
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "learnings_insert" ON "learnings" FOR INSERT
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "learnings_update" ON "learnings" FOR UPDATE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]))
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "learnings_delete" ON "learnings" FOR DELETE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "learnings" TO memos_app;
--> statement-breakpoint

-- artifacts
ALTER TABLE "artifacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "artifacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "artifacts_select" ON "artifacts" FOR SELECT
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "artifacts_insert" ON "artifacts" FOR INSERT
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "artifacts_update" ON "artifacts" FOR UPDATE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]))
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "artifacts_delete" ON "artifacts" FOR DELETE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "artifacts" TO memos_app;
--> statement-breakpoint

-- workflow_runs
ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workflow_runs_select" ON "workflow_runs" FOR SELECT
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "workflow_runs_insert" ON "workflow_runs" FOR INSERT
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "workflow_runs_update" ON "workflow_runs" FOR UPDATE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]))
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "workflow_runs_delete" ON "workflow_runs" FOR DELETE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "workflow_runs" TO memos_app;
--> statement-breakpoint

-- checkins
ALTER TABLE "checkins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "checkins" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "checkins_select" ON "checkins" FOR SELECT
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "checkins_insert" ON "checkins" FOR INSERT
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "checkins_update" ON "checkins" FOR UPDATE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]))
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "checkins_delete" ON "checkins" FOR DELETE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "checkins" TO memos_app;
--> statement-breakpoint

-- objectives
ALTER TABLE "objectives" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "objectives" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "objectives_select" ON "objectives" FOR SELECT
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "objectives_insert" ON "objectives" FOR INSERT
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "objectives_update" ON "objectives" FOR UPDATE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]))
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "objectives_delete" ON "objectives" FOR DELETE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "objectives" TO memos_app;
--> statement-breakpoint

-- milestones
ALTER TABLE "milestones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "milestones" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "milestones_select" ON "milestones" FOR SELECT
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "milestones_insert" ON "milestones" FOR INSERT
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "milestones_update" ON "milestones" FOR UPDATE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]))
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "milestones_delete" ON "milestones" FOR DELETE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "milestones" TO memos_app;
--> statement-breakpoint

-- questions
ALTER TABLE "questions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "questions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "questions_select" ON "questions" FOR SELECT
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "questions_insert" ON "questions" FOR INSERT
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "questions_update" ON "questions" FOR UPDATE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]))
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "questions_delete" ON "questions" FOR DELETE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "questions" TO memos_app;
--> statement-breakpoint

-- choices
ALTER TABLE "choices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "choices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "choices_select" ON "choices" FOR SELECT
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "choices_insert" ON "choices" FOR INSERT
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "choices_update" ON "choices" FOR UPDATE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]))
  WITH CHECK (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
CREATE POLICY "choices_delete" ON "choices" FOR DELETE
  USING (project_id = ANY (current_setting('memos.agent_projects', true)::text[]));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "choices" TO memos_app;
--> statement-breakpoint

-- Control-plane & identity-targeted tables: NO project_id RLS in Phase 0.
-- orgs/teams/projects/agents/enrollment_codes/brief_acks/feedback are touched during
-- enrollment/auth before any project scope exists — a project_id policy would deadlock
-- the gateway out of its own auth tables. briefs are identity-targeted (org/team/project/
-- agent) and get their own identity policy in Phase 6; handler-enforced until then.
-- They still need GRANTs so the memos_app gateway can read/write them.
GRANT SELECT, INSERT, UPDATE, DELETE ON "orgs" TO memos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "teams" TO memos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "projects" TO memos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "agents" TO memos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "enrollment_codes" TO memos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "briefs" TO memos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "brief_acks" TO memos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "feedback" TO memos_app;
