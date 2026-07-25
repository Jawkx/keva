import { describe, expect, it } from "vitest";
import { avatarForUser, parseAvatarRecipe, serializeAvatarRecipe } from "./avatar.js";

describe("avatar recipes", () => {
  it("canonicalizes valid recipes and falls back to the user id", () => {
    const serialized = serializeAvatarRecipe(
      JSON.stringify({ seed: "custom", version: 1, glasses: "variant02" }),
    );
    expect(serialized).toBe('{"version":1,"seed":"custom","glasses":"variant02"}');
    expect(parseAvatarRecipe(serialized)).toEqual({
      version: 1,
      seed: "custom",
      glasses: "variant02",
    });
    expect(avatarForUser("user-1", "not json")).toEqual({ version: 1, seed: "user-1" });
  });

  it("rejects unsupported recipe values", () => {
    expect(() => serializeAvatarRecipe({ version: 1, seed: "x", glasses: "variant99" })).toThrow();
  });
});
