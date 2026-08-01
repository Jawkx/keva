import type {
  Actor,
  ItemEventAction,
  ItemEventPayload,
  Properties,
  ItemPresentation,
  ItemStatus,
  QueryCondition,
  Scope,
  ShareScope,
} from "@keva/schema";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    declaredSize: bigint("declared_size", { mode: "number" }).notNull(),
    size: bigint("size", { mode: "number" }),
    etag: text("etag"),
    source: text("source").notNull(),
    uploadedByUserId: text("uploaded_by_user_id"),
    status: text("status").$type<ItemStatus>().notNull(),
    storageKey: text("storage_key").notNull(),
    stagingKey: text("staging_key").notNull(),
    revision: integer("revision").notNull().default(1),
    // Set once an item's staging blob has been purged. Drives the durable
    // staging-cleanup backstop: a null value on a ready item is an outstanding
    // cleanup obligation.
    stagingCleanedAt: timestamp("staging_cleaned_at", { withTimezone: true, mode: "string" }),
    uploadPeriodStart: timestamp("upload_period_start", { withTimezone: true, mode: "string" }),
    uploadReservationState: text("upload_reservation_state").$type<"reserved" | "consumed">(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
    properties: jsonb("properties").$type<Properties>().notNull().default({}),
    presentation: jsonb("presentation").$type<ItemPresentation>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("items_tenant_id_id_unique").on(table.tenantId, table.id),
    index("items_tenant_status_created_idx").on(table.tenantId, table.status, table.createdAt),
    index("items_status_created_idx").on(table.status, table.createdAt),
    index("items_tenant_content_type_idx").on(table.tenantId, table.contentType),
    index("items_tenant_size_idx").on(table.tenantId, table.size),
    index("items_tenant_created_id_idx").on(table.tenantId, table.createdAt, table.id),
    index("items_tenant_status_updated_id_idx").on(
      table.tenantId,
      table.status,
      table.updatedAt,
      table.id,
    ),
    index("items_tenant_status_name_id_idx").on(
      table.tenantId,
      table.status,
      sql`lower(${table.name})`,
      table.id,
    ),
    index("items_tenant_deleted_id_idx").on(table.tenantId, table.deletedAt, table.id),
    index("items_tenant_status_size_id_idx").on(
      table.tenantId,
      table.status,
      sql`coalesce(${table.size}, ${table.declaredSize})`,
      table.id,
    ),
    index("items_properties_gin_idx").using("gin", table.properties),
    index("items_ready_name_trgm_idx")
      .using("gin", sql`${table.name} gin_trgm_ops`)
      .where(sql`${table.status} = 'ready'`),
    index("items_ready_content_type_trgm_idx")
      .using("gin", sql`${table.contentType} gin_trgm_ops`)
      .where(sql`${table.status} = 'ready'`),
    index("items_tenant_source_idx").on(table.tenantId, table.source),
    index("items_uploaded_by_user_idx").on(table.uploadedByUserId),
    index("items_staging_uncleaned_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'ready' and ${table.stagingCleanedAt} is null`),
    check(
      "items_status_check",
      sql`${table.status} in ('pending', 'confirming', 'ready', 'deleting')`,
    ),
    check(
      "items_upload_reservation_state_check",
      sql`${table.uploadReservationState} is null or ${table.uploadReservationState} in ('reserved', 'consumed')`,
    ),
  ],
);

export const itemPropertyTerms = pgTable(
  "item_property_terms",
  {
    tenantId: text("tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    key: text("key").notNull(),
    kind: text("kind").$type<"tag" | "string" | "array">().notNull(),
    value: text("value"),
  },
  (table) => [
    foreignKey({
      name: "item_property_terms_tenant_item_fk",
      columns: [table.tenantId, table.itemId],
      foreignColumns: [items.tenantId, items.id],
    }).onDelete("cascade"),
    check("item_property_terms_kind_check", sql`${table.kind} in ('tag', 'string', 'array')`),
    index("item_property_terms_tenant_item_idx").on(table.tenantId, table.itemId),
    index("item_property_terms_tenant_key_idx").on(table.tenantId, table.key),
    index("item_property_terms_tenant_key_value_idx")
      .on(table.tenantId, table.key, table.value)
      .where(sql`${table.value} is not null`),
    index("item_property_terms_key_trgm_idx").using("gin", sql`${table.key} gin_trgm_ops`),
    index("item_property_terms_value_trgm_idx")
      .using("gin", sql`${table.value} gin_trgm_ops`)
      .where(sql`${table.value} is not null`),
    uniqueIndex("item_property_terms_null_unique")
      .on(table.tenantId, table.itemId, table.key, table.kind)
      .where(sql`${table.value} is null`),
    uniqueIndex("item_property_terms_value_unique")
      .on(table.tenantId, table.itemId, table.key, table.kind, table.value)
      .where(sql`${table.value} is not null`),
  ],
);

export const uploadAttempts = pgTable(
  "upload_attempts",
  {
    id: uuid("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    itemId: uuid("item_id"),
    retryKey: text("retry_key"),
    requestHash: text("request_hash"),
    stagingKey: text("staging_key").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadUrl: text("upload_url").notNull(),
    uploadHeaders: jsonb("upload_headers").$type<Readonly<Record<string, string>>>().notNull(),
    expectedSize: bigint("expected_size", { mode: "number" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    state: text("state").$type<"pending" | "confirming" | "confirmed" | "abandoned">().notNull(),
    observedEtag: text("observed_etag"),
    cleanupAfter: timestamp("cleanup_after", { withTimezone: true, mode: "string" }).notNull(),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true, mode: "string" }).notNull(),
    retryCount: integer("retry_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("upload_attempts_tenant_retry_key_unique")
      .on(table.tenantId, table.retryKey)
      .where(sql`${table.retryKey} is not null`),
    index("upload_attempts_item_idx").on(table.tenantId, table.itemId),
    index("upload_attempts_cleanup_idx").on(table.cleanupAfter, table.nextRetryAt),
  ],
);

export const tenantUsage = pgTable("tenant_usage", {
  tenantId: text("tenant_id").primaryKey(),
  usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
  usedItems: bigint("used_items", { mode: "number" }).notNull().default(0),
  quotaBytes: bigint("quota_bytes", { mode: "number" }).default(10_737_418_240),
  quotaItems: bigint("quota_items", { mode: "number" }),
});

export const tenantBilling = pgTable(
  "tenant_billing",
  {
    tenantId: text("tenant_id").primaryKey(),
    userId: text("user_id").notNull(),
    polarCustomerId: text("polar_customer_id"),
    polarSubscriptionId: text("polar_subscription_id"),
    polarProductId: text("polar_product_id"),
    planSlug: text("plan_slug").$type<"100gb" | "500gb" | "1tb" | "2tb">(),
    status: text("status")
      .$type<"unsubscribed" | "trialing" | "active" | "past_due" | "canceled">()
      .notNull()
      .default("unsubscribed"),
    monthlyUploadsLimit: bigint("monthly_uploads_limit", { mode: "number" }).notNull().default(0),
    monthlyApiRequestsLimit: bigint("monthly_api_requests_limit", { mode: "number" })
      .notNull()
      .default(0),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true, mode: "string" }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: "string" }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true, mode: "string" }),
    pendingPlanSlug: text("pending_plan_slug").$type<"100gb" | "500gb" | "1tb" | "2tb">(),
    pendingPlanAppliesAt: timestamp("pending_plan_applies_at", {
      withTimezone: true,
      mode: "string",
    }),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true, mode: "string" }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    lastPolarEventAt: timestamp("last_polar_event_at", { withTimezone: true, mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("tenant_billing_user_id_unique").on(table.userId),
    uniqueIndex("tenant_billing_polar_subscription_id_unique")
      .on(table.polarSubscriptionId)
      .where(sql`${table.polarSubscriptionId} is not null`),
    check(
      "tenant_billing_status_check",
      sql`${table.status} in ('unsubscribed', 'trialing', 'active', 'past_due', 'canceled')`,
    ),
  ],
);

export const tenantPeriodUsage = pgTable(
  "tenant_period_usage",
  {
    tenantId: text("tenant_id").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true, mode: "string" }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true, mode: "string" }).notNull(),
    uploadsUsed: bigint("uploads_used", { mode: "number" }).notNull().default(0),
    uploadsReserved: bigint("uploads_reserved", { mode: "number" }).notNull().default(0),
    apiRequestsUsed: bigint("api_requests_used", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    uniqueIndex("tenant_period_usage_tenant_start_unique").on(table.tenantId, table.periodStart),
    index("tenant_period_usage_period_end_idx").on(table.periodEnd),
  ],
);

// Append-only history of item metadata mutations. Deliberately no FK to items
// — events outlive deletion; `item_name` and `actor` are write-time snapshots.
export const itemEvents = pgTable(
  "item_events",
  {
    id: uuid("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    itemName: text("item_name").notNull(),
    action: text("action").$type<ItemEventAction>().notNull(),
    actor: jsonb("actor").$type<Actor>(),
    payload: jsonb("payload").$type<ItemEventPayload>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("item_events_tenant_item_created_idx").on(
      table.tenantId,
      table.itemId,
      table.createdAt,
      table.id,
    ),
    check(
      "item_events_action_check",
      sql`${table.action} in ('uploaded', 'updated', 'renamed', 'properties_changed', 'deleted')`,
    ),
  ],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    secretHash: text("secret_hash").notNull(),
    scopes: jsonb("scopes").$type<ReadonlyArray<Scope>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    lastUsedAt: timestamp("last_used_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [index("api_tokens_tenant_created_idx").on(table.tenantId, table.createdAt)],
);

export const views = pgTable(
  "views",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    // A Lucide icon key (see the web icon registry); null falls back to a default.
    icon: text("icon"),
    conditions: jsonb("conditions").$type<ReadonlyArray<QueryCondition>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("views_tenant_created_idx").on(table.tenantId, table.createdAt)],
);

// A secret link granting filtered read and/or write access to a view's items.
// The view (referenced by `view_id`) owns the conditions; a write grant
// force-applies `write_stamp` as the properties of every uploaded item and
// enforces the nullable quota columns (null = unlimited). Deleting a view
// cascades to its grants (revokes the links); a manual revoke is a row delete.
// Orphaned `source = "share:{id}"` on items is harmless. `secret_hash` verifies
// incoming tokens; plaintext tokens are returned only at creation time.
export const shareGrants = pgTable(
  "share_grants",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    viewId: text("view_id")
      .notNull()
      .references(() => views.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"link" | "account">().notNull().default("link"),
    name: text("name").notNull(),
    secretHash: text("secret_hash").notNull(),
    scopes: jsonb("scopes").$type<ReadonlyArray<ShareScope>>().notNull(),
    writeStamp: jsonb("write_stamp").$type<Properties>(),
    allowOwnDelete: boolean("allow_own_delete").notNull().default(false),
    maxItemBytes: bigint("max_item_bytes", { mode: "number" }),
    maxTotalBytes: bigint("max_total_bytes", { mode: "number" }),
    maxItems: integer("max_items"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("share_grants_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("share_grants_view_idx").on(table.viewId),
  ],
);
