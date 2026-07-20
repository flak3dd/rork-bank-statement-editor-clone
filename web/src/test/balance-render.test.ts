import { describe, expect, it } from "vitest";
import {
  applyRenderWithFallbacks,
  hybridBalances,
  recomputeBalances,
} from "@/lib/balance-engine";
import type { Transaction } from "@/lib/types";

function txn(
  partial: Partial<Transaction> & { id: string },
): Transaction {
  return {
    date: "2024-11-01",
    description: "Test",
    debit: null,
    credit: null,
    balance: null,
    category: "Other",
    categorySource: "heuristic",
    categoryConfidence: 0.5,
    flags: [],
    ...partial,
  };
}

describe("confirm render balance cascade", () => {
  it("hybrid does not re-anchor to stale balances after debit edit", () => {
    const rows = [
      txn({
        id: "a",
        debit: 150,
        balance: 900, // stale (was 100 after 100 debit from 1000)
        original: {
          date: "2024-11-01",
          description: "Test",
          debit: 100,
          credit: null,
          balance: 900,
        },
      }),
      txn({
        id: "b",
        credit: 50,
        balance: 950,
        original: {
          date: "2024-11-01",
          description: "Test",
          debit: null,
          credit: 50,
          balance: 950,
        },
      }),
    ];
    const hyb = hybridBalances(rows, 1000);
    // 1000 - 150 = 850, then 850 + 50 = 900
    expect(hyb[0]).toBe(850);
    expect(hyb[1]).toBe(900);
  });

  it("applyRender updates balances when amounts are dirty", () => {
    // Opening 1000. Debit changed 100→200 but balances left at old values.
    const rows = [
      txn({
        id: "a",
        debit: 200,
        balance: 900, // stale (should be 800)
        original: {
          date: "2024-11-01",
          description: "Test",
          debit: 100,
          credit: null,
          balance: 900,
        },
      }),
      txn({
        id: "b",
        debit: 50,
        balance: 850, // stale (should be 750)
        original: {
          date: "2024-11-01",
          description: "Test",
          debit: 50,
          credit: null,
          balance: 850,
        },
      }),
    ];
    const result = applyRenderWithFallbacks(rows, "hybrid", 1000);
    expect(result.rowsUpdated).toBe(2);
    expect(result.transactions[0].balance).toBe(800); // 1000-200
    expect(result.transactions[1].balance).toBe(750); // 800-50
    expect(result.engineUsed).toMatch(/recompute|hybrid/);
    expect(result.summary).toMatch(/2 balances updated/i);
  });

  it("recompute from opening is deterministic", () => {
    const rows = [
      txn({ id: "a", debit: 10, balance: null }),
      txn({ id: "b", credit: 5, balance: null }),
    ];
    const bals = recomputeBalances(rows, 100);
    expect(bals).toEqual([90, 95]);
  });
});
