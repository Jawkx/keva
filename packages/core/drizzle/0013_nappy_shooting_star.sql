ALTER TABLE "items" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "items_tenant_deleted_id_idx" ON "items" USING btree ("tenant_id","deleted_at","id");