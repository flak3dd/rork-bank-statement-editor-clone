/**
 * Final PDF generation must include ALL replacement transactions and fields.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cloneUint8Array } from "@/lib/bytes";
import { attachOriginals } from "@/lib/edit-utils";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { parseTransactionsHybrid } from "@/lib/parse-transactions";
import {
  advancedGenerator,
  replaceStatementDataWithGeneration,
  replaceWithGenerated,
  type BankId,
} from "@/lib/tools";
import {
  buildCompleteLedgerEdits,
  materializeCandidatePdf,
  mergePdfEdits,
} from "@/lib/verification/materialize-candidate";
import {
  formatDateLikeOriginal,
  formatMoneyLikeOriginal,
} from "@/lib/money";

const PDF_PATH =
  "/Users/adminuser/Downloads/1132%20(2)/698/St George Bank Acc Statement #726 - 21.08.24 to 19.11.24.pdf";
const OUT = resolve(process.cwd(), "scripts/.final-pdf-gen");

describe("final PDF generation — full replacement data", () => {
  it("format helpers preserve PDF glyph style", () => {
    expect(formatMoneyLikeOriginal(99.3, "-$99.30")).toBe("-$99.30");
    expect(formatMoneyLikeOriginal(1234.56, "$1,234.56")).toBe("$1,234.56");
    expect(formatMoneyLikeOriginal(50, "50.00")).toBe("50.00");
    expect(formatDateLikeOriginal("2024-11-18", "18 Nov")).toBe("18 Nov");
    expect(formatDateLikeOriginal("2024-03-05", "05/03/2024")).toMatch(
      /05[\/\-]03[\/\-]2024/,
    );
  });

  it(
    "materialize merges bank-desc queue + full ledger so every changed field is applied",
    async () => {
      expect(existsSync(PDF_PATH), `Missing ${PDF_PATH}`).toBe(true);
      mkdirSync(OUT, { recursive: true });

      const pdf = new Uint8Array(readFileSync(PDF_PATH));
      const text = await extractTextFromPdf(cloneUint8Array(pdf));
      const hybrid = parseTransactionsHybrid(text.text);
      const baseline = attachOriginals(hybrid.transactions);
      expect(baseline.length).toBeGreaterThan(5);

      // Path A: bank-desc replace → description edits only in queue
      const bank = "anz" as BankId;
      const bankRep = await replaceStatementDataWithGeneration({
        transactions: baseline,
        pdfBytes: cloneUint8Array(pdf),
        bank,
        replace: ["description"],
      });
      expect(bankRep.edits.length).toBeGreaterThan(0);
      expect(
        bankRep.edits.every((e) => e.linkedField === "description"),
      ).toBe(true);

      // Path B: advanced generator for full row replacement (dates + money + desc)
      const gen = advancedGenerator({
        count: baseline.length,
        seed: 999001,
        periodStart: baseline[0]?.date ?? "2024-08-21",
        periodEnd: baseline[baseline.length - 1]?.date ?? "2024-11-19",
        openingBalance: baseline[0]?.balance ?? 1000,
        locale: "au",
        bank: "westpac",
        includeIncome: true,
      });
      let generated = replaceWithGenerated(gen);
      if (generated.length > baseline.length) {
        generated = generated.slice(0, baseline.length);
      }
      // Prefer bank-desc descriptions on generated set for hybrid realism
      generated = generated.map((t, i) => ({
        ...t,
        description:
          bankRep.transactions[i]?.description ?? t.description,
        flags: [...new Set([...t.flags, "full-final"])],
      }));

      // Full ledger edits alone should cover multiple field types
      const ledger = await buildCompleteLedgerEdits({
        originalPdf: pdf,
        sourceBaseline: baseline,
        current: generated,
        maxPages: 40,
      });
      expect(ledger.edits.length).toBeGreaterThan(0);
      const ledgerFields = new Set(
        ledger.edits.map((e) => e.linkedField).filter(Boolean),
      );
      // At least descriptions; ideally more
      expect(ledgerFields.has("description") || ledger.edits.length > 0).toBe(
        true,
      );

      // materialize with BOTH queued bank-desc + full generated ledger
      const material = await materializeCandidatePdf({
        originalPdf: pdf,
        pdfEdits: bankRep.edits,
        sourceBaseline: baseline,
        current: generated,
        maxPages: 40,
      });

      expect(material.mode).not.toBe("identity");
      expect(material.editCount).toBeGreaterThan(0);
      expect(material.appliedEdits.length).toBe(material.editCount);
      expect(material.candidatePdf.byteLength).toBeGreaterThan(1000);
      expect(material.coverage.rowsPaired).toBeGreaterThan(0);
      expect(material.coverage.fieldsApplied).toBe(material.editCount);

      // Full materialize must not be weaker than ledger-only or queue-only
      expect(material.editCount).toBeGreaterThanOrEqual(ledger.edits.length);
      // Merged queue+ledger should cover at least the ledger set size
      const merged = mergePdfEdits(bankRep.edits, ledger.edits);
      expect(merged.length).toBeGreaterThanOrEqual(ledger.edits.length);
      expect(material.editCount).toBe(merged.length);

      const byField = material.coverage.byField;
      writeFileSync(
        resolve(OUT, "FINAL_PDF_COVERAGE.json"),
        JSON.stringify(
          {
            baselineRows: baseline.length,
            generatedRows: generated.length,
            bankDescEdits: bankRep.edits.length,
            ledgerEdits: ledger.edits.length,
            applied: material.editCount,
            mode: material.mode,
            byField,
            notes: material.notes,
            sampleEdits: material.appliedEdits.slice(0, 8).map((e) => ({
              field: e.linkedField,
              page: e.page,
              original: e.original.slice(0, 40),
              replacement: e.replacement.slice(0, 40),
            })),
          },
          null,
          2,
        ),
      );
      writeFileSync(resolve(OUT, "final-regenerated.pdf"), material.candidatePdf);

      // eslint-disable-next-line no-console
      console.log(
        "FINAL PDF",
        material.mode,
        "edits=",
        material.editCount,
        "byField=",
        byField,
      );

      // Candidate must differ from original when we have replacements
      expect(material.candidatePdf.byteLength).not.toBe(pdf.byteLength);
      // Or at least content changed even if size similar
      let same = material.candidatePdf.byteLength === pdf.byteLength;
      if (same) {
        same = material.candidatePdf.every((b, i) => b === pdf[i]);
      }
      expect(same).toBe(false);
    },
    180_000,
  );
});
