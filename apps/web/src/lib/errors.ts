export interface TaggedError {
  readonly _tag: string;
  readonly message?: string;
}

const hasTag = (value: unknown): value is TaggedError =>
  typeof value === "object" && value !== null && "_tag" in value;

export const isUnauthorized = (error: unknown): boolean =>
  hasTag(error) && error._tag === "Unauthorized";

export const isShareGone = (error: unknown): boolean =>
  hasTag(error) &&
  (error._tag === "Unauthorized" || error._tag === "NotFound" || error._tag === "Forbidden");

export const errorMessage = (error: unknown): string => {
  if (hasTag(error)) {
    const tag = error._tag;
    const message =
      typeof error.message === "string" && error.message.length > 0 ? error.message : undefined;
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
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
};
