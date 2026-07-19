import type { LedgerRow } from "./types";
import { money2 } from "./format";

function esc(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Plain CSV export (concepts §10) — machine-readable amounts. */
export function ledgerToCsv(rows: LedgerRow[]): string {
  const headers = [
    "date",
    "effective_date",
    "description",
    "debit",
    "credit",
    "balance",
    "category",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const debit = r.amount < 0 ? money2(-r.amount) : "";
    const credit = r.amount > 0 ? money2(r.amount) : "";
    const desc = r.secondaryDescription
      ? `${r.description} | ${r.secondaryDescription}`
      : r.description;
    lines.push(
      [
        r.date,
        r.effectiveDate,
        esc(desc),
        debit,
        credit,
        money2(r.balance),
        r.category,
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function downloadLedgerCsv(rows: LedgerRow[], filename: string): void {
  const blob = new Blob([ledgerToCsv(rows)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
