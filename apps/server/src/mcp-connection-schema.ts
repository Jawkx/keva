import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { oauthApplication, user } from "./auth-schema.js";

export const mcpConnectionActivity = pgTable(
  "mcp_connection_activity",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: "cascade" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.clientId] }),
    index("mcp_connection_activity_user_last_seen_idx").on(table.userId, table.lastSeenAt),
  ],
);
