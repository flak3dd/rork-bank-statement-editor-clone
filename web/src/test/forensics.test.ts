import { describe, expect, it } from "vitest";
import { runFidelityForensics } from "@/lib/forensics";
import type { Transaction } from "@/lib/types";

function txn(
  partial: Partial<Transaction> & Pick<Transaction, "id" | "description">,
): Transaction {
  return {
    date: "2026-03-05",
    debit: 10,
    credit: null,
    balance: 100,
    category: "Other",
    categorySource: "heuristic",
    categoryConfidence: 0.5,
    flags: [],
    ...partial,
    original: partial.original ?? {
      date: partial.date ?? "2026-03-05",
      description: partial.description,
      debit: partial.debit ?? 10,
      credit: partial.credit ?? null,
      balance: partial.balance ?? 100,
    },
  };
}

describe("fidelity forensics", () => {
  it("scores high when working matches source", async () => {
    const source = [
      txn({
        id: "1",
        description: "WOOLWORTHS MARKET",
        debit: 85.4,
        credit: null,
        balance: 1200,
        date: "2026-03-03",
      }),
      txn({
        id: "2",
        description: "SALARY ACME CORP",
        debit: null,
        credit: 2500,
        balance: 3700,
        date: "2026-03-05",
      }),
    ];
    // Fix balances for chain
    source[0].balance = 1200;
    source[0].original!.balance = 1200;
    source[1].balance = 3700;
    source[1].original!.balance = 3700;

    const report = await runFidelityForensics({
      fileName: "demo.pdf",
      pageCount: 1,
      rawText:
        "Statement Period Opening balance BSB 062-000 SALARY WOOLWORTHS Page 1 of 1",
      sourceTransactions: source,
      workingTransactions: source.map((t) => ({ ...t, flags: [...t.flags] })),
      runAi: false,
    });

    expect(report.overallScore).toBeGreaterThan(70);
    expect(report.layers.some((l) => l.layer === "structural")).toBe(true);
    expect(report.markdown).toContain("Fidelity");
    expect(report.verdict === "pass" || report.verdict === "warn").toBe(true);
  });

  it("flags placeholder narratives as critical/material risk", async () => {
    const source = [
      txn({ id: "1", description: "COLES SUPERMARKET", debit: 40, balance: 960 }),
    ];
    const working = [
      txn({
        id: "1",
        description: "Test Merchant Lorem Ipsum",
        debit: 40,
        balance: 960,
        flags: ["generated"],
      }),
    ];
    const report = await runFidelityForensics({
      fileName: "x.pdf",
      pageCount: 1,
      rawText: "Statement Period Opening balance",
      sourceTransactions: source,
      workingTransactions: working,
      runAi: false,
    });
    expect(
      report.findings.some(
        (f) =>
          f.severity === "critical" ||
          f.title.toLowerCase().includes("placeholder"),
      ),
    ).toBe(true);
  });
});
