import { Effect } from "effect";
import React from "react";

import type { MediaEventSlice, MediaFeature } from "@/components/limeplay/media-provider";

import { useMediaStore } from "@/hooks/limeplay/use-media";
import { noop, off, on } from "@/lib/utils";
import {
  enterPictureInPictureEffect,
  exitPictureInPictureEffect,
  isWebkitPictureInPictureSupported,
  type PictureInPictureMedia,
} from "@/hooks/limeplay/workflows/picture-in-picture-effect";
import {
  useMediaEvents,
  useMediaFeatureApi,
  useMediaFeatureStore,
} from "@/components/limeplay/media-provider";

export const PICTURE_IN_PICTURE_FEATURE_KEY = "pictureInPicture";

export interface PictureInPictureEvents {
  enterpictureinpicture: void;
  leavepictureinpicture: void;
}

export interface PictureInPictureStore extends MediaEventSlice<PictureInPictureEvents> {
  [PICTURE_IN_PICTURE_FEATURE_KEY]: {
    active: boolean;
    enter: () => Promise<void>;
    exit: () => Promise<void>;
    supported: boolean;
    toggle: () => Promise<void>;
  };
}

export function pictureInPictureFeature(): MediaFeature<PictureInPictureStore> {
  return {
    createSlice: (_set, get) => ({
      [PICTURE_IN_PICTURE_FEATURE_KEY]: {
        active: false,
        enter: async () => {
          const media = get().media.mediaElement as PictureInPictureMedia | null;
          if (!media || media.nodeName.toLowerCase() !== "video") return;

          await Effect.runPromise(
            enterPictureInPictureEffect(media).pipe(
              Effect.catchAll((error) =>
                Effect.sync(() => console.error("Failed to enter Picture-in-Picture mode:", error)),
              ),
            ),
          );
        },
        exit: async () => {
          const media = get().media.mediaElement as PictureInPictureMedia | null;
          if (!media) return;

          await Effect.runPromise(
            exitPictureInPictureEffect(media, document).pipe(
              Effect.catchAll((error) =>
                Effect.sync(() => console.error("Failed to exit Picture-in-Picture mode:", error)),
              ),
            ),
          );
        },
        supported: false,
        toggle: async () => {
          const pip = get().pictureInPicture;
          if (pip.active) {
            await pip.exit();
          } else {
            await pip.enter();
          }
        },
      },
    }),
    key: PICTURE_IN_PICTURE_FEATURE_KEY,
    Setup: PictureInPictureSetup,
  };
}

export function usePictureInPictureStore<TSelected>(
  selector: (state: PictureInPictureStore["pictureInPicture"]) => TSelected,
): TSelected {
  return useMediaFeatureStore<PictureInPictureStore, TSelected>(
    PICTURE_IN_PICTURE_FEATURE_KEY,
    (state) => selector(state.pictureInPicture),
  );
}

function hasVideoTrack(media: HTMLVideoElement): boolean {
  return media.videoWidth > 0 && media.videoHeight > 0;
}

function PictureInPictureSetup() {
  const store = useMediaFeatureApi<PictureInPictureStore>(PICTURE_IN_PICTURE_FEATURE_KEY);
  const events = useMediaEvents<PictureInPictureEvents>();
  const mediaElement = useMediaStore((state) => state.mediaElement);

  React.useEffect(() => {
    const media = mediaElement as PictureInPictureMedia | null;
    if (!media || media.nodeName.toLowerCase() !== "video") return noop;

    const updatePictureInPictureSupport = () => {
      const browserSupports =
        document.pictureInPictureEnabled || isWebkitPictureInPictureSupported(media);

      store.setState(({ pictureInPicture }) => {
        pictureInPicture.supported = browserSupports && hasVideoTrack(media);
      });
    };

    updatePictureInPictureSupport();

    const enterPictureInPictureHandler = () => {
      store.setState(({ pictureInPicture }) => {
        pictureInPicture.active = true;
      });
      events.emit("enterpictureinpicture");
    };

    const leavePictureInPictureHandler = () => {
      store.setState(({ pictureInPicture }) => {
        pictureInPicture.active = false;
      });
      events.emit("leavepictureinpicture");
    };

    const webkitPresentationModeHandler = () => {
      const isActive = media.webkitPresentationMode === "picture-in-picture";
      if (isActive) {
        enterPictureInPictureHandler();
      } else {
        leavePictureInPictureHandler();
      }
    };

    on(media, "enterpictureinpicture", enterPictureInPictureHandler);
    on(media, "leavepictureinpicture", leavePictureInPictureHandler);
    on(media, "loadedmetadata", updatePictureInPictureSupport);
    on(media, "emptied", updatePictureInPictureSupport);

    if (isWebkitPictureInPictureSupported(media)) {
      on(media, "webkitpresentationmodechanged", webkitPresentationModeHandler);
    }

    return () => {
      off(media, "enterpictureinpicture", enterPictureInPictureHandler);
      off(media, "leavepictureinpicture", leavePictureInPictureHandler);
      off(media, "loadedmetadata", updatePictureInPictureSupport);
      off(media, "emptied", updatePictureInPictureSupport);

      if (isWebkitPictureInPictureSupported(media)) {
        off(media, "webkitpresentationmodechanged", webkitPresentationModeHandler);
      }
    };
  }, [mediaElement, store]);

  return null;
}
