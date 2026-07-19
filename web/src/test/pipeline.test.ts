import { describe, expect, it } from "vitest";
import {
  applyRenderWithFallbacks,
  buildBalancePreview,
  inferOpeningBalance,
  recomputeBalances,
} from "@/lib/balance-engine";
import { computeCompletenessScore } from "@/lib/completeness";
import {
  applyFieldEdit,
  attachOriginals,
  isRowDirty,
  revertRow,
} from "@/lib/edit-utils";
import { runFinalMathCheck } from "@/lib/math-check";
import {
  analyzeCompleteness,
  buildExtractionResult,
  buildSummary,
  parseTransactionsHybrid,
  parseTransactionsFromText,
} from "@/lib/parse-transactions";
import { buildVisualComparison } from "@/lib/visual-validate";
import type { Transaction } from "@/lib/types";

const SAMPLE = `
Statement Period 01/03/2026 - 31/03/2026
03/03/2026 WOOLWORTHS MARKET          85.40      1,200.00
05/03/2026 SALARY ACME CORP                     2,500.00   3,700.00
07/03/2026 NETFLIX SUBSCRIPTION       16.99      3,683.01
10/03/2026 TRANSFER TO SAVINGS       200.00      3,483.01
`;

function sampleTxns(): Transaction[] {
  return parseTransactionsFromText(SAMPLE);
}

describe("hybrid parse + completeness", () => {
  it("parses sample statement rows", () => {
    const { transactions, meta } = parseTransactionsHybrid(SAMPLE);
    expect(transactions.length).toBeGreaterThanOrEqual(3);
    expect(meta.enginesTried.length).toBeGreaterThan(0);
    expect(transactions.every((t) => t.original)).toBe(true);
  });

  it("scores completeness with dimensions", () => {
    const txns = sampleTxns();
    const findings = analyzeCompleteness(txns);
    const score = computeCompletenessScore({
      transactions: txns,
      rawTextLength: SAMPLE.length,
      pageCount: 1,
      findings,
      limitedExtraction: false,
      aiValidated: true,
      aiScoreHint: 85,
    });
    expect(score.overall).toBeGreaterThan(40);
    expect(["A", "B", "C", "D", "F"]).toContain(score.grade);
    expect(score.dimensions.dateCoverage).toBeGreaterThan(50);
  });

  it("buildExtractionResult includes completenessScore", () => {
    const txns = sampleTxns();
    const result = buildExtractionResult({
      fileName: "demo.pdf",
      pageCount: 1,
      rawText: SAMPLE,
      transactions: txns,
    });
    expect(result.completenessScore.overall).toBeGreaterThanOrEqual(0);
    expect(result.transactions[0].original).toBeDefined();
  });
});

describe("inline edit + revert", () => {
  it("marks dirty fields and reverts per row", () => {
    let [t] = attachOriginals(sampleTxns());
    expect(isRowDirty(t)).toBe(false);
    t = applyFieldEdit(t, "debit", "99.50");
    expect(isRowDirty(t)).toBe(true);
    expect(t.debit).toBe(99.5);
    expect(t.flags).toContain("edited");
    const reverted = revertRow(t);
    expect(isRowDirty(reverted)).toBe(false);
    expect(reverted.debit).toBe(t.original?.debit);
  });

  it("edits description and balance", () => {
    let [t] = attachOriginals(sampleTxns());
    t = applyFieldEdit(t, "description", "GROCERY STORE");
    t = applyFieldEdit(t, "balance", "1500.00");
    expect(t.description).toBe("GROCERY STORE");
    expect(t.balance).toBe(1500);
    expect(isRowDirty(t)).toBe(true);
  });
});

describe("balance engines + render fallbacks", () => {
  it("builds per-row balance diffs", () => {
    const txns = sampleTxns();
    const preview = buildBalancePreview(txns, "recompute");
    expect(preview.rows.length).toBe(txns.length);
    expect(preview.openingBalance != null || txns.some((t) => t.balance != null)).toBe(
      true,
    );
  });

  it("recomputes chain from opening", () => {
    const txns = sampleTxns();
    const opening = inferOpeningBalance(txns);
    if (opening == null) return;
    const bals = recomputeBalances(txns, opening);
    expect(bals.length).toBe(txns.length);
    expect(bals.every((b) => b == null || Number.isFinite(b))).toBe(true);
  });

  it("applyRenderWithFallbacks updates balances", () => {
    const txns = sampleTxns().map((t, i) =>
      i === 0 ? { ...t, balance: (t.balance ?? 1000) + 50 } : t,
    );
    const rendered = applyRenderWithFallbacks(txns, "hybrid");
    expect(rendered.transactions.length).toBe(txns.length);
    expect(rendered.enginesTried.length).toBeGreaterThan(0);
    expect(rendered.transactions.every((t) => t.rendered)).toBe(true);
  });
});

describe("visual validate + math check", () => {
  it("detects field-layer changes", () => {
    let txns = attachOriginals(sampleTxns());
    txns = txns.map((t, i) =>
      i === 0 ? applyFieldEdit(t, "description", "EDITED MERCHANT") : t,
    );
    const visual = buildVisualComparison(txns);
    expect(visual.changedRowCount).toBeGreaterThanOrEqual(1);
    expect(visual.totalFieldChanges).toBeGreaterThanOrEqual(1);
  });

  it("runs final math check", () => {
    const txns = sampleTxns();
    const check = runFinalMathCheck({ transactions: txns, rawText: SAMPLE });
    expect(check.items.length).toBeGreaterThan(0);
    expect(check.score).toBeGreaterThanOrEqual(0);
    expect(["pass", "warn", "fail"]).toContain(check.status);
    expect(check.reparsedCount).toBeGreaterThan(0);
  });

  it("summary stays consistent after edits", () => {
    const txns = sampleTxns();
    const s = buildSummary(txns);
    expect(s.transactionCount).toBe(txns.length);
    expect(s.net).toBeCloseTo(s.totalIn - s.totalOut, 2);
  });
});
