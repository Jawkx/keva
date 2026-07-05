import { describe, expect, it } from "vitest";
import { randomTokenPart } from "./auth.js";
import { parseShareTokenParts } from "./shares.js";

describe("share token format", () => {
  it("round-trips minted share token parts through the parser", () => {
    for (let i = 0; i < 2000; i++) {
      const id = randomTokenPart(9);
      const secret = randomTokenPart(32);
      const token = `keva_sh_${id}_${secret}`;
      expect(parseShareTokenParts(token)).toEqual({ id, secret });
    }
  });

  it("returns null for malformed or wrong-prefix tokens", () => {
    expect(parseShareTokenParts("nope")).toBeNull();
    expect(parseShareTokenParts("keva_sh_onlyonepart")).toBeNull();
    expect(parseShareTokenParts("")).toBeNull();
    // An API token (keva_sk_) is not a share token (keva_sh_).
    expect(parseShareTokenParts("keva_sk_abc_def")).toBeNull();
  });
});
