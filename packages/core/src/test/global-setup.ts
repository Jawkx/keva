import { resetSchema, testSql } from "./db.js";

export default async function setup(): Promise<void> {
  const sql = testSql(1);
  try {
    await resetSchema(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
