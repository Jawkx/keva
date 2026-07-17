import { Effect, Fiber, TestClock } from "effect";
import { describe, expect } from "vitest";
import { it } from "./index.js";

describe("Effect test harness", () => {
  it.effect(
    "advances time deterministically",
    Effect.gen(function* () {
      const fiber = yield* Effect.sleep(60_000).pipe(Effect.as("complete"), Effect.fork);
      yield* TestClock.adjust(60_000);
      expect(yield* Fiber.join(fiber)).toBe("complete");
    }),
  );
});
