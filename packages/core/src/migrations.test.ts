import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationDir = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

describe("migrations", () => {
  it("starts new databases with the complete current schema", async () => {
    const migrations = (await readdir(migrationDir))
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .sort();

    expect(migrations).toHaveLength(1);

    const migration = await readFile(resolve(migrationDir, migrations[0]!), "utf8");
    expect(migration).toContain('CREATE TABLE "views"');
    expect(migration).toContain('CREATE TABLE "share_grants"');
    expect(migration).toContain('"view_id" text NOT NULL');
    expect(migration).not.toContain('"conditions" jsonb NOT NULL,\n\t"write_stamp"');
    expect(migration).toContain('CREATE TABLE "tenant_usage"');
  });
});
