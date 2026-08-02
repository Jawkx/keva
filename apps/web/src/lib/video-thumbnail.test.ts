import { describe, expect, it } from "vitest";
import {
  bestThumbnailCandidate,
  measureThumbnailFrame,
  videoThumbnailCandidateTimes,
} from "./video-thumbnail";

const solidFrame = (width: number, height: number, value: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  return pixels;
};

const checkerboardFrame = (width: number, height: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = (x + y) % 2 === 0 ? 35 : 220;
      pixels[offset] = value;
      pixels[offset + 1] = (value + 70) % 255;
      pixels[offset + 2] = 255 - value;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
};

describe("videoThumbnailCandidateTimes", () => {
  it("samples longer videos away from the first and final frames", () => {
    expect(videoThumbnailCandidateTimes(100)).toEqual([10, 20, 35, 50, 65]);
  });

  it("uses fewer samples for very short videos", () => {
    expect(videoThumbnailCandidateTimes(2)).toEqual([0.5, 1, 1.5]);
    expect(videoThumbnailCandidateTimes(0)).toEqual([]);
  });
});

describe("measureThumbnailFrame", () => {
  it("rejects blank frames", () => {
    const metrics = measureThumbnailFrame(solidFrame(20, 20, 0), 20, 20);

    expect(metrics.rejected).toBe(true);
    expect(metrics.darkPixelRatio).toBe(1);
  });

  it("accepts a detailed frame", () => {
    const metrics = measureThumbnailFrame(checkerboardFrame(20, 20), 20, 20);

    expect(metrics.rejected).toBe(false);
    expect(metrics.edgeDensity).toBeGreaterThan(0.1);
    expect(metrics.score).toBeGreaterThan(0.5);
  });
});

describe("bestThumbnailCandidate", () => {
  it("prefers an accepted frame over a higher-scoring rejected frame", () => {
    const accepted = {
      time: 20,
      metrics: { ...measureThumbnailFrame(checkerboardFrame(20, 20), 20, 20), score: 0.6 },
    };
    const rejected = {
      time: 10,
      metrics: { ...measureThumbnailFrame(solidFrame(20, 20, 0), 20, 20), score: 0.9 },
    };

    expect(bestThumbnailCandidate([rejected, accepted])).toBe(accepted);
  });
});
