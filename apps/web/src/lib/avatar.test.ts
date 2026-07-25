import { describe, expect, it } from "vitest";
import {
  avatarDataUri,
  avatarRecipeForUser,
  parseAvatarRecipe,
  resolveAvatarRecipe,
} from "./avatar";

describe("avatar rendering", () => {
  it("renders the same SVG data URI for the same recipe", () => {
    const recipe = { version: 1 as const, seed: "user-1", glasses: "variant02" as const };
    expect(avatarDataUri(recipe)).toBe(avatarDataUri(recipe));
    expect(avatarDataUri(recipe)).toMatch(/^data:image\/svg\+xml/);
  });

  it("uses a user id fallback for missing or invalid recipes", () => {
    expect(avatarRecipeForUser("user-1")).toEqual({ version: 1, seed: "user-1" });
    expect(parseAvatarRecipe("not json")).toBeUndefined();
  });

  it("resolves every visible part without adding color customization", () => {
    const recipe = resolveAvatarRecipe({ version: 1, seed: "user-1" });
    expect(recipe).toMatchObject({
      hair: expect.any(String),
      head: expect.any(String),
      eyes: expect.any(String),
      eyebrows: expect.any(String),
      nose: expect.any(String),
      mouth: expect.any(String),
    });
    expect(Object.keys(recipe).some((key) => key.toLowerCase().includes("color"))).toBe(false);
  });
});
