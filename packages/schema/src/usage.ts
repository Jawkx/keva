import { Schema } from "effect";

export const ContentTypeUsage = Schema.Struct({
  contentType: Schema.String,
  count: Schema.Number,
  bytes: Schema.Number,
});
export type ContentTypeUsage = typeof ContentTypeUsage.Type;

export const UsageResult = Schema.Struct({
  itemCount: Schema.Number,
  totalBytes: Schema.Number,
  accountedItems: Schema.Number,
  quotaBytes: Schema.NullOr(Schema.Number),
  quotaItems: Schema.NullOr(Schema.Number),
  remainingBytes: Schema.NullOr(Schema.Number),
  remainingItems: Schema.NullOr(Schema.Number),
  period: Schema.NullOr(
    Schema.Struct({
      startsAt: Schema.String,
      endsAt: Schema.String,
      uploadsUsed: Schema.Number,
      uploadsReserved: Schema.Number,
      uploadsLimit: Schema.Number,
      apiRequestsUsed: Schema.Number,
      apiRequestsLimit: Schema.Number,
    }),
  ),
  byType: Schema.Array(ContentTypeUsage),
});
export type UsageResult = typeof UsageResult.Type;
