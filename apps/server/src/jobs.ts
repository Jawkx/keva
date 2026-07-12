import { s3For } from "./runtime-mode.js";
import { runLifecycle } from "./lifecycle.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const s3 = s3For("persistent", {
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_REGION: process.env.S3_REGION,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
});
if (!s3) throw new Error("S3 configuration is required");

console.log(
  JSON.stringify({
    event: "lifecycle.cleanup.completed",
    ...(await runLifecycle({ databaseUrl, s3 })),
  }),
);
