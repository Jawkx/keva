ALTER TABLE "objects" RENAME TO "items";--> statement-breakpoint
ALTER TABLE "items" RENAME COLUMN "attributes" TO "properties";--> statement-breakpoint
ALTER TABLE "items" RENAME CONSTRAINT "objects_pkey" TO "items_pkey";--> statement-breakpoint
ALTER TABLE "items" RENAME CONSTRAINT "objects_status_check" TO "items_status_check";--> statement-breakpoint
ALTER INDEX "objects_tenant_id_id_unique" RENAME TO "items_tenant_id_id_unique";--> statement-breakpoint
ALTER INDEX "objects_tenant_status_created_idx" RENAME TO "items_tenant_status_created_idx";--> statement-breakpoint
ALTER INDEX "objects_tenant_content_type_idx" RENAME TO "items_tenant_content_type_idx";--> statement-breakpoint
ALTER INDEX "objects_tenant_size_idx" RENAME TO "items_tenant_size_idx";--> statement-breakpoint
ALTER INDEX "objects_tenant_created_id_idx" RENAME TO "items_tenant_created_id_idx";--> statement-breakpoint
ALTER INDEX "objects_attributes_gin_idx" RENAME TO "items_properties_gin_idx";
