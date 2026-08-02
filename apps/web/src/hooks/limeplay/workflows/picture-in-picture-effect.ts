import { Effect } from "effect";

import { PictureInPictureFailed, toWorkflowError } from "./media-workflow-errors";

export interface PictureInPictureMedia extends HTMLVideoElement {
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
}

export const isWebkitPictureInPictureSupported = (media: PictureInPictureMedia): boolean =>
  typeof media.webkitSupportsPresentationMode === "function" &&
  media.webkitSupportsPresentationMode("picture-in-picture") &&
  typeof media.webkitSetPresentationMode === "function";

export const enterPictureInPictureEffect = (
  media: PictureInPictureMedia,
): Effect.Effect<void, PictureInPictureFailed> =>
  Effect.tryPromise({
    catch: (cause) => new PictureInPictureFailed({ cause: toWorkflowError(cause) }),
    try: async () => {
      if (isWebkitPictureInPictureSupported(media)) {
        media.webkitSetPresentationMode!("picture-in-picture");
      } else {
        await media.requestPictureInPicture();
      }
    },
  });

export const exitPictureInPictureEffect = (
  media: PictureInPictureMedia,
  document: Document,
): Effect.Effect<void, PictureInPictureFailed> =>
  Effect.tryPromise({
    catch: (cause) => new PictureInPictureFailed({ cause: toWorkflowError(cause) }),
    try: async () => {
      if (isWebkitPictureInPictureSupported(media)) {
        media.webkitSetPresentationMode!("inline");
      } else if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
    },
  });
