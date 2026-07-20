import { describe, expect, it } from "vitest";
import {
  collapseDoubledMoneyGlyphs,
  parseAmount,
} from "@/lib/money";
import {
  analyzeCompleteness,
  buildSummary,
  parseTransactionsFromText,
  parseTransactionsHybrid,
} from "@/lib/parse-transactions";
import { runFinalMathCheck } from "@/lib/math-check";

describe("parseAmount", () => {
  it("parses US amounts", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("(50.00)")).toBe(-50);
  });

  it("parses EU amounts", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
  });

  it("repairs FreeText doubled-glyph money", () => {
    expect(collapseDoubledMoneyGlyphs("$ $4 4,,3 39 98 8..9 90 0")).toBe(
      "$4,398.90",
    );
    expect(parseAmount("$ $4 4,,3 39 98 8..9 90 0")).toBe(4398.9);
    expect(parseAmount("$ $1 19 90 0..5 51 1")).toBe(190.51);
  });
});

describe("parseTransactionsFromText", () => {
  it("extracts dated rows with amounts", () => {
    const text = `
Statement Period
01/03/2026 Opening balance
03/03/2026 WOOLWORTHS MARKET          85.40      1,200.00
05/03/2026 SALARY ACME CORP                     2,500.00   3,700.00
07/03/2026 NETFLIX SUBSCRIPTION       16.99      3,683.01
`;
    const txns = parseTransactionsFromText(text);
    expect(txns.length).toBeGreaterThanOrEqual(2);
    expect(txns.some((t) => /woolworths/i.test(t.description))).toBe(true);
    const summary = buildSummary(txns);
    expect(summary.transactionCount).toBe(txns.length);
    const findings = analyzeCompleteness(txns);
    expect(Array.isArray(findings)).toBe(true);
  });
});

describe("ANZ Plus multi-line parse", () => {
  const SAMPLE = `
ANZ Plus
Account Name GREGORY THOMPSON
Date   Description   Credit   Debit   Balance
01 Apr 2026 – 30 Jun 2026
01 Apr   OPENING BALANCE   $10,460.00
02 Apr   VISA DEBIT PURCHASE CARD 5076 STARBUCKS
GOLDEN BAY
$8.00   $10,452.00
02 Apr   TRANSFER TO 013-002-801917986 #680467
EFFECTIVE DATE 30/03/2026
$256.90   $10,195.10
02 Apr   VISA DEBIT PURCHASE CARD 6051 KMART ONLINE
EFFECTIVE DATE 31/03/2026
$118.13   $10,076.97
03 Apr   VISA DEBIT PURCHASE CARD 2027 NIGHTOWL
CONVENIENCE PERTH
$8.41   $10,068.56
03 Apr   TRANSFER TO 015-665-636066375 #677913
EFFECTIVE DATE 02/04/2026
$210.71   $9,857.85
05 Apr   DIRECT DEBIT TELSTRA MOBILE   $72.20   $9,785.65
06 Apr   VISA DEBIT PURCHASE CARD 5076 LOCAL
ESPRESSO PERTH
EFFECTIVE DATE 06/04/2026
$15.63   $9,770.02
07 Apr   SALARY CREDIT
07042026-100
$ $4 4,,3 39 98 8..9 90 0   $14,168.92
07 Apr   TRANSFER TO 014-301-636126784 #471957
EFFECTIVE DATE 05/04/2026
$261.72   $13,907.20
09 Apr   TRANSFER FROM 014-301-799178984 #245962   $ $1 19 90 0..5 51 1   $13,869.51
`;

  it("parses multi-line debit/credit/balance without dual columns", () => {
    const { transactions: txns, meta } = parseTransactionsHybrid(SAMPLE);
    expect(meta.enginesTried).toContain("anz-plus-multiline");
    expect(txns.length).toBeGreaterThanOrEqual(8);

    const open = txns.find((t) => /OPENING/i.test(t.description));
    expect(open?.balance).toBe(10460);
    expect(open?.debit).toBeNull();
    expect(open?.credit).toBeNull();

    const starbucks = txns.find((t) => /STARBUCKS/i.test(t.description));
    expect(starbucks?.debit).toBe(8);
    expect(starbucks?.credit).toBeNull();
    expect(starbucks?.balance).toBe(10452);

    const transferTo = txns.find((t) =>
      /TRANSFER TO 013-002/i.test(t.description),
    );
    expect(transferTo?.debit).toBe(256.9);
    expect(transferTo?.credit).toBeNull();
    // Must not treat account numbers as amounts
    expect(transferTo?.debit).not.toBe(986);
    expect(transferTo?.balance).toBe(10195.1);

    const salary = txns.find((t) => /SALARY CREDIT/i.test(t.description));
    expect(salary?.credit).toBe(4398.9);
    expect(salary?.debit).toBeNull();
    expect(salary?.balance).toBe(14168.92);

    const transferFrom = txns.find((t) =>
      /TRANSFER FROM/i.test(t.description),
    );
    expect(transferFrom?.credit).toBe(190.51);
    expect(transferFrom?.debit).toBeNull();

    const dual = txns.filter(
      (t) => t.debit != null && t.credit != null && t.debit > 0 && t.credit > 0,
    );
    expect(dual.length).toBe(0);

    // Continuous head of the sample (opening → salary) must chain; later rows
    // intentionally omit intermediate txns so full-sample chain is incomplete.
    const head = txns.filter((t) => t.date <= "2026-04-07");
    const math = runFinalMathCheck({ transactions: head, rawText: SAMPLE });
    expect(math.balanceChainOk).toBe(true);
    expect(math.score).toBeGreaterThanOrEqual(70);
  });
});
