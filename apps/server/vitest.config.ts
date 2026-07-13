import { defineConfig } from "vitest/config";

// Postgres is the only backend; the suite runs against KEVA_TEST_DATABASE_URL.
// Runs serially and shares one database with @keva/core's suite (turbo
// serializes the two test tasks).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["src/test/global-setup.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
