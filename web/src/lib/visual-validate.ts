import { formatFieldValue, movementOf } from "./edit-utils";
import { round2 } from "./money";
import type {
  EditableField,
  Transaction,
  VisualRowCompare,
  VisualValidateResult,
} from "./types";

const FIELDS: EditableField[] = [
  "date",
  "description",
  "debit",
  "credit",
  "balance",
];

/**
 * Multi-layer visual comparison: field layer, amount layer, balance layer,
 * plus aggregate totals structure.
 */
export function buildVisualComparison(
  transactions: Transaction[],
): VisualValidateResult {
  const rows: VisualRowCompare[] = transactions.map((t, index) => {
    const orig = t.original ?? {
      date: t.date,
      description: t.description,
      debit: t.debit,
      credit: t.credit,
      balance: t.balance,
    };

    const layers = FIELDS.map((field) => {
      const original = formatFieldValue(orig, field) || "—";
      const current = formatFieldValue(t, field) || "—";
      return {
        field,
        original,
        current,
        changed: original !== current,
      };
    });

    const anyChanged = layers.some((l) => l.changed);
    const amountDelta = round2(movementOf(t) - movementOf(orig));
    let balanceDelta: number | null = null;
    if (t.balance != null && orig.balance != null) {
      balanceDelta = round2(t.balance - orig.balance);
    } else if (t.balance != null && orig.balance == null) {
      balanceDelta = t.balance;
    } else if (t.balance == null && orig.balance != null) {
      balanceDelta = round2(-orig.balance);
    }

    return {
      id: t.id,
      index,
      layers,
      anyChanged,
      amountDelta,
      balanceDelta,
    };
  });

  const oIn = round2(
    transactions.reduce((s, t) => s + (t.original?.credit ?? 0), 0),
  );
  const oOut = round2(
    transactions.reduce((s, t) => s + (t.original?.debit ?? 0), 0),
  );
  const cIn = round2(transactions.reduce((s, t) => s + (t.credit ?? 0), 0));
  const cOut = round2(transactions.reduce((s, t) => s + (t.debit ?? 0), 0));

  return {
    rows,
    changedRowCount: rows.filter((r) => r.anyChanged).length,
    totalFieldChanges: rows.reduce(
      (s, r) => s + r.layers.filter((l) => l.changed).length,
      0,
    ),
    totals: {
      originalIn: oIn,
      currentIn: cIn,
      originalOut: oOut,
      currentOut: cOut,
      originalNet: round2(oIn - oOut),
      currentNet: round2(cIn - cOut),
    },
    structure: {
      originalCount: transactions.length,
      currentCount: transactions.length,
      countChanged: false,
    },
  };
}
