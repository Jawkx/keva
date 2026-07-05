import type { Properties, ItemStatus, QueryCondition, Scope, ShareScope } from "@keva/schema";
import {
  bigint,
  check,
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
    checksum: text("checksum"),
    source: text("source").notNull(),
    status: text("status").$type<ItemStatus>().notNull(),
    storageKey: text("storage_key").notNull(),
    stagingKey: text("staging_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
    properties: jsonb("properties").$type<Properties>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("items_tenant_id_id_unique").on(table.tenantId, table.id),
    index("items_tenant_status_created_idx").on(table.tenantId, table.status, table.createdAt),
    index("items_tenant_content_type_idx").on(table.tenantId, table.contentType),
    index("items_tenant_size_idx").on(table.tenantId, table.size),
    index("items_tenant_created_id_idx").on(table.tenantId, table.createdAt, table.id),
    index("items_properties_gin_idx").using("gin", table.properties),
    // Serves sourceUsage(tenantId, source) — read on every share upload initiate.
    index("items_tenant_source_idx").on(table.tenantId, table.source),
    check("items_status_check", sql`${table.status} in ('pending', 'ready', 'deleting')`),
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

// A secret link granting filtered read and/or write access to a tenant's items.
// `conditions` are ANDed and appended to a share visitor's queries; a write
// grant force-applies `write_stamp` as the properties of every uploaded item
// and enforces the nullable quota columns (null = unlimited). Revocation is a
// row delete (as with api_tokens); orphaned `source = "share:{id}"` on items is
// harmless. Secrets are stored only as `secret_hash`.
export const shareGrants = pgTable(
  "share_grants",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    secretHash: text("secret_hash").notNull(),
    scopes: jsonb("scopes").$type<ReadonlyArray<ShareScope>>().notNull(),
    conditions: jsonb("conditions").$type<ReadonlyArray<QueryCondition>>().notNull(),
    writeStamp: jsonb("write_stamp").$type<Properties>(),
    maxItemBytes: bigint("max_item_bytes", { mode: "number" }),
    maxTotalBytes: bigint("max_total_bytes", { mode: "number" }),
    maxItems: integer("max_items"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [index("share_grants_tenant_created_idx").on(table.tenantId, table.createdAt)],
);
