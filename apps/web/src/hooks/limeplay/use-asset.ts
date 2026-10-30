import { Effect, Result } from "effect";
import isNumber from "lodash/isNumber";
import isString from "lodash/isString";
import type shaka from "shaka-player";

import { useCallback, useEffect } from "react";

import type { PlaybackEvents, PlaybackStore } from "@/hooks/limeplay/use-playback";
import type { PlayerEvents, PlayerStore } from "@/hooks/limeplay/use-player";
import type {
  PlaylistChangeEvent,
  PlaylistEvents,
  PlaylistStore,
} from "@/hooks/limeplay/use-playlist";
import type {
  ImmerStoreApi,
  MediaEvents,
  MediaEventSlice,
  MediaFeature,
  MediaStore,
} from "@/components/limeplay/media-provider";

import { usePlaylist } from "@/hooks/limeplay/use-playlist";
import { loadAssetEffect } from "@/hooks/limeplay/workflows/load-asset-effect";
import { preloadAssetEffect } from "@/hooks/limeplay/workflows/preload-asset-effect";
import {
  MediaSourceMissing,
  type MediaPreviousError,
  getWorkflowCause,
  isWorkflowCancellation,
  toWorkflowError,
} from "@/hooks/limeplay/workflows/media-workflow-errors";
import { destroyPreloadManagerEffect } from "@/hooks/limeplay/workflows/player-lifecycle-effect";
import {
  useMediaEvents,
  useMediaFeatureApi,
  useMediaFeatureStore,
} from "@/components/limeplay/media-provider";

/** Context passed to a custom asset load handler. */
export interface AssetLoadContext<TItem extends TAsset = TAsset> {
  /** Asset being loaded. */
  asset: TItem;
  /** Run Limeplay's default Shaka load behavior. */
  loadDefault: (
    source?: null | PlaybackSource | shaka.media.PreloadManager | string,
    options?: number | { startTime?: number },
  ) => Promise<void>;
  /** Active media element. */
  media: HTMLMediaElement;
  /** Active Shaka Player instance. */
  player: shaka.Player;
  /** Existing preload manager for this asset, when available. */
  preloadManager?: shaka.media.PreloadManager;
  /** Previous load or playback error for retry-aware loaders. */
  previousError?: MediaPreviousError;
  /** Number of retry attempts for the active load session. */
  retryCount: number;
  /** Abort signal for the active load session. */
  signal: AbortSignal;
  /** Requested playback start time in seconds. */
  startTime?: number;
}

/** Context passed to a custom asset preload handler. */
export interface AssetPreloadContext<TItem extends TAsset = TAsset> {
  /** Asset being preloaded. */
  asset: TItem;
  /** Active Shaka Player instance. */
  player: shaka.Player;
  /** Run Limeplay's default Shaka preload behavior. */
  preloadDefault: (source?: PlaybackSource | string) => Promise<null | shaka.media.PreloadManager>;
  /** Previous load or preload error for retry-aware loaders. */
  previousError?: MediaPreviousError;
  /** Number of retry attempts for the active session. */
  retryCount: number;
  /** Abort signal for the active preload request. */
  signal: AbortSignal;
}

/** Source shape currently controlled by the asset feature. */
export const AssetSourceType = {
  Asset: "asset",
  Playlist: "playlist",
} as const;

export type AssetSourceType = (typeof AssetSourceType)[keyof typeof AssetSourceType];

/** Origin used when deriving or normalizing asset IDs. */
export const AssetSourceOrigin = {
  Asset: "asset",
  MediaProps: "media-props",
  Playlist: "playlist",
} as const;

export type AssetSourceOrigin = (typeof AssetSourceOrigin)[keyof typeof AssetSourceOrigin];

/** Recovery actions returned by load and playback recovery policies. */
export const AssetRecoveryAction = {
  Reload: "reload",
  Retry: "retry",
  Skip: "skip",
  Stop: "stop",
} as const;

/** Asset lifecycle events emitted through `useMediaEvents`. */
export interface AssetEvents {
  /** Emitted when the active playlist asset changes. */
  assetchange: PlaylistChangeEvent<TAsset>;
  /** Emitted after an asset loads successfully. */
  assetloaded: { asset: TAsset };
  /** Emitted when asset loading fails. */
  assetloaderror: { asset: TAsset; error: Error };
  /** Emitted before asset loading starts. */
  assetloadstart: { asset: TAsset; sourceType: AssetSourceType | null };
  /** Emitted after an asset preloads successfully. */
  assetpreloaded: { asset: TAsset };
  /** Emitted when asset preloading fails. */
  assetpreloaderror: { asset: TAsset; error: Error };
  /** Emitted before asset preloading starts. */
  assetpreloadstart: { asset: TAsset };
}

/** Decision returned from load-error recovery. */
export type AssetLoadDecision =
  | typeof AssetRecoveryAction.Retry
  | typeof AssetRecoveryAction.Skip
  | typeof AssetRecoveryAction.Stop;

/** Options for loading a source into the asset feature. */
export interface AssetLoadSourceOptions<TItem extends TAsset> {
  /** Initial playlist index when the source is an array. */
  initialIndex?: number;
  /** Session-local loading configuration. */
  loading?: UseAssetOptions<TItem>;
  /** Stable key used by source controllers to identify equivalent sources. */
  sourceKey?: string;
  /** Explicit source type override for UI and recovery behavior. */
  sourceType?: AssetSourceType;
}

/** Decision returned from playback-error recovery. */
export type AssetPlaybackRecoveryDecision<TItem extends TAsset> =
  | {
      action: typeof AssetRecoveryAction.Reload;
      asset?: TItem;
      startTime?: number;
    }
  | { action: typeof AssetRecoveryAction.Skip }
  | { action: typeof AssetRecoveryAction.Stop };

export type AssetRecoveryAction = (typeof AssetRecoveryAction)[keyof typeof AssetRecoveryAction];

/** Active source loading session. */
export interface AssetSession<TItem extends TAsset = TAsset> {
  /** Unique session ID generated for each explicit load. */
  id: string;
  /** Loading configuration attached to this session. */
  loading?: UseAssetOptions<TItem>;
  /** Stable source key, when provided by the caller. */
  sourceKey?: string;
  /** Source type for this session. */
  sourceType: AssetSourceType;
}

/** Returns a stable ID for an asset when `asset.id` is not enough. */
export type GetAssetId<TItem extends TAsset = TAsset> = (
  asset: TItem,
  context: {
    index?: number;
    origin: AssetSourceOrigin;
  },
) => null | string | undefined;

/** Asset normalized for playlist storage. */
export interface NormalizedAsset<TItem extends TAsset = TAsset> {
  /** Stable playlist item ID. */
  id: string;
  /** Original asset object. */
  properties: TItem;
}

/** Resolved playback source passed to Shaka Player. */
export interface PlaybackSource {
  /** Shaka Player configuration applied before loading. */
  config?: shaka.extern.PlayerConfiguration;
  /** MIME type supplied to Shaka to avoid probing signed URLs with HEAD. */
  mimeType?: string;
  /** Playback URL. */
  src?: string;
}

/** Public source input accepted by blocks and `loadSource`. */
export type PlayerSource<TItem extends TAsset = TAsset> = readonly TItem[] | string | TItem;

/** Lazily resolves a playable source for an asset. */
export type ResolveSource<TItem extends TAsset = TAsset> = (
  context: ResolveSourceContext<TItem>,
) => MaybePromise<null | PlaybackSource | string | undefined>;

/** Context passed to `resolveSource`. */
export interface ResolveSourceContext<TItem extends TAsset = TAsset> {
  /** Asset whose source should be resolved. */
  asset: TItem;
  /** Previous error for retry-aware resolution. */
  previousError?: MediaPreviousError;
  /** Number of retry attempts in the active session. */
  retryCount: number;
  /** Abort signal for the active load or preload request. */
  signal: AbortSignal;
  /** Requested playback start time in seconds. */
  startTime?: number;
}

/** Minimal playback configuration for one playable media item. */
export interface TAsset {
  /** Shaka Player configuration applied before this asset loads. */
  config?: shaka.extern.PlayerConfiguration;
  /** Stable identifier used for playlist, preload, and recovery state. */
  id?: string;
  /** MIME type supplied to Shaka to avoid probing signed URLs with HEAD. */
  mimeType?: string;
  /** Direct playback URL. Use `resolveSource` when this is resolved lazily. */
  src?: string;
}

/** Store actions exposed by the asset feature. */
export interface UseAssetActions {
  /** Current source loading session. */
  activeSession: AssetSession | null;
  /** Load a single asset immediately. */
  loadAsset: (asset: TAsset, startTime?: number) => Promise<boolean>;
  /** Load assets into the playlist and start from `startIndex`. */
  loadPlaylist: (
    assets: TAsset[],
    startIndex?: number,
    sourceType?: AssetSourceType,
    options?: Omit<AssetLoadSourceOptions<TAsset>, "initialIndex" | "sourceType">,
  ) => void;
  /** Normalize and load a URL, asset, or asset array. */
  loadSource: (source: PlayerSource<TAsset>, options?: AssetLoadSourceOptions<TAsset>) => void;
  /** Preload one asset for faster future playback. */
  preloadAsset: (asset: TAsset) => Promise<void>;
  /** Preload the next playlist item, when one exists. */
  preloadNext: () => Promise<void>;
}

/** Alias for custom load handler context. */
export type UseAssetLoadContext<TItem extends TAsset> = AssetLoadContext<TItem>;

/** Custom loader hooks for replacing or extending default Shaka behavior. */
export interface UseAssetLoader<TItem extends TAsset> {
  /** Custom load implementation. Call `context.loadDefault()` to reuse defaults. */
  load?: (context: AssetLoadContext<TItem>) => Promise<void>;
  /** Custom preload implementation. Call `context.preloadDefault()` to reuse defaults. */
  preload?: (context: AssetPreloadContext<TItem>) => Promise<null | shaka.media.PreloadManager>;
}

/** Session-local loading options for asset source loading. */
export interface UseAssetOptions<TItem extends TAsset> {
  /** Allow autoplay on the first loaded asset when the media element requests autoplay. */
  autoplayFirst?: boolean;
  /** Resolve a stable asset ID when `asset.id` is missing or insufficient. */
  getAssetId?: GetAssetId<TItem>;
  /** Custom load and preload handlers. */
  loader?: UseAssetLoader<TItem>;
  /** Maximum retry attempts used by `recover.loadError`. */
  maxRetries?: number;
  /** Recovery policies for load and playback errors. */
  recover?: {
    /** Decide whether to retry, skip, or stop after a load error. */
    loadError?: (
      asset: TItem,
      error: MediaPreviousError,
      context: { hasNext: boolean; retryCount: number },
    ) => AssetLoadDecision;
    /** Decide whether to reload, skip, or stop after a playback error. */
    playbackError?: (
      asset: TItem,
      error: Error,
      context: { currentTime: number },
    ) => Promise<AssetPlaybackRecoveryDecision<TItem>>;
  };
  /** Lazily resolve the playback URL or source config for an asset. */
  resolveSource?: ResolveSource<TItem>;
}

/** Alias for custom preload handler context. */
export type UseAssetPreloadContext<TItem extends TAsset> = AssetPreloadContext<TItem>;

/** Values and actions returned by `useAsset`. */
export interface UseAssetReturn<TItem extends TAsset> {
  /** Cancel an active preload by asset ID. */
  cancelPreload: (assetId: string) => void;
  /** Current playlist index. */
  currentIndex: number;
  /** Current playlist item. */
  currentItem: null | { id: string; properties: TItem };
  /** Return a playlist item by ID. */
  getItem: (id: string) => null | { id: string; properties: TItem };
  /** Whether a next playlist item is available. */
  hasNext: boolean;
  /** Whether a previous playlist item is available. */
  hasPrevious: boolean;
  /** Check whether an asset has a stored Shaka preload manager. */
  isPreloaded: (assetId: string) => boolean;
  /** Load one asset immediately. */
  loadAsset: (asset: TItem, startTime?: number) => Promise<boolean>;
  /** Load a playlist and start from `startIndex`. */
  loadPlaylist: (
    assets: TItem[],
    startIndex?: number,
    sourceType?: AssetSourceType,
    options?: Omit<AssetLoadSourceOptions<TItem>, "initialIndex" | "sourceType">,
  ) => void;
  /** Load a URL string, one asset, or an asset array. */
  loadSource: (source: PlayerSource<TItem>, options?: AssetLoadSourceOptions<TItem>) => void;
  /** Next playlist item, when available. */
  nextItem: null | { id: string; properties: TItem };
  /** Playlist items in playback order. */
  orderedItems: { id: string; properties: TItem }[];
  /** Preload one asset for faster future playback. */
  preloadAsset: (asset: TItem) => Promise<void>;
  /** Preload the next playlist item, when one exists. */
  preloadNext: () => Promise<void>;
  /** Previous playlist item, when available. */
  previousItem: null | { id: string; properties: TItem };
  /** Current source mode, or `null` before a source is loaded. */
  sourceType: AssetSourceType | null;
}

/** Internal state owned by the asset feature. */
export interface UseAssetState {
  /** Current source loading session. */
  activeSession: AssetSession | null;
  /** Whether the current session has not completed its first load. */
  isFirstLoad: boolean;
  /** Abort controller for the active load. */
  loadAbortController: AbortController | null;
  /** Monotonic generation used to ignore stale loads. */
  loadGeneration: number;
  /** Most recent load or playback error. */
  previousError: MediaPreviousError;
  /** Retry count for the active session. */
  retryCount: number;
  /** Current source mode, or `null` before a source is loaded. */
  sourceType: AssetSourceType | null;
}

export const ASSET_FEATURE_KEY = "asset";

/** Store slice installed by `assetFeature`. */
export interface AssetStore extends MediaEventSlice<AssetEvents> {
  [ASSET_FEATURE_KEY]: {
    activeSession: AssetSession | null;
    isFirstLoad: boolean;
    loadAbortController: AbortController | null;
    loadAsset: (
      asset: TAsset,
      startTime?: number,
      sourceType?: AssetSourceType,
    ) => Promise<boolean>;
    loadGeneration: number;
    loadPlaylist: (
      assets: TAsset[],
      startIndex?: number,
      sourceType?: AssetSourceType,
      options?: Omit<AssetLoadSourceOptions<TAsset>, "initialIndex" | "sourceType">,
    ) => void;
    loadSource: (source: PlayerSource<TAsset>, options?: AssetLoadSourceOptions<TAsset>) => void;
    preloadAbortControllers: Record<string, AbortController | undefined>;
    preloadAsset: (asset: TAsset) => Promise<void>;
    preloadNext: () => Promise<void>;
    previousError: MediaPreviousError;
    retryCount: number;
    setSourceType: (sourceType: AssetSourceType | null) => void;
    sourceType: AssetSourceType | null;
  };
}

type AssetSetupStore = AssetStore & MediaStore & PlaybackStore & PlayerStore & PlaylistStore;

type MaybePromise<T> = Promise<T> | T;

type NormalizedSource = {
  config?: shaka.extern.PlayerConfiguration;
  mimeType?: string;
  source?: null | shaka.media.PreloadManager | string;
};

/**
 * Adds source loading, playlist-backed playback, preloading, and recovery
 * orchestration to a media kit.
 */
export function assetFeature(): MediaFeature<
  AssetStore,
  AssetStore & MediaStore & PlaybackStore & PlayerStore & PlaylistStore
> {
  return {
    createSlice: (set, get, _store, events) => ({
      [ASSET_FEATURE_KEY]: {
        activeSession: null,
        isFirstLoad: true,
        loadAbortController: null,
        loadAsset: async (asset, startTime, sourceType) => {
          const player = get().player.instance;
          const media = get().media.mediaElement;
          const session = get().asset.activeSession;
          const options = session?.loading;

          if (sourceType) {
            set(({ asset }) => {
              asset.sourceType = sourceType;
            });
          }

          if (!player || !media) {
            return false;
          }

          const assetId = getNormalizedAssetId(asset, options, {
            origin: AssetSourceOrigin.Asset,
          });

          const generation = get().asset.loadGeneration + 1;
          get().asset.loadAbortController?.abort();

          const abortController = new AbortController();

          set(({ asset }) => {
            asset.loadAbortController = abortController;
            asset.loadGeneration = generation;
          });

          get().playback.pause();
          set(({ playback }) => {
            playback.error = null;
            playback.status = "loading";
          });
          events.emit("assetloadstart", {
            asset,
            sourceType: sourceType ?? get().asset.sourceType,
          });

          const preloadManagers = get().player.preloadManagers;
          const preloadManager = preloadManagers.get(assetId);
          const defaultLoadContext: Parameters<typeof createDefaultLoad>[0] = {
            asset,
            assetId,
            player,
          };
          if (preloadManager !== undefined) {
            defaultLoadContext.preloadManager = preloadManager;
          }
          if (startTime !== undefined) {
            defaultLoadContext.startTime = startTime;
          }
          const loadDefault = createDefaultLoad(defaultLoadContext);
          const shouldAutoplay =
            media.autoplay &&
            media.paused &&
            (!get().asset.isFirstLoad || Boolean(options?.autoplayFirst));
          const loadWorkflowContext = {
            asset,
            generation,
            getGeneration: () => get().asset.loadGeneration,
            getPreviousError: () => get().asset.previousError ?? undefined,
            getRetryCount: () => get().asset.retryCount,
            loadDefault,
            media,
            options,
            play: shouldAutoplay ? () => get().playback.play() : undefined,
            player,
            preloadManager,
            signal: abortController.signal,
            startTime,
          };
          const result = await Effect.runPromise(
            loadAssetEffect(loadWorkflowContext).pipe(Effect.result),
          );

          if (Result.isSuccess(result)) {
            if (preloadManager) {
              const updated = new Map(preloadManagers);
              updated.delete(assetId);
              set(({ player }) => {
                player.preloadManagers = updated;
              });
            }

            set(({ asset }) => {
              asset.isFirstLoad = false;
              asset.previousError = null;
              asset.retryCount = 0;
            });

            events.emit("assetloaded", { asset });
            return true;
          }

          const workflowError = result.failure;
          if (isWorkflowCancellation(workflowError)) {
            return false;
          }

          const cause = getWorkflowCause(workflowError);
          const normalizedError = toWorkflowError(cause);
          events.emit("assetloaderror", { asset, error: normalizedError });
          const playlist = get().playlist;
          const maxRetries = options?.maxRetries ?? 0;
          const currentRetryCount = get().asset.retryCount;
          const hasNext = playlist.getNextIndex() !== -1;

          set(({ asset }) => {
            asset.previousError = workflowError;
          });

          if (options?.recover?.loadError) {
            const decision = options.recover.loadError(asset, normalizedError, {
              hasNext,
              retryCount: currentRetryCount,
            });

            if (decision === AssetRecoveryAction.Retry && currentRetryCount < maxRetries) {
              set(({ asset }) => {
                asset.retryCount = currentRetryCount + 1;
              });
              return get().asset.loadAsset(asset, startTime, sourceType);
            }

            if (
              (decision === AssetRecoveryAction.Skip ||
                (decision === AssetRecoveryAction.Retry && currentRetryCount >= maxRetries)) &&
              hasNext
            ) {
              set(({ asset }) => {
                asset.previousError = null;
                asset.retryCount = 0;
              });
              playlist.next();
              return false;
            }

            set(({ asset }) => {
              asset.previousError = null;
              asset.retryCount = 0;
            });
            get().playback.setError(normalizedError);
            return false;
          }

          if (hasNext) {
            set(({ asset }) => {
              asset.previousError = null;
              asset.retryCount = 0;
            });
            playlist.next();
          } else {
            get().playback.setError(normalizedError);
          }
          return false;
        },
        loadGeneration: 0,
        loadPlaylist: (assets, startIndex = 0, sourceType, options) => {
          const resolvedSourceType = sourceType ?? AssetSourceType.Playlist;
          const activeSession = createAssetSession(resolvedSourceType, options);
          const normalizedAssets = normalizeAssets(assets, activeSession.loading);

          set(({ asset }) => {
            asset.activeSession = activeSession;
            asset.isFirstLoad = true;
            asset.previousError = null;
            asset.retryCount = 0;
            asset.sourceType = resolvedSourceType;
          });

          get().playlist.load(normalizedAssets, startIndex);
        },
        loadSource: (source, options) => {
          const assets = normalizePlayerSource(source);
          const sourceType =
            options?.sourceType ??
            (Array.isArray(source)
              ? AssetSourceType.Playlist
              : (getSourceTypeForItems(assets) ?? AssetSourceType.Asset));

          get().asset.loadPlaylist(assets, options?.initialIndex, sourceType, options);
        },
        preloadAbortControllers: {},
        preloadAsset: async (asset) => {
          const player = get().player.instance;
          const session = get().asset.activeSession;
          const options = session?.loading;
          if (!player) return;

          const assetId = getNormalizedAssetId(asset, options, {
            origin: AssetSourceOrigin.Asset,
          });
          get().asset.preloadAbortControllers[assetId]?.abort();
          const abortController = new AbortController();

          set(({ asset }) => {
            asset.preloadAbortControllers[assetId] = abortController;
          });
          events.emit("assetpreloadstart", { asset });

          const isCurrentPreload = () => {
            return (
              get().asset.preloadAbortControllers[assetId] === abortController &&
              !abortController.signal.aborted
            );
          };

          const preloadDefault = async (
            source?: PlaybackSource | string,
          ): Promise<null | shaka.media.PreloadManager> => {
            if (!isCurrentPreload()) return null;

            const normalizedSource = normalizePlaybackSource(source);
            const resolvedSource = normalizedSource.source ?? asset.src;

            if (!resolvedSource || !isString(resolvedSource)) {
              throw new MediaSourceMissing({ assetId });
            }

            const manager = await player.preload(
              resolvedSource,
              undefined,
              normalizedSource.mimeType ?? asset.mimeType,
              mergePlayerConfiguration(asset.config, normalizedSource.config),
            );
            if (!isCurrentPreload()) {
              if (manager) void Effect.runPromiseExit(destroyPreloadManagerEffect(manager));
              return null;
            }

            return manager;
          };

          const result = await Effect.runPromise(
            preloadAssetEffect({
              asset,
              getIsCurrentPreload: isCurrentPreload,
              getPreviousError: () => get().asset.previousError ?? undefined,
              getRetryCount: () => get().asset.retryCount,
              options,
              player,
              preloadDefault,
              signal: abortController.signal,
            }).pipe(Effect.result),
          );

          if (Result.isFailure(result)) {
            if (!isWorkflowCancellation(result.failure)) {
              const error = toWorkflowError(getWorkflowCause(result.failure));
              events.emit("assetpreloaderror", { asset, error });
              console.error("[useAsset] Preload error:", error);
            }
            return;
          }

          const manager = result.success;
          if (!isCurrentPreload()) {
            if (manager) void Effect.runPromiseExit(destroyPreloadManagerEffect(manager));
            return;
          }

          if (manager) {
            const existing = get().player.preloadManagers;
            const previousManager = existing.get(assetId);

            if (previousManager && previousManager !== manager) {
              void Effect.runPromiseExit(destroyPreloadManagerEffect(previousManager));
            }

            const updated = new Map(existing);
            updated.set(assetId, manager);
            set(({ player }) => {
              player.preloadManagers = updated;
            });
            events.emit("assetpreloaded", { asset });
          }
        },
        preloadNext: async () => {
          const playlist = get().playlist;
          const nextIndex = playlist.getNextIndex();
          if (nextIndex === -1) return;
          const nextItem = playlist.queue[nextIndex];
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- noUncheckedIndexedAccess is off; index can be out of bounds
          if (nextItem) {
            await get().asset.preloadAsset(nextItem.properties);
          }
        },
        previousError: null,
        retryCount: 0,
        setSourceType: (sourceType) => {
          set(({ asset }) => {
            asset.sourceType = sourceType;
          });
        },
        sourceType: null,
      },
    }),
    key: ASSET_FEATURE_KEY,
    Setup: AssetSetup,
  };
}

/**
 * Access asset loading state and actions for the current `MediaProvider`.
 *
 * `useAsset()` is optionless. Pass loading configuration to `loadSource`,
 * `loadPlaylist`, or a block's `loading` prop so configuration is scoped to
 * the active source session.
 */
export function useAsset<TItem extends TAsset = TAsset>(): UseAssetReturn<TItem> {
  const api = useMediaFeatureApi<AssetStore & PlayerStore>(ASSET_FEATURE_KEY);
  const playlist = usePlaylist<TItem>();
  const loadAssetAction = useAssetStore((state) => state.loadAsset);
  const loadPlaylistAction = useAssetStore((state) => state.loadPlaylist);
  const loadSourceAction = useAssetStore((state) => state.loadSource);
  const preloadAsset = useAssetStore((state) => state.preloadAsset);
  const preloadNext = useAssetStore((state) => state.preloadNext);
  const sourceType = useAssetStore((state) => state.sourceType);

  const loadAsset = useCallback<UseAssetReturn<TItem>["loadAsset"]>(
    (asset, startTime) => loadAssetAction(asset, startTime, sourceType ?? AssetSourceType.Asset),
    [loadAssetAction, sourceType],
  );

  const loadPlaylist = useCallback<UseAssetReturn<TItem>["loadPlaylist"]>(
    (assets, startIndex, playlistSourceType, options) =>
      loadPlaylistAction(
        assets,
        startIndex,
        playlistSourceType,
        adaptAssetLoadOptions(options, assets),
      ),
    [loadPlaylistAction],
  );

  const loadSource = useCallback<UseAssetReturn<TItem>["loadSource"]>(
    (source, options) =>
      loadSourceAction(source, adaptAssetSourceOptions(options, getOwnedAssets(source))),
    [loadSourceAction],
  );

  const cancelPreload = useCallback(
    (assetId: string) => {
      const preloadAbortController = api.getState().asset.preloadAbortControllers[assetId];
      preloadAbortController?.abort();

      const preloadManagers = api.getState().player.preloadManagers;
      const manager = preloadManagers.get(assetId);
      if (manager) {
        manager.destroy();
        const updated = new Map(preloadManagers);
        updated.delete(assetId);
        api.setState(({ player }) => {
          player.preloadManagers = updated;
        });
      }

      api.setState(({ asset }) => {
        delete asset.preloadAbortControllers[assetId];
      });
    },
    [api],
  );

  const isPreloaded = useCallback(
    (assetId: string) => {
      return api.getState().player.preloadManagers.has(assetId);
    },
    [api],
  );

  return {
    cancelPreload,
    currentIndex: playlist.currentIndex,
    currentItem: playlist.currentItem,
    getItem: playlist.getItem,
    hasNext: playlist.hasNext,
    hasPrevious: playlist.hasPrevious,
    isPreloaded,
    loadAsset,
    loadPlaylist,
    loadSource,
    nextItem: playlist.nextItem,
    orderedItems: playlist.orderedItems,
    preloadAsset,
    preloadNext,
    previousItem: playlist.previousItem,
    sourceType,
  };
}

/** Subscribe to a field from the asset feature store slice. */
export function useAssetStore<TSelected>(
  selector: (state: AssetStore["asset"]) => TSelected,
): TSelected {
  return useMediaFeatureStore<AssetStore, TSelected>(ASSET_FEATURE_KEY, (state) =>
    selector(state[ASSET_FEATURE_KEY]),
  );
}

function AssetSetup() {
  const api = useMediaFeatureApi<AssetSetupStore>(ASSET_FEATURE_KEY);
  const events = useMediaEvents<AssetEvents & PlaybackEvents & PlayerEvents & PlaylistEvents>();
  useEffect(() => subscribeAssetEvents(api, events), [api, events]);

  return null;
}

function subscribeAssetEvents(
  api: ImmerStoreApi<AssetSetupStore>,
  events: MediaEvents<AssetEvents & PlaybackEvents & PlayerEvents & PlaylistEvents>,
) {
  const getHasNext = () => {
    const { getNextIndex, queue, repeatMode } = api.getState().playlist;
    return repeatMode === "all" && queue.length > 0 ? true : getNextIndex() !== -1;
  };

  const offPlaylistChange = events.on("playlistchange", (event) => {
    const item = event.currentItem;
    if (!item) return;
    events.emit("assetchange", event);
    void api
      .getState()
      .asset.loadAsset(
        item.properties,
        undefined,
        api.getState().asset.sourceType ?? AssetSourceType.Playlist,
      );
  });

  const offPlaybackError = events.on("playbackerror", (payload) => {
    const state = api.getState();
    const { currentItem } = state.playlist;
    const sessionId = state.asset.activeSession?.id;
    const options = state.asset.activeSession?.loading;
    if (!currentItem) return;
    const currentItemId = currentItem.id;

    const getFreshCurrentItem = () => {
      const freshState = api.getState();
      if (freshState.asset.activeSession?.id !== sessionId) return null;
      if (freshState.playlist.currentItem?.id !== currentItemId) return null;

      return freshState.playlist.currentItem;
    };

    const mediaElement = api.getState().media.mediaElement;
    const recover = Effect.tryPromise({
      try: async () => {
        const currentTime =
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          payload.currentTime ?? mediaElement?.currentTime ?? 0;
        const decision = options?.recover?.playbackError
          ? await options.recover.playbackError(currentItem.properties, payload.error, {
              currentTime,
            })
          : {
              action: AssetRecoveryAction.Stop,
            };
        const freshCurrentItem = getFreshCurrentItem();
        if (!freshCurrentItem) return;

        if (decision.action === AssetRecoveryAction.Reload) {
          const assetToLoad = decision.asset ?? freshCurrentItem.properties;
          const startTime = decision.startTime ?? currentTime;
          api.setState(({ asset }) => {
            asset.previousError = payload.error;
          });
          await api
            .getState()
            .asset.loadAsset(
              assetToLoad,
              startTime,
              api.getState().asset.sourceType ?? AssetSourceType.Asset,
            );
        } else if (decision.action === AssetRecoveryAction.Skip && getHasNext()) {
          api.getState().playlist.next();
        }
      },
      catch: toWorkflowError,
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() =>
          console.error("[useAsset] recover.playbackError callback failed:", error),
        ),
      ),
    );
    void Effect.runPromise(recover);
  });

  const offEnded = events.on("ended", () => {
    if (getHasNext()) {
      api.getState().playlist.next();
    }
  });

  return () => {
    offPlaylistChange();
    offPlaybackError();
    offEnded();
  };
}

function adaptAssetLoadOptions<TItem extends TAsset>(
  options: Omit<AssetLoadSourceOptions<TItem>, "initialIndex" | "sourceType"> | undefined,
  assets: TItem[],
): Omit<AssetLoadSourceOptions<TAsset>, "initialIndex" | "sourceType"> | undefined {
  if (!options) return undefined;

  const adapted: Omit<AssetLoadSourceOptions<TAsset>, "initialIndex" | "sourceType"> = {};
  if (options.loading !== undefined) {
    adapted.loading = createAssetOptionsAdapter(options.loading, assets);
  }
  if (options.sourceKey !== undefined) {
    adapted.sourceKey = options.sourceKey;
  }
  return adapted;
}

function adaptAssetSourceOptions<TItem extends TAsset>(
  options: AssetLoadSourceOptions<TItem> | undefined,
  assets: TItem[],
): AssetLoadSourceOptions<TAsset> | undefined {
  if (!options) return undefined;

  const adapted: AssetLoadSourceOptions<TAsset> = {};
  if (options.initialIndex !== undefined) {
    adapted.initialIndex = options.initialIndex;
  }
  if (options.loading !== undefined) {
    adapted.loading = createAssetOptionsAdapter(options.loading, assets);
  }
  if (options.sourceKey !== undefined) {
    adapted.sourceKey = options.sourceKey;
  }
  if (options.sourceType !== undefined) {
    adapted.sourceType = options.sourceType;
  }
  return adapted;
}

function createAssetOptionsAdapter<TItem extends TAsset>(
  options: UseAssetOptions<TItem>,
  assets: TItem[],
): UseAssetOptions<TAsset> {
  const ownedAssets = new Map<TAsset, TItem>(assets.map((asset) => [asset, asset]));
  const parseAsset = (asset: TAsset): TItem => {
    const ownedAsset = ownedAssets.get(asset);
    if (!ownedAsset) {
      throw new Error("Asset does not belong to the active typed source");
    }
    return ownedAsset;
  };
  const adapted: UseAssetOptions<TAsset> = {};

  if (options.autoplayFirst !== undefined) adapted.autoplayFirst = options.autoplayFirst;
  if (options.getAssetId) {
    adapted.getAssetId = (asset, context) => options.getAssetId?.(parseAsset(asset), context);
  }
  if (options.loader) {
    adapted.loader = {};
    if (options.loader.load) {
      adapted.loader.load = (context) => {
        const typedContext: AssetLoadContext<TItem> = {
          asset: parseAsset(context.asset),
          loadDefault: context.loadDefault,
          media: context.media,
          player: context.player,
          retryCount: context.retryCount,
          signal: context.signal,
        };
        if (context.preloadManager !== undefined) {
          typedContext.preloadManager = context.preloadManager;
        }
        if (context.previousError !== undefined) {
          typedContext.previousError = context.previousError;
        }
        if (context.startTime !== undefined) {
          typedContext.startTime = context.startTime;
        }
        return options.loader?.load?.(typedContext) ?? Promise.resolve();
      };
    }
    if (options.loader.preload) {
      adapted.loader.preload = (context) => {
        const typedContext: AssetPreloadContext<TItem> = {
          asset: parseAsset(context.asset),
          player: context.player,
          preloadDefault: context.preloadDefault,
          retryCount: context.retryCount,
          signal: context.signal,
        };
        if (context.previousError !== undefined) {
          typedContext.previousError = context.previousError;
        }
        return options.loader?.preload?.(typedContext) ?? Promise.resolve(null);
      };
    }
  }
  if (options.maxRetries !== undefined) adapted.maxRetries = options.maxRetries;
  if (options.recover) {
    adapted.recover = {};
    if (options.recover.loadError) {
      adapted.recover.loadError = (asset, error, context) =>
        options.recover?.loadError?.(parseAsset(asset), error, context) ?? AssetRecoveryAction.Stop;
    }
    if (options.recover.playbackError) {
      adapted.recover.playbackError = (asset, error, context) =>
        options.recover?.playbackError?.(parseAsset(asset), error, context) ??
        Promise.resolve({ action: AssetRecoveryAction.Stop });
    }
  }
  if (options.resolveSource) {
    adapted.resolveSource = (context) =>
      options.resolveSource?.({ ...context, asset: parseAsset(context.asset) });
  }

  return adapted;
}

function createAssetSession(
  sourceType: AssetSourceType,
  options?: Omit<AssetLoadSourceOptions<TAsset>, "initialIndex" | "sourceType">,
): AssetSession {
  const session: AssetSession = {
    id: generateAssetSessionId(),
    sourceType,
  };
  if (options?.loading !== undefined) {
    session.loading = options.loading;
  }
  if (options?.sourceKey !== undefined) {
    session.sourceKey = options.sourceKey;
  }
  return session;
}

function createDefaultLoad({
  asset,
  assetId,
  player,
  preloadManager,
  startTime,
}: {
  asset: TAsset;
  assetId: string;
  player: shaka.Player;
  preloadManager?: shaka.media.PreloadManager;
  startTime?: number;
}): AssetLoadContext["loadDefault"] {
  return async (source, loadOptions) => {
    const normalizedSource = normalizePlaybackSource(source);
    player.resetConfiguration();

    if (asset.config) {
      player.configure(asset.config);
    }

    if (normalizedSource.config) {
      player.configure(normalizedSource.config);
    }

    const shouldUseFallbackSource =
      source === undefined ||
      source === null ||
      (Boolean(normalizedSource.config) && !normalizedSource.source);
    const resolvedSource = shouldUseFallbackSource
      ? (preloadManager ?? normalizedSource.source ?? asset.src)
      : normalizedSource.source;

    const finalStartTime = isNumber(loadOptions)
      ? loadOptions
      : (loadOptions?.startTime ?? startTime);
    const timeToLoad = finalStartTime ?? undefined;

    if (!resolvedSource) {
      throw new Error(
        `[useAsset] Missing playback source for asset "${assetId}". Provide asset.src or resolveSource.`,
      );
    }

    await player.load(resolvedSource, timeToLoad, normalizedSource.mimeType ?? asset.mimeType);
  };
}

function generateAssetSessionId(): string {
  return `lp_asset_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getNormalizedAssetId(
  asset: TAsset,
  options: undefined | UseAssetOptions<TAsset>,
  context: { index?: number; origin: AssetSourceOrigin },
): string {
  const id = asset.id ?? options?.getAssetId?.(asset, context);
  if (id) return id;

  if (asset.src) {
    return `lp_src_${hashString(asset.src)}`;
  }

  throw new Error(
    `[useAsset] Missing asset id. Provide asset.id, asset.src, or getAssetId for ${context.origin} assets.`,
  );
}

function getSourceTypeForItems<T>(
  items: T[],
  sourceType?: AssetSourceType,
): AssetSourceType | null {
  return (
    sourceType ??
    (items.length === 0
      ? null
      : items.length > 1
        ? AssetSourceType.Playlist
        : AssetSourceType.Asset)
  );
}

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index++) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function mergePlayerConfiguration(
  base?: shaka.extern.PlayerConfiguration,
  override?: shaka.extern.PlayerConfiguration,
): shaka.extern.PlayerConfiguration | undefined {
  if (!base) return override;
  if (!override) return base;

  return {
    ...base,
    ...override,
  };
}

function normalizeAssets(assets: TAsset[], options?: UseAssetOptions<TAsset>): NormalizedAsset[] {
  const usedIds = new Set<string>();

  return assets.map((asset, index) => {
    const id = getNormalizedAssetId(asset, options, {
      index,
      origin: AssetSourceOrigin.Playlist,
    });

    if (usedIds.has(id)) {
      throw new Error(
        `[useAsset] Duplicate asset id "${id}". Provide explicit ids for duplicate playlist entries.`,
      );
    }

    usedIds.add(id);

    return {
      id,
      properties: asset,
    };
  });
}

function isAssetArray<TItem extends TAsset>(
  source: PlayerSource<TItem>,
): source is readonly TItem[] {
  return Array.isArray(source);
}

function getOwnedAssets<TItem extends TAsset>(source: PlayerSource<TItem>): TItem[] {
  if (isAssetArray(source)) return [...source];
  if (isString(source)) return [];
  return [source];
}

function isPlaybackSource(
  source: PlaybackSource | shaka.media.PreloadManager,
): source is PlaybackSource {
  return "src" in source || "config" in source || "mimeType" in source;
}

function normalizePlaybackSource(
  source?: null | PlaybackSource | shaka.media.PreloadManager | string,
): NormalizedSource {
  if (isString(source)) {
    return { source };
  }

  if (!source) {
    return {};
  }

  if (isPlaybackSource(source)) {
    const normalized: NormalizedSource = {};
    if (source.config !== undefined) {
      normalized.config = source.config;
    }
    if (source.mimeType !== undefined) {
      normalized.mimeType = source.mimeType;
    }
    if (source.src !== undefined) {
      normalized.source = source.src;
    }
    return normalized;
  }

  return { source };
}

function normalizePlayerSource(source: PlayerSource<TAsset>): TAsset[] {
  if (isAssetArray(source)) return [...source];
  if (isString(source)) return [{ src: source }];
  return [source];
}
