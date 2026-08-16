import { makeThumbnailJobStore } from "@keva/core/postgres";
import { Data, Effect } from "effect";
import postgres from "postgres";

class BackfillError extends Data.TaggedError("BackfillError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const program = Effect.gen(function* () {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return yield* new BackfillError({ message: "DATABASE_URL is required" });
  const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
  const parsedLimit = Number(limitArgument?.slice(8) || "200");
  if (!Number.isFinite(parsedLimit))
    return yield* new BackfillError({ message: "--limit must be a number" });
  const limit = Math.max(1, Math.min(1_000, parsedLimit));
  const sql = yield* Effect.acquireRelease(
    Effect.sync(() => postgres(databaseUrl, { max: 1 })),
    (connection) => Effect.promise(() => connection.end({ timeout: 5 })),
  );
  const enqueued = yield* Effect.tryPromise({
    try: () => makeThumbnailJobStore(sql).enqueueMissing({ limit }),
    catch: (cause) => new BackfillError({ message: "Backfill failed", cause }),
  });
  yield* Effect.sync(() => console.log(JSON.stringify({ enqueued, limit })));
}).pipe(Effect.scoped);

Effect.runPromise(program).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
