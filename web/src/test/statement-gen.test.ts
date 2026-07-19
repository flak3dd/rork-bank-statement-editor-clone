import { describe, expect, it } from "vitest";
import {
  countOccurrences,
  defaultStatementConfig,
  generateStatement,
  isDueOnDay,
  ledgerToCsv,
  ledgerToAppTransactions,
  normalizeStatementConfig,
  paginateLedger,
  validateLedger,
  type Frequency,
} from "@/lib/statement-gen";

describe("statement generation engine", () => {
  it("generates opening/closing markers and consistent balances", () => {
    const config = defaultStatementConfig();
    config.seed = 99;
    config.periodDays = 28;
    const result = generateStatement(config);

    expect(result.rows[0].type).toBe("opening");
    expect(result.rows[result.rows.length - 1].type).toBe("closing");
    expect(result.summary.transactionCount).toBeGreaterThan(0);
    expect(result.summary.closingBalance).toBe(
      result.rows[result.rows.length - 1].balance,
    );

    const v = validateLedger(result.rows, config.openingBalance);
    expect(v.chronological).toBe(true);
    expect(v.balanceConsistent).toBe(true);
    expect(v.ok).toBe(true);
  });

  it("is deterministic for the same seed", () => {
    const config = defaultStatementConfig();
    config.seed = 7;
    const a = generateStatement(config);
    const b = generateStatement(config);
    expect(a.rows.length).toBe(b.rows.length);
    expect(a.summary.closingBalance).toBe(b.summary.closingBalance);
    expect(a.rows[1]?.description).toBe(b.rows[1]?.description);
  });

  it("paginates into A4 pages", () => {
    const config = defaultStatementConfig();
    config.periodDays = 45;
    const result = generateStatement(config);
    const pages = paginateLedger(result.rows);
    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(pages[0].isFirst).toBe(true);
    expect(pages[pages.length - 1].isLast).toBe(true);
    const totalRows = pages.reduce((s, p) => s + p.rows.length, 0);
    expect(totalRows).toBe(result.rows.length);
  });

  it("exports CSV and maps to app transactions", () => {
    const result = generateStatement(defaultStatementConfig());
    const csv = ledgerToCsv(result.rows);
    expect(csv.split("\n")[0]).toContain("date");
    expect(csv.split("\n").length).toBeGreaterThan(3);

    const txns = ledgerToAppTransactions(result.rows);
    expect(txns.every((t) => t.flags.includes("statement-gen"))).toBe(true);
    expect(txns[0].original).toBeDefined();
  });

  it("honours user-configurable salary description and cardLast4", () => {
    const config = normalizeStatementConfig({
      ...defaultStatementConfig(),
      seed: 11,
      salaryDescription: "PAYROLL ACME PTY LTD",
      salaryAccount: "ACME PAY",
      cardLast4: "9999",
      hasDirectDebits: false,
      cardSpendPct: 40,
      periodDays: 21,
    });
    const result = generateStatement(config);
    const salary = result.rows.find((r) => r.type === "credit");
    expect(salary?.description).toBe("PAYROLL ACME PTY LTD");
    expect(salary?.secondaryDescription).toContain("ACME PAY");
    const card = result.rows.find((r) => r.type === "card");
    if (card) {
      expect(card.description).toMatch(/\*9999/);
    }
  });

  it("filters bill categories and subscriptions", () => {
    const base = defaultStatementConfig();
    const withSubs = generateStatement(
      normalizeStatementConfig({
        ...base,
        seed: 3,
        hasDirectDebits: true,
        hasSubscriptions: true,
        selectedBillCategories: ["Entertainment", "Telecom"],
        periodDays: 30,
      }),
    );
    const noSubs = generateStatement(
      normalizeStatementConfig({
        ...base,
        seed: 3,
        hasDirectDebits: true,
        hasSubscriptions: false,
        selectedBillCategories: ["Entertainment", "Telecom"],
        periodDays: 30,
      }),
    );
    const subRows = withSubs.rows.filter(
      (r) => r.secondaryDescription === "SUBSCRIPTION",
    );
    const subRowsOff = noSubs.rows.filter(
      (r) => r.secondaryDescription === "SUBSCRIPTION",
    );
    expect(subRows.length).toBeGreaterThan(0);
    expect(subRowsOff.length).toBe(0);
  });

  it("includes rental income when enabled", () => {
    const config = normalizeStatementConfig({
      ...defaultStatementConfig(),
      seed: 5,
      hasRentalIncome: true,
      rentalAmount: 450,
      rentalDescription: "TENANT RENT",
      periodDays: 30,
    });
    const result = generateStatement(config);
    const rent = result.rows.find((r) => r.type === "rental");
    expect(rent?.description).toBe("TENANT RENT");
    expect(rent?.amount).toBe(450);
  });

  it("countOccurrences matches isDueOnDay for all frequencies/day counts", () => {
    const freqs: Frequency[] = ["none", "weekly", "fortnightly", "monthly"];
    for (const freq of freqs) {
      for (const days of [1, 7, 14, 28, 30, 31, 45, 60, 90]) {
        let due = 0;
        for (let d = 0; d < days; d++) if (isDueOnDay(d, freq)) due += 1;
        expect(countOccurrences("2025-01-01", days, freq)).toBe(due);
      }
    }
  });
});
