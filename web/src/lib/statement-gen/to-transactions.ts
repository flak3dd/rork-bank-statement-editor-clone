import { attachOriginals } from "@/lib/edit-utils";
import type { Transaction, TransactionCategory } from "@/lib/types";
import type { GenCategory, LedgerRow } from "./types";

const MAP: Partial<Record<GenCategory, TransactionCategory>> = {
  Wages: "Income",
  Groceries: "Groceries",
  Dining: "Dining",
  Alcohol: "Dining",
  OnlineShopping: "Shopping",
  Transport: "Transport",
  Fuel: "Transport",
  Telecom: "Utilities",
  Utilities: "Utilities",
  Health: "Health",
  HomeImprovement: "Shopping",
  Retail: "Shopping",
  Entertainment: "Entertainment",
  Insurance: "Fees",
  Financial: "Fees",
  TaxSuper: "Fees",
  Savings: "Transfer",
  Transfer: "Transfer",
  BPAY: "Transfer",
  Pending: "Other",
  Other: "Other",
  BalanceMarker: "Other",
};

/** Map generated ledger rows into app Transaction[] for the main table. */
export function ledgerToAppTransactions(rows: LedgerRow[]): Transaction[] {
  const txns: Transaction[] = rows
    .filter((r) => r.type !== "opening" && r.type !== "closing")
    .map((r, i) => {
      const debit = r.amount < 0 ? Math.abs(r.amount) : null;
      const credit = r.amount > 0 ? r.amount : null;
      return {
        id: r.id || `gen-stmt-${i}`,
        date: r.date,
        description: r.secondaryDescription
          ? `${r.description} — ${r.secondaryDescription}`
          : r.description,
        debit,
        credit,
        balance: r.balance,
        category: MAP[r.category] ?? "Other",
        categorySource: "heuristic" as const,
        categoryConfidence: 0.7,
        flags: ["statement-gen", r.type, r.category],
        notes: `effective ${r.effectiveDate}`,
      };
    });
  return attachOriginals(txns);
}
