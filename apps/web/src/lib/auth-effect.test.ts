import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
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
      })).pipe(Effect.result),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(AuthRejected);
  });

  it("normalizes thrown transport errors", async () => {
    const result = await Effect.runPromise(
      authOperationEffect(async () => {
        throw new Error("offline");
      }).pipe(Effect.result),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(AuthTransportError);
  });

  it("rejects invalid responses", async () => {
    const result = await Effect.runPromise(
      authOperationEffect(async () => null).pipe(Effect.result),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(AuthProtocolError);
  });
});
