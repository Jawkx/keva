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
  readonly options?: UseAssetOptions<TItem> | undefined;
  readonly play?: (() => Promise<void>) | undefined;
  readonly player: shaka.Player;
  readonly preloadManager?: shaka.media.PreloadManager | undefined;
  readonly signal: AbortSignal;
  readonly startTime?: number | undefined;
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

    const load = context.options?.loader?.load;
    if (load) {
      const loadContext: AssetLoadContext<TItem> = {
        asset: context.asset,
        loadDefault: context.loadDefault,
        media: context.media,
        player: context.player,
        retryCount,
        signal: context.signal,
      };
      if (context.preloadManager !== undefined) {
        loadContext.preloadManager = context.preloadManager;
      }
      if (previousError !== undefined) {
        loadContext.previousError = previousError;
      }
      if (context.startTime !== undefined) {
        loadContext.startTime = context.startTime;
      }

      yield* Effect.tryPromise({
        catch: (cause) => mapLoadError(cause),
        try: () => load(loadContext),
      });
    } else {
      const resolveContext: ResolveSourceContext<TItem> = {
        asset: context.asset,
        retryCount,
        signal: context.signal,
      };
      if (previousError !== undefined) {
        resolveContext.previousError = previousError;
      }
      if (context.startTime !== undefined) {
        resolveContext.startTime = context.startTime;
      }
      const resolvedSource = yield* resolveSourceEffect(context.options, resolveContext);

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
