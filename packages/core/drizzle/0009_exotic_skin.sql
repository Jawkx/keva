CREATE TABLE "upload_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"item_id" uuid,
	"retry_key" text,
	"request_hash" text,
	"staging_key" text NOT NULL,
	"storage_key" text NOT NULL,
	"upload_url" text NOT NULL,
	"upload_headers" jsonb NOT NULL,
	"expected_size" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"observed_etag" text,
	"cleanup_after" timestamp with time zone NOT NULL,
	"next_retry_at" timestamp with time zone NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_events" DROP CONSTRAINT "item_events_action_check";--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_status_check";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "upload_attempts_tenant_retry_key_unique" ON "upload_attempts" USING btree ("tenant_id","retry_key") WHERE "upload_attempts"."retry_key" is not null;--> statement-breakpoint
CREATE INDEX "upload_attempts_item_idx" ON "upload_attempts" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "upload_attempts_cleanup_idx" ON "upload_attempts" USING btree ("cleanup_after","next_retry_at");--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "checksum";--> statement-breakpoint
ALTER TABLE "share_grants" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_action_check" CHECK ("item_events"."action" in ('uploaded', 'updated', 'renamed', 'properties_changed', 'deleted'));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_status_check" CHECK ("items"."status" in ('pending', 'confirming', 'ready', 'deleting'));