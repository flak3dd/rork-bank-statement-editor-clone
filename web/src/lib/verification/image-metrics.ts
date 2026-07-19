/**
 * Pure image comparison metrics for visual validation.
 * Always-on: SSIM, tile-max absolute diff, perceptual hash (DCT-ish / aHash hybrid).
 */

export interface ImageSize {
  width: number;
  height: number;
}

export interface SsimResult {
  /** Structural similarity 0..1 (1 = identical). */
  ssim: number;
  luminance: number;
  contrast: number;
  structure: number;
}

export interface TileMaxDiffResult {
  /** Max mean-absolute-diff across tiles, normalized 0..1. */
  tileMaxDiff: number;
  /** Absolute 0..255 scale mean abs diff of the worst tile. */
  worstTileMad: number;
  tileRows: number;
  tileCols: number;
  worstTile: { row: number; col: number };
}

export interface PhashResult {
  /** 64-bit hex hash of baseline. */
  baselineHash: string;
  /** 64-bit hex hash of candidate. */
  candidateHash: string;
  /** Hamming distance 0..64 (0 = identical). */
  hammingDistance: number;
  /** Normalized similarity 0..1. */
  similarity: number;
}

export interface PerPixelDeltaResult {
  /** Mean absolute difference / 255 → 0..1 */
  meanAbsDelta: number;
  /** RMS difference / 255 → 0..1 */
  rmsDelta: number;
  /** Max channel-luma abs delta / 255 */
  maxAbsDelta: number;
  /** Fraction of pixels with abs delta ≥ threshold*255 */
  fractionAboveThreshold: number;
  /** Absolute mean abs delta 0..255 */
  meanAbsDelta255: number;
  thresholdUsed: number;
}

export interface CompareThresholds {
  /** Normalized visual diff fail threshold (0.005–0.10). */
  visualDiff: number;
  /** Minimum SSIM to pass. */
  ssimMin: number;
  /** Max pHash Hamming distance to pass. */
  phashMaxDistance: number;
}

export interface PixelCompareResult {
  ssim: SsimResult;
  tileMax: TileMaxDiffResult;
  phash: PhashResult;
  /** Per-pixel delta statistics at the given threshold. */
  perPixel: PerPixelDeltaResult;
  /** Combined 0..100 quality score (higher = closer). */
  score: number;
  /** Threshold-aware pass / warn / fail */
  status: "pass" | "warn" | "fail";
  /** Which gates failed (empty if pass). */
  failedGates: string[];
  pixelCount: number;
  width: number;
  height: number;
  dpi?: number;
}

const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

function toGray(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Float64Array {
  const n = width * height;
  const g = new Float64Array(n);
  const len = Math.min(data.length, n * 4);
  for (let i = 0, p = 0; p < n && i + 2 < len; i += 4, p++) {
    // Rec. 601 luminance
    g[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return g;
}

function resizeNearest(
  src: Float64Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float64Array {
  const out = new Float64Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y / dh) * sh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x / dw) * sw));
      out[y * dw + x] = src[sy * sw + sx];
    }
  }
  return out;
}

/** Align two images to the smaller shared size (top-left crop). */
export function alignImages(
  a: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  b: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
): {
  a: Float64Array;
  b: Float64Array;
  width: number;
  height: number;
} {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const ga = toGray(a.data, a.width, a.height);
  const gb = toGray(b.data, b.width, b.height);
  const crop = (g: Float64Array, w: number, h: number) => {
    if (w === width && h === height) return g;
    const out = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        out[y * width + x] = g[y * w + x];
      }
    }
    return out;
  };
  return {
    a: crop(ga, a.width, a.height),
    b: crop(gb, b.width, b.height),
    width,
    height,
  };
}

/** Global SSIM on grayscale (single window ≈ full image stats). */
export function computeSsim(a: Float64Array, b: Float64Array): SsimResult {
  const n = Math.min(a.length, b.length);
  if (n === 0) {
    return { ssim: 0, luminance: 0, contrast: 0, structure: 0 };
  }

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const muA = sumA / n;
  const muB = sumB / n;

  let varA = 0;
  let varB = 0;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - muA;
    const db = b[i] - muB;
    varA += da * da;
    varB += db * db;
    cov += da * db;
  }
  varA /= n;
  varB /= n;
  cov /= n;

  const luminance = (2 * muA * muB + C1) / (muA * muA + muB * muB + C1);
  const contrast = (2 * Math.sqrt(varA) * Math.sqrt(varB) + C2) / (varA + varB + C2);
  const structure = (cov + C2 / 2) / (Math.sqrt(varA) * Math.sqrt(varB) + C2 / 2);
  const ssim = Math.max(0, Math.min(1, luminance * contrast * structure));

  return { ssim, luminance, contrast, structure };
}

/** Tile-max mean absolute difference (normalized). */
export function computeTileMaxDiff(
  a: Float64Array,
  b: Float64Array,
  width: number,
  height: number,
  tileSize = 32,
): TileMaxDiffResult {
  const tileCols = Math.max(1, Math.ceil(width / tileSize));
  const tileRows = Math.max(1, Math.ceil(height / tileSize));
  let worst = 0;
  let worstRow = 0;
  let worstCol = 0;

  for (let tr = 0; tr < tileRows; tr++) {
    for (let tc = 0; tc < tileCols; tc++) {
      const x0 = tc * tileSize;
      const y0 = tr * tileSize;
      const x1 = Math.min(width, x0 + tileSize);
      const y1 = Math.min(height, y0 + tileSize);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * width + x;
          sum += Math.abs(a[i] - b[i]);
          count += 1;
        }
      }
      const mad = count ? sum / count : 0;
      if (mad > worst) {
        worst = mad;
        worstRow = tr;
        worstCol = tc;
      }
    }
  }

  return {
    tileMaxDiff: Math.min(1, worst / 255),
    worstTileMad: worst,
    tileRows,
    tileCols,
    worstTile: { row: worstRow, col: worstCol },
  };
}

/** Average-hash style 64-bit perceptual hash (fast, robust to mild scale). */
export function computePhash64(gray: Float64Array, width: number, height: number): bigint {
  const small = resizeNearest(gray, width, height, 8, 8);
  let mean = 0;
  for (let i = 0; i < 64; i++) mean += small[i];
  mean /= 64;
  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if (small[i] >= mean) hash |= 1n << BigInt(i);
  }
  return hash;
}

export function hamming64(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

export function hashToHex(h: bigint): string {
  return h.toString(16).padStart(16, "0");
}

export function computePhashPair(
  a: Float64Array,
  b: Float64Array,
  width: number,
  height: number,
): PhashResult {
  const ha = computePhash64(a, width, height);
  const hb = computePhash64(b, width, height);
  const dist = hamming64(ha, hb);
  return {
    baselineHash: hashToHex(ha),
    candidateHash: hashToHex(hb),
    hammingDistance: dist,
    similarity: 1 - dist / 64,
  };
}

/** Per-pixel delta on aligned grayscale buffers. */
export function computePerPixelDelta(
  a: Float64Array,
  b: Float64Array,
  threshold = 0.02,
): PerPixelDeltaResult {
  const n = Math.min(a.length, b.length);
  if (n === 0) {
    return {
      meanAbsDelta: 1,
      rmsDelta: 1,
      maxAbsDelta: 1,
      fractionAboveThreshold: 1,
      meanAbsDelta255: 255,
      thresholdUsed: threshold,
    };
  }
  const thr255 = threshold * 255;
  let sumAbs = 0;
  let sumSq = 0;
  let maxAbs = 0;
  let above = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    sumAbs += d;
    sumSq += d * d;
    if (d > maxAbs) maxAbs = d;
    if (d >= thr255) above += 1;
  }
  const meanAbs = sumAbs / n;
  return {
    meanAbsDelta: meanAbs / 255,
    rmsDelta: Math.sqrt(sumSq / n) / 255,
    maxAbsDelta: maxAbs / 255,
    fractionAboveThreshold: above / n,
    meanAbsDelta255: meanAbs,
    thresholdUsed: threshold,
  };
}

const DEFAULT_COMPARE: CompareThresholds = {
  visualDiff: 0.02,
  ssimMin: 0.95,
  phashMaxDistance: 8,
};

/** Full pixel compare pipeline with threshold-aware gating. */
export function compareImageData(
  baseline: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  candidate: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  thresholds?: Partial<CompareThresholds>,
  meta?: { dpi?: number },
): PixelCompareResult {
  const thr: CompareThresholds = { ...DEFAULT_COMPARE, ...thresholds };
  const { a, b, width, height } = alignImages(baseline, candidate);
  const ssim = computeSsim(a, b);
  const tileMax = computeTileMaxDiff(a, b, width, height);
  const phash = computePhashPair(a, b, width, height);
  const perPixel = computePerPixelDelta(a, b, thr.visualDiff);

  // Score: SSIM + inverse pixel delta + tile + phash
  const score = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        ssim.ssim * 40 +
          (1 - perPixel.meanAbsDelta) * 25 +
          (1 - tileMax.tileMaxDiff) * 20 +
          phash.similarity * 15,
      ),
    ),
  );

  const failedGates: string[] = [];
  if (perPixel.meanAbsDelta >= thr.visualDiff) {
    failedGates.push(
      `per-pixel Δ ${perPixel.meanAbsDelta.toFixed(4)} ≥ ${thr.visualDiff}`,
    );
  }
  if (ssim.ssim < thr.ssimMin) {
    failedGates.push(`SSIM ${ssim.ssim.toFixed(4)} < ${thr.ssimMin}`);
  }
  if (phash.hammingDistance > thr.phashMaxDistance) {
    failedGates.push(
      `pHash Δ ${phash.hammingDistance} > ${thr.phashMaxDistance}`,
    );
  }
  // Soft warn if tile spike high even when mean ok
  const tileWarn = tileMax.tileMaxDiff >= thr.visualDiff * 3;

  let status: PixelCompareResult["status"] = "pass";
  if (failedGates.length > 0) status = "fail";
  else if (tileWarn || score < 90) status = "warn";

  return {
    ssim,
    tileMax,
    phash,
    perPixel,
    score,
    status,
    failedGates,
    pixelCount: width * height,
    width,
    height,
    dpi: meta?.dpi,
  };
}
