import { Schema } from "effect";
import { IsoInstant, ItemId } from "./common.js";

export const RealtimeEventReason = Schema.Literals([
  "uploaded",
  "patched",
  "restored",
  "trashed",
  "purged",
  "thumbnail_deleted",
  "thumbnail_ready",
  "thumbnail_failed",
  "bulk_changed",
]);
export type RealtimeEventReason = typeof RealtimeEventReason.Type;

export const RealtimeEvent = Schema.Struct({
  id: ItemId,
  type: Schema.Literal("items.changed"),
  reason: RealtimeEventReason,
  itemId: Schema.optional(ItemId),
  occurredAt: IsoInstant,
});
export type RealtimeEvent = typeof RealtimeEvent.Type;
