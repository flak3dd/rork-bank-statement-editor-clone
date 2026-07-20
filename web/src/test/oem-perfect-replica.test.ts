/**
 * OEM Perfect Replica — end-to-end on real St George fixtures.
 *
 * Asserts the combined method:
 *   three-part layout + structure fidelity + perfect replacement write
 * produces a non-identity PDF with OEM gates and bank structure flags.
 */
import { describe, expect, it } from "vitest";
import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { runOemPerfectReplica } from "@/lib/oem-replica";
import { analyzeStatementLayout } from "@/lib/statement-layout";
import type { Transaction } from "@/lib/types";

const FINAL =
  "/Users/adminuser/Downloads/1132%20(2)/698/St George Bank Acc Statement #726 - 21.08.24 to 19.11.24.pdf";
const BASE =
  "/Users/adminuser/Desktop/St George Bank TEMPLATE 2- 21.08.24 to 19.11.24.pdf";
const OUT = resolve(__dirname, "../../docs/st-george-layer-analysis/out");

function mutateLedger(txns: Transaction[]): Transaction[] {
  return txns.map((t, i) => {
    if (i % 3 !== 0) return { ...t };
    // Local token edits only — preserve multi-line OEM shape
    const debit =
      t.debit != null ? Math.round((t.debit + 1.11) * 100) / 100 : t.debit;
    const credit =
      t.credit != null ? Math.round((t.credit + 2.22) * 100) / 100 : t.credit;
    const balance =
      t.balance != null
        ? Math.round((t.balance + 1.11) * 100) / 100
        : t.balance;
    return {
      ...t,
      description: t.description
        .replace(/\bMelbourne\b/gi, "Sydney")
        .replace(/\bLadbrokes\b/gi, "Sportsbet"),
      debit,
      credit,
      balance,
      flags: [...(t.flags ?? []), "oem-test-mutate"],
    };
  });
}

describe("OEM perfect replica pipeline", () => {
  it(
    "filled #726: rewrite on OEM PDF with structure + gates",
    async () => {
      if (!existsSync(FINAL)) {
        console.warn("skip: #726 missing");
        return;
      }
      const sourcePdf = new Uint8Array(readFileSync(FINAL));
      const layout = await analyzeStatementLayout(sourcePdf, {
        fileName: "726.pdf",
        bankHint: "st george",
        maxPages: 3,
      });
      expect(layout.part3.rows.length).toBeGreaterThan(10);

      const baseline: Transaction[] = layout.transactions.map((t) => ({
        ...t,
        original: {
          date: t.date,
          description: t.description,
          debit: t.debit,
          credit: t.credit,
          balance: t.balance,
        },
      }));
      const current = mutateLedger(baseline);

      const oem = await runOemPerfectReplica({
        sourcePdf,
        sourceBaseline: baseline,
        current,
        fileName: "St George #726.pdf",
        maxPages: 3,
        preserveTxnStructure: true,
        minDescriptionCoverage: 0.25,
        strict: false,
      });

      mkdirSync(OUT, { recursive: true });
      writeFileSync(resolve(OUT, "oem-replica-726.pdf"), oem.candidatePdf);
      writeFileSync(
        resolve(OUT, "oem-replica-726.json"),
        JSON.stringify(
          {
            path: oem.path,
            score: oem.score,
            editCount: oem.editCount,
            summary: oem.summary,
            gates: oem.gates,
            notes: oem.notes.slice(-12),
            edits: oem.appliedEdits.map((e) => ({
              page: e.page,
              field: e.linkedField,
              original: e.original,
              replacement: e.replacement,
              bbox: e.bbox,
            })),
          },
          null,
          2,
        ),
      );

      console.log(
        "OEM726",
        oem.path,
        oem.score,
        oem.editCount,
        oem.summary.bankId,
        oem.ok,
      );

      expect(oem.path).toBe("filled-geometry");
      expect(oem.editCount).toBeGreaterThan(5);
      expect(oem.score).toBeGreaterThanOrEqual(55);
      expect(oem.candidatePdf.byteLength).toBeGreaterThan(1000);
      expect(oem.summary.writePolicy).toMatch(/no redactions/i);
      expect(oem.gates.find((g) => g.id === "oem-no-redactions")?.pass).toBe(
        true,
      );
      expect(oem.gates.find((g) => g.id === "oem-static-preserved")?.pass).toBe(
        true,
      );
      // Structure flags on ledger (keep or reformat)
      expect(
        oem.structuredLedger.some(
          (t) =>
            t.flags?.includes("oem-struct") ||
            t.flags?.includes("oem-struct-keep"),
        ),
      ).toBe(true);
    },
    90_000,
  );

  it(
    "TEMPLATE 2 base: layered shell path with expanded rows",
    async () => {
      if (!existsSync(BASE)) {
        console.warn("skip: TEMPLATE 2 missing");
        return;
      }
      const basePdf = new Uint8Array(readFileSync(BASE));
      const sample: Transaction[] = Array.from({ length: 12 }, (_, i) => ({
        id: `s${i}`,
        date: `2024-11-${String(18 - (i % 15)).padStart(2, "0")}`,
        description:
          i % 2 === 0
            ? `Visa Purchase ${10 + i}Nov Oz Lotteries Melbourne`
            : `Osko Deposit Interbank Trans Sample Person`,
        debit: i % 2 === 0 ? 50 + i : null,
        credit: i % 2 === 1 ? 1000 : null,
        balance: 50000 - i * 100,
        category: "Other",
        categorySource: "heuristic",
        categoryConfidence: 0.5,
        flags: [],
      }));

      const oem = await runOemPerfectReplica({
        sourcePdf: basePdf,
        sourceBaseline: sample.map((t) => ({
          ...t,
          description: "PLACEHOLDER",
          debit: null,
          credit: null,
          balance: null,
        })),
        current: sample,
        fileName: "TEMPLATE 2 base.pdf",
        maxPages: 2,
        preserveTxnStructure: true,
        strict: false,
      });

      writeFileSync(resolve(OUT, "oem-replica-base-layered.pdf"), oem.candidatePdf);
      console.log("OEMBASE", oem.path, oem.score, oem.editCount);

      expect(["st-george-layered", "token-template", "hybrid-fallback"]).toContain(
        oem.path,
      );
      expect(oem.editCount).toBeGreaterThan(10);
      expect(oem.candidatePdf.byteLength).toBeGreaterThan(basePdf.byteLength * 0.4);
    },
    60_000,
  );
});
