import { afterAll, beforeEach } from "vitest";
import { testSql, truncateAll } from "./db.js";

// One connection per worker; each test starts from an empty schema.
const sql = testSql(1);

beforeEach(() => truncateAll(sql));
afterAll(() => sql.end({ timeout: 5 }));
