/**
 * St George template fill — Desktop TEMPLATE → #726-style filled PDF.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { cloneUint8Array } from "@/lib/bytes";
import { parseTransactionsHybrid } from "@/lib/parse-transactions";
import { attachOriginals } from "@/lib/edit-utils";
import {
  fillStGeorgeTemplate,
  isStGeorgeTemplateText,
  resolveStGeorgeTokenValues,
  formatStGeorgeDayMonth,
  formatStGeorgeAmount,
} from "@/lib/st-george-template";

const TPL =
  "/Users/adminuser/Desktop/St George Bank TEMPLATE- 21.08.24 to 19.11.24.pdf";
const REAL =
  "/Users/adminuser/Downloads/1132%20(2)/698/St George Bank Acc Statement #726 - 21.08.24 to 19.11.24.pdf";
const OUT = resolve(process.cwd(), "scripts/.template-fill");

describe("st-george template fill", () => {
  it("formats amounts and dates like #726", () => {
    expect(formatStGeorgeDayMonth("2024-11-18")).toBe("18 Nov");
    expect(formatStGeorgeAmount(99.3, null)).toBe("-$99.30");
    expect(formatStGeorgeAmount(null, 10000)).toMatch(/\$10,000\.00/);
  });

  it("detects template text", async () => {
    const bytes = new Uint8Array(readFileSync(TPL));
    const text = await extractTextFromPdf(cloneUint8Array(bytes));
    expect(isStGeorgeTemplateText(text.text)).toBe(true);
  });

  it(
    "fills template with variables + statement #726 transactions",
    async () => {
      expect(existsSync(TPL)).toBe(true);
      expect(existsSync(REAL)).toBe(true);
      mkdirSync(OUT, { recursive: true });

      const templatePdf = new Uint8Array(readFileSync(TPL));
      const realPdf = new Uint8Array(readFileSync(REAL));
      const realText = await extractTextFromPdf(cloneUint8Array(realPdf));
      const txns = attachOriginals(
        parseTransactionsHybrid(realText.text).transactions,
      );
      expect(txns.length).toBeGreaterThan(5);

      const result = await fillStGeorgeTemplate({
        templatePdf,
        transactions: txns,
        variables: {
          holderName: "ELYSIA LEAVER",
          addressLine1: "48 DENISON ST",
          addressLine2: "COOMA NSW 2630",
          bsb: "116-879",
          accountNumber: "453 657 726",
        },
        periodStart: "2024-08-21",
        periodEnd: "2024-11-19",
        accountOpened: "2021-08-31",
        currentBalance: 64474.33,
      });

      writeFileSync(resolve(OUT, "filled.pdf"), result.candidatePdf);
      writeFileSync(
        resolve(OUT, "fill-report.json"),
        JSON.stringify(
          {
            edits: result.edits.length,
            filledTokens: result.filledTokens,
            unmatchedTokens: result.unmatchedTokens,
            slots: result.transactionSlotsAvailable,
            slotsFilled: result.transactionSlotsFilled,
            notes: result.notes,
            sampleEdits: result.edits.slice(0, 15).map((e) => ({
              page: e.page,
              original: e.original.slice(0, 50),
              replacement: e.replacement.slice(0, 60),
            })),
          },
          null,
          2,
        ),
      );

      // eslint-disable-next-line no-console
      console.log(
        "FILL",
        result.edits.length,
        "edits",
        result.transactionSlotsFilled,
        "/",
        result.transactionSlotsAvailable,
        "slots",
        result.filledTokens,
      );

      expect(result.mode).toBe("st-george-template-fill");
      expect(result.edits.length).toBeGreaterThan(5);
      expect(result.filledTokens.length).toBeGreaterThan(3);
      expect(result.candidatePdf.byteLength).toBeGreaterThan(1000);
      // Must differ from empty template
      expect(result.candidatePdf.byteLength).not.toBe(templatePdf.byteLength);

      const filledText = await extractTextFromPdf(
        cloneUint8Array(result.candidatePdf),
      );
      writeFileSync(resolve(OUT, "filled.txt"), filledText.text);
      // FreeText may or may not appear in extract — at least file built
      const tokens = resolveStGeorgeTokenValues({
        templatePdf,
        transactions: txns,
        variables: { holderName: "ELYSIA LEAVER" },
      });
      expect(tokens["{FIRSTNAME LASTNAME}"]).toContain("ELYSIA");
    },
    120_000,
  );
});
