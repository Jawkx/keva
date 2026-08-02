import { describe, expect, it } from "vitest";
import { loadOptionalThumbnailUrl } from "./thumbnails";

describe("loadOptionalThumbnailUrl", () => {
  it("returns a thumbnail URL when present", async () => {
    await expect(
      loadOptionalThumbnailUrl(async () => ({ url: "https://storage.invalid/thumbnail" })),
    ).resolves.toBe("https://storage.invalid/thumbnail");
  });

  it("treats a missing thumbnail as optional", async () => {
    await expect(
      loadOptionalThumbnailUrl(async () => {
        throw { _tag: "NotFound", message: "Thumbnail not found" };
      }),
    ).resolves.toBeNull();
  });

  it("preserves other failures", async () => {
    const failure = new Error("offline");
    await expect(
      loadOptionalThumbnailUrl(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
