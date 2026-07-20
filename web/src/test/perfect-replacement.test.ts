/**
 * Perfect Replacement Pipeline — multi-strategy bulletproof replace.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cloneUint8Array } from "@/lib/bytes";
import { attachOriginals } from "@/lib/edit-utils";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { parseTransactionsHybrid } from "@/lib/parse-transactions";
import {
  classifyDocument,
  runPerfectReplacement,
} from "@/lib/perfect-replacement";
import { rewriteTransactionDescriptions } from "@/lib/tools/bank-descriptions";

const REAL =
  "/Users/adminuser/Downloads/1132%20(2)/698/St George Bank Acc Statement #726 - 21.08.24 to 19.11.24.pdf";
const TPL =
  "/Users/adminuser/Desktop/St George Bank TEMPLATE- 21.08.24 to 19.11.24.pdf";
const OUT = resolve(process.cwd(), "scripts/.perfect-replacement");

describe("perfect replacement pipeline", () => {
  it("classifies template vs filled statement", async () => {
    const tpl = await extractTextFromPdf(
      cloneUint8Array(new Uint8Array(readFileSync(TPL))),
    );
    const real = await extractTextFromPdf(
      cloneUint8Array(new Uint8Array(readFileSync(REAL))),
    );
    expect(classifyDocument(tpl.text)).toBe("token-template");
    expect(classifyDocument(real.text)).toBe("filled-statement");
  });

  it(
    "replaces descriptions on filled #726 with high coverage (auto workflow)",
    async () => {
      expect(existsSync(REAL)).toBe(true);
      mkdirSync(OUT, { recursive: true });
      const pdf = new Uint8Array(readFileSync(REAL));
      const text = await extractTextFromPdf(cloneUint8Array(pdf));
      const baseline = attachOriginals(
        parseTransactionsHybrid(text.text).transactions,
      );
      expect(baseline.length).toBeGreaterThan(5);

      const current = rewriteTransactionDescriptions(
        baseline.map((t) => ({ ...t })),
        "anz",
      );

      const result = await runPerfectReplacement({
        sourcePdf: pdf,
        sourceBaseline: baseline,
        current,
        rawText: text.text,
        maxPages: 40,
        minDescriptionCoverage: 0.35,
        strict: false,
      });

      writeFileSync(resolve(OUT, "filled-statement-replaced.pdf"), result.candidatePdf);
      writeFileSync(
        resolve(OUT, "filled-report.json"),
        JSON.stringify(
          {
            ok: result.ok,
            score: result.score,
            strategy: result.strategy,
            documentClass: result.documentClass,
            editCount: result.editCount,
            coverage: result.coverage,
            gates: result.gates,
            strategiesTried: result.strategiesTried,
            notes: result.notes,
            durationMs: result.durationMs,
          },
          null,
          2,
        ),
      );

      // eslint-disable-next-line no-console
      console.log(
        "PERFECT filled",
        result.score,
        result.editCount,
        result.coverage.description,
        result.ok,
      );

      expect(result.documentClass).toBe("filled-statement");
      expect(result.editCount).toBeGreaterThan(0);
      expect(result.candidatePdf.byteLength).toBeGreaterThan(1000);
      expect(result.strategiesTried).toContain("geometry-link");
      expect(result.strategiesTried).toContain("hybrid-merge");
      // description coverage gate soft
      expect(result.coverage.description.applied).toBeGreaterThan(0);
    },
    180_000,
  );

  it(
    "fills token template with variables + sample ledger",
    async () => {
      expect(existsSync(TPL)).toBe(true);
      mkdirSync(OUT, { recursive: true });
      const templatePdf = new Uint8Array(readFileSync(TPL));
      const real = new Uint8Array(readFileSync(REAL));
      const text = await extractTextFromPdf(cloneUint8Array(real));
      const txns = attachOriginals(
        parseTransactionsHybrid(text.text).transactions,
      );

      const result = await runPerfectReplacement({
        sourcePdf: templatePdf,
        sourceBaseline: [],
        current: txns,
        variables: {
          holderName: "TEST HOLDER",
          addressLine1: "1 TEST ST",
          addressLine2: "SYDNEY NSW 2000",
          bsb: "062-000",
          accountNumber: "1234 5678",
        },
        maxPages: 8,
        strict: false,
      });

      writeFileSync(resolve(OUT, "template-filled.pdf"), result.candidatePdf);
      // eslint-disable-next-line no-console
      console.log(
        "PERFECT template",
        result.documentClass,
        result.editCount,
        result.score,
      );

      expect(result.documentClass).toBe("token-template");
      expect(result.editCount).toBeGreaterThan(5);
      expect(result.strategiesTried).toContain("template-tokens");
    },
    120_000,
  );
});
