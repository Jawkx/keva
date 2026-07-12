import type { RuntimeConfig } from "./runtime.js";

export type RuntimeMode = "local-memory" | "persistent";

interface S3Environment {
  readonly S3_ENDPOINT?: string | undefined;
  readonly S3_REGION?: string | undefined;
  readonly S3_ACCESS_KEY_ID?: string | undefined;
  readonly S3_SECRET_ACCESS_KEY?: string | undefined;
  readonly S3_BUCKET?: string | undefined;
  readonly S3_FORCE_PATH_STYLE?: string | undefined;
}

const s3Required = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
] as const;
const s3Fields = [...s3Required, "S3_REGION", "S3_FORCE_PATH_STYLE"] as const;

const hasValue = (value: string | undefined): value is string => Boolean(value);

export const runtimeModeFor = (value: string | undefined): RuntimeMode => {
  if (value === "local-memory" || value === "persistent") return value;
  throw new Error('KEVA_RUNTIME_MODE must be "local-memory" or "persistent"');
};

export const s3For = (
  mode: RuntimeMode,
  environment: S3Environment,
): RuntimeConfig["s3"] | undefined => {
  const configured = s3Fields.filter((name) => hasValue(environment[name]));
  if (mode === "local-memory") {
    if (configured.length > 0) {
      throw new Error("S3 configuration is not allowed when KEVA_RUNTIME_MODE is local-memory");
    }
    return undefined;
  }

  const missing = s3Required.filter((name) => !hasValue(environment[name]));
  if (missing.length > 0)
    throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required`);

  return {
    endpoint: environment.S3_ENDPOINT!,
    region: environment.S3_REGION ?? "us-east-1",
    accessKeyId: environment.S3_ACCESS_KEY_ID!,
    secretAccessKey: environment.S3_SECRET_ACCESS_KEY!,
    bucket: environment.S3_BUCKET!,
    forcePathStyle: environment.S3_FORCE_PATH_STYLE !== "false",
  };
};
