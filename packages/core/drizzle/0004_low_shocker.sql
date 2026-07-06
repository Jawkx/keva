CREATE TABLE "views" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "share_grants" ADD COLUMN "view_id" text NOT NULL;--> statement-breakpoint
CREATE INDEX "views_tenant_created_idx" ON "views" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_view_id_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_grants_view_idx" ON "share_grants" USING btree ("view_id");