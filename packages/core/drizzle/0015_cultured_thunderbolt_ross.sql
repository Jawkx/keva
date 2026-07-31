ALTER TABLE "items" ADD COLUMN "uploaded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "share_grants" ADD COLUMN "allow_own_delete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "items_uploaded_by_user_idx" ON "items" USING btree ("uploaded_by_user_id");