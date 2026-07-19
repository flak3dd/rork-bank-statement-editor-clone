import { describe, expect, it } from "vitest";
import { compareLedgers, pairLedgers } from "@/lib/compare-ledger";
import type { Transaction } from "@/lib/types";

function tx(
  partial: Partial<Transaction> & Pick<Transaction, "id" | "description">,
): Transaction {
  return {
    date: "2026-03-01",
    debit: null,
    credit: null,
    balance: 100,
    category: "Other",
    categorySource: "heuristic",
    categoryConfidence: 1,
    flags: [],
    ...partial,
  };
}

describe("compareLedgers", () => {
  it("detects description and amount changes", () => {
    const original = [
      tx({ id: "a", description: "COLES", debit: 20, balance: 80 }),
      tx({ id: "b", description: "SALARY", credit: 1000, balance: 1080 }),
    ];
    const current = [
      tx({ id: "a", description: "WOOLWORTHS", debit: 25, balance: 75 }),
      tx({ id: "b", description: "SALARY", credit: 1000, balance: 1075 }),
    ];
    const report = compareLedgers(original, current);
    expect(report.stats.changed).toBe(2);
    expect(report.stats.unchanged).toBe(0);
    expect(report.stats.fieldChangeCounts.description).toBeGreaterThanOrEqual(1);
    expect(report.stats.fieldChangeCounts.debit).toBeGreaterThanOrEqual(1);
  });

  it("detects added and removed rows", () => {
    const original = [tx({ id: "a", description: "KEEP" })];
    const current = [
      tx({ id: "a", description: "KEEP" }),
      tx({ id: "c", description: "NEW" }),
    ];
    const report = compareLedgers(original, current);
    expect(report.stats.added).toBe(1);
    expect(report.stats.unchanged).toBe(1);
  });

  it("pairs by id first", () => {
    const original = [
      tx({ id: "z", description: "Z", date: "2026-03-02" }),
      tx({ id: "a", description: "A", date: "2026-03-01" }),
    ];
    const current = [
      tx({ id: "a", description: "A2", date: "2026-03-01" }),
      tx({ id: "z", description: "Z", date: "2026-03-02" }),
    ];
    const pairs = pairLedgers(original, current);
    const a = pairs.find((p) => p.key === "a");
    expect(a?.status).toBe("changed");
    expect(a?.current?.description).toBe("A2");
  });
});
