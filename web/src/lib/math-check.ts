import { buildBalancePreview, inferOpeningBalance } from "./balance-engine";
import { movementOf, moneyEqual } from "./edit-utils";
import { round2 } from "./money";
import { buildSummary, parseTransactionsFromText } from "./parse-transactions";
import type {
  MathCheckItem,
  MathCheckResult,
  MathCheckStatus,
  Transaction,
} from "./types";

function worst(a: MathCheckStatus, b: MathCheckStatus): MathCheckStatus {
  const rank = { pass: 0, warn: 1, fail: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Final math check: re-derive totals, verify running balance chain,
 * optional re-parse of raw text for count drift, opening+net≈closing.
 */
export function runFinalMathCheck(params: {
  transactions: Transaction[];
  rawText?: string;
  tolerance?: number;
}): MathCheckResult {
  const tolerance = params.tolerance ?? 0.05;
  const txns = params.transactions;
  const items: MathCheckItem[] = [];
  let status: MathCheckStatus = "pass";

  if (txns.length === 0) {
    items.push({
      id: "empty",
      status: "fail",
      title: "No transactions",
      detail: "Cannot verify math on an empty statement.",
    });
    return {
      status: "fail",
      score: 0,
      items,
      reparsedCount: 0,
      balanceChainOk: false,
      openingPlusNetOk: null,
      checkedAt: new Date().toISOString(),
    };
  }

  items.push({
    id: "count",
    status: "pass",
    title: "Transaction count",
    detail: `${txns.length} row(s) in working set.`,
  });

  const hollow = txns.filter(
    (t) => t.debit == null && t.credit == null && t.balance == null,
  );
  if (hollow.length > 0) {
    status = worst(status, "warn");
    items.push({
      id: "hollow",
      status: "warn",
      title: "Rows without amounts",
      detail: `${hollow.length} row(s) lack debit, credit, and balance.`,
      transactionId: hollow[0].id,
    });
  } else {
    items.push({
      id: "hollow",
      status: "pass",
      title: "Amount presence",
      detail: "Every row has at least one amount or balance field.",
    });
  }

  const dual = txns.filter(
    (t) => t.debit != null && t.credit != null && t.debit > 0 && t.credit > 0,
  );
  if (dual.length > 0) {
    status = worst(status, "warn");
    items.push({
      id: "dual",
      status: "warn",
      title: "Dual-sided rows",
      detail: `${dual.length} row(s) have both debit and credit > 0 — verify columns.`,
      transactionId: dual[0].id,
    });
  } else {
    items.push({
      id: "dual",
      status: "pass",
      title: "Column exclusivity",
      detail: "No row has both debit and credit filled as positive amounts.",
    });
  }

  const preview = buildBalancePreview(txns, "recompute");
  const balanceChainOk = preview.mismatchCount === 0;
  if (!balanceChainOk) {
    const sev: MathCheckStatus =
      preview.mismatchCount > Math.max(2, txns.length * 0.15) ? "fail" : "warn";
    status = worst(status, sev);
    const firstBad = preview.rows.find((r) => r.mismatched);
    items.push({
      id: "chain",
      status: sev,
      title: "Running balance chain",
      detail: `${preview.mismatchCount} mismatch(es). First at row ${
        (firstBad?.index ?? 0) + 1
      }: expected ${firstBad?.expectedBalance?.toFixed(2) ?? "—"} vs stated ${
        firstBad?.statedBalance?.toFixed(2) ?? "—"
      }.`,
      transactionId: firstBad?.transactionId,
    });
  } else {
    items.push({
      id: "chain",
      status: "pass",
      title: "Running balance chain",
      detail: "Stated balances match recompute engine within tolerance.",
    });
  }

  const summary = buildSummary(txns);
  const opening = inferOpeningBalance(txns) ?? summary.openingBalance;
  let openingPlusNetOk: boolean | null = null;
  if (opening != null && summary.closingBalance != null) {
    const netMove = round2(txns.reduce((s, t) => s + movementOf(t), 0));
    const expectedClose = round2(opening + netMove);
    openingPlusNetOk = moneyEqual(expectedClose, summary.closingBalance, tolerance);
    if (!openingPlusNetOk) {
      status = worst(status, "warn");
      items.push({
        id: "open-net-close",
        status: "warn",
        title: "Opening + movements vs closing",
        detail: `Opening ${opening.toFixed(2)} + net ${netMove.toFixed(2)} = ${expectedClose.toFixed(2)}, closing stated ${summary.closingBalance.toFixed(2)} (Δ ${round2(Math.abs(expectedClose - summary.closingBalance)).toFixed(2)}).`,
      });
    } else {
      items.push({
        id: "open-net-close",
        status: "pass",
        title: "Opening + movements vs closing",
        detail: `Closing ${summary.closingBalance.toFixed(2)} matches opening + net movements.`,
      });
    }
  } else {
    items.push({
      id: "open-net-close",
      status: "warn",
      title: "Opening + movements vs closing",
      detail: "Insufficient balance anchors to verify opening + net = closing.",
    });
    status = worst(status, "warn");
  }

  const totalIn = round2(txns.reduce((s, t) => s + (t.credit ?? 0), 0));
  const totalOut = round2(txns.reduce((s, t) => s + (t.debit ?? 0), 0));
  if (
    moneyEqual(totalIn, summary.totalIn) &&
    moneyEqual(totalOut, summary.totalOut)
  ) {
    items.push({
      id: "totals",
      status: "pass",
      title: "Summary totals",
      detail: `In ${totalIn.toFixed(2)} · Out ${totalOut.toFixed(2)} · Net ${round2(totalIn - totalOut).toFixed(2)}.`,
    });
  } else {
    status = worst(status, "fail");
    items.push({
      id: "totals",
      status: "fail",
      title: "Summary totals mismatch",
      detail: "Recomputed totals do not match summary builder — internal error.",
    });
  }

  let reparsedCount = 0;
  if (params.rawText && params.rawText.trim().length > 40) {
    try {
      const reparsed = parseTransactionsFromText(params.rawText);
      reparsedCount = reparsed.length;
      const drift = Math.abs(reparsedCount - txns.length);
      if (drift === 0) {
        items.push({
          id: "reparse",
          status: "pass",
          title: "Re-parse count",
          detail: `Raw text re-parse yields ${reparsedCount} row(s).`,
        });
      } else {
        const edited = txns.filter(
          (t) => t.flags.includes("edited") || t.rendered,
        ).length;
        status = worst(status, "warn");
        items.push({
          id: "reparse",
          status: "warn",
          title: edited > 0 ? "Re-parse vs edited set" : "Re-parse count drift",
          detail:
            edited > 0
              ? `Raw re-parse ${reparsedCount} ≠ working ${txns.length}. ${edited} row(s) were edited/rendered — drift can be expected.`
              : `Raw re-parse: ${reparsedCount} vs working set ${txns.length} (Δ ${drift}).`,
        });
      }
    } catch {
      status = worst(status, "warn");
      items.push({
        id: "reparse",
        status: "warn",
        title: "Re-parse failed",
        detail: "Could not re-parse raw statement text.",
      });
    }
  }

  const passN = items.filter((i) => i.status === "pass").length;
  const warnN = items.filter((i) => i.status === "warn").length;
  const failN = items.filter((i) => i.status === "fail").length;
  const score = Math.round(
    clamp(
      (passN / Math.max(items.length, 1)) * 100 - warnN * 8 - failN * 25,
      0,
      100,
    ),
  );

  return {
    status,
    score,
    items,
    reparsedCount,
    balanceChainOk,
    openingPlusNetOk,
    checkedAt: new Date().toISOString(),
  };
}
