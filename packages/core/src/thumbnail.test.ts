import { describe, expect, it } from "vitest";
import { supportsGeneratedThumbnail } from "./thumbnail.js";

describe("supportsGeneratedThumbnail", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "image/avif", "IMAGE/JPEG; charset=binary"])(
    "accepts %s",
    (contentType) => expect(supportsGeneratedThumbnail(contentType)).toBe(true),
  );

  it.each(["image/gif", "image/svg+xml", "video/mp4", "application/pdf", "text/plain"])(
    "rejects %s",
    (contentType) => expect(supportsGeneratedThumbnail(contentType)).toBe(false),
  );
});
