import { formatMoney, parseAmount, round2 } from "./money";
import type {
  EditableField,
  Transaction,
  TransactionSnapshot,
} from "./types";
import { EDITABLE_FIELDS } from "./types";

export function snapshotOf(t: Transaction): TransactionSnapshot {
  return {
    date: t.date,
    description: t.description,
    debit: t.debit,
    credit: t.credit,
    balance: t.balance,
  };
}

/** Attach original snapshots to freshly parsed transactions (idempotent). */
export function attachOriginals(transactions: Transaction[]): Transaction[] {
  return transactions.map((t) => ({
    ...t,
    original: t.original ?? snapshotOf(t),
  }));
}

/**
 * After Additional tools / generator replace: pin `original` to the pre-replace
 * (or source baseline) snapshot so Balance Out / dirty flags reflect replacements.
 */
export function withSourceOriginals(
  next: Transaction[],
  source: Transaction[],
): Transaction[] {
  return next.map((t, i) => {
    const src = source[i];
    const original = src
      ? (src.original ?? snapshotOf(src))
      : (t.original ?? snapshotOf(t));
    return {
      ...t,
      original,
      flags: [...new Set([...t.flags, "replaced"])],
    };
  });
}

export function moneyEqual(a: number | null, b: number | null, eps = 0.005): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= eps;
}

export function fieldEqual(
  field: EditableField,
  a: Transaction | TransactionSnapshot,
  b: Transaction | TransactionSnapshot,
): boolean {
  if (field === "date" || field === "description") {
    return String(a[field] ?? "").trim() === String(b[field] ?? "").trim();
  }
  return moneyEqual(a[field] as number | null, b[field] as number | null);
}

export function isRowDirty(t: Transaction): boolean {
  if (!t.original) return false;
  return EDITABLE_FIELDS.some((f) => !fieldEqual(f, t, t.original!));
}

export function dirtyFields(t: Transaction): EditableField[] {
  if (!t.original) return [];
  return EDITABLE_FIELDS.filter((f) => !fieldEqual(f, t, t.original!));
}

export function revertRow(t: Transaction): Transaction {
  if (!t.original) return t;
  return {
    ...t,
    date: t.original.date,
    description: t.original.description,
    debit: t.original.debit,
    credit: t.original.credit,
    balance: t.original.balance,
    rendered: false,
    flags: t.flags.filter((f) => f !== "edited" && f !== "rendered"),
  };
}

export function applyFieldEdit(
  t: Transaction,
  field: EditableField,
  raw: string,
): Transaction {
  let next: Transaction = { ...t };

  if (field === "date") {
    next = { ...next, date: raw.trim() };
  } else if (field === "description") {
    next = { ...next, description: raw };
  } else {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "—" || trimmed === "-") {
      next = { ...next, [field]: null };
    } else {
      const n = parseAmount(trimmed);
      next = { ...next, [field]: n != null ? round2(Math.abs(n)) : t[field] };
    }
  }

  const dirty = isRowDirty({ ...next, original: t.original ?? snapshotOf(t) });
  const flags = new Set(next.flags.filter((f) => f !== "edited"));
  if (dirty) flags.add("edited");

  return {
    ...next,
    original: t.original ?? snapshotOf(t),
    flags: [...flags],
    rendered: false,
  };
}

export function formatFieldValue(
  t: Transaction | TransactionSnapshot,
  field: EditableField,
): string {
  if (field === "date" || field === "description") {
    return String(t[field] ?? "");
  }
  const v = t[field] as number | null;
  if (v == null) return "";
  return v.toFixed(2);
}

export function displayFieldValue(
  t: Transaction | TransactionSnapshot,
  field: EditableField,
): string {
  if (field === "date" || field === "description") {
    return String(t[field] ?? "—");
  }
  return formatMoney(t[field] as number | null);
}

export function movementOf(t: Pick<Transaction, "debit" | "credit">): number {
  return round2((t.credit ?? 0) - (t.debit ?? 0));
}

export function countDirty(transactions: Transaction[]): number {
  return transactions.filter(isRowDirty).length;
}
