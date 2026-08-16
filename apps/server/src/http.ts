import { canDeleteOwnShareUpload } from "@keva/core";
import {
  Internal,
  ItemId,
  KevaError,
  NotFound,
  ValidationError,
  statusFor,
  toOwnerItem,
  toSharedItem,
  type KevaItem,
  type Principal,
} from "@keva/schema";
import { Cause, Effect, Exit, ManagedRuntime, Option, Schema } from "effect";
import type { Context } from "hono";
import type { RuntimeServices } from "./app-types.js";
import { Authenticator } from "./auth.js";
import { BillingMeter, isProgrammaticPrincipal } from "./billing.js";
import { defectTypes, failureOrElse } from "./effect-failure.js";

export const decode = <A>(schema: Schema.ConstraintDecoder<A>, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => new ValidationError({ message: "Request validation failed" })),
  );

export const jsonBody = (context: Context) =>
  Effect.tryPromise({
    try: () => context.req.json() as Promise<unknown>,
    catch: () => new ValidationError({ message: "Request body must be JSON" }),
  });

export const itemIdParam = (context: Context) => decode(ItemId, context.req.param("id"));

// Every route's failure channel is a typed KevaError, so a tracked failure maps
// straight to its tagged error. Only an untracked defect (Effect.die, a thrown
// bug) falls through to a generic 500 — internals are never serialized.
export const failureFrom = (cause: Cause.Cause<KevaError>): KevaError =>
  failureOrElse(cause, () => new Internal({ message: "Internal server error" }));

export const reportDefect = (context: Context, cause: Cause.Cause<unknown>): void => {
  if (Option.isSome(Cause.findErrorOption(cause))) return;
  console.error(
    JSON.stringify({
      event: "http.request.defect",
      method: context.req.method,
      path: context.req.path,
      defectTypes: defectTypes(cause),
    }),
  );
};

export const reportServiceFailure = (context: Context, error: KevaError): void => {
  if (statusFor(error) < 500) return;
  console.error(
    JSON.stringify({
      event: "http.request.failed",
      method: context.req.method,
      path: context.req.path,
      errorTag: error._tag,
    }),
  );
};

export const execute = async <A>(
  context: Context,
  effect: Effect.Effect<A, KevaError, RuntimeServices>,
  runtime: ManagedRuntime.ManagedRuntime<RuntimeServices, never>,
): Promise<Response> => {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return context.json(exit.value as never);
  reportDefect(context, exit.cause);
  const error = failureFrom(exit.cause);
  if (Option.isSome(Cause.findErrorOption(exit.cause))) reportServiceFailure(context, error);
  return context.json(error, statusFor(error) as never);
};

export const principalEffect = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticator = yield* Authenticator;
    const principal = yield* authenticator.authenticate({ headers });
    if (isProgrammaticPrincipal(principal)) {
      const billing = yield* BillingMeter;
      yield* billing.consumeApiRequest(principal.tenantId);
    }
    return principal;
  });

export const sessionUser = (principal: Principal) =>
  principal.via === "session" && principal.actor?.user
    ? Effect.succeed(principal.actor.user)
    : Effect.fail(new NotFound({ message: "Account session not found" }));

// Share visitors never receive the tenant-internal storage fields. Redaction
// happens here at the boundary (not in the engine) so internal callers keep the
// full KevaItem shape and only the wire response is trimmed.
export const redactItem = (principal: Principal, item: KevaItem) =>
  principal.via === "share"
    ? toSharedItem(item, canDeleteOwnShareUpload(principal, item))
    : toOwnerItem(item);
