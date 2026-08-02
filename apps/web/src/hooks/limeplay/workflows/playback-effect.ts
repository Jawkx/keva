import { Effect } from "effect";

import { MediaPlaybackFailed, toWorkflowError } from "./media-workflow-errors";

export const playMediaEffect = (
  media: HTMLMediaElement,
): Effect.Effect<void, MediaPlaybackFailed> =>
  Effect.tryPromise({
    catch: (cause) => new MediaPlaybackFailed({ cause: toWorkflowError(cause) }),
    try: () => media.play(),
  });
