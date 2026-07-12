ALTER TABLE "items" ADD COLUMN "staging_cleaned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "items_staging_uncleaned_idx" ON "items" USING btree ("created_at") WHERE "items"."status" = 'ready' and "items"."staging_cleaned_at" is null;
