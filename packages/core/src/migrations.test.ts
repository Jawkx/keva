import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationDir = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const migrationPath = resolve(migrationDir, "0001_rename_objects_to_items.sql");
const shareGrantsMigrationPath = resolve(migrationDir, "0003_new_black_panther.sql");
const tenantUsageMigrationPath = resolve(migrationDir, "0008_faithful_champions.sql");

describe("migrations", () => {
  it("renames objects to items without dropping metadata", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('ALTER TABLE "objects" RENAME TO "items"');
    expect(migration).toContain('ALTER TABLE "items" RENAME COLUMN "attributes" TO "properties"');
    expect(migration).not.toMatch(/drop\s+table\s+"objects"/i);
    expect(migration).not.toContain('CREATE TABLE "items"');
  });

  it("adds share_grants and the source index without touching existing data", async () => {
    const migration = await readFile(shareGrantsMigrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "share_grants"');
    expect(migration).toContain('CREATE INDEX "share_grants_tenant_created_idx"');
    expect(migration).toContain('CREATE INDEX "items_tenant_source_idx"');
    // Purely additive: no drops, and no destructive rewrite of items.
    expect(migration).not.toMatch(/drop\s+/i);
    expect(migration).not.toMatch(/alter\s+table\s+"items"/i);
  });

  it("backfills quota accounting from active items", async () => {
    const migration = await readFile(tenantUsageMigrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "tenant_usage"');
    expect(migration).toContain('INSERT INTO "tenant_usage"');
    expect(migration).toContain('sum(coalesce("size", "declared_size"))');
    expect(migration).toContain("\"status\" in ('pending', 'ready')");
  });
});
