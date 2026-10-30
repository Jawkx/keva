import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AwsClient } from "aws4fetch";
import { Data, Effect, Option, Schema } from "effect";
import postgres from "postgres";
import { drainThumbnailJobs } from "./processor.js";

const PORT = 8080;
interface DiagnosticResult {
  readonly ok: boolean;
  readonly code?: string;
}
class DiagnosticError extends Data.TaggedError("DiagnosticError")<{
  readonly code: string;
  readonly cause?: unknown;
}> {}

const required = (name: string) => {
  const value = process.env[name];
  return value
    ? Effect.succeed(value)
    : Effect.fail(new DiagnosticError({ code: "ConfigurationMissing" }));
};
const ErrorWithCode = Schema.Struct({ code: Schema.Unknown });

const errorCode = (cause: unknown) => {
  const coded = Schema.decodeUnknownOption(ErrorWithCode)(cause);
  if (Option.isSome(coded)) return String(coded.value.code).slice(0, 64);
  if (cause instanceof Error) {
    const message = cause.message.toLowerCase();
    if (message.includes("password") || message.includes("authentication")) return "DatabaseAuth";
    if (message.includes("enotfound") || message.includes("getaddrinfo")) return "DatabaseDns";
    if (message.includes("certificate") || message.includes("ssl")) return "DatabaseTls";
    if (message.includes("timeout")) return "DatabaseTimeout";
    if (message.includes("connection") || message.includes("connect")) return "DatabaseConnection";
    return cause.name.slice(0, 64);
  }
  return "UnknownError";
};
const result = <A>(effect: Effect.Effect<A, DiagnosticError>) =>
  effect.pipe(
    Effect.as({ ok: true } satisfies DiagnosticResult),
    Effect.catch((error) =>
      Effect.succeed({ ok: false, code: error.code } satisfies DiagnosticResult),
    ),
  );

const checkDatabase = Effect.scoped(
  Effect.gen(function* () {
    const url = yield* required("DATABASE_URL");
    const sql = yield* Effect.acquireRelease(
      Effect.sync(() => postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 1 })),
      (connection) => Effect.promise(() => connection.end({ timeout: 1 })),
    );
    const [row] = yield* Effect.tryPromise({
      try: () => sql<{ value: number }[]>`select 1 as value`,
      catch: (cause) => new DiagnosticError({ code: errorCode(cause), cause }),
    });
    if (row?.value !== 1) return yield* new DiagnosticError({ code: "DatabaseInvalidResponse" });
  }),
);

const checkStorage = Effect.gen(function* () {
  const endpoint = new URL(yield* required("S3_ENDPOINT"));
  const bucket = yield* required("S3_BUCKET");
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== "false";
  const url = forcePathStyle
    ? new URL(`/${encodeURIComponent(bucket)}?max-keys=0`, endpoint)
    : new URL(`${endpoint.protocol}//${bucket}.${endpoint.host}/?max-keys=0`);
  const client = new AwsClient({
    accessKeyId: yield* required("S3_ACCESS_KEY_ID"),
    secretAccessKey: yield* required("S3_SECRET_ACCESS_KEY"),
    region: process.env.S3_REGION || "auto",
    service: "s3",
  });
  const response = yield* Effect.tryPromise({
    try: (signal) => client.fetch(url, { method: "GET", signal }),
    catch: (cause) => new DiagnosticError({ code: errorCode(cause), cause }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: 30_000,
      orElse: () => Effect.fail(new DiagnosticError({ code: "StorageTimeout" })),
    }),
  );
  yield* Effect.promise(() => response.body?.cancel() ?? Promise.resolve());
  if (!response.ok) return yield* new DiagnosticError({ code: `StorageHttp${response.status}` });
});

const diagnostic = Effect.all(
  { database: result(checkDatabase), storage: result(checkStorage) },
  { concurrency: "unbounded" },
).pipe(
  Effect.map(({ database, storage }) => ({
    environment: process.env.KEVA_ENVIRONMENT || "unknown",
    recipeVersion: process.env.THUMBNAIL_RECIPE_VERSION || "unknown",
    database,
    storage,
    ok: database.ok && storage.ok,
  })),
);
const send = <Body>(response: ServerResponse, status: number, body: Body) =>
  Effect.sync(() => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
const handle = (request: IncomingMessage, response: ServerResponse) =>
  Effect.gen(function* () {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health")
      return yield* send(response, 200, {
        ok: true,
        environment: process.env.KEVA_ENVIRONMENT || "unknown",
      });
    if (request.method === "POST" && url.pathname === "/diagnostic") {
      const value = yield* diagnostic;
      return yield* send(response, value.ok ? 200 : 503, value);
    }
    if (request.method === "POST" && url.pathname === "/drain")
      return yield* drainThumbnailJobs.pipe(
        Effect.flatMap((value) => send(response, 200, value)),
        Effect.catch(() => send(response, 503, { ok: false, code: "DrainUnavailable" })),
      );
    return yield* send(response, 404, { ok: false, code: "NotFound" });
  });

const server = createServer((request, response) => {
  Effect.runPromise(handle(request, response)).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});
server.listen(PORT, "0.0.0.0", () =>
  console.log(JSON.stringify({ event: "media-worker.listening", port: PORT })),
);
