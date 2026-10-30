import { Data } from "effect";

export class MediaWorkflowAborted extends Data.TaggedError("MediaWorkflowAborted")<{
  readonly reason: "aborted" | "cancelled";
}> {}

export class MediaWorkflowSuperseded extends Data.TaggedError("MediaWorkflowSuperseded")<{
  readonly reason: "generation" | "preload";
}> {}

export class MediaLoadInterrupted extends Data.TaggedError("MediaLoadInterrupted")<{
  readonly cause: unknown;
}> {}

export class MediaSourceMissing extends Data.TaggedError("MediaSourceMissing")<{
  readonly assetId: string;
}> {}

export class MediaSourceResolutionFailed extends Data.TaggedError("MediaSourceResolutionFailed")<{
  readonly cause: unknown;
}> {}

export class MediaAssetLoadFailed extends Data.TaggedError("MediaAssetLoadFailed")<{
  readonly cause: unknown;
}> {}

export class MediaAutoplayFailed extends Data.TaggedError("MediaAutoplayFailed")<{
  readonly cause: unknown;
}> {}

export class MediaPlaybackFailed extends Data.TaggedError("MediaPlaybackFailed")<{
  readonly cause: unknown;
}> {}

export class MediaPreloadFailed extends Data.TaggedError("MediaPreloadFailed")<{
  readonly cause: unknown;
}> {}

export class PlayerAttachFailed extends Data.TaggedError("PlayerAttachFailed")<{
  readonly cause: unknown;
}> {}

export class PlayerDestroyFailed extends Data.TaggedError("PlayerDestroyFailed")<{
  readonly cause: unknown;
}> {}

export class PictureInPictureFailed extends Data.TaggedError("PictureInPictureFailed")<{
  readonly cause: unknown;
}> {}

export type MediaWorkflowError =
  | MediaAssetLoadFailed
  | MediaAutoplayFailed
  | MediaLoadInterrupted
  | MediaPlaybackFailed
  | MediaPreloadFailed
  | MediaSourceMissing
  | MediaSourceResolutionFailed
  | MediaWorkflowAborted
  | MediaWorkflowSuperseded
  | PictureInPictureFailed
  | PlayerAttachFailed
  | PlayerDestroyFailed;

export type MediaPreviousError = Error | MediaWorkflowError | null;

export function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

export function isWorkflowCancellation(error: MediaWorkflowError): boolean {
  return (
    error instanceof MediaWorkflowAborted ||
    error instanceof MediaWorkflowSuperseded ||
    error instanceof MediaLoadInterrupted
  );
}

export function getWorkflowCause(error: MediaWorkflowError): Error {
  return "cause" in error ? toWorkflowError(error.cause) : toWorkflowError(error);
}

export function toWorkflowError(cause: unknown): Error {
  if (cause instanceof Error) {
    return cause;
  }

  if (cause instanceof Object) {
    const message = "message" in cause ? cause.message : cause;
    return Object.assign(new Error(String(message)), cause);
  }

  return new Error(String(cause));
}
