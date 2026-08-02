import { describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import {
  AuthProtocolError,
  AuthRejected,
  AuthTransportError,
  authOperationEffect,
} from "./auth-effect";

describe("authOperationEffect", () => {
  it("returns successful data", async () => {
    const result = await Effect.runPromise(
      authOperationEffect(async () => ({ data: { id: "user-1" } })),
    );

    expect(result).toEqual({ id: "user-1" });
  });

  it("normalizes returned auth errors", async () => {
    const result = await Effect.runPromise(
      authOperationEffect(async () => ({
        data: null,
        error: { code: "INVALID_CREDENTIALS", message: "Wrong password" },
      })).pipe(Effect.either),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(AuthRejected);
  });

  it("normalizes thrown transport errors", async () => {
    const result = await Effect.runPromise(
      authOperationEffect(async () => {
        throw new Error("offline");
      }).pipe(Effect.either),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(AuthTransportError);
  });

  it("rejects invalid responses", async () => {
    const result = await Effect.runPromise(
      authOperationEffect(async () => null as never).pipe(Effect.either),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(AuthProtocolError);
  });
});
