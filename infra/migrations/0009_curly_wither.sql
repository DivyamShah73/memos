ALTER TABLE "agents" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment_codes" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_role_check" CHECK ("agents"."role" in ('member','manager','ceo'));--> statement-breakpoint
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_role_check" CHECK ("enrollment_codes"."role" in ('member','manager','ceo'));--> statement-breakpoint
-- The dashboard's operator agent steers (authors briefs/OKRs in the demo), so it's a manager.
-- Existing agents default to 'member' (the column default); only the operator is elevated.
UPDATE "agents" SET "role" = 'manager' WHERE "id" = 'agent.operator';