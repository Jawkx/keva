import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createBetterAuth } from "./better-auth.js";

const client = postgres(
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/keva",
  { max: 1 },
);

export const auth: ReturnType<typeof createBetterAuth> = createBetterAuth({
  database: drizzle(client),
  secret: process.env.BETTER_AUTH_SECRET ?? "development-only-better-auth-secret-change-me",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:5173",
});
