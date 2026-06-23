-- Phase 11 (ADR-009): human identity + multi-org foundation.
-- New people tables (users, memberships) + denormalized org_id on the control-plane/root tables.
-- org_id is added NULLABLE, backfilled from team->org (all pre-migration data is single-org), then
-- set NOT NULL. users + memberships get org-scoped RLS keyed on the memos.org_id GUC — the new
-- DB-enforced isolation: org B can never read org A's people. The backfill + GRANTs + RLS are
-- hand-authored (drizzle models neither data, grants, nor RLS), in the spirit of 0002/0004/0007.

CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_scope_kind_check" CHECK ("memberships"."scope_kind" in ('org','team','project')),
	CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" in ('ceo','manager','member'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_status_check" CHECK ("users"."status" in ('active','disabled'))
);
--> statement-breakpoint
-- org_id: add nullable, backfill from team->org, then enforce NOT NULL (existing rows predate multi-org).
ALTER TABLE "agents" ADD COLUMN "org_id" text;--> statement-breakpoint
ALTER TABLE "enrollment_codes" ADD COLUMN "org_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "org_id" text;--> statement-breakpoint
UPDATE "agents" SET "org_id" = COALESCE((SELECT t."org_id" FROM "teams" t WHERE t."id" = "agents"."team_id"), 'org') WHERE "org_id" IS NULL;--> statement-breakpoint
UPDATE "enrollment_codes" SET "org_id" = COALESCE((SELECT t."org_id" FROM "teams" t WHERE t."id" = "enrollment_codes"."team_id"), 'org') WHERE "org_id" IS NULL;--> statement-breakpoint
UPDATE "projects" SET "org_id" = COALESCE((SELECT t."org_id" FROM "teams" t WHERE t."id" = "projects"."team_id"), 'org') WHERE "org_id" IS NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment_codes" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_unique_idx" ON "memberships" USING btree ("user_id","scope_kind","scope_id");--> statement-breakpoint
CREATE INDEX "memberships_org_idx" ON "memberships" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- memos_app needs privileges on the new tables (0002's per-table GRANTs don't cover them).
GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO memos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "memberships" TO memos_app;--> statement-breakpoint
-- Org-scoped RLS on the people tables. Scalar org_id GUC; nullif(...,'') maps unset/empty -> NULL
-- -> deny (the 0004 hardening, scalar form). Nothing reads these pre-GUC (login-by-email uses the
-- owner connection), so FORCE here cannot deadlock auth.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "users_select" ON "users" FOR SELECT USING ("org_id" = nullif(current_setting('memos.org_id', true), ''));--> statement-breakpoint
CREATE POLICY "users_insert" ON "users" FOR INSERT WITH CHECK ("org_id" = nullif(current_setting('memos.org_id', true), ''));--> statement-breakpoint
CREATE POLICY "users_update" ON "users" FOR UPDATE USING ("org_id" = nullif(current_setting('memos.org_id', true), '')) WITH CHECK ("org_id" = nullif(current_setting('memos.org_id', true), ''));--> statement-breakpoint
CREATE POLICY "users_delete" ON "users" FOR DELETE USING ("org_id" = nullif(current_setting('memos.org_id', true), ''));--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "memberships_select" ON "memberships" FOR SELECT USING ("org_id" = nullif(current_setting('memos.org_id', true), ''));--> statement-breakpoint
CREATE POLICY "memberships_insert" ON "memberships" FOR INSERT WITH CHECK ("org_id" = nullif(current_setting('memos.org_id', true), ''));--> statement-breakpoint
CREATE POLICY "memberships_update" ON "memberships" FOR UPDATE USING ("org_id" = nullif(current_setting('memos.org_id', true), '')) WITH CHECK ("org_id" = nullif(current_setting('memos.org_id', true), ''));--> statement-breakpoint
CREATE POLICY "memberships_delete" ON "memberships" FOR DELETE USING ("org_id" = nullif(current_setting('memos.org_id', true), ''));
