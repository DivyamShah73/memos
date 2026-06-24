CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- Org-scoped RLS (same template as users/memberships). Audit rows are WRITTEN via the owner
-- connection (recordAudit) so they work even for the public org.signup (no org GUC); memos_app READS
-- them under this policy. (hand-authored, like 0002/0008.)
GRANT SELECT, INSERT, UPDATE, DELETE ON "audit_log" TO memos_app;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_log_select" ON "audit_log" FOR SELECT USING ("org_id" = nullif(current_setting('memos.org_id', true), ''));--> statement-breakpoint
CREATE POLICY "audit_log_insert" ON "audit_log" FOR INSERT WITH CHECK ("org_id" = nullif(current_setting('memos.org_id', true), ''));--> statement-breakpoint
CREATE POLICY "audit_log_update" ON "audit_log" FOR UPDATE USING ("org_id" = nullif(current_setting('memos.org_id', true), '')) WITH CHECK ("org_id" = nullif(current_setting('memos.org_id', true), ''));--> statement-breakpoint
CREATE POLICY "audit_log_delete" ON "audit_log" FOR DELETE USING ("org_id" = nullif(current_setting('memos.org_id', true), ''));