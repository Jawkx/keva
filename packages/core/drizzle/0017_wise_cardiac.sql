ALTER TABLE "tenant_billing" ADD COLUMN "pending_plan_slug" text;--> statement-breakpoint
ALTER TABLE "tenant_billing" ADD COLUMN "pending_plan_applies_at" timestamp with time zone;