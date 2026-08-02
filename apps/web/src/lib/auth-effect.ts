import { Data, Effect } from "effect";

interface AuthErrorPayload {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

interface AuthResult<A> {
  readonly data?: A | null | undefined;
  readonly error?: AuthErrorPayload | null | undefined;
}

export class AuthRejected extends Data.TaggedError("AuthRejected")<{
  readonly code: string | undefined;
  readonly message: string;
}> {}

export class AuthTransportError extends Data.TaggedError("AuthTransportError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export class AuthProtocolError extends Data.TaggedError("AuthProtocolError")<{
  readonly message: string;
}> {}

export type AuthOperationError = AuthRejected | AuthTransportError | AuthProtocolError;

export const authOperationEffect = <A>(
  operation: (signal: AbortSignal) => Promise<AuthResult<A>>,
): Effect.Effect<A | null | undefined, AuthOperationError> =>
  Effect.gen(function* () {
    const result = yield* Effect.tryPromise<AuthResult<A>, AuthTransportError>({
      try: operation,
      catch: (cause) =>
        new AuthTransportError({ cause, message: "Could not reach the authentication service" }),
    });
    if (!result || typeof result !== "object") {
      return yield* new AuthProtocolError({
        message: "The authentication service returned an invalid response",
      });
    }
    if (result.error) {
      return yield* new AuthRejected({
        code: result.error.code,
        message: result.error.message ?? "Authentication failed",
      });
    }
    return result.data;
  });
