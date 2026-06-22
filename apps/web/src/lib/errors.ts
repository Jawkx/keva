// The SDK throws either a decoded typed error (a tagged object with `_tag` and
// `message`, e.g. NotFound / Unauthorized / ValidationError) or a
// KevaProtocolError. This narrows those into a friendly message and an
// "is this an auth failure?" flag the router can use to bounce to /login.

export interface TaggedError {
  readonly _tag: string;
  readonly message?: string;
}

const hasTag = (value: unknown): value is TaggedError =>
  typeof value === "object" && value !== null && "_tag" in value;

export const isUnauthorized = (error: unknown): boolean =>
  hasTag(error) && error._tag === "Unauthorized";

export const errorMessage = (error: unknown): string => {
  if (hasTag(error)) {
    const tag = error._tag;
    const message =
      typeof error.message === "string" && error.message.length > 0
        ? error.message
        : undefined;
    switch (tag) {
      case "Unauthorized":
        return message ?? "Your session has expired. Please sign in again.";
      case "Forbidden":
        return message ?? "You do not have permission to do that.";
      case "NotFound":
        return message ?? "That object could not be found.";
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
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
};
