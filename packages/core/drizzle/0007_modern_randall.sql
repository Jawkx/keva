CREATE TABLE "item_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"action" text NOT NULL,
	"actor" jsonb,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "item_events_action_check" CHECK ("item_events"."action" in ('uploaded', 'renamed', 'properties_changed', 'deleted'))
);
--> statement-breakpoint
CREATE INDEX "item_events_tenant_item_created_idx" ON "item_events" USING btree ("tenant_id","item_id","created_at","id");
--> statement-breakpoint
-- Backfill an unattributed "uploaded" event for every pre-existing ready item.
INSERT INTO "item_events" ("id", "tenant_id", "item_id", "item_name", "action", "actor", "payload", "created_at")
SELECT gen_random_uuid(), "tenant_id", "id", "name", 'uploaded', NULL,
       jsonb_build_object('size', "size", 'contentType', "content_type", 'source', "source"),
       "created_at"
FROM "items"
WHERE "status" = 'ready';