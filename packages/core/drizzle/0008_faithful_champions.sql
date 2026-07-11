CREATE TABLE "tenant_usage" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"quota_bytes" bigint DEFAULT 10737418240
);
--> statement-breakpoint
INSERT INTO "tenant_usage" ("tenant_id", "used_bytes", "quota_bytes")
SELECT "tenant_id", coalesce(sum(coalesce("size", "declared_size")), 0), 10737418240
FROM "items"
WHERE "status" in ('pending', 'ready')
GROUP BY "tenant_id";
