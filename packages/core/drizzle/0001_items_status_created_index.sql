CREATE INDEX "items_status_created_idx" ON "items" USING btree ("status", "created_at");
