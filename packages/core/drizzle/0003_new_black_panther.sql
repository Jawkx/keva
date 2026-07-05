CREATE TABLE "share_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"conditions" jsonb NOT NULL,
	"write_stamp" jsonb,
	"max_item_bytes" bigint,
	"max_total_bytes" bigint,
	"max_items" integer,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "share_grants_tenant_created_idx" ON "share_grants" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "items_tenant_source_idx" ON "items" USING btree ("tenant_id","source");