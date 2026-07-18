CREATE TABLE "mcp_connection_activity" (
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mcp_connection_activity_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "mcp_connection_activity" ADD CONSTRAINT "mcp_connection_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connection_activity" ADD CONSTRAINT "mcp_connection_activity_client_id_oauth_application_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_application"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_connection_activity_user_last_seen_idx" ON "mcp_connection_activity" USING btree ("user_id","last_seen_at");