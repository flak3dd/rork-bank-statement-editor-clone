import { balanceChainScore } from "./balance-engine";
import { round2 } from "./money";
import type {
  CompletenessFinding,
  CompletenessScore,
  Transaction,
} from "./types";

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function gradeOf(score: number): CompletenessScore["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 55) return "D";
  return "F";
}

/**
 * Hybrid completeness scoring from local heuristics + optional AI confidence signals.
 * Dimensions are weighted and combined into a 0–100 overall score.
 */
export function computeCompletenessScore(params: {
  transactions: Transaction[];
  rawTextLength: number;
  pageCount: number;
  findings: CompletenessFinding[];
  limitedExtraction: boolean;
  aiValidated?: boolean;
  /** Optional AI score hint blended into overall (0–100). */
  aiScoreHint?: number | null;
}): CompletenessScore {
  const {
    transactions,
    rawTextLength,
    pageCount,
    findings,
    limitedExtraction,
    aiValidated = false,
    aiScoreHint = null,
  } = params;

  const n = transactions.length;

  // 1. Extraction density: rows vs text volume / pages
  let extractionDensity = 0;
  if (n === 0) {
    extractionDensity = rawTextLength > 200 ? 15 : 5;
  } else {
    const perPage = n / Math.max(pageCount, 1);
    // ~5–40 txns/page is healthy for retail statements
    const density = clamp((perPage / 25) * 100, 0, 100);
    const textSupport = clamp((rawTextLength / 500) * 40, 0, 40);
    extractionDensity = clamp(density * 0.7 + textSupport * 0.3 + (n >= 3 ? 10 : 0));
  }

  // 2. Date coverage
  const isoDates = transactions.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date));
  const dateCoverage =
    n === 0 ? 0 : clamp((isoDates.length / n) * 100);

  // 3. Amount coverage (has debit or credit)
  const withAmount = transactions.filter(
    (t) => (t.debit != null && t.debit > 0) || (t.credit != null && t.credit > 0),
  );
  const amountCoverage = n === 0 ? 0 : clamp((withAmount.length / n) * 100);

  // 4. Balance chain health
  const balanceChain = balanceChainScore(transactions);

  // 5. Description quality
  let descriptionQuality = 0;
  if (n > 0) {
    const good = transactions.filter((t) => {
      const d = t.description.trim();
      return d.length >= 3 && d.length <= 200 && !/^transaction$/i.test(d);
    });
    const avgLen =
      transactions.reduce((s, t) => s + t.description.trim().length, 0) / n;
    descriptionQuality = clamp(
      (good.length / n) * 80 + clamp(avgLen / 40, 0, 1) * 20,
    );
  }

  // 6. AI confidence (category confidences + validation flag)
  let aiConfidence = 40;
  if (n > 0) {
    const avgConf =
      transactions.reduce((s, t) => s + (t.categoryConfidence ?? 0), 0) / n;
    const aiTagged = transactions.filter((t) => t.categorySource === "ai").length;
    aiConfidence = clamp(
      avgConf * 70 + (aiTagged / n) * 20 + (aiValidated ? 15 : 0),
    );
  } else if (aiValidated) {
    aiConfidence = 30;
  }

  // Penalize by findings severity
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warning").length;
  const findingPenalty = Math.min(35, errorCount * 10 + warnCount * 4);

  const weights: CompletenessScore["weights"] = {
    extractionDensity: 0.2,
    dateCoverage: 0.15,
    amountCoverage: 0.2,
    balanceChain: 0.2,
    descriptionQuality: 0.1,
    aiConfidence: 0.15,
  };

  const dimensions = {
    extractionDensity: round2(extractionDensity),
    dateCoverage: round2(dateCoverage),
    amountCoverage: round2(amountCoverage),
    balanceChain: round2(balanceChain),
    descriptionQuality: round2(descriptionQuality),
    aiConfidence: round2(aiConfidence),
  };

  let overall =
    dimensions.extractionDensity * weights.extractionDensity +
    dimensions.dateCoverage * weights.dateCoverage +
    dimensions.amountCoverage * weights.amountCoverage +
    dimensions.balanceChain * weights.balanceChain +
    dimensions.descriptionQuality * weights.descriptionQuality +
    dimensions.aiConfidence * weights.aiConfidence;

  // Blend AI score hint when present (hybrid local + model).
  if (aiScoreHint != null && Number.isFinite(aiScoreHint)) {
    overall = overall * 0.75 + clamp(aiScoreHint) * 0.25;
  }

  overall = clamp(overall - findingPenalty);
  if (limitedExtraction) overall = clamp(overall * 0.75);
  overall = round2(overall);

  const grade = gradeOf(overall);
  const summary =
    n === 0
      ? "No transactions extracted — score reflects limited/empty parse."
      : `Hybrid completeness ${overall.toFixed(0)}/100 (grade ${grade}) across ${n} row(s)` +
        (aiValidated ? " with AI validation." : " (local scoring).");

  return {
    overall,
    grade,
    dimensions,
    weights,
    summary,
    limitedExtraction,
  };
}
