import { Effect } from "effect";
import type shaka from "shaka-player";

import type {
  AssetPreloadContext,
  PlaybackSource,
  ResolveSourceContext,
  TAsset,
  UseAssetOptions,
} from "@/hooks/limeplay/use-asset";

import {
  MediaPreloadFailed,
  type MediaPreviousError,
  MediaSourceResolutionFailed,
  MediaWorkflowAborted,
  MediaWorkflowSuperseded,
  isAbortError,
  toWorkflowError,
} from "./media-workflow-errors";

interface PreloadAssetContext<TItem extends TAsset> {
  readonly asset: TItem;
  readonly getIsCurrentPreload: () => boolean;
  readonly getPreviousError: () => MediaPreviousError | undefined;
  readonly getRetryCount: () => number;
  readonly options?: UseAssetOptions<TItem> | undefined;
  readonly player: shaka.Player;
  readonly preloadDefault: AssetPreloadContext<TItem>["preloadDefault"];
  readonly signal: AbortSignal;
}

export type PreloadAssetWorkflowError =
  | MediaPreloadFailed
  | MediaSourceResolutionFailed
  | MediaWorkflowAborted
  | MediaWorkflowSuperseded;

export const preloadAssetEffect = <TItem extends TAsset>(
  context: PreloadAssetContext<TItem>,
): Effect.Effect<null | shaka.media.PreloadManager, PreloadAssetWorkflowError> =>
  Effect.gen(function* () {
    yield* ensureCurrentPreload(context.getIsCurrentPreload, context.signal);

    const retryCount = context.getRetryCount();
    const previousError = context.getPreviousError();

    const preload = context.options?.loader?.preload;
    if (preload) {
      const preloadContext: AssetPreloadContext<TItem> = {
        asset: context.asset,
        player: context.player,
        preloadDefault: context.preloadDefault,
        retryCount,
        signal: context.signal,
      };
      if (previousError !== undefined) {
        preloadContext.previousError = previousError;
      }
      const manager = yield* Effect.tryPromise({
        catch: (cause) => mapPreloadError(cause),
        try: () => preload(preloadContext),
      });

      return manager;
    }

    const resolveContext: ResolveSourceContext<TItem> = {
      asset: context.asset,
      retryCount,
      signal: context.signal,
    };
    if (previousError !== undefined) {
      resolveContext.previousError = previousError;
    }
    const resolvedSource = yield* resolveSourceEffect(context.options, resolveContext);

    yield* ensureCurrentPreload(context.getIsCurrentPreload, context.signal);

    const manager = yield* Effect.tryPromise({
      catch: (cause) => mapPreloadError(cause),
      try: () => context.preloadDefault(resolvedSource ?? undefined),
    });

    return manager;
  });

function ensureCurrentPreload(
  getIsCurrentPreload: () => boolean,
  signal: AbortSignal,
): Effect.Effect<void, MediaWorkflowAborted | MediaWorkflowSuperseded> {
  if (signal.aborted) {
    return Effect.fail(new MediaWorkflowAborted({ reason: "aborted" }));
  }

  if (!getIsCurrentPreload()) {
    return Effect.fail(new MediaWorkflowSuperseded({ reason: "preload" }));
  }

  return Effect.void;
}

function mapPreloadError(cause: unknown): PreloadAssetWorkflowError {
  if (cause instanceof MediaWorkflowAborted || cause instanceof MediaWorkflowSuperseded) {
    return cause;
  }

  if (isAbortError(cause)) {
    return new MediaWorkflowAborted({ reason: "cancelled" });
  }

  return new MediaPreloadFailed({ cause: toWorkflowError(cause) });
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
