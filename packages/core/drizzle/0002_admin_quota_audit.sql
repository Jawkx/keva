CREATE TABLE "admin_quota_audit" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "actor" text NOT NULL,
  "target_user_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "before_quota_bytes" bigint,
  "after_quota_bytes" bigint,
  "created_at" timestamp with time zone NOT NULL
);
