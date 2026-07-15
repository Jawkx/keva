import { shareGrants } from "@keva/core/postgres";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

export const accountShareGrants = pgTable(
  "account_share_grants",
  {
    grantId: text("grant_id")
      .primaryKey()
      .references(() => shareGrants.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    invitedEmail: text("invited_email").notNull(),
    status: text("status").$type<"pending" | "accepted">().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("account_share_grants_owner_idx").on(table.ownerUserId, table.createdAt),
    index("account_share_grants_recipient_idx").on(
      table.recipientUserId,
      table.status,
      table.createdAt,
    ),
    check("account_share_grants_status_check", sql`${table.status} in ('pending', 'accepted')`),
  ],
);
