import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  analyzeStatementLayout,
  formatDescriptionToStructure,
  summarizeLayoutAnalysis,
  buildTxnStructureProfile,
  measureStructureSignals,
  type TransactionTableRow,
} from "@/lib/statement-layout";

const FINAL =
  "/Users/adminuser/Downloads/1132%20(2)/698/St George Bank Acc Statement #726 - 21.08.24 to 19.11.24.pdf";
const BASE =
  "/Users/adminuser/Desktop/St George Bank TEMPLATE 2- 21.08.24 to 19.11.24.pdf";
const OUT = resolve(__dirname, "../../docs/st-george-layer-analysis/out");

describe("three-part layout analysis + txn structure", () => {
  it("measures structure signals for multi-line + embedded dates", () => {
    const rows: TransactionTableRow[] = [
      {
        index: 0,
        page: 1,
        y: 100,
        dateRaw: "18 Nov",
        dateIso: "2024-11-18",
        description: "Visa Purchase 14Nov Oz Lotteries Melbourne",
        primaryLine: "Visa Purchase 14Nov",
        secondaryLines: ["Oz Lotteries Melbourne"],
        referenceLines: [],
        debit: 99.3,
        credit: null,
        amount: -99.3,
        balance: 64474.33,
        runs: [],
        structureTags: ["multi-line", "embedded-date"],
      },
      {
        index: 1,
        page: 1,
        y: 136,
        dateRaw: "14 Nov",
        dateIso: "2024-11-14",
        description: "Clough Projects 014164000000000000",
        primaryLine: "Clough Projects",
        secondaryLines: [],
        referenceLines: ["014164000000000000"],
        debit: null,
        credit: 1000,
        amount: 1000,
        balance: 2423.63,
        runs: [],
        structureTags: ["has-reference"],
      },
    ];
    const s = measureStructureSignals(rows);
    expect(s.multiLineRate).toBeGreaterThan(0.4);
    expect(s.embedDateRate).toBeGreaterThan(0.4);
    expect(s.refRate).toBeGreaterThan(0.4);

    const profile = buildTxnStructureProfile({
      rows,
      rawText: "St.George Bank Complete Freedom",
    });
    expect(profile.bankId).toBe("st-george");
    expect(profile.multiLineDescription).toBe(true);

    const fmt = formatDescriptionToStructure(
      profile,
      "Visa Purchase Coffee Shop Melbourne CBD 14Nov",
    );
    expect(fmt.primary.length).toBeGreaterThan(3);
  });

  it(
    "maps FINAL #726 into three parts with structure profile",
    async () => {
      if (!existsSync(FINAL)) {
        console.warn("skip: final pdf missing");
        return;
      }
      const bytes = new Uint8Array(readFileSync(FINAL));
      const analysis = await analyzeStatementLayout(bytes, {
        fileName: "St George #726.pdf",
        bankHint: "st george",
        maxPages: 3,
      });

      const summary = summarizeLayoutAnalysis(analysis);
      mkdirSync(OUT, { recursive: true });
      writeFileSync(
        resolve(OUT, "layout-analysis-726.json"),
        JSON.stringify(summary, null, 2),
      );

      console.log(
        "LAYOUT726",
        analysis.score,
        "static",
        analysis.part1.runs.length,
        "vars",
        analysis.part2.runs.length,
        "txnRows",
        analysis.part3.rows.length,
        analysis.txnStructure.bankId,
        analysis.txnStructure.descriptionPatterns.slice(0, 6),
      );

      expect(analysis.kind).toBe("statement-layout.three-part");
      expect(analysis.part1.runs.length).toBeGreaterThan(5);
      // Must find a real transaction table
      expect(analysis.part3.rows.length).toBeGreaterThan(10);
      expect(analysis.txnStructure.bankId).toBe("st-george");
      expect(analysis.txnStructure.multiLineDescription).toBe(true);
      expect(analysis.score).toBeGreaterThanOrEqual(60);

      // Structure samples should look St George-ish
      const sample = analysis.txnStructure.samplePrimaries.join(" ");
      expect(
        /visa|osko|eftpos|interbank|sct|deposit|purchase/i.test(sample) ||
          analysis.part3.rows.some((r) =>
            /visa|osko|eftpos/i.test(r.description),
          ),
      ).toBe(true);
    },
    60_000,
  );

  it(
    "maps TEMPLATE 2 base as shell (static heavy, few/no txn rows)",
    async () => {
      if (!existsSync(BASE)) {
        console.warn("skip: base missing");
        return;
      }
      const bytes = new Uint8Array(readFileSync(BASE));
      const analysis = await analyzeStatementLayout(bytes, {
        fileName: "TEMPLATE 2 base.pdf",
        bankHint: "st george",
      });
      console.log(
        "LAYOUT_BASE",
        analysis.documentClass,
        "static",
        analysis.part1.runs.length,
        "vars",
        analysis.part2.runs.length,
        "txns",
        analysis.part3.rows.length,
      );
      expect(analysis.part1.runs.length).toBeGreaterThan(5);
      // Empty table shell
      expect(analysis.part3.rows.length).toBeLessThan(5);
      expect(
        analysis.documentClass === "base-shell" ||
          analysis.documentClass === "token-template" ||
          analysis.documentClass === "unknown" ||
          analysis.part1.labels.length > 0,
      ).toBe(true);
    },
    30_000,
  );
});
