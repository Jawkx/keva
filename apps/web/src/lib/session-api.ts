import { Effect, Schema } from "effect";
import { KevaProtocolError, KevaTransportError } from "@keva/sdk";
import { KevaError, type KevaError as KevaErrorType } from "@keva/schema";
import { runEffectPromise } from "./effect-runtime";

export type SessionApiError = KevaErrorType | KevaProtocolError | KevaTransportError;

export const sessionApiRequestEffect = <A>(
  method: string,
  path: string,
  schema: Schema.ConstraintDecoder<A>,
  body?: unknown,
): Effect.Effect<A, SessionApiError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(path, {
          method,
          credentials: "include",
          signal,
          headers: body === undefined ? {} : { "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      catch: (cause) => new KevaTransportError(cause),
    });
    const payload: unknown = yield* Effect.promise(() => response.json().catch(() => undefined));
    if (!response.ok) {
      const error = yield* Schema.decodeUnknownEffect(KevaError)(payload).pipe(
        Effect.mapError(
          () => new KevaProtocolError(`Request to ${path} failed with ${response.status}`),
        ),
      );
      return yield* Effect.fail(error);
    }
    return yield* Schema.decodeUnknownEffect(schema)(payload).pipe(
      Effect.mapError(
        () => new KevaProtocolError(`Request to ${path} returned an invalid response`),
      ),
    );
  });

export const sessionApiRequest = <A>(
  method: string,
  path: string,
  schema: Schema.ConstraintDecoder<A>,
  body?: unknown,
): Promise<A> => runEffectPromise(sessionApiRequestEffect(method, path, schema, body));
