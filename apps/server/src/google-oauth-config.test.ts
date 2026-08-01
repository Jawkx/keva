import { describe, expect, it } from "vitest";
import { googleOAuthConfigFor } from "./google-oauth-config.js";

describe("googleOAuthConfigFor", () => {
  it("keeps Google OAuth disabled when no credentials are present", () => {
    expect(googleOAuthConfigFor({})).toBeUndefined();
  });

  it("builds Google OAuth configuration from complete credentials", () => {
    expect(
      googleOAuthConfigFor({
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
      }),
    ).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      requireLocalEmailVerified: false,
    });
  });

  it("requires verified local accounts only in production", () => {
    expect(
      googleOAuthConfigFor({
        KEVA_ENVIRONMENT: "production",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
      }),
    ).toMatchObject({ requireLocalEmailVerified: true });
    expect(
      googleOAuthConfigFor({
        KEVA_ENVIRONMENT: "staging",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
      }),
    ).toMatchObject({ requireLocalEmailVerified: false });
  });

  it("rejects partial configuration", () => {
    expect(() => googleOAuthConfigFor({ GOOGLE_CLIENT_ID: "client-id" })).toThrow(
      "Google OAuth configuration is incomplete",
    );
    expect(() => googleOAuthConfigFor({ GOOGLE_CLIENT_SECRET: "client-secret" })).toThrow(
      "Google OAuth configuration is incomplete",
    );
  });
});
