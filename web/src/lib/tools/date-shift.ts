import type { Transaction } from "@/lib/types";
import { attachOriginals } from "@/lib/edit-utils";

/**
 * Shift all ISO dates by ±days. Non-ISO dates are left unchanged but flagged.
 */
export function shiftTransactionDates(
  transactions: Transaction[],
  days: number,
): { transactions: Transaction[]; shifted: number; skipped: number } {
  const delta = Math.round(days);
  if (delta === 0) {
    return { transactions, shifted: 0, skipped: 0 };
  }

  let shifted = 0;
  let skipped = 0;

  const next = transactions.map((t) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
      skipped += 1;
      return {
        ...t,
        flags: t.flags.includes("date-shift-skipped")
          ? t.flags
          : [...t.flags, "date-shift-skipped"],
      };
    }
    const d = new Date(t.date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    const iso = d.toISOString().slice(0, 10);
    shifted += 1;
    const flags = new Set(t.flags);
    flags.add("date-shifted");
    flags.add("edited");
    return {
      ...t,
      date: iso,
      flags: [...flags],
      original: t.original ?? {
        date: t.date,
        description: t.description,
        debit: t.debit,
        credit: t.credit,
        balance: t.balance,
      },
    };
  });

  return {
    transactions: attachOriginals(next),
    shifted,
    skipped,
  };
}

/** Compute period bounds from transactions. */
export function periodBounds(transactions: Transaction[]): {
  start: string | null;
  end: string | null;
} {
  const dates = transactions
    .map((t) => t.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return {
    start: dates[0] ?? null,
    end: dates[dates.length - 1] ?? null,
  };
}
