import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";

const migrationDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export const requireTestDatabaseUrl = (): string => {
  const url = process.env.KEVA_TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "KEVA_TEST_DATABASE_URL is required to run the test suite (Postgres is the only backend).",
    );
  }
  return url;
};

export const testSql = (max = 4): Sql => postgres(requireTestDatabaseUrl(), { max });

export const applyMigrations = async (sql: Sql): Promise<void> => {
  const files = (await readdir(migrationDir)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
  for (const file of files) {
    const migration = await readFile(resolve(migrationDir, file), "utf8");
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((part) => part.trim())
      .filter(Boolean)) {
      await sql.unsafe(statement);
    }
  }
};

// Reset the database to a freshly-migrated schema. Run once before the suite.
// The migrations are `public`-qualified, so tests use the public schema; core
// and server test tasks are serialized (turbo) to share one database safely.
export const resetSchema = async (sql: Sql): Promise<void> => {
  await sql.unsafe("drop schema if exists public cascade; create schema public;");
  await applyMigrations(sql);
};

// Empty every table between tests. Store queries like the lifecycle sweeps and
// usage are not tenant-scoped, so tests need a clean slate, not just unique ids.
export const truncateAll = async (sql: Sql): Promise<void> => {
  const tables = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'
  `;
  if (tables.length === 0) return;
  const list = tables.map((row) => `"public"."${row.tablename}"`).join(", ");
  await sql.unsafe(`truncate ${list} restart identity cascade`);
};
