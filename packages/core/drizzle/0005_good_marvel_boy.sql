CREATE TABLE "account_share_grants" (
	"grant_id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"invited_email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "account_share_grants_status_check" CHECK ("account_share_grants"."status" in ('pending', 'accepted'))
);
--> statement-breakpoint
ALTER TABLE "share_grants" ADD COLUMN "kind" text DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_share_grants" ADD CONSTRAINT "account_share_grants_grant_id_share_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."share_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_share_grants" ADD CONSTRAINT "account_share_grants_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_share_grants" ADD CONSTRAINT "account_share_grants_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "delete_account_share_grant_parent"() RETURNS trigger AS $$
BEGIN
	DELETE FROM "share_grants" WHERE "id" = OLD."grant_id";
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "account_share_grants_delete_parent"
	AFTER DELETE ON "account_share_grants"
	FOR EACH ROW EXECUTE FUNCTION "delete_account_share_grant_parent"();--> statement-breakpoint
CREATE INDEX "account_share_grants_owner_idx" ON "account_share_grants" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "account_share_grants_recipient_idx" ON "account_share_grants" USING btree ("recipient_user_id","status","created_at");
