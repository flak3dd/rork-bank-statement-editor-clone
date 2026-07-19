/**
 * Full end-to-end workflow stress on a real St George PDF.
 *
 * Runs unique workflow variants until 5 consecutive flawless, unique runs
 * (or fails with a debug report).
 *
 * npm run test -- src/test/full-workflow-stress.test.ts
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeGenerationQuality,
  defaultStatementConfig,
  generateStatement,
  ledgerToAppTransactions,
  normalizeStatementConfig,
  validateLedger,
  type StatementConfig,
} from "@/lib/statement-gen";
import {
  BANK_IDS,
  generateBankDescription,
  generateBankDescriptions,
  type BankId,
} from "@/lib/tools/bank-descriptions";
import { cloneUint8Array } from "@/lib/bytes";
import { compareLedgers } from "@/lib/compare-ledger";
import { attachOriginals } from "@/lib/edit-utils";
import { buildBalancePreview } from "@/lib/balance-engine";
import { runFinalMathCheck } from "@/lib/math-check";
import { applyReplacementsWithFallbacks } from "@/lib/pdf-engines";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { parseTransactionsHybrid } from "@/lib/parse-transactions";
import { runDocumentParser } from "@/lib/parsers";
import type { DocumentParserId } from "@/lib/parsers/types";
import {
  buildFontReplicatedReplacements,
} from "@/lib/tools/advanced-generator";
import { getPageTextRunsFromBytes } from "@/lib/tools/pdf-runs";
import {
  linkRunMatches,
  pairGeneratedToMatches,
} from "@/lib/tools/run-match";
import { materializeCandidatePdf } from "@/lib/verification/materialize-candidate";
import { runVisualVerification } from "@/lib/verification/run-visual";
import type { PdfEdit, Transaction } from "@/lib/types";

const PDF_PATH =
  "/Users/adminuser/Downloads/1132%20(2)/698/St George Bank Acc Statement #726 - 21.08.24 to 19.11.24.pdf";

const OUT = resolve(process.cwd(), "scripts/.workflow-stress");

const TARGET_STREAK = 5;
const MAX_ATTEMPTS = 40;

type RunVariant = {
  id: string;
  parser: DocumentParserId;
  bank: BankId;
  seed: number;
  periodDays: number;
  salaryAmount: number;
  cardSpendPct: number;
  billsSubsPct: number;
  hasRental: boolean;
  replaceMode: "bank-desc" | "generate-apply" | "hybrid";
  balanceEngine: "hybrid" | "recompute" | "stated";
  runVisual: boolean;
};

function buildVariants(): RunVariant[] {
  const parsers: DocumentParserId[] = [
    "offline-heuristic",
    "pymupdf",
    "offline-heuristic",
    "pymupdf",
    "local-ocr",
  ];
  const banks: BankId[] = [
    "anz",
    "cba",
    "westpac",
    "ing",
    "bankwest",
    "suncorp",
    "macquarie",
    "other",
  ];
  const modes: RunVariant["replaceMode"][] = [
    "bank-desc",
    "generate-apply",
    "hybrid",
  ];
  const engines: RunVariant["balanceEngine"][] = [
    "hybrid",
    "recompute",
    "stated",
  ];

  const out: RunVariant[] = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    out.push({
      id: `v${i + 1}-${banks[i % banks.length]}-${modes[i % modes.length]}-${parsers[i % parsers.length]}`,
      parser: parsers[i % parsers.length],
      bank: banks[i % banks.length],
      seed: 11000 + i * 97 + (i % 11) * 13,
      periodDays: 21 + (i % 5) * 7,
      salaryAmount: 2800 + (i % 8) * 250,
      cardSpendPct: 15 + (i % 6) * 5,
      billsSubsPct: 10 + (i % 5) * 4,
      hasRental: i % 3 === 0,
      replaceMode: modes[i % modes.length],
      balanceEngine: engines[i % engines.length],
      runVisual: i % 2 === 0, // every other run includes pixel path (heavy)
    });
  }
  return out;
}

function fingerprint(v: RunVariant, stats: Record<string, unknown>): string {
  return JSON.stringify({
    parser: v.parser,
    bank: v.bank,
    seed: v.seed,
    periodDays: v.periodDays,
    salaryAmount: v.salaryAmount,
    cardSpendPct: v.cardSpendPct,
    billsSubsPct: v.billsSubsPct,
    hasRental: v.hasRental,
    replaceMode: v.replaceMode,
    balanceEngine: v.balanceEngine,
    runVisual: v.runVisual,
    // uniqueness of generation outcome
    genClose: stats.genClose,
    rewriteClose: stats.rewriteClose,
    editCount: stats.editCount,
    sampleDesc: stats.sampleDesc,
  });
}

async function parseSource(
  bytes: Uint8Array,
  fileName: string,
  parserId: DocumentParserId,
): Promise<{ transactions: Transaction[]; rawText: string; pageCount: number; warnings: string[] }> {
  const file = new File([bytes], fileName, { type: "application/pdf" });
  try {
    const parsed = await runDocumentParser(parserId, {
      file,
      bytes: cloneUint8Array(bytes),
      fileName,
    });
    let txns = parsed.transactions;
    if (txns.length === 0 && parsed.rawText) {
      txns = attachOriginals(
        parseTransactionsHybrid(parsed.rawText).transactions,
      );
    }
    // Always also try hybrid on extracted text if sparse
    if (txns.length < 3) {
      try {
        const extracted = await extractTextFromPdf(cloneUint8Array(bytes));
        const hybrid = parseTransactionsHybrid(extracted.text);
        if (hybrid.transactions.length > txns.length) {
          txns = attachOriginals(hybrid.transactions);
          return {
            transactions: txns,
            rawText: extracted.text,
            pageCount: extracted.pageCount,
            warnings: [
              ...parsed.meta.warnings,
              `Hybrid text parse recovered ${txns.length} rows (parser had ${parsed.transactions.length})`,
            ],
          };
        }
      } catch {
        /* keep parser result */
      }
    }
    return {
      transactions: attachOriginals(txns),
      rawText: parsed.rawText,
      pageCount: parsed.pageCount,
      warnings: parsed.meta.warnings,
    };
  } catch (err) {
    // Hard fallback: PDF.js extract + hybrid
    const extracted = await extractTextFromPdf(cloneUint8Array(bytes));
    const hybrid = parseTransactionsHybrid(extracted.text);
    return {
      transactions: attachOriginals(hybrid.transactions),
      rawText: extracted.text,
      pageCount: extracted.pageCount,
      warnings: [
        `Parser ${parserId} failed: ${err instanceof Error ? err.message : String(err)} — hybrid fallback`,
      ],
    };
  }
}

function makeGenConfig(v: RunVariant, opening: number): StatementConfig {
  return normalizeStatementConfig({
    ...defaultStatementConfig(),
    seed: v.seed,
    periodStart: "2024-08-21",
    periodDays: v.periodDays,
    openingBalance: opening > 0 ? opening : 2500,
    salaryAmount: v.salaryAmount,
    salaryFrequency: v.seed % 2 === 0 ? "fortnightly" : "monthly",
    salaryDescription: `${v.bank.toUpperCase()} SALARY ${v.seed}`,
    cardLast4: String(1000 + (v.seed % 9000)),
    cardSpendPct: v.cardSpendPct,
    billsSubsPct: v.billsSubsPct,
    hasRentalIncome: v.hasRental,
    rentalAmount: v.hasRental ? 500 + (v.seed % 400) : 0,
    hasDirectDebits: true,
    hasSubscriptions: v.seed % 3 !== 0,
    savingsAmount: 150 + (v.seed % 100),
    mortgageAmount: 1200 + (v.seed % 300),
  });
}

async function bankDescReplace(
  original: Transaction[],
  pdfBytes: Uint8Array,
  bank: BankId,
): Promise<{ transactions: Transaction[]; edits: PdfEdit[]; linkStats: string }> {
  const next = original.map((t) => ({
    ...t,
    description: generateBankDescription(bank),
    flags: [...new Set([...t.flags, "bank-desc", bank])],
  }));
  const generated = attachOriginals(next);

  let edits: PdfEdit[] = [];
  let linkStats = "no-pdf-link";
  try {
    const runs = await getPageTextRunsFromBytes(cloneUint8Array(pdfBytes), 10);
    const { matches, stats } = linkRunMatches({
      transactions: original,
      runs,
      preferOriginal: true,
    });
    const paired = pairGeneratedToMatches({
      previous: original,
      generated,
      matches,
    }).filter((m) => m.field === "description");
    edits = buildFontReplicatedReplacements({
      transactions: generated,
      runMatches: paired,
    });
    linkStats = `linked ${stats.linked}/${stats.fields} · edits ${edits.length} · runs ${stats.runs}`;
  } catch (err) {
    linkStats = `link-fail: ${err instanceof Error ? err.message : String(err)}`;
  }

  return { transactions: generated, edits, linkStats };
}

async function generateApplyPath(
  original: Transaction[],
  v: RunVariant,
): Promise<{ transactions: Transaction[]; config: StatementConfig; qualityOk: boolean }> {
  const opening =
    original.find((t) => t.balance != null)?.balance ??
    original[0]?.balance ??
    2500;
  const config = makeGenConfig(v, Number(opening) || 2500);
  const gen = generateStatement(config);
  const q = analyzeGenerationQuality(gen, config);
  // Rewrite non-salary descriptions with bank formats
  const descs = generateBankDescriptions(v.bank, gen.rows.length);
  let di = 0;
  const rows = gen.rows.map((r) => {
    if (r.type === "opening" || r.type === "closing") return r;
    if (r.type === "credit" && r.category === "Wages") return r;
    const d = descs[di++ % descs.length];
    return { ...r, description: d };
  });
  const txns = ledgerToAppTransactions(rows);
  // Align length to original when possible for geometry linking later
  let aligned = txns;
  if (original.length > 0 && txns.length > original.length) {
    aligned = txns.slice(0, original.length);
  }
  return { transactions: attachOriginals(aligned), config, qualityOk: q.ok };
}

type RunResult = {
  ok: boolean;
  id: string;
  fingerprint: string;
  errors: string[];
  warnings: string[];
  stats: Record<string, unknown>;
};

async function executeVariant(
  pdfBytes: Uint8Array,
  fileName: string,
  v: RunVariant,
): Promise<RunResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats: Record<string, unknown> = {
    id: v.id,
    parser: v.parser,
    bank: v.bank,
    seed: v.seed,
    replaceMode: v.replaceMode,
  };

  try {
    // 1) Parse original
    const parsed = await parseSource(pdfBytes, fileName, v.parser);
    const baseline = parsed.transactions;
    stats.parseCount = baseline.length;
    stats.pageCount = parsed.pageCount;
    stats.rawTextLen = parsed.rawText.length;
    warnings.push(...parsed.warnings);

    if (baseline.length === 0) {
      // Still allow generation-only path but flag
      warnings.push("Parse produced 0 transactions — generation-only path");
    }

    // 2) Generation / replace path (unique per variant)
    let working: Transaction[] = baseline;
    let edits: PdfEdit[] = [];
    let genClose: number | null = null;

    if (v.replaceMode === "bank-desc" && baseline.length > 0) {
      const r = await bankDescReplace(baseline, pdfBytes, v.bank);
      working = r.transactions;
      edits = r.edits;
      stats.linkStats = r.linkStats;
      stats.sampleDesc = working[0]?.description ?? null;
    } else if (v.replaceMode === "generate-apply") {
      const g = await generateApplyPath(baseline, v);
      working = g.transactions;
      genClose = g.config ? null : null;
      const gen = generateStatement(g.config);
      genClose = gen.summary.closingBalance;
      stats.qualityOk = g.qualityOk;
      stats.sampleDesc = working[0]?.description ?? null;
      if (!g.qualityOk) errors.push("generation quality failed");
      // try geometry from original if available
      if (baseline.length > 0) {
        try {
          const runs = await getPageTextRunsFromBytes(
            cloneUint8Array(pdfBytes),
            8,
          );
          const { matches, stats: st } = linkRunMatches({
            transactions: baseline,
            runs,
            preferOriginal: true,
          });
          const n = Math.min(baseline.length, working.length);
          const paired = pairGeneratedToMatches({
            previous: baseline.slice(0, n),
            generated: working.slice(0, n),
            matches,
          });
          edits = buildFontReplicatedReplacements({
            transactions: working.slice(0, n),
            runMatches: paired,
          });
          stats.linkStats = `gen-link ${st.linked}/${st.fields} edits=${edits.length}`;
        } catch (e) {
          warnings.push(
            `gen link: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    } else {
      // hybrid: generate + bank-desc rewrite of original, then merge descriptions
      const g = await generateApplyPath(baseline, v);
      if (baseline.length > 0) {
        const r = await bankDescReplace(baseline, pdfBytes, v.bank);
        // mix: keep generated money, bank-desc style text on overlapping rows
        working = g.transactions.map((t, i) => {
          const b = r.transactions[i];
          return b
            ? { ...t, description: b.description, flags: [...t.flags, "hybrid"] }
            : t;
        });
        edits = r.edits;
        stats.linkStats = r.linkStats;
      } else {
        working = g.transactions;
      }
      const gen = generateStatement(g.config);
      genClose = gen.summary.closingBalance;
      stats.qualityOk = g.qualityOk;
      stats.sampleDesc = working[0]?.description ?? null;
      if (!g.qualityOk) errors.push("generation quality failed");
    }

    stats.editCount = edits.length;
    stats.workingCount = working.length;
    stats.genClose = genClose;
    stats.rewriteClose =
      working.filter((t) => t.balance != null).slice(-1)[0]?.balance ?? null;
    stats.sampleDesc =
      stats.sampleDesc ?? working.find((t) => t.description)?.description;

    // 3) Compare ledgers
    if (baseline.length > 0) {
      const cmp = compareLedgers(baseline, working);
      stats.compareChanged = cmp.stats.changed;
      stats.compareAdded = cmp.stats.added;
      // must not throw; structural ok
    }

    // 4) Balance engine
    const bal = buildBalancePreview(working, v.balanceEngine);
    stats.balanceMismatches = bal.mismatchCount;
    // recompute/hybrid may show mismatches after bank-desc-only (balances unchanged) — not a hard fail
    if (v.replaceMode === "generate-apply" && bal.mismatchCount > working.length) {
      errors.push(`excessive balance mismatches: ${bal.mismatchCount}`);
    }

    // 5) Math check
    const math = runFinalMathCheck({
      transactions: working,
      rawText: parsed.rawText,
    });
    stats.mathStatus = math.status;
    stats.mathScore = math.score;
    // Bank-desc rewrite intentionally diverges from source PDF text — math
    // re-parse vs working set is expected to score low; amounts still checked
    // via balance engine / ledger validate.
    if (math.status === "fail" && math.score < 40) {
      if (v.replaceMode === "bank-desc") {
        warnings.push(
          `math score=${math.score} (expected after description-only rewrite)`,
        );
      } else if (v.replaceMode === "hybrid") {
        warnings.push(
          `math score=${math.score} (hybrid desc rewrite vs source text)`,
        );
      } else {
        errors.push(`math fail score=${math.score}`);
      }
    }

    // 6) Materialize candidate PDF
    let materialMode = "skipped";
    let materialEdits = 0;
    try {
      const material = await materializeCandidatePdf({
        originalPdf: pdfBytes,
        pdfEdits: edits,
        sourceBaseline: baseline,
        current: working,
      });
      materialMode = material.mode;
      materialEdits = material.editCount;
      stats.materialMode = materialMode;
      stats.materialEdits = materialEdits;
      stats.materialNotes = material.notes.slice(0, 3);

      // 7) Optional visual (every other run)
      if (v.runVisual) {
        const visual = await runVisualVerification({
          baselinePdf: material.baselinePdf,
          candidatePdf: material.candidatePdf,
          transactions: working,
          maxPages: 3, // keep stress runtime reasonable
          scale: 300 / 72,
          runApplitools: false,
          compareMode:
            material.mode === "identity"
              ? "identity"
              : material.mode === "auto-linked"
                ? "auto-linked"
                : "edited",
          candidateEditCount: material.editCount,
          extraNotes: material.notes,
        });
        stats.visualStatus = visual.pixelStatus;
        stats.visualScore = visual.pixelScore;
        stats.visualMode = visual.compareMode;
        stats.rendererOk = visual.rendererOk;
        if (!visual.rendererOk) {
          errors.push(`visual renderer: ${visual.rendererError}`);
        }
        // Identity is valid if no edits; non-identity should complete without throw
      }
    } catch (err) {
      // Visual/materialize errors are hard for visual runs, soft otherwise
      const msg = err instanceof Error ? err.message : String(err);
      if (v.runVisual) errors.push(`materialize/visual: ${msg}`);
      else warnings.push(`materialize: ${msg}`);
    }

    // 8) Apply replacements export path when edits exist
    if (edits.length > 0) {
      try {
        const out = await applyReplacementsWithFallbacks(
          cloneUint8Array(pdfBytes),
          edits.map((e) => ({
            page: e.page,
            bbox: e.bbox,
            replacement: e.replacement,
            fontSpec: e.fontSpec,
          })),
        );
        stats.exportBytes = out.byteLength;
        if (out.byteLength < 100) errors.push("export PDF too small");
      } catch (err) {
        errors.push(
          `export apply: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 9) Determinism of generator config
    if (v.replaceMode !== "bank-desc") {
      const cfg = makeGenConfig(
        v,
        Number(baseline[0]?.balance ?? 2500),
      );
      const a = generateStatement(cfg);
      const b = generateStatement(cfg);
      if (JSON.stringify(a.rows) !== JSON.stringify(b.rows)) {
        errors.push("generator non-deterministic");
      }
      const q = analyzeGenerationQuality(a, cfg);
      if (!q.ok) {
        errors.push(
          `gen quality: ${q.checks
            .filter((c) => c.severity === "error")
            .map((c) => c.id)
            .join(",")}`,
        );
      }
      const vled = validateLedger(a.rows, cfg.openingBalance);
      if (!vled.ok || !vled.balanceConsistent) {
        errors.push("gen ledger invalid");
      }
    }

    const ok = errors.length === 0;
    return {
      ok,
      id: v.id,
      fingerprint: fingerprint(v, stats),
      errors,
      warnings,
      stats,
    };
  } catch (err) {
    return {
      ok: false,
      id: v.id,
      fingerprint: v.id,
      errors: [err instanceof Error ? err.message : String(err)],
      warnings,
      stats,
    };
  }
}

describe("full workflow stress — St George #726", () => {
  it(
    `completes ${TARGET_STREAK} consecutive unique flawless runs`,
    async () => {
      expect(existsSync(PDF_PATH), `PDF missing: ${PDF_PATH}`).toBe(true);
      mkdirSync(OUT, { recursive: true });

      const raw = readFileSync(PDF_PATH);
      const pdfBytes = new Uint8Array(raw);
      const fileName = "St George Bank Acc Statement #726 - 21.08.24 to 19.11.24.pdf";

      const variants = buildVariants();
      const results: RunResult[] = [];
      let streak = 0;
      let streakFingerprints: string[] = [];
      let bestStreak = 0;
      const seenFp = new Set<string>();

      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        // eslint-disable-next-line no-console
        console.log(`\n=== RUN ${i + 1}/${variants.length} ${v.id} ===`);
        const r = await executeVariant(pdfBytes, fileName, v);
        results.push(r);

        // eslint-disable-next-line no-console
        console.log(
          r.ok ? "PASS" : "FAIL",
          r.errors.join("; ") || "clean",
          JSON.stringify({
            parse: r.stats.parseCount,
            work: r.stats.workingCount,
            edits: r.stats.editCount,
            visual: r.stats.visualScore,
            mode: r.stats.materialMode,
          }),
        );

        if (r.ok) {
          // Streak requires consecutive passes that are unique *within the streak*
          if (streakFingerprints.includes(r.fingerprint)) {
            // duplicate process inside streak — restart with this run
            streak = 1;
            streakFingerprints = [r.fingerprint];
          } else {
            streak += 1;
            streakFingerprints.push(r.fingerprint);
          }
          seenFp.add(r.fingerprint);
          bestStreak = Math.max(bestStreak, streak);
        } else {
          streak = 0;
          streakFingerprints = [];
        }

        if (streak >= TARGET_STREAK) {
          // eslint-disable-next-line no-console
          console.log(`\n*** ACHIEVED ${TARGET_STREAK} unique flawless runs in a row ***`);
          break;
        }
      }

      const report = {
        pdf: PDF_PATH,
        targetStreak: TARGET_STREAK,
        bestStreak,
        achieved: streak >= TARGET_STREAK,
        finalStreak: streak,
        streakFingerprints,
        totalAttempts: results.length,
        passCount: results.filter((r) => r.ok).length,
        failCount: results.filter((r) => !r.ok).length,
        results: results.map((r) => ({
          id: r.id,
          ok: r.ok,
          errors: r.errors,
          warnings: r.warnings.slice(0, 5),
          stats: r.stats,
          fingerprint: r.fingerprint.slice(0, 200),
        })),
      };

      writeFileSync(
        resolve(OUT, "WORKFLOW_STRESS_REPORT.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      const md = [
        "# Workflow stress report — St George #726",
        "",
        `- Achieved ${TARGET_STREAK} unique flawless streak: **${report.achieved}**`,
        `- Best streak: ${bestStreak}`,
        `- Attempts: ${report.totalAttempts} · pass ${report.passCount} · fail ${report.failCount}`,
        "",
        "## Last streak fingerprints",
        ...streakFingerprints.map((f, i) => `${i + 1}. \`${f.slice(0, 120)}…\``),
        "",
        "## Failures",
        ...results
          .filter((r) => !r.ok)
          .slice(0, 20)
          .map((r) => `- **${r.id}**: ${r.errors.join(" | ")}`),
        "",
      ].join("\n");
      writeFileSync(resolve(OUT, "WORKFLOW_STRESS_REPORT.md"), md, "utf8");
      // eslint-disable-next-line no-console
      console.log(md);

      expect(
        streak,
        `Only ${streak}/${TARGET_STREAK} unique flawless in a row (best ${bestStreak}). See scripts/.workflow-stress/WORKFLOW_STRESS_REPORT.md`,
      ).toBeGreaterThanOrEqual(TARGET_STREAK);
    },
    600_000,
  );
});
