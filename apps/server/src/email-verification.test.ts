import { describe, expect, it } from "vitest";
import { emailVerificationConfigFor } from "./email-verification.js";

describe("email verification configuration", () => {
  it("is disabled outside production", () => {
    expect(emailVerificationConfigFor({})).toBeUndefined();
    expect(
      emailVerificationConfigFor({
        KEVA_ENVIRONMENT: "staging",
        RESEND_API_KEY: "ignored",
        RESEND_FROM: "ignored@example.com",
      }),
    ).toBeUndefined();
  });

  it("requires Resend configuration in production", () => {
    expect(() => emailVerificationConfigFor({ KEVA_ENVIRONMENT: "production" })).toThrow(
      "RESEND_API_KEY is required",
    );
    expect(() =>
      emailVerificationConfigFor({
        KEVA_ENVIRONMENT: "production",
        RESEND_API_KEY: "re_test",
      }),
    ).toThrow("RESEND_FROM is required");
  });

  it("returns the production Resend configuration", () => {
    expect(
      emailVerificationConfigFor({
        KEVA_ENVIRONMENT: "production",
        RESEND_API_KEY: "re_test",
        RESEND_FROM: "Keva <accounts@usekeva.com>",
      }),
    ).toEqual({
      apiKey: "re_test",
      from: "Keva <accounts@usekeva.com>",
    });
  });
});
