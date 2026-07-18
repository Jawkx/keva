import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./auth-schema.js";
import * as mcpConnectionSchema from "./mcp-connection-schema.js";

const schema = { ...authSchema, ...mcpConnectionSchema };

let created = 0;
let disposed = 0;

export const databaseUnitMetrics = () => ({ created, disposed, active: created - disposed });

export const resetDatabaseUnitMetrics = (): void => {
  created = 0;
  disposed = 0;
};

export const makeDatabaseUnit = (url: string) => {
  const sql = postgres(url);
  const db = drizzle(sql, { schema });
  created++;
  let closed = false;

  return {
    sql,
    db,
    dispose: async () => {
      if (closed) return;
      closed = true;
      disposed++;
      await sql.end({ timeout: 5 });
    },
  };
};

export type DatabaseUnit = ReturnType<typeof makeDatabaseUnit>;
