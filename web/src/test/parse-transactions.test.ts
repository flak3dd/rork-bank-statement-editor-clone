import { describe, expect, it } from "vitest";
import { parseAmount } from "@/lib/money";
import {
  analyzeCompleteness,
  buildSummary,
  parseTransactionsFromText,
} from "@/lib/parse-transactions";

describe("parseAmount", () => {
  it("parses US amounts", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("(50.00)")).toBe(-50);
  });

  it("parses EU amounts", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
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
