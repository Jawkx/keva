import { Cause, Effect, Exit, Option } from "effect";

export const runEffectPromise = <A, E>(
  effect: Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> =>
  Effect.runPromiseExit(effect, signal ? { signal } : undefined).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    const failure = Cause.failureOption(exit.cause);
    throw Option.isSome(failure) ? failure.value : Cause.squash(exit.cause);
  });
