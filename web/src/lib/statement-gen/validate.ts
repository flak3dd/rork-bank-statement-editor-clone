import { round2 } from "./calibrate";
import type { LedgerRow, ValidationIssue, ValidationReport } from "./types";

/**
 * Shared validator (concepts §11): chronology, running balances,
 * same-day duplicate description+amount, closing behaviour.
 */
export function validateLedger(
  rows: LedgerRow[],
  openingBalance: number,
): ValidationReport {
  const issues: ValidationIssue[] = [];
  let chronological = true;
  let balanceConsistent = true;
  let noSameDayDupes = true;

  if (rows.length === 0) {
    issues.push({
      id: "empty",
      severity: "error",
      message: "Ledger is empty",
    });
    return {
      ok: false,
      issues,
      chronological: false,
      balanceConsistent: false,
      noSameDayDupes: true,
    };
  }

  // Chronology
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].date < rows[i - 1].date) {
      chronological = false;
      issues.push({
        id: `chrono-${i}`,
        severity: "error",
        message: `Out of order: ${rows[i].date} after ${rows[i - 1].date}`,
        rowId: rows[i].id,
      });
    }
  }

  // Opening marker
  const open = rows.find((r) => r.type === "opening");
  if (!open) {
    issues.push({
      id: "no-open",
      severity: "warning",
      message: "Missing opening balance marker",
    });
  } else if (Math.abs(open.balance - openingBalance) > 0.01) {
    issues.push({
      id: "open-mismatch",
      severity: "error",
      message: `Opening balance ${open.balance} ≠ config ${openingBalance}`,
      rowId: open.id,
    });
    balanceConsistent = false;
  }

  // Running balances
  let expected = openingBalance;
  for (const r of rows) {
    if (r.type === "opening") {
      expected = r.balance;
      continue;
    }
    expected = round2(expected + r.amount);
    if (Math.abs(expected - r.balance) > 0.02) {
      balanceConsistent = false;
      issues.push({
        id: `bal-${r.id}`,
        severity: "error",
        message: `Balance drift on “${r.description}”: stored ${r.balance}, expected ${expected}`,
        rowId: r.id,
      });
    }
  }

  // Same-day duplicates (description + amount)
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r.type === "opening" || r.type === "closing") continue;
    const key = `${r.date}|${r.description}|${r.amount}`;
    if (seen.has(key)) {
      noSameDayDupes = false;
      issues.push({
        id: `dup-${r.id}`,
        severity: "warning",
        message: `Duplicate on ${r.date}: ${r.description} ${r.amount}`,
        rowId: r.id,
      });
    } else {
      seen.set(key, r.id);
    }
  }

  // Closing
  const close = rows.find((r) => r.type === "closing");
  if (!close) {
    issues.push({
      id: "no-close",
      severity: "warning",
      message: "Missing closing balance marker",
    });
  } else if (Math.abs(close.balance - expected) > 0.02) {
    issues.push({
      id: "close-mismatch",
      severity: "error",
      message: `Closing balance ${close.balance} ≠ final expected ${expected}`,
      rowId: close.id,
    });
    balanceConsistent = false;
  }

  const ok =
    chronological &&
    balanceConsistent &&
    issues.filter((i) => i.severity === "error").length === 0;

  return {
    ok,
    issues,
    chronological,
    balanceConsistent,
    noSameDayDupes,
  };
}

export function categoryDistribution(
  rows: LedgerRow[],
): Array<{ category: string; count: number; total: number }> {
  const map = new Map<string, { count: number; total: number }>();
  for (const r of rows) {
    if (r.type === "opening" || r.type === "closing") continue;
    const cur = map.get(r.category) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total = round2(cur.total + Math.abs(r.amount));
    map.set(r.category, cur);
  }
  return [...map.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.total - a.total);
}

export function largestTransactions(
  rows: LedgerRow[],
  n = 5,
): LedgerRow[] {
  return [...rows]
    .filter((r) => r.type !== "opening" && r.type !== "closing")
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, n);
}
