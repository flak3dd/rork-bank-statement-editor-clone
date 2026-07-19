/**
 * Generation quality suite used by Test Lab UI and automated stress tests.
 * Checks structural, mathematical, and config-fidelity invariants.
 */
import { cardSpendCap, countOccurrences, isDueOnDay, round2 } from "./calibrate";
import { generateStatement } from "./engine";
import type {
  GenerationResult,
  StatementConfig,
  ValidationReport,
} from "./types";
import { validateLedger } from "./validate";
import { paginateLedger } from "./paginate";
import { ledgerToCsv } from "./export-csv";
import { defaultStatementConfig, normalizeStatementConfig } from "./types";

export type QualitySeverity = "error" | "warning" | "pass";

export interface QualityCheck {
  id: string;
  label: string;
  severity: QualitySeverity;
  detail: string;
}

export interface GenerationQualityReport {
  ok: boolean;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  checks: QualityCheck[];
  validation: ValidationReport;
  summary: {
    rows: number;
    credits: number;
    debits: number;
    closing: number;
    salaryHits: number;
    cardHits: number;
    ddHits: number;
  };
}

function gradeFromScore(score: number): GenerationQualityReport["grade"] {
  if (score >= 95) return "A";
  if (score >= 85) return "B";
  if (score >= 70) return "C";
  if (score >= 50) return "D";
  return "F";
}

/** Deep quality analysis for a single generation result. */
export function analyzeGenerationQuality(
  result: GenerationResult,
  config: StatementConfig = result.config,
): GenerationQualityReport {
  const cfg = normalizeStatementConfig(config);
  const validation = validateLedger(result.rows, cfg.openingBalance);
  const checks: QualityCheck[] = [];
  const rows = result.rows;

  const push = (
    id: string,
    label: string,
    ok: boolean,
    detail: string,
    soft = false,
  ) => {
    checks.push({
      id,
      label,
      severity: ok ? "pass" : soft ? "warning" : "error",
      detail,
    });
  };

  push(
    "structure-open",
    "Opening marker",
    rows[0]?.type === "opening",
    rows[0]?.type === "opening" ? "First row is OPENING BALANCE" : "Missing opening",
  );
  push(
    "structure-close",
    "Closing marker",
    rows[rows.length - 1]?.type === "closing",
    rows[rows.length - 1]?.type === "closing"
      ? "Last row is CLOSING BALANCE"
      : "Missing closing",
  );
  push(
    "chrono",
    "Chronological",
    validation.chronological,
    validation.chronological ? "Dates in order" : "Out-of-order dates",
  );
  push(
    "balances",
    "Running balances",
    validation.balanceConsistent,
    validation.balanceConsistent
      ? "Every balance matches amount chain"
      : "Balance drift detected",
  );
  push(
    "dupes",
    "No same-day duplicates",
    validation.noSameDayDupes,
    validation.noSameDayDupes
      ? "No identical desc+amount on same day"
      : "Duplicate rows found",
    true,
  );

  let finiteOk = true;
  let precisionOk = true;
  let signsOk = true;
  let periodOk = true;
  for (const r of rows) {
    if (!Number.isFinite(r.amount) || !Number.isFinite(r.balance)) finiteOk = false;
    if (
      Math.abs(Math.round(r.amount * 100) / 100 - r.amount) > 1e-9 ||
      Math.abs(Math.round(r.balance * 100) / 100 - r.balance) > 1e-9
    ) {
      precisionOk = false;
    }
    if (
      (r.type === "credit" || r.type === "rental") &&
      r.amount <= 0
    ) {
      signsOk = false;
    }
    if (
      ["debit", "transfer", "direct_debit", "card", "peer"].includes(r.type) &&
      r.amount >= 0
    ) {
      signsOk = false;
    }
    if (r.date < cfg.periodStart || r.date > result.periodEnd) periodOk = false;
  }
  push("finite", "Finite money", finiteOk, finiteOk ? "No NaN/Infinity" : "Non-finite values");
  push("precision", "2 d.p. precision", precisionOk, precisionOk ? "All amounts ≤2 d.p." : ">2 decimals");
  push("signs", "Amount signs", signsOk, signsOk ? "Credits+/debits− correct" : "Sign errors");
  push("period", "Dates in period", periodOk, periodOk ? "All dates in range" : "Date outside period");

  // Salary schedule fidelity
  let salaryDue = 0;
  for (let d = 0; d < cfg.periodDays; d++) {
    if (isDueOnDay(d, cfg.salaryFrequency) && cfg.salaryAmount > 0) salaryDue += 1;
  }
  const salaryHits = rows.filter(
    (r) => r.description === cfg.salaryDescription && r.type === "credit",
  ).length;
  push(
    "salary",
    "Salary schedule",
    salaryDue === 0 || salaryHits === salaryDue,
    salaryDue === 0
      ? "No salary scheduled"
      : `${salaryHits}/${salaryDue} salary rows (desc matched)`,
  );

  // countOccurrences alignment
  const occ = countOccurrences(cfg.periodStart, cfg.periodDays, cfg.salaryFrequency);
  push(
    "calibrate",
    "Income calibration",
    occ === salaryDue,
    `countOccurrences=${occ} · isDueOnDay=${salaryDue}`,
  );

  // Card last4
  const cards = rows.filter((r) => r.type === "card");
  const cardOk =
    cards.length === 0 ||
    cards.every((c) => c.description.includes("*" + cfg.cardLast4));
  push(
    "card",
    "Card last4",
    cardOk,
    cards.length === 0
      ? "No card rows"
      : cardOk
        ? `All ${cards.length} cards use *${cfg.cardLast4}`
        : "Card suffix mismatch",
  );

  // Subscriptions / DD flags
  if (!cfg.hasSubscriptions) {
    const subs = rows.filter((r) => r.secondaryDescription === "SUBSCRIPTION");
    push(
      "subs",
      "Subscriptions off",
      subs.length === 0,
      subs.length === 0 ? "No subscription rows" : `${subs.length} leaked`,
    );
  }
  if (!cfg.hasDirectDebits) {
    const dd = rows.filter((r) => r.type === "direct_debit");
    push(
      "dd-off",
      "Direct debits off",
      dd.length === 0,
      dd.length === 0 ? "No DD rows" : `${dd.length} leaked`,
    );
  }

  // Summary net
  let credits = 0;
  let debits = 0;
  for (const r of rows) {
    if (r.amount > 0) credits += r.amount;
    if (r.amount < 0) debits += -r.amount;
  }
  credits = round2(credits);
  debits = round2(debits);
  const netClose = round2(cfg.openingBalance + credits - debits);
  push(
    "summary",
    "Summary totals",
    Math.abs(credits - result.summary.totalCredits) <= 0.02 &&
      Math.abs(debits - result.summary.totalDebits) <= 0.02,
    `credits ${result.summary.totalCredits} · debits ${result.summary.totalDebits}`,
  );
  push(
    "net",
    "Closing = open + net",
    Math.abs(netClose - result.summary.closingBalance) <= 0.02,
    `close ${result.summary.closingBalance} · expected ${netClose}`,
  );

  // Pagination
  const pages = paginateLedger(rows);
  const packed = pages.reduce((s, p) => s + p.rows.length, 0);
  push(
    "pages",
    "A4 pagination",
    packed === rows.length && Boolean(pages[0]?.isFirst),
    `${pages.length} page(s) · ${packed} rows packed`,
  );

  const csv = ledgerToCsv(rows);
  push(
    "csv",
    "CSV exportable",
    csv.split("\n").length >= rows.length,
    `${csv.split("\n").length} CSV lines`,
  );

  const hardFails = checks.filter((c) => c.severity === "error").length;
  const softFails = checks.filter((c) => c.severity === "warning").length;
  const passes = checks.filter((c) => c.severity === "pass").length;
  const score = Math.max(
    0,
    Math.round(
      ((passes + softFails * 0.5) / Math.max(1, checks.length)) * 100 -
        hardFails * 8,
    ),
  );

  return {
    ok: hardFails === 0 && validation.ok,
    score: Math.min(100, score),
    grade: gradeFromScore(Math.min(100, score)),
    checks,
    validation,
    summary: {
      rows: rows.length,
      credits,
      debits,
      closing: result.summary.closingBalance,
      salaryHits,
      cardHits: cards.length,
      ddHits: rows.filter((r) => r.type === "direct_debit").length,
    },
  };
}

export interface StressSuiteReport {
  n: number;
  passed: number;
  failed: number;
  totalRows: number;
  perfect: boolean;
  failures: Array<{ seed: number; messages: string[] }>;
  durationMs: number;
}

/** Run N random generations (Test Lab stress button). */
export function runStressSuite(n = 50, baseSeed = 1000): StressSuiteReport {
  const t0 = performance.now();
  const failures: StressSuiteReport["failures"] = [];
  let passed = 0;
  let totalRows = 0;
  const freqs = ["weekly", "fortnightly", "monthly"] as const;

  for (let i = 0; i < n; i++) {
    const seed = baseSeed + i * 17;
    const cfg = normalizeStatementConfig({
      ...defaultStatementConfig(),
      seed,
      periodDays: 14 + (i % 40),
      salaryFrequency: freqs[i % 3],
      salaryAmount: 1500 + (i % 20) * 100,
      cardSpendPct: 10 + (i % 30),
      billsSubsPct: 5 + (i % 25),
      hasDirectDebits: i % 5 !== 0,
      hasSubscriptions: i % 3 !== 0,
      hasRentalIncome: i % 4 === 0,
      rentalAmount: i % 4 === 0 ? 800 : 0,
      cardLast4: String(1000 + (i % 9000)),
    });
    const result = generateStatement(cfg);
    totalRows += result.rows.length;
    const q = analyzeGenerationQuality(result, cfg);
    if (q.ok) passed += 1;
    else {
      failures.push({
        seed,
        messages: q.checks
          .filter((c) => c.severity === "error")
          .map((c) => c.detail)
          .slice(0, 6),
      });
    }
  }

  return {
    n,
    passed,
    failed: n - passed,
    totalRows,
    perfect: failures.length === 0,
    failures: failures.slice(0, 12),
    durationMs: Math.round(performance.now() - t0),
  };
}

/** Suggest card spend cap text for UI. */
export function formatCapHint(config: StatementConfig): string {
  const cfg = normalizeStatementConfig(config);
  return `Card cap ≈ ${cardSpendCap(cfg).toFixed(2)} · salary due ${countOccurrences(cfg.periodStart, cfg.periodDays, cfg.salaryFrequency)}×`;
}
