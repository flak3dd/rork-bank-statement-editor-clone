import { describe, expect, it } from "vitest";
import {
  compareImageData,
  computePhash64,
  computeSsim,
  computeTileMaxDiff,
  hamming64,
  hashToHex,
} from "@/lib/verification/image-metrics";

function solidRgba(
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe("image metrics", () => {
  it("SSIM is ~1 for identical images", () => {
    const a = new Float64Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const s = computeSsim(a, a);
    expect(s.ssim).toBeGreaterThan(0.99);
  });

  it("tile-max is 0 for identical", () => {
    const a = new Float64Array(64).fill(100);
    const t = computeTileMaxDiff(a, a, 8, 8, 4);
    expect(t.tileMaxDiff).toBe(0);
  });

  it("phash hamming 0 for same gray", () => {
    const g = new Float64Array(64);
    for (let i = 0; i < 64; i++) g[i] = i;
    const h = computePhash64(g, 8, 8);
    expect(hamming64(h, h)).toBe(0);
    expect(hashToHex(h)).toHaveLength(16);
  });

  it("compareImageData scores identical solid images as pass", () => {
    const data = solidRgba(16, 16, 200, 200, 200);
    const result = compareImageData(
      { data, width: 16, height: 16 },
      { data: data.slice(), width: 16, height: 16 },
      { visualDiff: 0.02, ssimMin: 0.95, phashMaxDistance: 8 },
      { dpi: 300 },
    );
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.status).toBe("pass");
    expect(result.ssim.ssim).toBeGreaterThan(0.99);
    expect(result.phash.hammingDistance).toBe(0);
    expect(result.perPixel.meanAbsDelta).toBe(0);
    expect(result.failedGates).toHaveLength(0);
    expect(result.dpi).toBe(300);
  });

  it("compareImageData detects large color difference", () => {
    const a = solidRgba(16, 16, 0, 0, 0);
    const b = solidRgba(16, 16, 255, 255, 255);
    const result = compareImageData(
      { data: a, width: 16, height: 16 },
      { data: b, width: 16, height: 16 },
      { visualDiff: 0.02, ssimMin: 0.95, phashMaxDistance: 8 },
    );
    expect(result.score).toBeLessThan(90);
    expect(result.status).toBe("fail");
    expect(result.tileMax.tileMaxDiff).toBeGreaterThan(0.5);
    expect(result.perPixel.meanAbsDelta).toBeGreaterThan(0.5);
    expect(result.failedGates.length).toBeGreaterThan(0);
  });
});

