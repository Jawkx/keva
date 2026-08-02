import { describe, expect, it } from "vitest";
import { isHtml, isMarkdown, isPreviewable, isVideo } from "./preview";

describe("video previews", () => {
  it("streams videos without applying an in-memory size limit", () => {
    const video = { contentType: "video/mp4", size: 10 * 1024 * 1024 * 1024 };

    expect(isVideo(video)).toBe(true);
    expect(isPreviewable(video)).toBe(true);
    expect(isVideo({ contentType: "image/mp4", size: 10 })).toBe(false);
  });
});

describe("isMarkdown", () => {
  it("recognizes markdown MIME types and common filename extensions", () => {
    expect(isMarkdown({ name: "notes.txt", contentType: "text/markdown", size: 10 })).toBe(true);
    expect(isMarkdown({ name: "README.MD", contentType: "text/plain", size: 10 })).toBe(true);
    expect(isMarkdown({ name: "notes.markdown", contentType: "text/plain", size: 10 })).toBe(true);
  });

  it("does not treat other text files as markdown", () => {
    expect(isMarkdown({ name: "notes.txt", contentType: "text/plain", size: 10 })).toBe(false);
  });
});

describe("isHtml", () => {
  it("recognizes HTML MIME types and filename extensions", () => {
    expect(isHtml({ name: "page.txt", contentType: "text/html", size: 10 })).toBe(true);
    expect(isHtml({ name: "index.HTML", contentType: "text/plain", size: 10 })).toBe(true);
    expect(isHtml({ name: "legacy.htm", contentType: "text/plain", size: 10 })).toBe(true);
  });

  it("does not treat other text files as HTML", () => {
    expect(isHtml({ name: "page.txt", contentType: "text/plain", size: 10 })).toBe(false);
  });
});
