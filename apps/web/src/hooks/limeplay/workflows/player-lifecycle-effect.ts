import { Effect } from "effect";
import type shaka from "shaka-player";

import {
  MediaWorkflowAborted,
  PlayerAttachFailed,
  PlayerDestroyFailed,
  toWorkflowError,
} from "./media-workflow-errors";

export const attachPlayerEffect = (
  player: shaka.Player,
  media: HTMLMediaElement,
  isCancelled: () => boolean,
): Effect.Effect<shaka.Player, MediaWorkflowAborted | PlayerAttachFailed> =>
  Effect.tryPromise({
    catch: (cause) => new PlayerAttachFailed({ cause: toWorkflowError(cause) }),
    try: () => player.attach(media, false),
  }).pipe(
    Effect.flatMap(() =>
      isCancelled()
        ? Effect.fail(new MediaWorkflowAborted({ reason: "cancelled" }))
        : Effect.succeed(player),
    ),
  );

export const destroyPreloadManagerEffect = (
  manager: shaka.media.PreloadManager,
): Effect.Effect<void, PlayerDestroyFailed> =>
  Effect.tryPromise({
    catch: (cause) => new PlayerDestroyFailed({ cause: toWorkflowError(cause) }),
    try: () => manager.destroy(),
  });

export const destroyPlayerEffect = (
  player: shaka.Player,
): Effect.Effect<void, PlayerDestroyFailed> =>
  Effect.tryPromise({
    catch: (cause) => new PlayerDestroyFailed({ cause: toWorkflowError(cause) }),
    try: () => player.destroy(),
  });
