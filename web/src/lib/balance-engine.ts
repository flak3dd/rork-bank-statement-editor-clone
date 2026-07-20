import { dirtyFields, isRowDirty, movementOf, moneyEqual } from "./edit-utils";
import { round2 } from "./money";
import type {
  BalanceEngineId,
  BalancePreviewResult,
  RenderResult,
  RowBalanceDiff,
  Transaction,
} from "./types";

const TOLERANCE = 0.05;

/** Infer opening balance from first stated balance minus first movement. */
export function inferOpeningBalance(transactions: Transaction[]): number | null {
  if (transactions.length === 0) return null;
  const firstWithBal = transactions.find((t) => t.balance != null);
  if (!firstWithBal || firstWithBal.balance == null) return null;
  const idx = transactions.indexOf(firstWithBal);
  // Walk backwards from first balance to start, undoing movements
  let bal = firstWithBal.balance;
  for (let i = idx; i >= 0; i--) {
    bal = round2(bal - movementOf(transactions[i]));
  }
  return bal;
}

/** Recompute running balances from an opening seed. */
export function recomputeBalances(
  transactions: Transaction[],
  opening: number | null,
): Array<number | null> {
  if (opening == null) {
    // Seed from first stated balance if any
    const seed = inferOpeningBalance(transactions);
    if (seed == null) return transactions.map(() => null);
    return recomputeBalances(transactions, seed);
  }
  let running = opening;
  return transactions.map((t) => {
    running = round2(running + movementOf(t));
    return running;
  });
}

/**
 * Hybrid: prefer stated balance when it matches the chain; otherwise recompute.
 * When a stated balance matches, re-anchor the chain to it.
 *
 * Important: if the row has a non-zero movement (debit/credit) that does not
 * reconcile with stated balance, trust the movement cascade — do NOT re-anchor
 * to stale stated balances (that left Confirm Render at "0 balances updated"
 * after user edits).
 */
export function hybridBalances(
  transactions: Transaction[],
  opening: number | null,
): Array<number | null> {
  let running = opening;
  if (running == null) {
    running = inferOpeningBalance(transactions);
  }

  const out: Array<number | null> = [];
  for (const t of transactions) {
    const move = movementOf(t);
    const hasMove = Math.abs(move) > TOLERANCE;
    const amountDirty =
      t.original != null &&
      (!moneyEqual(t.debit, t.original.debit) ||
        !moneyEqual(t.credit, t.original.credit));

    if (running == null) {
      if (t.balance != null) {
        running = t.balance;
        out.push(t.balance);
      } else {
        out.push(null);
      }
      continue;
    }
    const expected = round2(running + move);
    if (t.balance != null && moneyEqual(t.balance, expected, TOLERANCE)) {
      running = t.balance;
      out.push(t.balance);
    } else if (
      // Only re-anchor on large drift when the row has NO movement and is not
      // amount-dirty (missing prior rows / statement discontinuity).
      t.balance != null &&
      !hasMove &&
      !amountDirty &&
      Math.abs(t.balance - expected) > TOLERANCE * 20
    ) {
      running = t.balance;
      out.push(t.balance);
    } else {
      // Prefer cascade from debit/credit (user edits, generator inject)
      running = expected;
      out.push(expected);
    }
  }
  return out;
}

export function balancesForEngine(
  transactions: Transaction[],
  engine: BalanceEngineId,
  opening?: number | null,
): Array<number | null> {
  const open = opening !== undefined ? opening : inferOpeningBalance(transactions);
  switch (engine) {
    case "stated":
      return transactions.map((t) => t.balance);
    case "recompute":
      return recomputeBalances(transactions, open);
    case "hybrid":
      return hybridBalances(transactions, open);
    default:
      return transactions.map((t) => t.balance);
  }
}

export function buildBalancePreview(
  transactions: Transaction[],
  engine: BalanceEngineId = "hybrid",
  opening?: number | null,
): BalancePreviewResult {
  const open =
    opening !== undefined ? opening : inferOpeningBalance(transactions);
  const expected = balancesForEngine(transactions, engine, open);

  const rows: RowBalanceDiff[] = transactions.map((t, index) => {
    const exp = expected[index];
    const stated = t.balance;
    let delta: number | null = null;
    let mismatched = false;
    if (exp != null && stated != null) {
      delta = round2(exp - stated);
      mismatched = Math.abs(delta) > TOLERANCE;
    } else if (exp != null && stated == null) {
      mismatched = true;
      delta = null;
    }

    return {
      transactionId: t.id,
      index,
      date: t.date,
      description: t.description,
      debit: t.debit,
      credit: t.credit,
      statedBalance: stated,
      expectedBalance: exp,
      delta,
      mismatched,
      fieldsChanged: dirtyFields(t),
      isDirty: isRowDirty(t),
    };
  });

  const mismatchCount = rows.filter((r) => r.mismatched).length;
  const dirtyCount = rows.filter((r) => r.isDirty).length;
  const last = rows[rows.length - 1];

  return {
    engine,
    rows,
    mismatchCount,
    dirtyCount,
    openingBalance: open,
    closingStated: last?.statedBalance ?? null,
    closingExpected: last?.expectedBalance ?? null,
    chainHealthy: mismatchCount === 0 && transactions.length > 0,
  };
}

/**
 * Apply engine balances to transactions.
 * Fallback chain: preferred → remaining engines until chain is healthy or last resort.
 *
 * When the ledger has dirty amount fields, prefer recompute over hybrid so
 * cascading balances always land after generator / bank-desc edits.
 */
export function applyRenderWithFallbacks(
  transactions: Transaction[],
  preferred: BalanceEngineId = "hybrid",
  opening?: number | null,
): RenderResult {
  const dirtyAmounts = transactions.some(
    (t) =>
      t.original != null &&
      (!moneyEqual(t.debit, t.original.debit) ||
        !moneyEqual(t.credit, t.original.credit) ||
        !moneyEqual(t.balance, t.original.balance)),
  );
  // Dirty ledgers: put recompute first so balances cascade from new amounts
  const effectivePreferred: BalanceEngineId =
    dirtyAmounts && preferred === "hybrid" ? "recompute" : preferred;

  const order: BalanceEngineId[] = [effectivePreferred];
  for (const id of ["hybrid", "recompute", "stated"] as BalanceEngineId[]) {
    if (!order.includes(id)) order.push(id);
  }

  const enginesTried: BalanceEngineId[] = [];
  let chosen: BalanceEngineId = effectivePreferred;
  let preview = buildBalancePreview(transactions, effectivePreferred, opening);

  for (const eng of order) {
    // Never fall through to "stated" when amounts/balances were edited —
    // stated always "matches itself" and would leave 0 rows updated.
    if (eng === "stated" && dirtyAmounts) {
      break;
    }
    enginesTried.push(eng);
    preview = buildBalancePreview(transactions, eng, opening);
    chosen = eng;
    if (preview.chainHealthy) break;
    if (eng === "stated") break;
    // Accept hybrid/recompute if mismatches are few relative to size
    // (preview mismatches vs *stated* — after apply, cascade is authoritative)
    if (
      (eng === "recompute" || eng === "hybrid") &&
      (dirtyAmounts ||
        (transactions.length > 0 &&
          preview.mismatchCount / transactions.length <= 0.25))
    ) {
      break;
    }
  }

  const open =
    opening !== undefined ? opening : inferOpeningBalance(transactions);
  const expected = balancesForEngine(transactions, chosen, open);
  let rowsUpdated = 0;
  const next = transactions.map((t, i) => {
    const bal = expected[i];
    if (bal == null || moneyEqual(bal, t.balance)) {
      return { ...t, rendered: true };
    }
    rowsUpdated += 1;
    const flags = new Set(t.flags);
    flags.add("rendered");
    if (!moneyEqual(bal, t.original?.balance ?? null)) flags.add("edited");
    return {
      ...t,
      balance: bal,
      rendered: true,
      flags: [...flags],
    };
  });

  const fallbackUsed = chosen !== preferred && chosen !== effectivePreferred;

  const dirtyNote = dirtyAmounts
    ? effectivePreferred !== preferred
      ? ` Dirty amounts detected → preferred ${effectivePreferred}.`
      : " Dirty amounts detected."
    : "";

  return {
    engineUsed: chosen,
    enginesTried,
    fallbackUsed,
    transactions: next,
    appliedAt: new Date().toISOString(),
    rowsUpdated,
    summary: fallbackUsed
      ? `Applied ${chosen} engine after fallback from ${preferred} (${rowsUpdated} balances updated).${dirtyNote}`
      : `Applied ${chosen} engine (${rowsUpdated} balances updated).${dirtyNote}`,
  };
}

/** Score how healthy a balance chain is (0–100). */
export function balanceChainScore(transactions: Transaction[]): number {
  if (transactions.length === 0) return 0;
  const preview = buildBalancePreview(transactions, "recompute");
  const withAny = transactions.filter(
    (t) => t.balance != null || t.debit != null || t.credit != null,
  );
  if (withAny.length === 0) return 20;
  const ratio = 1 - preview.mismatchCount / Math.max(withAny.length, 1);
  const coverage =
    transactions.filter((t) => t.balance != null).length / transactions.length;
  return Math.round(Math.max(0, Math.min(100, ratio * 70 + coverage * 30)));
}
