import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { KevaTransportError } from "@keva/sdk";
import { uploadFileEffect } from "./upload-workflow";

interface Session {
  readonly initiated: { readonly expiresAt: string };
  readonly id: string;
}

const session = (id: string, expiresAt = "2099-01-01T00:00:00.000Z"): Session => ({
  id,
  initiated: { expiresAt },
});

describe("uploadFileEffect", () => {
  it("resumes directly from confirmation", async () => {
    const calls: string[] = [];
    const existing = session("existing");
    const result = await Effect.runPromise(
      uploadFileEffect(
        {
          start: Effect.sync(() => {
            calls.push("start");
            return session("new");
          }),
          put: () => Effect.sync(() => calls.push("put")),
          confirm: (current) =>
            Effect.sync(() => {
              calls.push(`confirm:${current.id}`);
              return "complete";
            }),
        },
        { session: existing, phase: "confirm" },
        () => undefined,
      ),
    );

    expect(result).toBe("complete");
    expect(calls).toEqual(["confirm:existing"]);
  });

  it("retries transient upload failures", async () => {
    let puts = 0;
    const result = await Effect.runPromise(
      uploadFileEffect(
        {
          start: Effect.succeed(session("new")),
          put: () =>
            Effect.suspend(() => {
              puts += 1;
              return puts < 3
                ? Effect.fail(new KevaTransportError(new Error("offline")))
                : Effect.void;
            }),
          confirm: () => Effect.succeed("complete"),
        },
        { phase: "put" },
        () => undefined,
      ),
    );

    expect(result).toBe("complete");
    expect(puts).toBe(3);
  });

  it("retries confirmation without repeating the upload", async () => {
    let confirms = 0;
    let puts = 0;
    const result = await Effect.runPromise(
      uploadFileEffect(
        {
          start: Effect.succeed(session("new")),
          put: () =>
            Effect.sync(() => {
              puts += 1;
            }),
          confirm: () =>
            Effect.suspend(() => {
              confirms += 1;
              return confirms === 1
                ? Effect.fail(new KevaTransportError(new Error("lost response")))
                : Effect.succeed("complete");
            }),
        },
        { phase: "put" },
        () => undefined,
      ),
    );

    expect(result).toBe("complete");
    expect(puts).toBe(1);
    expect(confirms).toBe(2);
  });

  it("does not retry initiation and retains resumable state", async () => {
    let starts = 0;
    const result = await Effect.runPromise(
      uploadFileEffect(
        {
          start: Effect.suspend(() => {
            starts += 1;
            return Effect.fail({ _tag: "StorageUnavailable" as const });
          }),
          put: () => Effect.void,
          confirm: () => Effect.succeed("complete"),
        },
        { phase: "put" },
        () => undefined,
      ).pipe(Effect.either),
    );

    expect(result).toMatchObject({
      _tag: "Left",
      left: { phase: "put", session: undefined },
    });
    expect(starts).toBe(1);
  });

  it("restarts expired put sessions", async () => {
    const calls: string[] = [];
    const result = await Effect.runPromise(
      uploadFileEffect(
        {
          start: Effect.sync(() => {
            calls.push("start");
            return session("new");
          }),
          put: (current) => Effect.sync(() => calls.push(`put:${current.id}`)),
          confirm: (current) => Effect.sync(() => `confirm:${current.id}`),
        },
        { session: session("expired", "2000-01-01T00:00:00.000Z"), phase: "put" },
        () => undefined,
      ),
    );

    expect(result).toBe("confirm:new");
    expect(calls).toEqual(["start", "put:new"]);
  });
});
