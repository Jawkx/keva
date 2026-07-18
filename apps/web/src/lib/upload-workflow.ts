import { Effect } from "effect";

export type UploadPhase = "put" | "confirm";

export interface UploadFailure<S> {
  readonly cause: unknown;
  readonly session: S | undefined;
  readonly phase: UploadPhase;
}

interface UploadClient<S, A, E> {
  readonly start: Effect.Effect<S, E>;
  readonly put: (session: S) => Effect.Effect<void, E>;
  readonly confirm: (session: S) => Effect.Effect<A, E>;
}

export class UploadTimeoutError extends Error {
  readonly _tag = "UploadTimeoutError";
}

const isRetryable = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  (error._tag === "KevaTransportError" ||
    error._tag === "StorageUnavailable" ||
    error._tag === "Internal");

const stagePolicy = <A, E>(
  effect: Effect.Effect<A, E>,
  phase: "initiate" | UploadPhase,
  timeout: number,
  retry: boolean,
): Effect.Effect<A, E | UploadTimeoutError> =>
  (retry ? effect.pipe(Effect.retry({ times: 2, while: isRetryable })) : effect).pipe(
    Effect.timeoutFail({
      duration: timeout,
      onTimeout: () => new UploadTimeoutError(`Upload ${phase} timed out`),
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
): Effect.Effect<A, UploadFailure<S>> =>
  Effect.suspend(() => {
    let session = initial.session;
    let phase = initial.phase;

    return Effect.gen(function* () {
      if (
        phase === "put" &&
        session &&
        Number.isFinite(Date.parse(session.initiated.expiresAt)) &&
        Date.parse(session.initiated.expiresAt) <= Date.now()
      ) {
        session = undefined;
      }
      if (!session) {
        phase = "put";
        session = yield* stagePolicy(client.start, "initiate", 30_000, false);
        yield* Effect.sync(() => onProgress(session!, phase));
      }
      if (phase === "put") {
        yield* stagePolicy(client.put(session), "put", 5 * 60_000, true);
        phase = "confirm";
        yield* Effect.sync(() => onProgress(session!, phase));
      }
      return yield* stagePolicy(client.confirm(session), "confirm", 30_000, true);
    }).pipe(
      Effect.mapError(
        (cause): UploadFailure<S> => ({
          cause,
          session,
          phase,
        }),
      ),
    );
  });
