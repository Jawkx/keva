import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { renderImageThumbnail } from "./processor.js";

const directories: string[] = [];

const directory = async () => {
  const path = await mkdtemp(join(tmpdir(), "keva-thumbnail-test-"));
  directories.push(path);
  return path;
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("renderImageThumbnail", () => {
  it("renders a bounded WebP without enlarging the source", async () => {
    const path = await directory();
    const input = join(path, "source.png");
    const output = join(path, "output.webp");
    await sharp({
      create: { width: 320, height: 180, channels: 4, background: "#e8793e" },
    })
      .png()
      .toFile(input);

    const result = await renderImageThumbnail(input, output);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe("webp");
    expect(result).toMatchObject({ width: 320, height: 180 });
    expect(result.size).toBeLessThanOrEqual(1024 * 1024);
  });

  it("rejects corrupt input", async () => {
    const path = await directory();
    const input = join(path, "corrupt.jpg");
    await writeFile(input, "not an image");

    await expect(renderImageThumbnail(input, join(path, "output.webp"))).rejects.toThrow(
      "UnsupportedSourceType",
    );
  });
});
