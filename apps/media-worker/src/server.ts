import { createServer } from "node:http";
import { AwsClient } from "aws4fetch";
import postgres from "postgres";
import { drainThumbnailJobs } from "./processor.js";

const PORT = 8080;

interface DiagnosticResult {
  readonly ok: boolean;
  readonly code?: string;
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const errorCode = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code).slice(0, 64);
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("password") || message.includes("authentication")) return "DatabaseAuth";
    if (message.includes("enotfound") || message.includes("getaddrinfo")) return "DatabaseDns";
    if (message.includes("certificate") || message.includes("ssl")) return "DatabaseTls";
    if (message.includes("timeout") || message.includes("timed out")) return "DatabaseTimeout";
    if (message.includes("connection") || message.includes("connect")) return "DatabaseConnection";
    if (error.name) return error.name.slice(0, 64);
  }
  return "UnknownError";
};

const checkDatabase = async (): Promise<DiagnosticResult> => {
  const sql = postgres(required("DATABASE_URL"), {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 1,
  });
  try {
    const [result] = await sql<{ value: number }[]>`select 1 as value`;
    return { ok: result?.value === 1 };
  } catch (error) {
    return { ok: false, code: errorCode(error) };
  } finally {
    await sql.end({ timeout: 1 });
  }
};

const checkStorage = async (): Promise<DiagnosticResult> => {
  try {
    const endpoint = new URL(required("S3_ENDPOINT"));
    const bucket = required("S3_BUCKET");
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== "false";
    const url = forcePathStyle
      ? new URL(`/${encodeURIComponent(bucket)}?max-keys=0`, endpoint)
      : new URL(`${endpoint.protocol}//${bucket}.${endpoint.host}/?max-keys=0`);
    const client = new AwsClient({
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
      region: process.env.S3_REGION || "auto",
      service: "s3",
    });
    const response = await client.fetch(url, { method: "GET" });
    await response.body?.cancel();
    return response.ok ? { ok: true } : { ok: false, code: `StorageHttp${response.status}` };
  } catch (error) {
    return { ok: false, code: errorCode(error) };
  }
};

const diagnostic = async () => {
  const [database, storage] = await Promise.all([checkDatabase(), checkStorage()]);
  return {
    environment: process.env.KEVA_ENVIRONMENT || "unknown",
    recipeVersion: process.env.THUMBNAIL_RECIPE_VERSION || "unknown",
    database,
    storage,
    ok: database.ok && storage.ok,
  };
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ ok: true, environment: process.env.KEVA_ENVIRONMENT || "unknown" }),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/diagnostic") {
    const result = await diagnostic();
    response.writeHead(result.ok ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
    return;
  }
  if (request.method === "POST" && url.pathname === "/drain") {
    try {
      const result = await drainThumbnailJobs();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
    } catch {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, code: "DrainUnavailable" }));
    }
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: false, code: "NotFound" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "media-worker.listening", port: PORT }));
});
