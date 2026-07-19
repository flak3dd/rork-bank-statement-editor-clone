import { categorizeDescription } from "./categorize";
import { parseAmount, round2 } from "./money";
import type {
  CompletenessFinding,
  ExtractionResult,
  StatementSummary,
  Transaction,
} from "./types";

const DATE_PATTERNS: RegExp[] = [
  // 12/03/2026 or 12-03-2026
  /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
  // 2026-03-12
  /\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/,
  // 12 Mar 2026 / 12 March 2026
  /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4})\b/i,
  // Mar 12, 2026
  /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4})\b/i,
];

const AMOUNT_TOKEN =
  /[($£€]?\s*-?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s*\)?|\(\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})\s*\)|-?\d+(?:[.,]\d{2})/;

const HEADER_HINT =
  /\b(date|description|particulars|details|debit|credit|withdrawal|deposit|balance|amount|narrative)\b/i;

const NOISE =
  /^(page\s+\d+|continued|opening\s+balance|closing\s+balance|statement\s+period|account\s+number|bsb|total|subtotal|please\s+note|important|www\.|http)/i;

function normalizeDate(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  // Try Date parse for month-name forms
  const tryDate = new Date(s);
  if (!Number.isNaN(tryDate.getTime()) && /[a-zA-Z]/.test(s)) {
    return tryDate.toISOString().slice(0, 10);
  }

  // yyyy-mm-dd
  const iso = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (iso) {
    const y = iso[1];
    const m = iso[2].padStart(2, "0");
    const d = iso[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // dd/mm/yyyy or mm/dd/yyyy — prefer day-first for AU-style statements
  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    let y = slash[3];
    if (y.length === 2) y = Number(y) > 70 ? `19${y}` : `20${y}`;
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    // If first > 12, must be day-first
    if (a > 12) {
      return `${y}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
    }
    // If second > 12, must be month-first
    if (b > 12) {
      return `${y}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
    }
    // Ambiguous: day-first default
    return `${y}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
  }

  return s;
}

function extractDate(line: string): { date: string; rest: string } | null {
  for (const re of DATE_PATTERNS) {
    const m = line.match(re);
    if (m && m.index != null) {
      const date = normalizeDate(m[1]);
      const rest = (line.slice(0, m.index) + line.slice(m.index + m[0].length)).trim();
      return { date, rest };
    }
  }
  return null;
}

function extractAmounts(rest: string): {
  description: string;
  amounts: number[];
} {
  const amounts: number[] = [];
  const matches = [...rest.matchAll(new RegExp(AMOUNT_TOKEN, "g"))];
  // Prefer trailing amount tokens (rightmost columns)
  const significant = matches.filter((m) => {
    const v = parseAmount(m[0]);
    return v != null && Math.abs(v) >= 0.01;
  });

  // Take up to last 3 amount-like tokens
  const tail = significant.slice(-3);
  let cutAt = rest.length;
  for (const m of tail) {
    if (m.index != null && m.index < cutAt) cutAt = m.index;
    const v = parseAmount(m[0]);
    if (v != null) amounts.push(Math.abs(v));
  }

  let description = rest.slice(0, cutAt).trim();
  description = description.replace(/[\s|·•]+$/g, "").replace(/\s{2,}/g, " ");
  return { description, amounts };
}

function isLikelyTxnLine(line: string): boolean {
  if (line.length < 8) return false;
  if (HEADER_HINT.test(line) && !extractDate(line)) return false;
  if (NOISE.test(line.trim())) return false;
  return extractDate(line) != null;
}

function classifyDebitCredit(
  amounts: number[],
  description: string,
): { debit: number | null; credit: number | null; balance: number | null } {
  if (amounts.length === 0) {
    return { debit: null, credit: null, balance: null };
  }

  if (amounts.length === 1) {
    const only = amounts[0];
    // Heuristic: income-like words → credit
    if (/\b(deposit|salary|payroll|refund|interest\s*credit|incoming)\b/i.test(description)) {
      return { debit: null, credit: only, balance: null };
    }
    if (/\b(withdrawal|purchase|payment|fee|debit|pos)\b/i.test(description)) {
      return { debit: only, credit: null, balance: null };
    }
    // Default single amount as debit (most statement lines are outflows)
    return { debit: only, credit: null, balance: null };
  }

  if (amounts.length === 2) {
    // amount + balance
    return { debit: amounts[0], credit: null, balance: amounts[1] };
  }

  // 3 amounts: debit, credit, balance — zeros mean empty column
  const [a, b, c] = amounts;
  let debit: number | null = a;
  let credit: number | null = b;
  if (a === 0) debit = null;
  if (b === 0) credit = null;
  // If both non-zero rare; keep as-is
  if (debit != null && credit != null && debit > 0 && credit > 0) {
    // Prefer larger as the movement if one looks like balance already in c
    // keep both for review
  }
  return { debit, credit, balance: c };
}

function uid(prefix: string, i: number): string {
  return `${prefix}-${i}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Parse plain statement text into structured transactions. */
export function parseTransactionsFromText(text: string): Transaction[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const txns: Transaction[] = [];
  let pending: Transaction | null = null;

  for (const line of lines) {
    if (!isLikelyTxnLine(line)) {
      // Continuation line for previous description
      if (pending && line.length > 2 && !HEADER_HINT.test(line) && !NOISE.test(line)) {
        if (!AMOUNT_TOKEN.test(line) || line.length > 20) {
          pending.description = `${pending.description} ${line}`.trim();
        }
      }
      continue;
    }

    const dated = extractDate(line);
    if (!dated) continue;

    const { description, amounts } = extractAmounts(dated.rest);
    if (!description && amounts.length === 0) continue;

    const { debit, credit, balance } = classifyDebitCredit(amounts, description);
    if (debit == null && credit == null && balance == null) continue;

    const { category, confidence } = categorizeDescription(
      description || "Unknown",
      credit,
      debit,
    );

    if (pending) txns.push(pending);

    pending = {
      id: uid("txn", txns.length),
      date: dated.date,
      description: description || "Transaction",
      debit,
      credit,
      balance,
      category,
      categorySource: "heuristic",
      categoryConfidence: confidence,
      flags: [],
    };
  }

  if (pending) txns.push(pending);

  // Drop obvious header false-positives
  return txns.filter((t) => {
    if (HEADER_HINT.test(t.description) && t.description.split(" ").length <= 6) {
      return false;
    }
    return true;
  });
}

export function buildSummary(transactions: Transaction[]): StatementSummary {
  let totalIn = 0;
  let totalOut = 0;
  for (const t of transactions) {
    if (t.credit != null) totalIn += t.credit;
    if (t.debit != null) totalOut += t.debit;
  }
  totalIn = round2(totalIn);
  totalOut = round2(totalOut);

  const withBal = transactions.filter((t) => t.balance != null);
  const openingBalance = withBal.length ? withBal[0].balance : null;
  // Opening is often before first txn; if first row balance exists after txn, approximate
  const closingBalance = withBal.length ? withBal[withBal.length - 1].balance : null;

  const dates = transactions
    .map((t) => t.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  return {
    transactionCount: transactions.length,
    totalIn,
    totalOut,
    net: round2(totalIn - totalOut),
    openingBalance,
    closingBalance,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
  };
}

/** Local completeness / math consistency checks (report only). */
export function analyzeCompleteness(transactions: Transaction[]): CompletenessFinding[] {
  const findings: CompletenessFinding[] = [];

  if (transactions.length === 0) {
    findings.push({
      id: "empty",
      severity: "warning",
      title: "No transactions detected",
      detail:
        "We couldn't find dated transaction rows. The PDF may be image-only or use an unusual layout. You can still export raw text notes later.",
    });
    return findings;
  }

  // Dual debit+credit
  transactions.forEach((t) => {
    if (t.debit != null && t.credit != null && t.debit > 0 && t.credit > 0) {
      findings.push({
        id: `dual-${t.id}`,
        severity: "info",
        title: "Both debit and credit present",
        detail: `“${t.description.slice(0, 40)}” has both columns filled — verify the source columns.`,
        transactionId: t.id,
      });
    }
  });

  // Running balance consistency where possible
  const withBal = transactions.filter(
    (t) => t.balance != null && (t.debit != null || t.credit != null),
  );
  for (let i = 1; i < withBal.length; i++) {
    const prev = withBal[i - 1];
    const cur = withBal[i];
    if (prev.balance == null || cur.balance == null) continue;
    const movement = (cur.credit ?? 0) - (cur.debit ?? 0);
    const expected = round2(prev.balance + movement);
    const drift = round2(Math.abs(expected - cur.balance));
    if (drift > 0.05) {
      findings.push({
        id: `bal-${cur.id}`,
        severity: drift > 1 ? "warning" : "info",
        title: "Running balance may not match",
        detail: `After “${cur.description.slice(0, 36)}”, expected ~${expected.toFixed(2)} but saw ${cur.balance.toFixed(2)} (Δ ${drift.toFixed(2)}). This is a report only — the PDF is not modified.`,
        transactionId: cur.id,
      });
      // Flag row
      if (!cur.flags.includes("balance-mismatch")) {
        cur.flags.push("balance-mismatch");
      }
    }
  }

  // Large gap in dates
  const dated = transactions
    .map((t) => ({ t, d: Date.parse(t.date) }))
    .filter((x) => !Number.isNaN(x.d))
    .sort((a, b) => a.d - b.d);

  for (let i = 1; i < dated.length; i++) {
    const gapDays = (dated[i].d - dated[i - 1].d) / (1000 * 60 * 60 * 24);
    if (gapDays >= 21) {
      findings.push({
        id: `gap-${dated[i].t.id}`,
        severity: "info",
        title: "Date gap between transactions",
        detail: `${Math.floor(gapDays)} days between ${dated[i - 1].t.date} and ${dated[i].t.date}. Possible missing pages or quiet period.`,
        transactionId: dated[i].t.id,
      });
    }
  }

  // Sparse extraction relative to text
  if (transactions.length < 3) {
    findings.push({
      id: "sparse",
      severity: "warning",
      title: "Very few rows extracted",
      detail: "Only a handful of transactions were found. Review the table carefully before exporting.",
    });
  }

  return findings.slice(0, 40);
}

export function buildExtractionResult(params: {
  fileName: string;
  pageCount: number;
  rawText: string;
  transactions: Transaction[];
}): ExtractionResult {
  const limitedExtraction =
    params.rawText.trim().length < 80 || params.transactions.length === 0;

  const summary = buildSummary(params.transactions);
  const findings = analyzeCompleteness(params.transactions);

  if (limitedExtraction) {
    findings.unshift({
      id: "limited",
      severity: "warning",
      title: "Limited text extraction",
      detail:
        "This PDF has little extractable text (often a scan). Results may be incomplete. Optical character recognition is not enabled in this version.",
    });
  }

  return {
    fileName: params.fileName,
    pageCount: params.pageCount,
    rawText: params.rawText,
    textLength: params.rawText.length,
    limitedExtraction,
    transactions: params.transactions,
    summary,
    findings,
    extractedAt: new Date().toISOString(),
  };
}
