import type { ServerOptionsConfig } from "./server-options.js";

interface GoogleOAuthEnv {
  readonly KEVA_ENVIRONMENT?: string | undefined;
  readonly GOOGLE_CLIENT_ID?: string | undefined;
  readonly GOOGLE_CLIENT_SECRET?: string | undefined;
}

export const googleOAuthConfigFor = (env: GoogleOAuthEnv): ServerOptionsConfig["googleOAuth"] => {
  const values = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET];
  if (values.every((value) => !value)) return undefined;
  if (values.some((value) => !value)) {
    throw new Error("Google OAuth configuration is incomplete");
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID!,
    clientSecret: env.GOOGLE_CLIENT_SECRET!,
    // Non-production databases contain disposable accounts created without email verification.
    // Production retains Better Auth's pre-registration takeover protection.
    requireLocalEmailVerified: env.KEVA_ENVIRONMENT === "production",
  };
};
