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

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function isWorkflowCancellation(error: unknown): boolean {
  return (
    error instanceof MediaWorkflowAborted ||
    error instanceof MediaWorkflowSuperseded ||
    error instanceof MediaLoadInterrupted
  );
}

export function getWorkflowCause(error: unknown): unknown {
  return typeof error === "object" && error !== null && "cause" in error ? error.cause : error;
}

export function toWorkflowError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    return Object.assign(
      new Error(String((error as { message?: string }).message ?? error)),
      error,
    );
  }

  return new Error(String(error));
}
