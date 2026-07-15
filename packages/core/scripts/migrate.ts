import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is required in packages/core/.env, or pass it inline: " +
      "DATABASE_URL=... pnpm --filter @keva/core db:migrate",
  );
}

// Redacted host so it's obvious which DB we're about to touch, without leaking creds.
const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    return "<unparseable DATABASE_URL>";
  }
})();
console.log(`Target: ${host}`);

// max:1 + prepare:false keeps DDL migrations safe over Neon's transaction-mode pooler.
// Prefer the direct (non-pooler) host for migrations regardless.
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  await migrate(drizzle(sql), {
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  });
  console.log("✅ migrations applied");
} catch (err) {
  // Unlike drizzle-kit's CLI, surface the real error instead of a bare exit code.
  console.error("❌ migration failed:");
  console.error(err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
