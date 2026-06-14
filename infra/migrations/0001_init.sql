CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"api_token_hash" text NOT NULL,
	"team_id" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trust_score" numeric DEFAULT '0.5' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_checkin_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_status_check" CHECK ("agents"."status" in ('active','revoked'))
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"bd_id" text NOT NULL,
	"kind" text,
	"description" text,
	"mime_type" text,
	"bucket_path" text,
	"size_bytes" bigint,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brief_acks" (
	"brief_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"acked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brief_acks_brief_id_agent_id_pk" PRIMARY KEY("brief_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"author_id" text,
	"supersedes_id" uuid,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefs_target_kind_check" CHECK ("briefs"."target_kind" in ('org','team','project','agent'))
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bd_id" text NOT NULL,
	"project_id" text NOT NULL,
	"target_objective_id" uuid,
	"status" text NOT NULL,
	"current_task" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkins_status_check" CHECK ("checkins"."status" in ('start','progress','blocked','complete','failed'))
);
--> statement-breakpoint
CREATE TABLE "choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text,
	"bd_id" text,
	"project_id" text NOT NULL,
	"description" text,
	"outcome" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "choices_status_check" CHECK ("choices"."status" in ('open','resolved'))
);
--> statement-breakpoint
CREATE TABLE "enrollment_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"team_id" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"used_by" text,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"bd_id" text NOT NULL,
	"agent_id" text,
	"claim" text NOT NULL,
	"confidence" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"evidence_artifact_id" uuid,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facts_confidence_check" CHECK ("facts"."confidence" in ('low','medium','high')),
	CONSTRAINT "facts_status_check" CHECK ("facts"."status" in ('active','retracted','superseded'))
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text,
	"bd_id" text,
	"category" text,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"bd_id" text NOT NULL,
	"agent_id" text,
	"claim" text NOT NULL,
	"applies_to" text[] NOT NULL,
	"confidence" text NOT NULL,
	"non_obvious_marker" text,
	"evidence_artifact_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"dok_grade" text DEFAULT 'ungraded' NOT NULL,
	"reuse_count" integer DEFAULT 0 NOT NULL,
	"reuse_success_count" integer DEFAULT 0 NOT NULL,
	"reuse_failure_count" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learnings_confidence_check" CHECK ("learnings"."confidence" in ('low','medium','high')),
	CONSTRAINT "learnings_dok_check" CHECK ("learnings"."dok_grade" in ('ungraded','DOK1','DOK2','DOK3','DOK4'))
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"objective_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"metric_target" numeric,
	"metric_current" numeric,
	"metric_unit" text,
	"metric_direction" text,
	"achieved_at" timestamp with time zone,
	"achievement" jsonb,
	CONSTRAINT "milestones_status_check" CHECK ("milestones"."status" in ('pending','achieved')),
	CONSTRAINT "milestones_direction_check" CHECK ("milestones"."metric_direction" is null or "milestones"."metric_direction" in ('up','down'))
);
--> statement-breakpoint
CREATE TABLE "objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"bd_id" text,
	"agent_id" text,
	"parent_id" uuid,
	"weight" numeric,
	"title" text NOT NULL,
	"description" text,
	"target_completion" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "objectives_status_check" CHECK ("objectives"."status" in ('active','achieved','abandoned','superseded'))
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" text,
	"name" text NOT NULL,
	"okrs_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"bd_id" text,
	"agent_id" text,
	"subject" text,
	"body" text,
	"urgency" text,
	"status" text DEFAULT 'open' NOT NULL,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_status_check" CHECK ("questions"."status" in ('open','answered')),
	CONSTRAINT "questions_urgency_check" CHECK ("questions"."urgency" is null or "questions"."urgency" in ('low','medium','high'))
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"bd_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"agent_id" text,
	"workflow_class" text,
	"title" text NOT NULL,
	"target_objective_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "workflow_runs_status_check" CHECK ("workflow_runs"."status" in ('open','complete','failed'))
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_bd_id_workflow_runs_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."workflow_runs"("bd_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_acks" ADD CONSTRAINT "brief_acks_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_acks" ADD CONSTRAINT "brief_acks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_supersedes_id_briefs_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."briefs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_bd_id_workflow_runs_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."workflow_runs"("bd_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "choices" ADD CONSTRAINT "choices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_bd_id_workflow_runs_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."workflow_runs"("bd_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_evidence_artifact_id_artifacts_id_fk" FOREIGN KEY ("evidence_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_bd_id_workflow_runs_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."workflow_runs"("bd_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_evidence_artifact_id_artifacts_id_fk" FOREIGN KEY ("evidence_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_parent_id_objectives_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_supersedes_id_objectives_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_target_objective_id_objectives_id_fk" FOREIGN KEY ("target_objective_id") REFERENCES "public"."objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_project_bd_idx" ON "artifacts" USING btree ("project_id","bd_id");--> statement-breakpoint
CREATE INDEX "briefs_target_idx" ON "briefs" USING btree ("target_kind","target_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "checkins_bd_created_idx" ON "checkins" USING btree ("bd_id","created_at");--> statement-breakpoint
CREATE INDEX "facts_project_created_idx" ON "facts" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "facts_bd_idx" ON "facts" USING btree ("bd_id");--> statement-breakpoint
CREATE INDEX "learnings_project_created_idx" ON "learnings" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "learnings_bd_idx" ON "learnings" USING btree ("bd_id");--> statement-breakpoint
CREATE INDEX "learnings_applies_to_idx" ON "learnings" USING gin ("applies_to");--> statement-breakpoint
CREATE INDEX "milestones_objective_position_idx" ON "milestones" USING btree ("objective_id","position");--> statement-breakpoint
CREATE INDEX "objectives_project_status_idx" ON "objectives" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "objectives_parent_idx" ON "objectives" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_project_status_idx" ON "workflow_runs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "workflow_runs_target_objective_idx" ON "workflow_runs" USING btree ("target_objective_id");