import { Data, Effect } from "effect";
import { Internal, StorageUnavailable } from "@keva/schema";
import { KevaTransportError } from "@keva/sdk";

export type UploadPhase = "put" | "confirm";
export type UploadStage = "initiate" | UploadPhase;

export class UploadTimedOut extends Data.TaggedError("UploadTimedOut")<{
  readonly stage: UploadStage;
}> {}

export class UploadFailed<S, E> extends Data.TaggedError("UploadFailed")<{
  readonly cause: E | UploadTimedOut;
  readonly session: S | undefined;
  readonly stage: UploadStage;
}> {}

interface UploadClient<S, A, E> {
  readonly start: Effect.Effect<S, E>;
  readonly put: (session: S) => Effect.Effect<void, E>;
  readonly confirm: (session: S) => Effect.Effect<A, E>;
}

const isRetryableUploadError = (error: unknown): boolean =>
  error instanceof KevaTransportError ||
  error instanceof StorageUnavailable ||
  error instanceof Internal;

const stagePolicy = <A, E>(
  effect: Effect.Effect<A, E>,
  stage: UploadStage,
  timeout: number,
  shouldRetry: ((error: E) => boolean) | undefined,
): Effect.Effect<A, E | UploadTimedOut> =>
  (shouldRetry ? effect.pipe(Effect.retry({ times: 2, while: shouldRetry })) : effect).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () => Effect.fail(new UploadTimedOut({ stage })),
    }),
  );

export const uploadFileEffect = <
  S extends { readonly initiated: { readonly expiresAt: string } },
  A,
  E,
>(
  client: UploadClient<S, A, E>,
  initial: { readonly session?: S | undefined; readonly phase: UploadPhase },
  onProgress: (session: S, phase: UploadPhase) => void,
  shouldRetry: (error: E) => boolean = isRetryableUploadError,
): Effect.Effect<A, UploadFailed<S, E>> =>
  Effect.suspend(() => {
    let session = initial.session;
    let stage: UploadStage = initial.phase;

    return Effect.gen(function* () {
      if (
        stage === "put" &&
        session &&
        Number.isFinite(Date.parse(session.initiated.expiresAt)) &&
        Date.parse(session.initiated.expiresAt) <= Date.now()
      ) {
        session = undefined;
      }
      if (!session) {
        stage = "initiate";
        session = yield* stagePolicy(client.start, stage, 30_000, undefined);
        stage = "put";
        yield* Effect.sync(() => onProgress(session!, stage as UploadPhase));
      }
      if (stage === "put") {
        yield* stagePolicy(client.put(session), stage, 5 * 60_000, shouldRetry);
        stage = "confirm";
        yield* Effect.sync(() => onProgress(session!, "confirm"));
      }
      return yield* stagePolicy(client.confirm(session), "confirm", 30_000, shouldRetry);
    }).pipe(
      Effect.mapError(
        (cause) =>
          new UploadFailed({
            cause,
            session,
            stage,
          }),
      ),
    );
  });
