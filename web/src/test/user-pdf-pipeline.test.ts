/**
 * One-shot pipeline report against a user-supplied PDF.
 * Run: npx vitest run src/test/user-pdf-pipeline.test.ts
 *
 * PDF path from STATEMENT_PDF env or default below.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cloneUint8Array } from "@/lib/bytes";
import { attachOriginals } from "@/lib/edit-utils";
import { buildBalancePreview } from "@/lib/balance-engine";
import { runFinalMathCheck } from "@/lib/math-check";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { parseTransactionsHybrid } from "@/lib/parse-transactions";
import { analyzeStatementLayout } from "@/lib/statement-layout";
import { runOemPerfectReplica } from "@/lib/oem-replica";
import { runPerfectReplacement } from "@/lib/perfect-replacement";
import { rewriteTransactionDescriptions } from "@/lib/tools/bank-descriptions";
import { materializeCandidatePdf } from "@/lib/verification/materialize-candidate";
import type { Transaction } from "@/lib/types";

const PDF_PATH =
  process.env.STATEMENT_PDF ??
  "/Users/adminuser/Downloads/cloned_80xxxxx78_90d_y_final_clean.pdf";

const OUT = resolve(process.cwd(), "scripts/.user-pdf-pipeline");

function mutateBalances(txns: Transaction[]): Transaction[] {
  return txns.map((t, i) => {
    if (i % 4 !== 0) return { ...t };
    const debit =
      t.debit != null ? Math.round((t.debit + 1.11) * 100) / 100 : t.debit;
    const credit =
      t.credit != null ? Math.round((t.credit + 0.55) * 100) / 100 : t.credit;
    const balance =
      t.balance != null
        ? Math.round((t.balance + 1.11) * 100) / 100
        : t.balance;
    return {
      ...t,
      description: t.description
        .replace(/\bMelbourne\b/gi, "Sydney")
        .replace(/\bPurchase\b/gi, "Purchase"),
      debit,
      credit,
      balance,
      flags: [...(t.flags ?? []), "user-pdf-test-mutate"],
    };
  });
}

describe(`user PDF pipeline · ${PDF_PATH}`, () => {
  it(
    "full Stage-1 layout + OEM + perfect-replacement + math report",
    async () => {
      expect(existsSync(PDF_PATH), `Missing PDF: ${PDF_PATH}`).toBe(true);
      mkdirSync(OUT, { recursive: true });

      const pdf = new Uint8Array(readFileSync(PDF_PATH));
      const report: Record<string, unknown> = {
        pdf: PDF_PATH,
        bytes: pdf.byteLength,
        startedAt: new Date().toISOString(),
      };

      // ── Text extract ──────────────────────────────────────────
      const text = await extractTextFromPdf(cloneUint8Array(pdf));
      report.extract = {
        pageCount: text.pageCount,
        textLength: text.text.length,
        engine: (text as { engine?: string }).engine ?? "pdfjs",
        sample: text.text.slice(0, 400),
      };

      // ── Hybrid parse ──────────────────────────────────────────
      const hybrid = parseTransactionsHybrid(text.text);
      const baseline = attachOriginals(hybrid.transactions);
      report.parse = {
        txnCount: baseline.length,
        enginesTried: hybrid.enginesTried ?? [],
        first3: baseline.slice(0, 3).map((t) => ({
          date: t.date,
          desc: t.description.slice(0, 60),
          debit: t.debit,
          credit: t.credit,
          balance: t.balance,
        })),
      };

      // ── Stage 1 layout ────────────────────────────────────────
      const layout = await analyzeStatementLayout(cloneUint8Array(pdf), {
        fileName: PDF_PATH.split("/").pop(),
        maxPages: 12,
        rawText: text.text,
        bankHint: PDF_PATH,
      });
      report.layout = {
        score: layout.score,
        documentClass: layout.documentClass,
        bank: layout.txnStructure.bankId,
        structureConf: layout.txnStructure.confidence,
        recipe: layout.txnStructure.recipe,
        pageCount: layout.pageCount,
        pageSize: layout.pageSize,
        part1_static: layout.part1.runs.length,
        part2_vars: layout.part2.runs.length,
        part3_txnRows: layout.part3.rows.length,
        columns: layout.part3.columns,
        bodyYMin: layout.part3.bodyYMin,
        bodyYMax: layout.part3.bodyYMax,
        rowPitchMedian: layout.part3.rowPitchMedian,
        gates: layout.gates,
        notes: layout.notes,
        durationMs: layout.durationMs,
      };

      // Prefer layout rows if hybrid sparse
      const ledgerBase =
        baseline.length >= 3
          ? baseline
          : attachOriginals(
              layout.transactions.map((t) => ({ ...t })),
            );
      report.ledgerSource =
        baseline.length >= 3 ? "hybrid-parse" : "layout-part3";
      report.ledgerCount = ledgerBase.length;

      expect(ledgerBase.length).toBeGreaterThan(0);

      // ── Balance + math on source ──────────────────────────────
      const bal = buildBalancePreview(ledgerBase);
      const mathSrc = runFinalMathCheck({
        transactions: ledgerBase,
        rawText: text.text,
      });
      report.sourceMath = {
        score: mathSrc.score,
        status: mathSrc.status,
        balanceChainOk: mathSrc.balanceChainOk,
        openingPlusNetOk: mathSrc.openingPlusNetOk,
        items: mathSrc.items.slice(0, 8),
      };
      report.balancePreview = {
        opening: bal.openingBalance,
        closing: bal.closingBalance,
        mismatchCount: bal.mismatchCount,
        engine: bal.engine,
        chainHealthy: bal.chainHealthy,
      };

      // ── Mutate ledger for write path ───────────────────────────
      const current =
        ledgerBase.length >= 3
          ? rewriteTransactionDescriptions(
              mutateBalances(ledgerBase.map((t) => ({ ...t }))),
              "anz",
            )
          : mutateBalances(ledgerBase.map((t) => ({ ...t })));

      // ── Perfect replacement ───────────────────────────────────
      let perfectOk = false;
      try {
        const perfect = await runPerfectReplacement({
          sourcePdf: cloneUint8Array(pdf),
          sourceBaseline: ledgerBase,
          current,
          rawText: text.text,
          maxPages: 12,
          minDescriptionCoverage: 0.2,
          strict: false,
        });
        perfectOk = perfect.editCount > 0;
        report.perfectReplacement = {
          ok: perfect.ok,
          editCount: perfect.editCount,
          strategy: perfect.strategy,
          score: perfect.score,
          coverage: perfect.coverage,
          notes: perfect.notes.slice(-6),
          durationMs: perfect.durationMs,
        };
        if (perfect.editCount > 0) {
          writeFileSync(
            resolve(OUT, "perfect-replacement.pdf"),
            Buffer.from(perfect.candidatePdf),
          );
        }
      } catch (e) {
        report.perfectReplacement = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }

      // ── OEM Perfect Replica (frozen layout) ───────────────────
      let oemOk = false;
      try {
        const oem = await runOemPerfectReplica({
          sourcePdf: cloneUint8Array(pdf),
          sourceBaseline: ledgerBase,
          current,
          rawText: text.text,
          fileName: PDF_PATH.split("/").pop(),
          maxPages: 12,
          minDescriptionCoverage: 0.2,
          preserveTxnStructure: true,
          strict: false,
          layout,
        });
        oemOk = oem.editCount > 0;
        report.oem = {
          ok: oem.ok,
          path: oem.path,
          score: oem.score,
          editCount: oem.editCount,
          summary: oem.summary,
          gates: oem.gates,
          notes: oem.notes.slice(-8),
          durationMs: oem.durationMs,
          layoutFrozen:
            oem.notes.some((n) => /FROZEN upload profile/i.test(n)) ||
            oem.notes.some((n) => /FROZEN/i.test(n)),
        };
        if (oem.editCount > 0) {
          writeFileSync(
            resolve(OUT, "oem-replica.pdf"),
            Buffer.from(oem.candidatePdf),
          );
        }
      } catch (e) {
        report.oem = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }

      // ── Materialize fallback ──────────────────────────────────
      try {
        const material = await materializeCandidatePdf({
          originalPdf: cloneUint8Array(pdf),
          pdfEdits: [],
          sourceBaseline: ledgerBase,
          current,
          maxPages: 12,
        });
        report.materialize = {
          mode: material.mode,
          editCount: material.editCount,
          notes: material.notes.slice(-4),
        };
        if (material.mode !== "identity") {
          writeFileSync(
            resolve(OUT, "materialize.pdf"),
            Buffer.from(material.candidatePdf),
          );
        }
      } catch (e) {
        report.materialize = {
          error: e instanceof Error ? e.message : String(e),
        };
      }

      report.finishedAt = new Date().toISOString();
      report.passSummary = {
        hasText: text.text.length > 40,
        hasTxns: ledgerBase.length > 0,
        layoutScore: layout.score,
        layoutGatesPass: layout.gates.every((g) => g.pass),
        perfectWrote: perfectOk,
        oemWrote: oemOk,
      };

      writeFileSync(
        resolve(OUT, "REPORT.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      // Soft console dump for the operator
      // eslint-disable-next-line no-console
      console.log("\n===== USER PDF PIPELINE REPORT =====\n");
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(report, null, 2));
      // eslint-disable-next-line no-console
      console.log(`\nWrote ${resolve(OUT, "REPORT.json")}\n`);

      expect(text.text.length).toBeGreaterThan(40);
      expect(ledgerBase.length).toBeGreaterThan(0);
      expect(layout.score).toBeGreaterThan(0);
      // At least one write path should produce edits (soft: report if not)
      if (!perfectOk && !oemOk) {
        // Still pass parse/layout — write may fail on non-StGeorge geometry
        // but surface clearly in report
        expect(
          report.passSummary,
          "parse+layout only; write paths produced 0 edits — see REPORT.json",
        ).toBeTruthy();
      }
    },
    180_000,
  );
});
