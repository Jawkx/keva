import { describe, expect, it } from "vitest";
import { parseTokenParts, randomTokenPart } from "./auth.js";

describe("API token format", () => {
  it("round-trips minted token parts through the parser", () => {
    for (let i = 0; i < 2000; i++) {
      const id = randomTokenPart(9);
      const secret = randomTokenPart(32);
      const token = `keva_sk_${id}_${secret}`;
      expect(parseTokenParts(token)).toEqual({ id, secret });
    }
  });

  it("emits a delimiter-free alphabet so the single '_' separator is unambiguous", () => {
    for (let i = 0; i < 2000; i++) {
      expect(/[_-]/.test(randomTokenPart(16))).toBe(false);
    }
  });

  it("returns null for malformed tokens", () => {
    expect(parseTokenParts("nope")).toBeNull();
    expect(parseTokenParts("keva_sk_onlyonepart")).toBeNull();
    expect(parseTokenParts("")).toBeNull();
  });
});
