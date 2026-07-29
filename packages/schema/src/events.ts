import { Schema } from "effect";
import { ItemId } from "./common.js";
import { Actor } from "./principal.js";
import { PropertyValue } from "./properties.js";

export const ItemEventAction = Schema.Literal(
  "uploaded",
  "updated",
  "renamed",
  "properties_changed",
  "deleted",
);
export type ItemEventAction = typeof ItemEventAction.Type;

const PropertyChanges = Schema.Struct({
  set: Schema.optional(Schema.Record({ key: Schema.String, value: PropertyValue })),
  previous: Schema.optional(Schema.Record({ key: Schema.String, value: PropertyValue })),
  unset: Schema.optional(Schema.Array(Schema.String)),
});

export const ItemEventPayload = Schema.Struct({
  size: Schema.optional(Schema.NullOr(Schema.Number)),
  contentType: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  ...PropertyChanges.fields,
  name: Schema.optional(
    Schema.Struct({
      from: Schema.String,
      to: Schema.String,
    }),
  ),
  properties: Schema.optional(PropertyChanges),
});
export type ItemEventPayload = typeof ItemEventPayload.Type;

// `itemName` and `actor` are write-time snapshots; events outlive the item and
// the acting credential. `actor` is null for unattributed (backfilled) events.
export const ItemEvent = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  itemId: ItemId,
  itemName: Schema.String,
  action: ItemEventAction,
  actor: Schema.NullOr(Actor),
  payload: ItemEventPayload,
  createdAt: Schema.String,
});
export type ItemEvent = typeof ItemEvent.Type;

export const ItemEventsResult = Schema.Struct({
  events: Schema.Array(ItemEvent),
  nextCursor: Schema.optional(Schema.String),
});
export type ItemEventsResult = typeof ItemEventsResult.Type;
