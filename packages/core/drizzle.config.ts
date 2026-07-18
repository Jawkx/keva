import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/postgres/schema.ts",
    "../../apps/server/src/auth-schema.ts",
    "../../apps/server/src/account-share-schema.ts",
    "../../apps/server/src/mcp-connection-schema.ts",
  ],
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/keva",
  },
});
