import { afterAll, beforeEach } from "vitest";
import { testSql, truncateAll } from "./db.js";

const sql = testSql(1);

beforeEach(() => truncateAll(sql));
afterAll(() => sql.end({ timeout: 5 }));
