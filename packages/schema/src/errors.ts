import { Schema } from "effect";
import { ItemId } from "./common.js";

export class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  message: Schema.String,
}) {}
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  message: Schema.String,
}) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  message: Schema.String,
}) {}
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  message: Schema.String,
}) {}
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", {
  message: Schema.String,
  grantIds: Schema.optional(Schema.Array(Schema.String)),
}) {}
export class QuotaExceeded extends Schema.TaggedError<QuotaExceeded>()("QuotaExceeded", {
  message: Schema.String,
}) {}
export class SubscriptionRequired extends Schema.TaggedError<SubscriptionRequired>()(
  "SubscriptionRequired",
  { message: Schema.String },
) {}
export class RateLimitExceeded extends Schema.TaggedError<RateLimitExceeded>()(
  "RateLimitExceeded",
  { message: Schema.String, resetsAt: Schema.String },
) {}
export class StorageUnavailable extends Schema.TaggedError<StorageUnavailable>()(
  "StorageUnavailable",
  { message: Schema.String },
) {}
export class Internal extends Schema.TaggedError<Internal>()("Internal", {
  message: Schema.String,
}) {}

export const KevaError = Schema.Union([
  ValidationError,
  Unauthorized,
  Forbidden,
  NotFound,
  Conflict,
  QuotaExceeded,
  SubscriptionRequired,
  RateLimitExceeded,
  StorageUnavailable,
  Internal,
]);
export type KevaError = typeof KevaError.Type;

export const BatchPatchResult = Schema.Struct({
  updated: Schema.Array(
    Schema.Struct({
      id: ItemId,
      revision: Schema.Number.pipe(
        Schema.check(Schema.isInt()),
        Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      ),
    }),
  ),
  failed: Schema.Array(Schema.Struct({ id: ItemId, error: KevaError })),
});
export type BatchPatchResult = typeof BatchPatchResult.Type;

export const statusFor = (error: KevaError): number => {
  switch (error._tag) {
    case "ValidationError":
      return 400;
    case "Unauthorized":
      return 401;
    case "Forbidden":
      return 403;
    case "NotFound":
      return 404;
    case "Conflict":
      return 409;
    case "QuotaExceeded":
      return 413;
    case "SubscriptionRequired":
      return 402;
    case "RateLimitExceeded":
      return 429;
    case "StorageUnavailable":
      return 502;
    case "Internal":
      return 500;
  }
};
