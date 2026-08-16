import { Cause, Effect, Exit, Layer, Predicate, TestContext } from "effect";
import type * as Scope from "effect/Scope";
import { it as vitestIt } from "vitest";

type EffectBody<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>);

const suspend = <A, E, R>(body: EffectBody<A, E, R>) =>
  Effect.suspend(() => (Predicate.isFunction(body) ? body() : body));

const run = <A, E, R, E2>(body: EffectBody<A, E, R | Scope.Scope>, layer: Layer.Layer<R, E2>) =>
  Effect.gen(function* () {
    const exit = yield* suspend(body).pipe(Effect.scoped, Effect.provide(layer), Effect.exit);
    if (Exit.isFailure(exit)) {
      for (const error of Cause.prettyErrors(exit.cause)) yield* Effect.logError(error);
    }
    return yield* exit;
  }).pipe(Effect.runPromise);

const make = <TestR, TestE, LiveR, LiveE>(
  testLayer: Layer.Layer<TestR, TestE>,
  liveLayer: Layer.Layer<LiveR, LiveE>,
) => {
  const effect = <A, E2>(
    name: string,
    body: EffectBody<A, E2, TestR | Scope.Scope>,
    timeout?: number,
  ) => vitestIt(name, () => run(body, testLayer), timeout);

  effect.only = <A, E2>(
    name: string,
    body: EffectBody<A, E2, TestR | Scope.Scope>,
    timeout?: number,
  ) => vitestIt.only(name, () => run(body, testLayer), timeout);

  effect.skip = <A, E2>(
    name: string,
    body: EffectBody<A, E2, TestR | Scope.Scope>,
    timeout?: number,
  ) => vitestIt.skip(name, () => run(body, testLayer), timeout);

  const live = <A, E2>(
    name: string,
    body: EffectBody<A, E2, LiveR | Scope.Scope>,
    timeout?: number,
  ) => vitestIt(name, () => run(body, liveLayer), timeout);

  live.only = <A, E2>(
    name: string,
    body: EffectBody<A, E2, LiveR | Scope.Scope>,
    timeout?: number,
  ) => vitestIt.only(name, () => run(body, liveLayer), timeout);

  live.skip = <A, E2>(
    name: string,
    body: EffectBody<A, E2, LiveR | Scope.Scope>,
    timeout?: number,
  ) => vitestIt.skip(name, () => run(body, liveLayer), timeout);

  return { effect, live };
};

export const it = make(TestContext.TestContext, Layer.empty);

export const testEffect = <R, E>(layer: Layer.Layer<R, E>) =>
  make(Layer.provideMerge(layer, TestContext.TestContext), layer);
