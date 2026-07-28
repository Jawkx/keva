CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "items_ready_name_trgm_idx" ON "items" USING gin ("name" gin_trgm_ops) WHERE "items"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "items_ready_content_type_trgm_idx" ON "items" USING gin ("content_type" gin_trgm_ops) WHERE "items"."status" = 'ready';