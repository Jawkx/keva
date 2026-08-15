import { makeThumbnailJobStore } from "@keva/core/postgres";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = Math.max(1, Math.min(1_000, Number(limitArgument?.slice(8) || "200")));
const sql = postgres(databaseUrl, { max: 1 });

try {
  const enqueued = await makeThumbnailJobStore(sql).enqueueMissing({ limit });
  console.log(JSON.stringify({ enqueued, limit }));
} finally {
  await sql.end({ timeout: 5 });
}
