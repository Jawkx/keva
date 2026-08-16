import { Schema } from "effect";

const TaggedError = Schema.Struct({
  _tag: Schema.String,
  message: Schema.optional(Schema.String),
});

export interface TaggedError extends Schema.Schema.Type<typeof TaggedError> {}

const parseTaggedError = (cause: unknown): TaggedError | null =>
  Schema.is(TaggedError)(cause) ? cause : null;

export const isUnauthorized = (cause: unknown): boolean =>
  parseTaggedError(cause)?._tag === "Unauthorized";

export const isShareGone = (cause: unknown): boolean => {
  const tag = parseTaggedError(cause)?._tag;
  return tag === "Unauthorized" || tag === "NotFound" || tag === "Forbidden";
};

export const isNotFound = (cause: unknown): boolean => parseTaggedError(cause)?._tag === "NotFound";

export const errorMessage = (cause: unknown): string => {
  const error = parseTaggedError(cause);
  if (error) {
    const tag = error._tag;
    const message = error.message && error.message.length > 0 ? error.message : undefined;
    switch (tag) {
      case "Unauthorized":
        return message ?? "Your session has expired. Please sign in again.";
      case "Forbidden":
        return message ?? "You do not have permission to do that.";
      case "NotFound":
        return message ?? "That item could not be found.";
      case "Conflict":
        return message ?? "That action conflicts with the current state.";
      case "QuotaExceeded":
        return message ?? "Storage quota exceeded.";
      case "StorageUnavailable":
        return message ?? "Storage is temporarily unavailable.";
      case "ValidationError":
        return message ?? "The request was invalid.";
      case "KevaProtocolError":
        return message ?? "The server returned an unexpected response.";
      default:
        return message ?? `Request failed (${tag}).`;
    }
  }
  if (cause instanceof Error) return cause.message;
  return "Something went wrong.";
};
