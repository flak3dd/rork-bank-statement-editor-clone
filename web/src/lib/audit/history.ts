import type { ChangeHistoryEntry } from "./types";

function uid(): string {
  return `chg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createChangeEntry(
  transactionId: string,
  field: string,
  from: string | number | null,
  to: string | number | null,
  source: ChangeHistoryEntry["source"],
): ChangeHistoryEntry {
  return {
    id: uid(),
    ts: new Date().toISOString(),
    transactionId,
    field,
    from,
    to,
    source,
  };
}

export function appendChange(
  history: ChangeHistoryEntry[],
  entry: ChangeHistoryEntry,
): ChangeHistoryEntry[] {
  return [...history, entry];
}

/** Diff two transaction snapshots for history rows. */
export function diffTransactionFields(
  before: {
    id: string;
    date: string;
    description: string;
    debit: number | null;
    credit: number | null;
    balance: number | null;
    category?: string;
  },
  after: {
    id: string;
    date: string;
    description: string;
    debit: number | null;
    credit: number | null;
    balance: number | null;
    category?: string;
  },
  source: ChangeHistoryEntry["source"],
): ChangeHistoryEntry[] {
  const fields: Array<keyof typeof before> = [
    "date",
    "description",
    "debit",
    "credit",
    "balance",
    "category",
  ];
  const out: ChangeHistoryEntry[] = [];
  for (const f of fields) {
    const a = before[f] ?? null;
    const b = after[f] ?? null;
    if (a !== b) {
      out.push(
        createChangeEntry(
          after.id,
          String(f),
          a as string | number | null,
          b as string | number | null,
          source,
        ),
      );
    }
  }
  return out;
}
