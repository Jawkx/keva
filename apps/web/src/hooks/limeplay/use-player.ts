"use client";

import { Effect, Result } from "effect";
import React, { useRef } from "react";
import shaka from "shaka-player";

import type { PlaybackStore } from "@/hooks/limeplay/use-playback";
import type { MediaEventSlice, MediaFeature } from "@/components/limeplay/media-provider";

import { useMediaStore } from "@/hooks/limeplay/use-media";
import { noop, off, on } from "@/lib/utils";
import {
  MediaWorkflowAborted,
  toWorkflowError,
} from "@/hooks/limeplay/workflows/media-workflow-errors";
import {
  attachPlayerEffect,
  destroyPlayerEffect,
  destroyPreloadManagerEffect,
} from "@/hooks/limeplay/workflows/player-lifecycle-effect";
import {
  useMediaEvents,
  useMediaFeatureApi,
  useMediaFeatureStore,
} from "@/components/limeplay/media-provider";

declare global {
  interface HTMLMediaElement {
    player: null | shaka.Player;
  }
  interface Window {
    shaka: typeof shaka;
  }
}

export const PLAYER_FEATURE_KEY = "player";

export interface PlayerEvents {
  bufferingchange: { isBuffering: boolean };
  playbackerror: { currentTime: number; error: Error };
  playererror: { error: Error };
  playerready: void;
}

export interface PlayerStore extends MediaEventSlice<PlayerEvents> {
  [PLAYER_FEATURE_KEY]: {
    containerRef: HTMLDivElement | null;
    instance: null | shaka.Player;
    preloadManagers: Map<string, shaka.media.PreloadManager>;
    setContainerRef: (instance: HTMLDivElement | null) => void;
    setInstance: (player: null | shaka.Player) => void;
  };
}

export interface UsePlayerOptions<TAsset> {
  onError: (error: Error, asset?: TAsset) => void;
  onLoad: (
    asset: TAsset,
    player: shaka.Player,
    media: HTMLMediaElement,
    preloadManager?: shaka.media.PreloadManager,
    startTime?: number,
  ) => Promise<void>;
  onPreload?: (asset: TAsset, player: shaka.Player) => Promise<null | shaka.media.PreloadManager>;
}

export const RECOMMENDED_PLAYER_BUFFERING_THROTTLE_MS = 250;

export function isLoadInterrupted(cause: unknown): boolean {
  return cause instanceof shaka.util.Error && cause.code === shaka.util.Error.Code.LOAD_INTERRUPTED;
}

export function playerFeature(): MediaFeature<PlayerStore> {
  return {
    createSlice: (_set, _get, _store) => ({
      [PLAYER_FEATURE_KEY]: {
        containerRef: null,
        instance: null,
        preloadManagers: new Map(),
        setContainerRef: (instance) => {
          _set(({ player }) => {
            player.containerRef = instance;
          });
        },
        setInstance: (instance) => {
          _set(({ player }) => {
            player.instance = instance;
          });
        },
      },
    }),
    key: PLAYER_FEATURE_KEY,
    Setup: PlayerSetup,
  };
}

/**
 * Low-level player hook for manual load/preload control.
 * Prefer `useAsset` for most use cases — it handles retry logic,
 * playlist integration, abort/generation tracking, and preload lifecycle.
 * Using both `usePlayer.load` and `useAsset.loadAsset` on the same
 * content will cause split state in `preloadManagers` and retry counters.
 */
export function usePlayer<TAsset extends { id: string }>(options?: UsePlayerOptions<TAsset>) {
  const store = useMediaFeatureApi<PlayerStore>(PLAYER_FEATURE_KEY);
  const player = usePlayerStore((state) => state.instance);
  const mediaElement = useMediaStore((state) => state.mediaElement);

  const load = React.useCallback(
    async (asset: TAsset, startTime?: number): Promise<boolean> => {
      if (!options) return false;

      const currentPlayer = store.getState().player.instance;
      const currentMedia = store.getState().media.mediaElement;

      if (!currentPlayer || !currentMedia) {
        console.warn("[usePlayer] Player or media element not initialized");
        return false;
      }

      const loaded = await Effect.runPromise(
        Effect.tryPromise({
          try: async () => {
            const preloadManagers = store.getState().player.preloadManagers;
            const preloadManager = preloadManagers.get(asset.id);
            await options.onLoad(asset, currentPlayer, currentMedia, preloadManager, startTime);
            if (preloadManager) {
              preloadManagers.delete(asset.id);
              store.setState(({ player }) => {
                player.preloadManagers = new Map(preloadManagers);
              });
            }
          },
          catch: (cause) => cause,
        }).pipe(Effect.result),
      );
      if (Result.isSuccess(loaded)) return true;
      if (!isLoadInterrupted(loaded.failure))
        options.onError(toWorkflowError(loaded.failure), asset);
      return false;
    },
    [mediaElement, options, store],
  );

  const preload = React.useCallback(
    async (asset: TAsset): Promise<void> => {
      if (!options?.onPreload) return;

      const currentPlayer = store.getState().player.instance;
      if (!currentPlayer) return;

      const preloaded = await Effect.runPromise(
        Effect.tryPromise({
          try: () => options.onPreload!(asset, currentPlayer),
          catch: (cause) => cause,
        }).pipe(Effect.result),
      );
      if (Result.isFailure(preloaded)) {
        const error = toWorkflowError(preloaded.failure);
        options.onError(error, asset);
        console.error("[usePlayer] Preload error:", error);
        return;
      }
      if (preloaded.success) {
        const preloadManagers = store.getState().player.preloadManagers;
        preloadManagers.set(asset.id, preloaded.success);
        store.setState(({ player }) => {
          player.preloadManagers = new Map(preloadManagers);
        });
      }
    },
    [options, store],
  );

  const cancelPreload = React.useCallback(
    (assetId: string): void => {
      const preloadManagers = store.getState().player.preloadManagers;
      const manager = preloadManagers.get(assetId);
      if (manager) {
        void Effect.runPromiseExit(destroyPreloadManagerEffect(manager));
        preloadManagers.delete(assetId);
        store.setState(({ player }) => {
          player.preloadManagers = new Map(preloadManagers);
        });
      }
    },
    [store],
  );

  const isPreloaded = React.useCallback(
    (assetId: string): boolean => {
      return store.getState().player.preloadManagers.has(assetId);
    },
    [store],
  );

  return {
    cancelPreload,
    isPreloaded,
    load,
    player,
    preload,
  };
}

export function usePlayerStore<TSelected>(
  selector: (state: PlayerStore["player"]) => TSelected,
): TSelected {
  return useMediaFeatureStore<PlayerStore, TSelected>(PLAYER_FEATURE_KEY, (state) =>
    selector(state.player),
  );
}

function PlayerSetup() {
  const store = useMediaFeatureApi<PlaybackStore & PlayerStore>(PLAYER_FEATURE_KEY);
  const events = useMediaEvents<PlayerEvents>();
  const setPlayer = usePlayerStore((state) => state.setInstance);
  const mediaElement = useMediaStore((state) => state.mediaElement);
  const player = usePlayerStore((state) => state.instance);

  const playerInstance = useRef<null | shaka.Player>(null);

  React.useLayoutEffect(() => {
    let aborted = false;

    async function loadPlayer() {
      if (!mediaElement || aborted) {
        return;
      }

      const localPlayer = new shaka.Player();
      const attached = await Effect.runPromise(
        attachPlayerEffect(localPlayer, mediaElement, () => aborted).pipe(Effect.result),
      );

      if (Result.isFailure(attached)) {
        if (attached.failure instanceof MediaWorkflowAborted) {
          void Effect.runPromiseExit(destroyPlayerEffect(localPlayer));
          return;
        }
        const error = toWorkflowError(attached.failure.cause);
        console.error("[usePlayer] Failed to attach player to media element:", error);
        events.emit("playererror", { error });
        return;
      }

      setPlayer(localPlayer);
      playerInstance.current = localPlayer;
      mediaElement.player = localPlayer;
      window.shaka = shaka;
      events.emit("playerready");
    }

    if (!playerInstance.current) {
      void loadPlayer();
    }

    return () => {
      aborted = true;
      if (playerInstance.current) {
        void Effect.runPromiseExit(destroyPlayerEffect(playerInstance.current));
        setPlayer(null);
        playerInstance.current = null;
      }
    };
  }, [mediaElement, setPlayer, events]);

  React.useEffect(() => {
    if (!player) return noop;
    let bufferingTimeout: null | ReturnType<typeof setTimeout> = null;

    const clearBufferingTimeout = () => {
      if (bufferingTimeout) {
        clearTimeout(bufferingTimeout);
        bufferingTimeout = null;
      }
    };

    const setInitialState = () => {
      if (player.isBuffering()) {
        store.setState(({ playback }) => {
          playback.status = "buffering";
        });
      }
    };

    const bufferingHandler = () => {
      const isBuffering = player.isBuffering();

      if (isBuffering) {
        store.setState(({ playback }) => {
          playback.status = "buffering";
        });
      } else {
        clearBufferingTimeout();
        const media = store.getState().media.mediaElement;
        if (media) {
          store.setState(({ playback }) => {
            playback.status = media.paused ? "paused" : "playing";
          });
        }
      }

      events.emit("bufferingchange", { isBuffering });
    };

    const loadingHandler = () => {
      store.setState(({ playback }) => {
        playback.status = "loading";
      });
    };

    on(player, "buffering", bufferingHandler);
    on(player, "loading", loadingHandler);

    const errorHandler = (event: Event) => {
      // SAFETY: Shaka's "error" listener contract dispatches CustomEvent<shaka.util.Error>.
      const detail = (event as CustomEvent<shaka.util.Error>).detail;
      if (isLoadInterrupted(detail)) return;
      const media = store.getState().media.mediaElement;
      const currentTime = media?.currentTime ?? 0;
      const error = toWorkflowError(detail);

      store.getState().playback.setError(error);
      events.emit("playbackerror", { currentTime, error });
    };

    player.addEventListener("error", errorHandler);

    setInitialState();

    return () => {
      off(player, "buffering", bufferingHandler);
      off(player, "loading", loadingHandler);
      player.removeEventListener("error", errorHandler);
      clearBufferingTimeout();
    };
  }, [events, mediaElement, player, store]);

  return null;
}
