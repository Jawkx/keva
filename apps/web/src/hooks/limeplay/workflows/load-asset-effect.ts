import { Effect } from "effect";
import type shaka from "shaka-player";

import type {
  AssetLoadContext,
  AssetSourceType,
  PlaybackSource,
  ResolveSourceContext,
  TAsset,
  UseAssetOptions,
} from "@/hooks/limeplay/use-asset";

import { isLoadInterrupted } from "@/hooks/limeplay/use-player";
import {
  MediaAssetLoadFailed,
  MediaAutoplayFailed,
  MediaLoadInterrupted,
  type MediaPreviousError,
  MediaSourceResolutionFailed,
  MediaWorkflowAborted,
  MediaWorkflowSuperseded,
  isAbortError,
  toWorkflowError,
} from "./media-workflow-errors";

interface LoadAssetContext<TItem extends TAsset> {
  readonly asset: TItem;
  readonly generation: number;
  readonly getGeneration: () => number;
  readonly getRetryCount: () => number;
  readonly getPreviousError: () => MediaPreviousError | undefined;
  readonly loadDefault: AssetLoadContext<TItem>["loadDefault"];
  readonly media: HTMLMediaElement;
  readonly options?: UseAssetOptions<TItem>;
  readonly play?: () => Promise<void>;
  readonly player: shaka.Player;
  readonly preloadManager?: shaka.media.PreloadManager;
  readonly signal: AbortSignal;
  readonly startTime?: number;
}

export type LoadAssetWorkflowError =
  | MediaAssetLoadFailed
  | MediaAutoplayFailed
  | MediaLoadInterrupted
  | MediaSourceResolutionFailed
  | MediaWorkflowAborted
  | MediaWorkflowSuperseded;

export interface LoadAssetWorkflowResult {
  readonly loaded: true;
}

export const loadAssetEffect = <TItem extends TAsset>(
  context: LoadAssetContext<TItem>,
): Effect.Effect<LoadAssetWorkflowResult, LoadAssetWorkflowError> =>
  Effect.gen(function* () {
    const retryCount = context.getRetryCount();
    const previousError = context.getPreviousError();

    if (context.options?.loader?.load) {
      yield* Effect.tryPromise({
        catch: (cause) => mapLoadError(cause),
        try: () =>
          context.options!.loader!.load!({
            asset: context.asset,
            loadDefault: context.loadDefault,
            media: context.media,
            player: context.player,
            ...(context.preloadManager === undefined
              ? {}
              : { preloadManager: context.preloadManager }),
            ...(previousError === undefined ? {} : { previousError }),
            retryCount,
            signal: context.signal,
            ...(context.startTime === undefined ? {} : { startTime: context.startTime }),
          }),
      });
    } else {
      const resolvedSource = yield* resolveSourceEffect(context.options, {
        asset: context.asset,
        ...(previousError === undefined ? {} : { previousError }),
        retryCount,
        signal: context.signal,
        ...(context.startTime === undefined ? {} : { startTime: context.startTime }),
      });

      yield* abortIfCancelled(context.signal);
      yield* ensureGeneration(context.generation, context.getGeneration);

      yield* Effect.tryPromise({
        catch: (cause) => mapLoadError(cause),
        try: () => context.loadDefault(resolvedSource),
      });
    }

    yield* abortIfCancelled(context.signal);
    yield* ensureGeneration(context.generation, context.getGeneration);

    if (context.play) {
      yield* Effect.tryPromise({
        catch: (cause) => new MediaAutoplayFailed({ cause }),
        try: context.play,
      });
    }

    return { loaded: true } as const;
  });

function abortIfCancelled(signal: AbortSignal): Effect.Effect<void, MediaWorkflowAborted> {
  return signal.aborted
    ? Effect.fail(new MediaWorkflowAborted({ reason: "aborted" }))
    : Effect.void;
}

function ensureGeneration(
  generation: number,
  getGeneration: () => number,
): Effect.Effect<void, MediaWorkflowSuperseded> {
  return getGeneration() !== generation
    ? Effect.fail(new MediaWorkflowSuperseded({ reason: "generation" }))
    : Effect.void;
}

function mapLoadError(cause: unknown): LoadAssetWorkflowError {
  if (cause instanceof MediaWorkflowAborted || cause instanceof MediaWorkflowSuperseded) {
    return cause;
  }

  if (isLoadInterrupted(cause)) {
    return new MediaLoadInterrupted({ cause });
  }

  if (isAbortError(cause)) {
    return new MediaWorkflowAborted({ reason: "cancelled" });
  }

  return new MediaAssetLoadFailed({ cause: toWorkflowError(cause) });
}

function resolveSourceEffect<TItem extends TAsset>(
  options: undefined | UseAssetOptions<TItem>,
  context: ResolveSourceContext<TItem>,
): Effect.Effect<null | PlaybackSource | string | undefined, MediaSourceResolutionFailed> {
  if (!options?.resolveSource) {
    return Effect.succeed(undefined);
  }

  return Effect.tryPromise({
    catch: (cause) => new MediaSourceResolutionFailed({ cause: toWorkflowError(cause) }),
    try: () => Promise.resolve(options.resolveSource!(context)),
  });
}

export function getLoadStartType(
  explicitSourceType: AssetSourceType | undefined,
  sourceType: AssetSourceType | null,
): AssetSourceType | null {
  return explicitSourceType ?? sourceType;
}
