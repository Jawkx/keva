import { Effect } from "effect";
import React from "react";

import type { MediaEventSlice, MediaFeature } from "@/components/limeplay/media-provider";

import { useMediaStore } from "@/hooks/limeplay/use-media";
import { noop, off, on } from "@/lib/utils";
import { playMediaEffect } from "@/hooks/limeplay/workflows/playback-effect";
import {
  useMediaEvents,
  useMediaFeatureApi,
  useMediaFeatureStore,
} from "@/components/limeplay/media-provider";

export type MediaStatus =
  | "buffering"
  | "canplay"
  | "canplaythrough"
  | "ended"
  | "error"
  | "init"
  | "loading"
  | "paused"
  | "playing"
  | "stopped";

export const MediaReadyState = {
  HAVE_CURRENT_DATA: 2,
  HAVE_ENOUGH_DATA: 4,
  HAVE_FUTURE_DATA: 3,
  HAVE_METADATA: 1,
  HAVE_NOTHING: 0,
} as const;

export type MediaReadyState = (typeof MediaReadyState)[keyof typeof MediaReadyState];

function getMediaReadyState(media: HTMLMediaElement): MediaReadyState {
  switch (media.readyState) {
    case MediaReadyState.HAVE_CURRENT_DATA:
      return MediaReadyState.HAVE_CURRENT_DATA;
    case MediaReadyState.HAVE_FUTURE_DATA:
      return MediaReadyState.HAVE_FUTURE_DATA;
    case MediaReadyState.HAVE_ENOUGH_DATA:
      return MediaReadyState.HAVE_ENOUGH_DATA;
    case MediaReadyState.HAVE_METADATA:
      return MediaReadyState.HAVE_METADATA;
    default:
      return MediaReadyState.HAVE_NOTHING;
  }
}

export const PLAYBACK_FEATURE_KEY = "playback";

export interface PlaybackEvents {
  buffering: { isBuffering: boolean };
  ended: void;
  pause: void;
  play: void;
  statuschange: { prevStatus: MediaStatus; status: MediaStatus };
}

export type PlaybackError = Error | MediaError | null;

export interface PlaybackStore extends MediaEventSlice<PlaybackEvents> {
  [PLAYBACK_FEATURE_KEY]: {
    canPlay: boolean;
    canPlayThrough: boolean;
    ended: boolean;
    error: PlaybackError;
    loop: boolean;
    networkState: number;
    pause: () => void;
    paused: boolean;
    play: () => Promise<void>;
    readyState: MediaReadyState;
    restart: () => void;
    setError: (error: PlaybackError) => void;
    setLoop: (loop: boolean) => void;
    status: MediaStatus;
    toggleLoop: () => void;
    togglePaused: () => Promise<void>;
  };
}

export function playbackFeature(): MediaFeature<PlaybackStore> {
  return {
    createSlice: (set, get, _store, events) => ({
      [PLAYBACK_FEATURE_KEY]: {
        canPlay: false,
        canPlayThrough: false,
        ended: false,
        error: null,
        loop: false,
        networkState: 0,
        pause: () => {
          const media = get().media.mediaElement;
          if (!media) return;

          media.pause();

          set(({ media: mediaState }) => {
            mediaState.idle = false;
          });
        },
        paused: false,
        play: () => {
          const media = get().media.mediaElement;
          if (!media) return Promise.resolve();

          set(({ media: mediaState }) => {
            mediaState.idle = false;
          });

          return Effect.runPromise(
            playMediaEffect(media).pipe(
              Effect.tapError((error) =>
                Effect.sync(() => {
                  console.error("Error playing media", error);
                  get().playback.setError(error);
                }),
              ),
            ),
          );
        },
        readyState: MediaReadyState.HAVE_NOTHING,
        restart: () => {
          const media = get().media.mediaElement;
          if (!media) return;

          media.currentTime = 0;
          if (media.paused) {
            void Effect.runPromiseExit(
              Effect.tryPromise({ try: () => get().playback.play(), catch: () => undefined }),
            );
          }

          set(({ media: mediaState, playback }) => {
            mediaState.idle = false;
            playback.ended = false;
          });
        },
        setError: (error) => {
          const media = get().media.mediaElement;
          const prevStatus = get().playback.status;

          if (media && !media.paused) {
            media.pause();
          }

          set(({ media: mediaState, playback }) => {
            mediaState.idle = false;
            playback.error = error;
            playback.paused = true;
            playback.status = "error";

            if (media) {
              playback.canPlay = media.readyState >= MediaReadyState.HAVE_FUTURE_DATA;
              playback.canPlayThrough = media.readyState >= MediaReadyState.HAVE_ENOUGH_DATA;
              playback.ended = media.ended;
              playback.loop = media.loop;
              playback.networkState = media.networkState;
              playback.readyState = getMediaReadyState(media);
            }
          });

          if (prevStatus === "buffering") {
            events.emit("buffering", { isBuffering: false });
          }

          if (prevStatus !== "error") {
            events.emit("statuschange", { prevStatus, status: "error" });
          }
        },
        setLoop: (loop) => {
          const media = get().media.mediaElement;
          if (!media) return;

          media.loop = loop;

          set(({ media: mediaState, playback }) => {
            mediaState.idle = false;
            playback.loop = loop;
          });
        },
        status: "init",
        toggleLoop: () => {
          const media = get().media.mediaElement;
          if (!media) return;

          get().playback.setLoop(!media.loop);
        },
        togglePaused: async () => {
          const media = get().media.mediaElement;
          if (!media) return;

          if (media.paused) {
            await Effect.runPromise(
              Effect.tryPromise({ try: () => get().playback.play(), catch: () => undefined }).pipe(
                Effect.asVoid,
              ),
            );
          } else {
            get().playback.pause();
          }
        },
      },
    }),
    key: PLAYBACK_FEATURE_KEY,
    Setup: PlaybackSetup,
  };
}

export function usePlaybackStore<TSelected>(
  selector: (state: PlaybackStore["playback"]) => TSelected,
): TSelected {
  return useMediaFeatureStore<PlaybackStore, TSelected>(PLAYBACK_FEATURE_KEY, (state) =>
    selector(state.playback),
  );
}

function PlaybackSetup() {
  const store = useMediaFeatureApi<PlaybackStore>(PLAYBACK_FEATURE_KEY);
  const events = useMediaEvents<PlaybackEvents>();
  const mediaElement = useMediaStore((state) => state.mediaElement);

  React.useEffect(() => {
    if (!mediaElement) return noop;

    const media = mediaElement;

    const setInitialState = () => {
      const status: MediaStatus = media.paused ? "paused" : "playing";

      store.setState(({ playback }) => {
        playback.canPlay = media.readyState >= MediaReadyState.HAVE_FUTURE_DATA;
        playback.canPlayThrough = media.readyState >= MediaReadyState.HAVE_ENOUGH_DATA;
        playback.ended = media.ended;
        playback.error = media.error;
        playback.loop = media.loop;
        playback.networkState = media.networkState;
        playback.paused = media.paused;
        playback.readyState = getMediaReadyState(media);
        playback.status = status;
      });
    };

    const pauseHandler = () => {
      const prevStatus = store.getState().playback.status;

      if (prevStatus === "error") {
        store.setState(({ playback }) => {
          playback.paused = true;
        });
        return;
      }

      store.setState(({ playback }) => {
        playback.paused = true;
        playback.status = "paused";
      });

      if (prevStatus === "buffering") {
        events.emit("buffering", { isBuffering: false });
      }

      events.emit("pause");
      events.emit("statuschange", { prevStatus, status: "paused" });
    };

    const playHandler = () => {
      const prevStatus = store.getState().playback.status;

      store.setState(({ playback }) => {
        playback.paused = false;
        playback.status = "playing";
      });

      events.emit("play");
      events.emit("statuschange", { prevStatus, status: "playing" });
    };

    const playingHandler = () => {
      const prevStatus = store.getState().playback.status;

      store.setState(({ playback }) => {
        playback.paused = false;
        playback.status = "playing";
      });

      if (prevStatus === "buffering") {
        events.emit("buffering", { isBuffering: false });
      }

      events.emit("statuschange", { prevStatus, status: "playing" });
    };

    const endedHandler = () => {
      if (media.loop) {
        return;
      }

      const prevStatus = store.getState().playback.status;

      store.setState(({ playback }) => {
        playback.ended = true;
        playback.status = "ended";
      });

      if (prevStatus === "buffering") {
        events.emit("buffering", { isBuffering: false });
      }

      events.emit("ended");
      events.emit("statuschange", { prevStatus, status: "ended" });
    };

    const loadStartHandler = () => {
      store.setState(({ playback }) => {
        playback.error = null;
        playback.status = "loading";
      });
    };

    const loadedMetadataHandler = () => {
      store.setState(({ playback }) => {
        playback.ended = false;
        playback.readyState = getMediaReadyState(media);
      });
    };

    const loadedDataHandler = () => {
      store.setState(({ playback }) => {
        playback.canPlay = media.readyState >= MediaReadyState.HAVE_FUTURE_DATA;
        playback.ended = false;
        playback.readyState = getMediaReadyState(media);
      });
    };

    const canPlayHandler = () => {
      store.setState(({ playback }) => {
        playback.canPlay = true;
        playback.readyState = getMediaReadyState(media);
        playback.status = media.paused ? "paused" : "playing";
      });
    };

    const canPlayThroughHandler = () => {
      store.setState(({ playback }) => {
        playback.canPlay = true;
        playback.canPlayThrough = true;
        playback.readyState = getMediaReadyState(media);
        playback.status = media.paused ? "paused" : "playing";
      });
    };

    const waitingHandler = () => {
      const prevStatus = store.getState().playback.status;

      store.setState(({ playback }) => {
        playback.status = "buffering";
      });

      events.emit("buffering", { isBuffering: true });
      events.emit("statuschange", { prevStatus, status: "buffering" });
    };

    const stalledHandler = () => {
      const prevStatus = store.getState().playback.status;

      store.setState(({ playback }) => {
        playback.status = "buffering";
      });

      events.emit("buffering", { isBuffering: true });
      events.emit("statuschange", { prevStatus, status: "buffering" });
    };

    const errorHandler = () => {
      store.getState().playback.setError(media.error);
    };

    on(media, "loadstart", loadStartHandler);
    on(media, "loadedmetadata", loadedMetadataHandler);
    on(media, "loadeddata", loadedDataHandler);
    on(media, "canplay", canPlayHandler);
    on(media, "canplaythrough", canPlayThroughHandler);
    on(media, "play", playHandler);
    on(media, "playing", playingHandler);
    on(media, "pause", pauseHandler);
    on(media, "ended", endedHandler);
    on(media, "waiting", waitingHandler);
    on(media, "stalled", stalledHandler);
    on(media, "error", errorHandler);

    setInitialState();

    return () => {
      off(media, "loadstart", loadStartHandler);
      off(media, "loadedmetadata", loadedMetadataHandler);
      off(media, "loadeddata", loadedDataHandler);
      off(media, "canplay", canPlayHandler);
      off(media, "canplaythrough", canPlayThroughHandler);
      off(media, "play", playHandler);
      off(media, "playing", playingHandler);
      off(media, "pause", pauseHandler);
      off(media, "ended", endedHandler);
      off(media, "waiting", waitingHandler);
      off(media, "stalled", stalledHandler);
      off(media, "error", errorHandler);
    };
  }, [events, store, mediaElement]);

  return null;
}
