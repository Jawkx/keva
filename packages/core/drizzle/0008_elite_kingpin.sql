CREATE TABLE "tenant_billing" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"polar_customer_id" text,
	"polar_subscription_id" text,
	"polar_product_id" text,
	"plan_slug" text,
	"status" text DEFAULT 'unsubscribed' NOT NULL,
	"monthly_uploads_limit" bigint DEFAULT 0 NOT NULL,
	"monthly_api_requests_limit" bigint DEFAULT 0 NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"last_polar_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tenant_billing_status_check" CHECK ("tenant_billing"."status" in ('unsubscribed', 'trialing', 'active', 'past_due', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "tenant_period_usage" (
	"tenant_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"uploads_used" bigint DEFAULT 0 NOT NULL,
	"uploads_reserved" bigint DEFAULT 0 NOT NULL,
	"api_requests_used" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "upload_period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "upload_reservation_state" text;--> statement-breakpoint
ALTER TABLE "tenant_usage" ADD COLUMN "used_items" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_usage" ADD COLUMN "quota_items" bigint;--> statement-breakpoint
UPDATE "tenant_usage" usage
SET "used_bytes" = source.used_bytes,
	"used_items" = source.used_items
FROM (
	SELECT tenant_id,
		coalesce(sum(coalesce(size, declared_size)), 0)::bigint AS used_bytes,
		count(*)::bigint AS used_items
	FROM items
	GROUP BY tenant_id
) source
WHERE usage.tenant_id = source.tenant_id;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_billing_user_id_unique" ON "tenant_billing" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_billing_polar_subscription_id_unique" ON "tenant_billing" USING btree ("polar_subscription_id") WHERE "tenant_billing"."polar_subscription_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_period_usage_tenant_start_unique" ON "tenant_period_usage" USING btree ("tenant_id","period_start");--> statement-breakpoint
CREATE INDEX "tenant_period_usage_period_end_idx" ON "tenant_period_usage" USING btree ("period_end");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_upload_reservation_state_check" CHECK ("items"."upload_reservation_state" is null or "items"."upload_reservation_state" in ('reserved', 'consumed'));
