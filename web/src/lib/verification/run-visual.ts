import { compareImageData, type PixelCompareResult } from "./image-metrics";
import {
  pageToDataUrl,
  renderPdfWithPdfium,
  type VerificationRenderResult,
} from "./pdfium-renderer";
import { runApplitoolsEyesCheck, type ApplitoolsResult } from "./applitools";
import type { VisualValidateResult } from "@/lib/types";
import { buildVisualComparison } from "@/lib/visual-validate";
import type { Transaction } from "@/lib/types";
import {
  DPI_300_SCALE,
  VERIFICATION_DPI,
  normalizeThresholds,
  type VerificationThresholds,
} from "./thresholds";

export interface PagePixelResult {
  pageNumber: number;
  metrics: PixelCompareResult;
  baselinePreviewUrl?: string;
  candidatePreviewUrl?: string;
  attempt: number;
}

export type VisualCompareMode = "identity" | "edited" | "auto-linked";

export interface VisualVerificationReport {
  renderer: "pdfium";
  rendererOk: boolean;
  rendererError?: string;
  dpi: number;
  scale: number;
  thresholds: VerificationThresholds;
  attempts: number;
  baselineRender?: VerificationRenderResult;
  candidateRender?: VerificationRenderResult;
  pages: PagePixelResult[];
  /** Aggregate 0..100 from page scores. */
  pixelScore: number;
  pixelStatus: "pass" | "warn" | "fail" | "skipped";
  alwaysOn: {
    ssim: boolean;
    tileMaxDiff: boolean;
    perceptualHash: boolean;
    perPixelDelta: boolean;
  };
  applitools: ApplitoolsResult;
  fieldLayers: VisualValidateResult;
  durationMs: number;
  notes: string[];
  /** How baseline vs candidate were produced. */
  compareMode: VisualCompareMode;
  /** Number of PDF text replacements applied to candidate. */
  candidateEditCount: number;
}

export interface RunVisualVerificationParams {
  /** Original source PDF (frozen at parse). */
  baselinePdf: Uint8Array;
  /** Re-rendered PDF with generator/edits applied. */
  candidatePdf?: Uint8Array | null;
  transactions: Transaction[];
  /** Defaults to 300 DPI scale. */
  scale?: number;
  maxPages?: number;
  thresholds?: Partial<VerificationThresholds>;
  runApplitools?: boolean;
  onProgress?: (message: string, ratio: number) => void;
  signal?: AbortSignal;
  /** Identity | edited (queued/auto) — for report labeling. */
  compareMode?: VisualCompareMode;
  candidateEditCount?: number;
  extraNotes?: string[];
}

async function renderPair(
  baselinePdf: Uint8Array,
  candidatePdf: Uint8Array,
  scale: number,
  maxPages: number,
  same: boolean,
  onProgress?: RunVisualVerificationParams["onProgress"],
): Promise<{
  baseline: VerificationRenderResult;
  candidate: VerificationRenderResult;
}> {
  onProgress?.(`Rendering baseline @ ${VERIFICATION_DPI} DPI (Pdfium)…`, 0.1);
  const baseline = await renderPdfWithPdfium(baselinePdf, {
    scale,
    maxPages,
    onProgress: (r) =>
      onProgress?.(`Pdfium baseline @ ${VERIFICATION_DPI} DPI…`, 0.1 + r * 0.3),
  });

  if (same) {
    return { baseline, candidate: baseline };
  }

  onProgress?.(`Rendering candidate @ ${VERIFICATION_DPI} DPI (Pdfium)…`, 0.45);
  const candidate = await renderPdfWithPdfium(candidatePdf, {
    scale,
    maxPages,
    onProgress: (r) =>
      onProgress?.(`Pdfium candidate @ ${VERIFICATION_DPI} DPI…`, 0.45 + r * 0.3),
  });
  return { baseline, candidate };
}

function compareAllPages(
  baseline: VerificationRenderResult,
  candidate: VerificationRenderResult,
  thr: VerificationThresholds,
  attempt: number,
  onProgress?: RunVisualVerificationParams["onProgress"],
): PagePixelResult[] {
  const count = Math.min(baseline.pages.length, candidate.pages.length);
  const pages: PagePixelResult[] = [];
  for (let i = 0; i < count; i++) {
    const base = baseline.pages[i];
    const cand = candidate.pages[i];
    onProgress?.(
      `Page ${i + 1}/${count}: per-pixel Δ · SSIM · pHash @ ${VERIFICATION_DPI} DPI…`,
      0.75 + (i / Math.max(count, 1)) * 0.15,
    );
    const metrics = compareImageData(
      { data: base.data, width: base.width, height: base.height },
      { data: cand.data, width: cand.width, height: cand.height },
      {
        visualDiff: thr.visualDiff,
        ssimMin: thr.ssimMin,
        phashMaxDistance: thr.phashMaxDistance,
      },
      { dpi: VERIFICATION_DPI },
    );
    pages.push({
      pageNumber: base.pageNumber,
      metrics,
      baselinePreviewUrl: pageToDataUrl(base),
      candidatePreviewUrl: pageToDataUrl(cand),
      attempt,
    });
  }
  return pages;
}

function aggregateStatus(pages: PagePixelResult[]): {
  pixelScore: number;
  pixelStatus: VisualVerificationReport["pixelStatus"];
} {
  if (pages.length === 0) {
    return { pixelScore: 0, pixelStatus: "skipped" };
  }
  const pixelScore = Math.round(
    pages.reduce((s, p) => s + p.metrics.score, 0) / pages.length,
  );
  const anyFail = pages.some((p) => p.metrics.status === "fail");
  const anyWarn = pages.some((p) => p.metrics.status === "warn");
  const pixelStatus: VisualVerificationReport["pixelStatus"] = anyFail
    ? "fail"
    : anyWarn
      ? "warn"
      : pixelScore >= 90
        ? "pass"
        : "warn";
  return { pixelScore, pixelStatus };
}

/**
 * Full visual validation at 300 DPI:
 * Local Pdfium · per-pixel delta · SSIM · pHash · tile-max · optional Eyes
 * Retries up to maxRetries when status is fail.
 */
export async function runVisualVerification(
  params: RunVisualVerificationParams,
): Promise<VisualVerificationReport> {
  const started = performance.now();
  const notes: string[] = [...(params.extraNotes ?? [])];
  const thr = normalizeThresholds(params.thresholds);
  const scale = params.scale ?? DPI_300_SCALE;
  const maxPages = params.maxPages ?? 8;
  const fieldLayers = buildVisualComparison(params.transactions);
  const compareMode: VisualCompareMode = params.compareMode ?? "identity";
  const candidateEditCount = params.candidateEditCount ?? 0;

  let baselineRender: VerificationRenderResult | undefined;
  let candidateRender: VerificationRenderResult | undefined;
  let rendererOk = false;
  let rendererError: string | undefined;
  let pages: PagePixelResult[] = [];
  let attempts = 0;

  const candidateBytes = params.candidatePdf ?? params.baselinePdf;
  const sameBuffer =
    !params.candidatePdf ||
    params.candidatePdf === params.baselinePdf ||
    compareMode === "identity";
  if (sameBuffer || compareMode === "identity") {
    notes.push(
      "Candidate PDF equals original baseline — identity check @ 300 DPI (expect high score).",
    );
  } else {
    notes.push(
      `Comparing original PDF (baseline) vs regenerated candidate (${compareMode}, ${candidateEditCount} edit(s)) @ ${VERIFICATION_DPI} DPI.`,
    );
  }

  try {
    let lastStatus: VisualVerificationReport["pixelStatus"] = "fail";

    for (let attempt = 1; attempt <= thr.maxRetries; attempt++) {
      attempts = attempt;
      params.onProgress?.(
        `Verification attempt ${attempt}/${thr.maxRetries} @ ${VERIFICATION_DPI} DPI…`,
        0.05,
      );

      const pair = await renderPair(
        params.baselinePdf,
        candidateBytes,
        scale,
        maxPages,
        sameBuffer,
        params.onProgress,
      );
      baselineRender = pair.baseline;
      candidateRender = pair.candidate;
      rendererOk = true;

      pages = compareAllPages(
        baselineRender,
        candidateRender,
        thr,
        attempt,
        params.onProgress,
      );
      const agg = aggregateStatus(pages);
      lastStatus = agg.pixelStatus;

      if (lastStatus !== "fail") break;
      if (attempt < thr.maxRetries) {
        notes.push(
          `Attempt ${attempt} failed gates — retrying (${attempt + 1}/${thr.maxRetries})…`,
        );
      }
    }

    if (baselineRender && candidateRender) {
      if (baselineRender.pages.length !== candidateRender.pages.length) {
        notes.push(
          `Page count mismatch: baseline ${baselineRender.pages.length} vs candidate ${candidateRender.pages.length}.`,
        );
      }
    }
    notes.push(
      `Thresholds: visualDiff=${thr.visualDiff}, ssimMin=${thr.ssimMin}, pHashMax=${thr.phashMaxDistance}, retries=${thr.maxRetries}, dpi=${thr.dpi}.`,
    );
  } catch (err) {
    rendererOk = false;
    rendererError = err instanceof Error ? err.message : String(err);
    notes.push(`Pdfium verification renderer failed: ${rendererError}`);
  }

  const { pixelScore, pixelStatus } = aggregateStatus(pages);

  let applitools: ApplitoolsResult = {
    ran: false,
    skipped: true,
    reason: "disabled",
    message: "Applitools Eyes not requested.",
    durationMs: 0,
  };

  if (params.runApplitools !== false) {
    params.onProgress?.("Optional Applitools Eyes…", 0.95);
    const first = pages[0];
    applitools = await runApplitoolsEyesCheck({
      baselinePngBase64: first?.baselinePreviewUrl,
      candidatePngBase64: first?.candidatePreviewUrl,
      testName: `statement-visual-${VERIFICATION_DPI}dpi`,
      signal: params.signal,
    });
    if (applitools.skipped) notes.push(applitools.message);
  }

  params.onProgress?.("Visual validation complete", 1);

  return {
    renderer: "pdfium",
    rendererOk,
    rendererError,
    dpi: VERIFICATION_DPI,
    scale,
    thresholds: thr,
    attempts,
    baselineRender,
    candidateRender,
    pages,
    pixelScore,
    pixelStatus,
    alwaysOn: {
      ssim: true,
      tileMaxDiff: true,
      perceptualHash: true,
      perPixelDelta: true,
    },
    applitools,
    fieldLayers,
    durationMs: Math.round(performance.now() - started),
    compareMode: sameBuffer ? "identity" : compareMode,
    candidateEditCount: sameBuffer ? 0 : candidateEditCount,
    notes,
  };
}
