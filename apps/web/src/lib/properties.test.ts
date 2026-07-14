import { describe, expect, it } from "vitest";
import { inferPropertyValue } from "./properties";

describe("inferPropertyValue", () => {
  it("infers a tag from an empty value", () => {
    expect(inferPropertyValue("  ")).toEqual({ ok: true, value: null });
  });

  it("infers and trims a single value", () => {
    expect(inferPropertyValue(" finance ")).toEqual({ ok: true, value: "finance" });
  });

  it("infers normalized unique values from comma-delimited text", () => {
    expect(inferPropertyValue(" finance, legal, finance ")).toEqual({
      ok: true,
      value: ["finance", "legal"],
    });
  });
});
