import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { loadPreviewContent } from "./preview-content";

describe("loadPreviewContent", () => {
  it("decodes and truncates text previews", async () => {
    const bytes = new TextEncoder().encode("a".repeat(5_100));
    const result = await Effect.runPromise(
      loadPreviewContent(Effect.succeed(bytes), "text/plain", false),
    );

    expect(result).toEqual({ kind: "text", text: "a".repeat(5_000) });
  });

  it("preserves binary content in a typed blob", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await Effect.runPromise(
      loadPreviewContent(Effect.succeed(bytes), "image/png", true),
    );

    expect(result.kind).toBe("blob");
    if (result.kind === "blob") {
      expect(result.blob.type).toBe("image/png");
      expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
    }
  });
});
