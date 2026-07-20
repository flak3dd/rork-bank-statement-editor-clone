import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildLayeredStGeorgeEdits,
  fillStGeorgeLayered,
  ST_GEORGE_FIDELITY_SNAPSHOT,
  ST_GEORGE_ROW_PITCH,
  DEFAULT_ST_GEORGE_BASE_PATH,
} from "@/lib/st-george-template";
import type { Transaction } from "@/lib/types";

const BASE =
  process.env.ST_GEORGE_BASE ??
  DEFAULT_ST_GEORGE_BASE_PATH;
const OUT = resolve(__dirname, "../../docs/st-george-layer-analysis/out");

function sampleTxns(n: number): Transaction[] {
  const out: Transaction[] = [];
  let bal = 1000;
  for (let i = 0; i < n; i++) {
    const credit = i % 3 === 0 ? 1000 : null;
    const debit = credit == null ? 50 + i : null;
    bal = bal + (credit ?? 0) - (debit ?? 0);
    out.push({
      id: `t${i}`,
      date: `2024-11-${String(18 - (i % 17)).padStart(2, "0")}`,
      description:
        i % 2 === 0
          ? `Visa Purchase ${10 + i}Nov Oz Lotteries Melbourne`
          : `Osko Deposit Interbank Trans Sample`,
      debit,
      credit,
      balance: bal,
      category: "Other",
      categorySource: "heuristic",
      categoryConfidence: 0.5,
      flags: [],
    });
  }
  return out;
}

describe("st-george layered fill (TEMPLATE 2 base)", () => {
  it("exposes fidelity snapshot and 36.6pt pitch", () => {
    expect(ST_GEORGE_ROW_PITCH).toBeCloseTo(36.6, 1);
    expect(ST_GEORGE_FIDELITY_SNAPSHOT.template2VsTemplatePctDiff).toBeLessThan(2);
  });

  it("builds chrome + expanded txn grid edits without tokens on base", () => {
    const bytes = existsSync(BASE)
      ? new Uint8Array(readFileSync(BASE))
      : new Uint8Array([0]);
    if (bytes.byteLength < 50) {
      console.warn("skip: TEMPLATE 2 base missing at", BASE);
      return;
    }
    const built = buildLayeredStGeorgeEdits({
      basePdf: bytes,
      transactions: sampleTxns(20),
      variables: {
        holderName: "TEST HOLDER",
        addressLine1: "1 TEST ST",
        addressLine2: "SYDNEY NSW 2000",
        bsb: "116-879",
        accountNumber: "453 657 726",
      },
      expandRows: true,
    });
    expect(built.edits.length).toBeGreaterThan(30);
    // 13 on p1 + remainder on p2 (base is 2 pages)
    expect(built.transactionSlotsFilled).toBe(20);
    expect(built.notes.some((n) => /TEMPLATE 2 base/i.test(n))).toBe(true);
  });

  it(
    "paints layered PDF onto TEMPLATE 2 base",
    async () => {
      if (!existsSync(BASE)) {
        console.warn("skip: no base pdf");
        return;
      }
      const basePdf = new Uint8Array(readFileSync(BASE));
      const result = await fillStGeorgeLayered({
        basePdf,
        transactions: sampleTxns(15),
        variables: {
          holderName: "ELYSIA LEAVER",
          addressLine1: "48 DENISON ST",
          addressLine2: "COOMA NSW 2630",
          bsb: "116-879",
          accountNumber: "453 657 726",
        },
        accountOpened: "2021-08-31",
        periodStart: "2024-08-21",
        periodEnd: "2024-11-19",
        currentBalance: 64474.33,
        expandRows: true,
      });
      expect(result.compose).toContain("template2-base");
      expect(result.candidatePdf.byteLength).toBeGreaterThan(basePdf.byteLength * 0.5);
      expect(result.transactionSlotsFilled).toBeGreaterThanOrEqual(13);
      mkdirSync(OUT, { recursive: true });
      writeFileSync(resolve(OUT, "layered-from-template2.pdf"), result.candidatePdf);
      console.log(
        "LAYERED",
        result.transactionSlotsFilled,
        result.edits.length,
        result.compose,
      );
    },
    60_000,
  );
});
