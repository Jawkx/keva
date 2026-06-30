import type { Properties, ItemStatus, Scope } from "@keva/schema";
import {
  bigint,
  check,
  index,
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
