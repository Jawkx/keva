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
  readonly options?: UseAssetOptions<TItem>;
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

    if (context.options?.loader?.preload) {
      const manager = yield* Effect.tryPromise({
        catch: (cause) => mapPreloadError(cause),
        try: () =>
          context.options!.loader!.preload!({
            asset: context.asset,
            player: context.player,
            preloadDefault: context.preloadDefault,
            ...(previousError === undefined ? {} : { previousError }),
            retryCount,
            signal: context.signal,
          }),
      });

      return manager;
    }

    const resolvedSource = yield* resolveSourceEffect(context.options, {
      asset: context.asset,
      ...(previousError === undefined ? {} : { previousError }),
      retryCount,
      signal: context.signal,
    });

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
