import { describe, expect, it } from "vitest";
import {
  loadOptionalThumbnail,
  loadOptionalThumbnailUrl,
  thumbnailRefreshInterval,
} from "./thumbnails";

const target = {
  url: "https://storage.invalid/thumbnail",
  expiresAt: "2026-01-01T00:05:00.000Z",
};

describe("thumbnail helpers", () => {
  it("retains the signed URL expiry", async () => {
    await expect(loadOptionalThumbnail(async () => target)).resolves.toEqual(target);
    await expect(loadOptionalThumbnailUrl(async () => target)).resolves.toBe(target.url);
  });

  it("treats a missing thumbnail as optional", async () => {
    await expect(
      loadOptionalThumbnail(async () => {
        throw { _tag: "NotFound", message: "Thumbnail not found" };
      }),
    ).resolves.toBeNull();
  });

  it("preserves other failures", async () => {
    const failure = new Error("offline");
    await expect(
      loadOptionalThumbnail(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it("refreshes one minute before expiry", () => {
    expect(thumbnailRefreshInterval(target.expiresAt, Date.parse("2026-01-01T00:00:00.000Z"))).toBe(
      240_000,
    );
    expect(
      thumbnailRefreshInterval("2026-01-01T00:00:10.000Z", Date.parse("2026-01-01T00:00:00.000Z")),
    ).toBe(1_000);
    expect(thumbnailRefreshInterval(undefined)).toBe(false);
    expect(thumbnailRefreshInterval("not-a-date")).toBe(false);
  });
});
