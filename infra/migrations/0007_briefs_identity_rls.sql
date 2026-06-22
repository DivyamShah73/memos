-- Phase 6: identity-targeted RLS for briefs.
--
-- Briefs are targeted by IDENTITY (org/team/project/agent), not by project_id, so the
-- memos.agent_projects GUC doesn't cover them. We add a SECOND request-local GUC,
-- memos.agent_identity, carrying the agent's full identity set: {agent.x, team.x, org, project.*}.
-- A single `target_id = ANY(identity)` test is safe because those id namespaces never collide.
--
-- READ is the isolation boundary (you must not SEE another org's steering). WRITE is open:
-- a brief is an outbound instruction, and question.answer files one targeting a DIFFERENT
-- agent (the asker), so an identity-scoped WITH CHECK would wrongly reject it. The critic /
-- escalation workers run as the owner (superuser) and bypass FORCE RLS entirely.
--
-- nullif(...,'') mirrors 0004: a custom GUC reverts to '' (not NULL) after a SET LOCAL on a
-- reused pooled connection, which would make the ::text[] cast raise instead of deny.

ALTER TABLE "briefs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "briefs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "briefs_select" ON "briefs" FOR SELECT
  USING (target_id = ANY (nullif(current_setting('memos.agent_identity', true), '')::text[]));
--> statement-breakpoint
CREATE POLICY "briefs_insert" ON "briefs" FOR INSERT
  WITH CHECK (true);
