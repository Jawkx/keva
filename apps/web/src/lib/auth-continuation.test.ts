import { describe, expect, it } from "vitest";
import {
  authContinuationSearch,
  authErrorMessage,
  loginContinuation,
  planContinuation,
  signupContinuation,
} from "./auth-continuation";

describe("auth continuations", () => {
  it("preserves valid billing plan destinations", () => {
    expect(planContinuation("?plan=500gb")).toBe("/settings?plan=500gb");
    expect(planContinuation("?plan=unknown")).toBeNull();
  });

  it("prioritizes MCP OAuth authorization over other destinations", () => {
    const search = "?client_id=client-1&scope=openid&plan=1tb";
    expect(loginContinuation(search, "/items")).toBe(
      "/api/auth/mcp/authorize?client_id=client-1&scope=openid&plan=1tb",
    );
    expect(signupContinuation(search)).toBe(
      "/api/auth/mcp/authorize?client_id=client-1&scope=openid&plan=1tb",
    );
  });

  it("uses safe login return paths and signup defaults", () => {
    expect(loginContinuation("", "/settings")).toBe("/settings");
    expect(loginContinuation("", "https://attacker.example")).toBe("/");
    expect(loginContinuation("", "//attacker.example")).toBe("/");
    expect(signupContinuation("")).toBe("/");
  });

  it("removes OAuth errors without losing the original continuation", () => {
    expect(
      authContinuationSearch(
        "?client_id=client-1&scope=openid&error=access_denied&error_description=Canceled",
      ),
    ).toBe("?client_id=client-1&scope=openid");
    expect(loginContinuation("?client_id=client-1&error=access_denied", null)).toBe(
      "/api/auth/mcp/authorize?client_id=client-1",
    );
  });

  it("turns OAuth callback errors into user-facing messages", () => {
    expect(authErrorMessage("?error=access_denied")).toBe("Google sign-in was canceled.");
    expect(authErrorMessage("?error=server_error")).toBe(
      "Google sign-in failed. Please try again.",
    );
    expect(authErrorMessage("?error_description=Account%20disabled")).toBe("Account disabled");
    expect(authErrorMessage("")).toBeNull();
  });
});
