import { defineConfig } from "vitest/config";

// Postgres is the only backend, so the suite runs against a real database
// (KEVA_TEST_DATABASE_URL). Each package uses its own schema and runs serially
// so tests never contend for the shared database.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["src/test/global-setup.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
