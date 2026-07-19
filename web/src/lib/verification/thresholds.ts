/**
 * Configurable verification thresholds.
 * visualDiff: 0.005–0.10 (normalized per-pixel / structural fail band)
 * maxRetries: 1–10
 * DPI fixed at 300 for verification renders (scale = 300/72).
 */

export const VERIFICATION_DPI = 300;
/** PDF points are 72 DPI; scale factor for 300 DPI rasterization. */
export const DPI_300_SCALE = VERIFICATION_DPI / 72;

export interface VerificationThresholds {
  /** Normalized visual difference threshold (0.005–0.10). Fail if pixel delta ≥ this. */
  visualDiff: number;
  /** Minimum SSIM to pass (derived default from visualDiff, overridable). */
  ssimMin: number;
  /** Max perceptual-hash Hamming distance (0–64) to still pass. */
  phashMaxDistance: number;
  /** Max verification re-render attempts (1–10). */
  maxRetries: number;
  /** Render DPI (always 300 for verification pipeline). */
  dpi: number;
}

export const DEFAULT_THRESHOLDS: VerificationThresholds = {
  visualDiff: 0.02,
  ssimMin: 0.95,
  phashMaxDistance: 8,
  maxRetries: 3,
  dpi: VERIFICATION_DPI,
};

const STORAGE_KEY = "statement-lens.verification-thresholds";

export function clampVisualDiff(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_THRESHOLDS.visualDiff;
  return Math.min(0.1, Math.max(0.005, n));
}

export function clampMaxRetries(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_THRESHOLDS.maxRetries;
  return Math.min(10, Math.max(1, Math.round(n)));
}

export function clampSsimMin(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_THRESHOLDS.ssimMin;
  return Math.min(0.999, Math.max(0.5, n));
}

export function clampPhashMax(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_THRESHOLDS.phashMaxDistance;
  return Math.min(64, Math.max(0, Math.round(n)));
}

export function normalizeThresholds(
  partial?: Partial<VerificationThresholds> | null,
): VerificationThresholds {
  const base = { ...DEFAULT_THRESHOLDS, ...partial };
  return {
    visualDiff: clampVisualDiff(base.visualDiff),
    ssimMin: clampSsimMin(base.ssimMin),
    phashMaxDistance: clampPhashMax(base.phashMaxDistance),
    maxRetries: clampMaxRetries(base.maxRetries),
    dpi: VERIFICATION_DPI,
  };
}

export function loadThresholds(): VerificationThresholds {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THRESHOLDS };
    return normalizeThresholds(JSON.parse(raw) as Partial<VerificationThresholds>);
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export function saveThresholds(t: VerificationThresholds): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeThresholds(t)));
  } catch {
    // ignore quota
  }
}

/** Suggest ssimMin from visualDiff (tighter delta → higher SSIM bar). */
export function suggestedSsimMin(visualDiff: number): number {
  const v = clampVisualDiff(visualDiff);
  return clampSsimMin(1 - v * 2.5);
}
