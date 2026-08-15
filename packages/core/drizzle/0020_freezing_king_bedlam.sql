CREATE TABLE "thumbnail_jobs" (
	"tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"recipe_version" integer NOT NULL,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"source_etag" text,
	"output_key" text,
	"output_content_type" text,
	"output_size" bigint,
	"output_width" integer,
	"output_height" integer,
	"error_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "thumbnail_jobs_tenant_item_pk" PRIMARY KEY("tenant_id","item_id"),
	CONSTRAINT "thumbnail_jobs_state_check" CHECK ("thumbnail_jobs"."state" in ('pending', 'processing', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "thumbnail_jobs" ADD CONSTRAINT "thumbnail_jobs_tenant_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thumbnail_jobs_state_next_attempt_idx" ON "thumbnail_jobs" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "thumbnail_jobs_state_lease_expires_idx" ON "thumbnail_jobs" USING btree ("state","lease_expires_at");