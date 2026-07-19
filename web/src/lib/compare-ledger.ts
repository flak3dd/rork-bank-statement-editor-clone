/**
 * Pair original (frozen) vs current (working/generated) ledgers for live comparison.
 */
import type { StatementSummary, Transaction } from "@/lib/types";
import { buildSummary } from "@/lib/parse-transactions";
import { round2 } from "@/lib/money";

export type CompareField = "date" | "description" | "debit" | "credit" | "balance" | "category";

export const COMPARE_FIELDS: CompareField[] = [
  "date",
  "description",
  "debit",
  "credit",
  "balance",
  "category",
];

export interface FieldDiff {
  field: CompareField;
  original: string | number | null;
  current: string | number | null;
  changed: boolean;
}

export interface RowPair {
  key: string;
  index: number;
  original: Transaction | null;
  current: Transaction | null;
  status: "unchanged" | "changed" | "added" | "removed";
  diffs: FieldDiff[];
  changeCount: number;
}

export interface LedgerCompareReport {
  pairs: RowPair[];
  originalSummary: StatementSummary;
  currentSummary: StatementSummary;
  stats: {
    totalOriginal: number;
    totalCurrent: number;
    unchanged: number;
    changed: number;
    added: number;
    removed: number;
    fieldChangeCounts: Record<CompareField, number>;
  };
  summaryDeltas: {
    totalIn: number;
    totalOut: number;
    net: number;
    transactionCount: number;
    openingBalance: number | null;
    closingBalance: number | null;
  };
}

function fieldValue(
  t: Transaction | null,
  field: CompareField,
): string | number | null {
  if (!t) return null;
  return t[field] as string | number | null;
}

function valuesEqual(a: string | number | null, b: string | number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 0.005;
  }
  return String(a).trim() === String(b).trim();
}

function rowDiffs(
  original: Transaction | null,
  current: Transaction | null,
): FieldDiff[] {
  return COMPARE_FIELDS.map((field) => {
    const ov = fieldValue(original, field);
    const cv = fieldValue(current, field);
    return {
      field,
      original: ov,
      current: cv,
      changed: !valuesEqual(ov, cv),
    };
  });
}

function statusOf(
  original: Transaction | null,
  current: Transaction | null,
  diffs: FieldDiff[],
): RowPair["status"] {
  if (original && !current) return "removed";
  if (!original && current) return "added";
  if (diffs.some((d) => d.changed)) return "changed";
  return "unchanged";
}

/**
 * Pair rows: prefer same id, then same index, then leftover unmatched.
 */
export function pairLedgers(
  original: Transaction[],
  current: Transaction[],
): RowPair[] {
  const pairs: RowPair[] = [];
  const usedCurrent = new Set<string>();
  const usedOriginal = new Set<string>();

  // 1) Match by id
  const currentById = new Map(current.map((t) => [t.id, t]));
  for (const o of original) {
    const c = currentById.get(o.id);
    if (c) {
      const diffs = rowDiffs(o, c);
      pairs.push({
        key: o.id,
        index: pairs.length,
        original: o,
        current: c,
        status: statusOf(o, c, diffs),
        diffs,
        changeCount: diffs.filter((d) => d.changed).length,
      });
      usedCurrent.add(c.id);
      usedOriginal.add(o.id);
    }
  }

  // 2) Remaining originals → remaining currents by position order
  const remO = original.filter((t) => !usedOriginal.has(t.id));
  const remC = current.filter((t) => !usedCurrent.has(t.id));
  const n = Math.max(remO.length, remC.length);
  for (let i = 0; i < n; i++) {
    const o = remO[i] ?? null;
    const c = remC[i] ?? null;
    const diffs = rowDiffs(o, c);
    pairs.push({
      key: o?.id ?? c?.id ?? `pair-${i}`,
      index: pairs.length,
      original: o,
      current: c,
      status: statusOf(o, c, diffs),
      diffs,
      changeCount: diffs.filter((d) => d.changed).length,
    });
    if (o) usedOriginal.add(o.id);
    if (c) usedCurrent.add(c.id);
  }

  return pairs;
}

export function compareLedgers(
  original: Transaction[],
  current: Transaction[],
): LedgerCompareReport {
  const pairs = pairLedgers(original, current);
  const originalSummary = buildSummary(original);
  const currentSummary = buildSummary(current);

  const fieldChangeCounts = Object.fromEntries(
    COMPARE_FIELDS.map((f) => [f, 0]),
  ) as Record<CompareField, number>;

  let unchanged = 0;
  let changed = 0;
  let added = 0;
  let removed = 0;
  for (const p of pairs) {
    if (p.status === "unchanged") unchanged += 1;
    else if (p.status === "changed") changed += 1;
    else if (p.status === "added") added += 1;
    else if (p.status === "removed") removed += 1;
    for (const d of p.diffs) {
      if (d.changed) fieldChangeCounts[d.field] += 1;
    }
  }

  const delta = (a: number | null, b: number | null) => {
    if (a == null || b == null) return null;
    return round2(b - a);
  };

  return {
    pairs,
    originalSummary,
    currentSummary,
    stats: {
      totalOriginal: original.length,
      totalCurrent: current.length,
      unchanged,
      changed,
      added,
      removed,
      fieldChangeCounts,
    },
    summaryDeltas: {
      totalIn: round2(currentSummary.totalIn - originalSummary.totalIn),
      totalOut: round2(currentSummary.totalOut - originalSummary.totalOut),
      net: round2(currentSummary.net - originalSummary.net),
      transactionCount:
        currentSummary.transactionCount - originalSummary.transactionCount,
      openingBalance: delta(
        originalSummary.openingBalance,
        currentSummary.openingBalance,
      ),
      closingBalance: delta(
        originalSummary.closingBalance,
        currentSummary.closingBalance,
      ),
    },
  };
}

export function formatCompareMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const s = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (n < 0) return `-${s}`;
  if (n > 0) return `+${s}`;
  return s;
}
