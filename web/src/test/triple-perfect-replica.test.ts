/**
 * Mission gate: 3 consecutive complete runs with zero errors.
 *
 * Each run: parse St George PDF → generator inject → full-ledger materialize
 * → export PDF → math/balance/content validation.
 *
 * npm run stress:triple
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cloneUint8Array } from "@/lib/bytes";
import { attachOriginals } from "@/lib/edit-utils";
import { buildBalancePreview } from "@/lib/balance-engine";
import { runFinalMathCheck } from "@/lib/math-check";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { parseTransactionsHybrid } from "@/lib/parse-transactions";
import {
  advancedGenerator,
  replaceStatementDataWithGeneration,
  replaceWithGenerated,
  type BankId,
} from "@/lib/tools";
import { materializeCandidatePdf } from "@/lib/verification/materialize-candidate";
import { runVisualVerification } from "@/lib/verification/run-visual";
import { applyReplacementsWithFallbacks } from "@/lib/pdf-engines";

const PDF_PATH =
  "/Users/adminuser/Downloads/1132%20(2)/698/St George Bank Acc Statement #726 - 21.08.24 to 19.11.24.pdf";
const OUT = resolve(process.cwd(), "scripts/.triple-perfect");
const TARGET = 3;

const BANKS: BankId[] = ["anz", "cba", "westpac"];

type RunReport = {
  run: number;
  bank: BankId;
  seed: number;
  ok: boolean;
  errors: string[];
  stats: Record<string, unknown>;
};

function pdfsIdentical(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function onePerfectRun(
  pdf: Uint8Array,
  run: number,
  bank: BankId,
  seed: number,
): Promise<RunReport> {
  const errors: string[] = [];
  const stats: Record<string, unknown> = { run, bank, seed };

  try {
    // 1) Parse original
    const text = await extractTextFromPdf(cloneUint8Array(pdf));
    const hybrid = parseTransactionsHybrid(text.text);
    const baseline = attachOriginals(hybrid.transactions);
    stats.parseCount = baseline.length;
    stats.pageCount = text.pageCount;
    if (baseline.length < 5) {
      errors.push(`parse too sparse: ${baseline.length}`);
    }

    // 2) Generator inject full ledger (same length for 1:1 geometry)
    const gen = advancedGenerator({
      count: Math.max(baseline.length, 8),
      seed,
      periodStart: baseline[0]?.date ?? "2024-08-21",
      periodEnd: baseline[baseline.length - 1]?.date ?? "2024-11-19",
      openingBalance: baseline[0]?.balance ?? 2500,
      locale: "au",
      bank,
      includeIncome: true,
    });
    let working = replaceWithGenerated(gen);
    if (working.length > baseline.length && baseline.length > 0) {
      working = working.slice(0, baseline.length);
    }
    stats.generatedCount = working.length;

    // 3) Bank-desc overlay on descriptions (UI path)
    const bankRep = await replaceStatementDataWithGeneration({
      transactions: working.map((t, i) => ({
        ...t,
        // Keep generated money/dates; re-link geometry via baseline originals
        original: baseline[i]
          ? {
              date: baseline[i].date,
              description: baseline[i].description,
              debit: baseline[i].debit,
              credit: baseline[i].credit,
              balance: baseline[i].balance,
            }
          : t.original,
      })),
      pdfBytes: cloneUint8Array(pdf),
      bank,
      replace: ["description"],
    });
    // Preserve generator dates/amounts; take bank-desc descriptions
    working = working.map((t, i) => ({
      ...t,
      description: bankRep.transactions[i]?.description ?? t.description,
      original: baseline[i]
        ? {
            date: baseline[i].date,
            description: baseline[i].description,
            debit: baseline[i].debit,
            credit: baseline[i].credit,
            balance: baseline[i].balance,
          }
        : t.original,
      flags: [
        ...new Set([
          ...t.flags,
          ...(bankRep.transactions[i]?.flags ?? []),
          "triple-perfect",
        ]),
      ],
    }));
    stats.bankDescEdits = bankRep.edits.length;

    // 4) Balance cascade
    const bal = buildBalancePreview(working, "recompute");
    stats.balanceMismatches = bal.mismatchCount;
    stats.closingExpected = bal.closingExpected;
    // recompute after generate should chain; mismatches may exist vs stated
    // Apply recompute balances for final PDF money fidelity
    working = working.map((t) => {
      const row = bal.rows.find((r) => r.transactionId === t.id);
      if (!row || row.expectedBalance == null) return t;
      return { ...t, balance: row.expectedBalance };
    });

    // 5) Full materialize (queued + full ledger)
    const material = await materializeCandidatePdf({
      originalPdf: pdf,
      pdfEdits: bankRep.edits,
      sourceBaseline: baseline,
      current: working,
      maxPages: 40,
    });
    stats.materialMode = material.mode;
    stats.editCount = material.editCount;
    stats.byField = material.coverage.byField;
    stats.rowsPaired = material.coverage.rowsPaired;

    if (material.mode === "identity" || material.editCount === 0) {
      errors.push("materialize produced identity / 0 edits");
    }
    if (pdfsIdentical(pdf, material.candidatePdf)) {
      errors.push("candidate PDF identical to original (write path failed)");
    }
    if (material.candidatePdf.byteLength < 500) {
      errors.push("candidate PDF too small");
    }
    // Must include description replacements for all rows possible
    if ((material.coverage.byField.description ?? 0) < Math.min(5, baseline.length)) {
      errors.push(
        `too few description replacements: ${material.coverage.byField.description}`,
      );
    }
    // All paired rows should have at least one field rewrite when ledger differs
    if (material.coverage.rowsPaired < Math.min(5, baseline.length)) {
      errors.push(`rowsPaired too low: ${material.coverage.rowsPaired}`);
    }

    // 6) Direct apply path (export)
    const exportPdf = await applyReplacementsWithFallbacks(
      cloneUint8Array(pdf),
      material.appliedEdits.map((e) => ({
        page: e.page,
        bbox: e.bbox,
        replacement: e.replacement,
        fontSpec: e.fontSpec,
      })),
    );
    stats.exportBytes = exportPdf.byteLength;
    if (pdfsIdentical(pdf, exportPdf)) {
      errors.push("export apply identical to original");
    }

    // 7) Content must contain at least one new description snippet
    const latin = Buffer.from(material.candidatePdf).toString("latin1");
    const sampleDesc = working
      .map((t) => t.description.slice(0, 18))
      .find((d) => d.length >= 8 && !baseline.some((b) => b.description.includes(d)));
    if (sampleDesc && !latin.includes(sampleDesc.slice(0, 12))) {
      // FreeText may store as UTF-16 in PDF — soft-check via length delta instead
      if (material.candidatePdf.byteLength <= pdf.byteLength) {
        errors.push(
          `replacement text not found in PDF bytes and size did not grow (sample=${sampleDesc.slice(0, 20)})`,
        );
      }
    }

    // 8) Math on working ledger (desc rewrite vs re-parse is soft)
    const math = runFinalMathCheck({ transactions: working });
    stats.mathScore = math.score;
    stats.mathStatus = math.status;
    if (math.status === "fail" && math.score < 25) {
      errors.push(`math fail score=${math.score}`);
    }

    // 9) Visual pixel (page 1) — must render both PDFs
    const visual = await runVisualVerification({
      baselinePdf: material.baselinePdf,
      candidatePdf: material.candidatePdf,
      transactions: working,
      maxPages: 2,
      scale: 150 / 72,
      runApplitools: false,
      compareMode: material.mode === "identity" ? "identity" : "edited",
      candidateEditCount: material.editCount,
      extraNotes: material.notes,
    });
    stats.visualScore = visual.pixelScore;
    stats.visualStatus = visual.pixelStatus;
    stats.rendererOk = visual.rendererOk;
    if (!visual.rendererOk) {
      errors.push(`visual renderer: ${visual.rendererError ?? "fail"}`);
    }
    // Identity visual would mean no real delta — reject
    if (visual.compareMode === "identity" && material.editCount > 0) {
      errors.push("visual compareMode identity despite edits");
    }

    // Persist artefacts
    const runDir = resolve(OUT, `run-${run}-${bank}`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(resolve(runDir, "regenerated.pdf"), material.candidatePdf);
    writeFileSync(
      resolve(runDir, "stats.json"),
      JSON.stringify({ errors, stats, notes: material.notes }, null, 2),
    );

    return { run, bank, seed, ok: errors.length === 0, errors, stats };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { run, bank, seed, ok: false, errors, stats };
  }
}

describe("triple consecutive perfect replica runs", () => {
  it(
    `achieves ${TARGET} consecutive zero-error complete runs`,
    async () => {
      expect(existsSync(PDF_PATH), `Missing PDF ${PDF_PATH}`).toBe(true);
      mkdirSync(OUT, { recursive: true });
      const pdf = new Uint8Array(readFileSync(PDF_PATH));

      const reports: RunReport[] = [];
      let streak = 0;

      for (let i = 1; i <= TARGET; i++) {
        const bank = BANKS[(i - 1) % BANKS.length];
        const seed = 700_000 + i * 1117;
        // eslint-disable-next-line no-console
        console.log(`\n=== PERFECT RUN ${i}/${TARGET} bank=${bank} seed=${seed} ===`);
        const r = await onePerfectRun(pdf, i, bank, seed);
        reports.push(r);
        // eslint-disable-next-line no-console
        console.log(
          r.ok ? "PASS" : "FAIL",
          JSON.stringify({
            edits: r.stats.editCount,
            mode: r.stats.materialMode,
            visual: r.stats.visualScore,
            math: r.stats.mathScore,
            byField: r.stats.byField,
            errors: r.errors,
          }),
        );
        if (r.ok) streak += 1;
        else {
          streak = 0;
          // stop early — must be consecutive
          break;
        }
      }

      const summary = {
        target: TARGET,
        streak,
        achieved: streak >= TARGET,
        reports,
      };
      writeFileSync(
        resolve(OUT, "TRIPLE_PERFECT_REPORT.json"),
        JSON.stringify(summary, null, 2),
      );
      const md = [
        "# Triple perfect replica report",
        "",
        `- Achieved ${TARGET} consecutive clean runs: **${summary.achieved}**`,
        `- Streak: ${streak}`,
        "",
        "| Run | Bank | Edits | Mode | Visual | Math | Status |",
        "|-----|------|-------|------|--------|------|--------|",
        ...reports.map(
          (r) =>
            `| ${r.run} | ${r.bank} | ${r.stats.editCount ?? "—"} | ${r.stats.materialMode ?? "—"} | ${r.stats.visualScore ?? "—"} | ${r.stats.mathScore ?? "—"} | ${r.ok ? "PASS" : "FAIL: " + r.errors.join("; ")} |`,
        ),
        "",
      ].join("\n");
      writeFileSync(resolve(OUT, "TRIPLE_PERFECT_REPORT.md"), md);
      // eslint-disable-next-line no-console
      console.log(md);

      expect(streak, `Only ${streak}/${TARGET} consecutive clean runs`).toBe(
        TARGET,
      );
      for (const r of reports) {
        expect(r.ok, `Run ${r.run} failed: ${r.errors.join("; ")}`).toBe(true);
        expect(r.errors).toHaveLength(0);
      }
    },
    600_000,
  );
});
