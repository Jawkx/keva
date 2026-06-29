CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"declared_size" bigint NOT NULL,
	"size" bigint,
	"etag" text,
	"checksum" text,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"storage_key" text NOT NULL,
	"staging_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "items_status_check" CHECK ("items"."status" in ('pending', 'ready', 'deleting'))
);
--> statement-breakpoint
DROP TABLE "objects" CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "items_tenant_id_id_unique" ON "items" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "items_tenant_status_created_idx" ON "items" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "items_tenant_content_type_idx" ON "items" USING btree ("tenant_id","content_type");--> statement-breakpoint
CREATE INDEX "items_tenant_size_idx" ON "items" USING btree ("tenant_id","size");--> statement-breakpoint
CREATE INDEX "items_tenant_created_id_idx" ON "items" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "items_properties_gin_idx" ON "items" USING gin ("properties");