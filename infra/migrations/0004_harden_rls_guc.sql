-- Harden the RLS predicate against the empty-string GUC value.
-- A custom GUC (dotted name) that was ever SET LOCAL reverts to '' (not NULL) after the
-- transaction, so a reused pooled connection makes the original `::text[]` cast fail with
-- "malformed array literal" instead of cleanly denying. nullif(...,'') maps both unset (NULL)
-- and empty ('') to NULL -> = ANY(NULL) -> 0 rows (default-deny), no error.

ALTER POLICY "facts_select" ON "facts" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "facts_insert" ON "facts" WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "facts_update" ON "facts" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[])) WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "facts_delete" ON "facts" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "learnings_select" ON "learnings" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "learnings_insert" ON "learnings" WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "learnings_update" ON "learnings" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[])) WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "learnings_delete" ON "learnings" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "artifacts_select" ON "artifacts" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "artifacts_insert" ON "artifacts" WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "artifacts_update" ON "artifacts" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[])) WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "artifacts_delete" ON "artifacts" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "workflow_runs_select" ON "workflow_runs" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "workflow_runs_insert" ON "workflow_runs" WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "workflow_runs_update" ON "workflow_runs" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[])) WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "workflow_runs_delete" ON "workflow_runs" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "checkins_select" ON "checkins" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "checkins_insert" ON "checkins" WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "checkins_update" ON "checkins" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[])) WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "checkins_delete" ON "checkins" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "objectives_select" ON "objectives" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "objectives_insert" ON "objectives" WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "objectives_update" ON "objectives" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[])) WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "objectives_delete" ON "objectives" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "milestones_select" ON "milestones" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "milestones_insert" ON "milestones" WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "milestones_update" ON "milestones" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[])) WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "milestones_delete" ON "milestones" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "questions_select" ON "questions" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "questions_insert" ON "questions" WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "questions_update" ON "questions" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[])) WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "questions_delete" ON "questions" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "choices_select" ON "choices" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "choices_insert" ON "choices" WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "choices_update" ON "choices" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[])) WITH CHECK (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
--> statement-breakpoint
ALTER POLICY "choices_delete" ON "choices" USING (project_id = ANY (nullif(current_setting('memos.agent_projects', true), '')::text[]));
