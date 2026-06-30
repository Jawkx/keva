import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle/0001_rename_objects_to_items.sql",
);

describe("migrations", () => {
  it("renames objects to items without dropping metadata", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('ALTER TABLE "objects" RENAME TO "items"');
    expect(migration).toContain('ALTER TABLE "items" RENAME COLUMN "attributes" TO "properties"');
    expect(migration).not.toMatch(/drop\s+table\s+"objects"/i);
    expect(migration).not.toContain('CREATE TABLE "items"');
  });
});
