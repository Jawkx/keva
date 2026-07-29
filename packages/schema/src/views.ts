import { Schema } from "effect";
import { QueryCondition } from "./query.js";

export const ViewRecord = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  name: Schema.NonEmptyString,
  // A Lucide icon key resolved by the web client; null = default icon.
  icon: Schema.NullOr(Schema.String),
  conditions: Schema.Array(QueryCondition),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ViewRecord = typeof ViewRecord.Type;

export const CreateView = Schema.Struct({
  name: Schema.NonEmptyString,
  icon: Schema.optional(Schema.String),
  conditions: Schema.Array(QueryCondition),
});
export type CreateView = typeof CreateView.Type;

export const UpdateView = Schema.Struct({
  name: Schema.optional(Schema.NonEmptyString),
  icon: Schema.optional(Schema.String),
  conditions: Schema.optional(Schema.Array(QueryCondition)),
});
export type UpdateView = typeof UpdateView.Type;
