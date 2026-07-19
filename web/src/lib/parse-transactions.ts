import { categorizeDescription } from "./categorize";
import { computeCompletenessScore } from "./completeness";
import { attachOriginals } from "./edit-utils";
import { parseAmount, round2 } from "./money";
import type {
  CompletenessFinding,
  ExtractionResult,
  HybridParseMeta,
  StatementSummary,
  Transaction,
} from "./types";

const MONTH =
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

const DATE_PATTERNS: RegExp[] = [
  // 12/03/2026 or 12-03-2026
  /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
  // 2026-03-12
  /\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/,
  // 12 Mar 2026 / 12 March 2026
  new RegExp(
    String.raw`\b(\d{1,2}\s+(?:${MONTH})[a-z]*\.?\s+\d{2,4})\b`,
    "i",
  ),
  // 18 Nov (St George / bank listing — year from statement period)
  new RegExp(String.raw`\b(\d{1,2}\s+(?:${MONTH})[a-z]*)\b`, "i"),
  // Mar 12, 2026
  new RegExp(
    String.raw`\b((?:${MONTH})[a-z]*\.?\s+\d{1,2},?\s+\d{2,4})\b`,
    "i",
  ),
];

// Allow leading minus before currency: -$99.30 · $10,000.00 · ($12.00)
const AMOUNT_TOKEN =
  /-?\s*[$£€]?\s*-?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?|[$£€]\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\(\s*[$£€]?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})\s*\)|-?\d+(?:\.\d{2})/;

const HEADER_HINT =
  /\b(date|description|particulars|details|debit|credit|withdrawal|deposit|balance|amount|narrative)\b/i;

const NOISE =
  /^(page\s+\d+|continued|opening\s+balance|closing\s+balance|statement\s+period|account\s+number|bsb|total|subtotal|please\s+note|important|www\.|http)/i;

/** Infer year for "18 Nov" style dates from statement text period. */
function inferYearFromContext(text: string): number {
  const m = text.match(
    /\b(20\d{2})\s*to\s*(20\d{2})\b|\b(20\d{2})-(\d{2})-(\d{2})\s*to\s*(20\d{2})|\bto\s*(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\b|\((\d{1,2})-([A-Za-z]{3})-(\d{4})\s*to\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})\)/i,
  );
  if (m) {
    for (const g of m.slice(1)) {
      if (g && /^20\d{2}$/.test(g)) return Number(g);
      if (g && /^\d{4}$/.test(g)) return Number(g);
    }
  }
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((x) => Number(x[1]));
  if (years.length) return years[years.length - 1];
  return new Date().getUTCFullYear();
}

export function normalizeDate(raw: string, yearHint?: number): string {
  const s = raw.trim().replace(/\s+/g, " ");
  // 18 Nov / 18 November
  const monOnly = s.match(
    new RegExp(
      `^(\\d{1,2})\\s+(${MONTH})[a-z]*$`,
      "i",
    ),
  );
  if (monOnly) {
    const day = monOnly[1].padStart(2, "0");
    const monMap: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const mon = monMap[monOnly[2].slice(0, 3).toLowerCase()] ?? "01";
    const y = yearHint ?? new Date().getUTCFullYear();
    return `${y}-${mon}-${day}`;
  }

  // Try Date parse for month-name forms
  const tryDate = new Date(s);
  if (!Number.isNaN(tryDate.getTime()) && /[a-zA-Z]/.test(s) && /\d{4}/.test(s)) {
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
  return extractDateWithYear(line, new Date().getUTCFullYear());
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

export interface ParseHybridResult {
  transactions: Transaction[];
  meta: HybridParseMeta;
}

/**
 * Hybrid extraction: primary line parser + continuation recovery +
 * secondary pass for amount-only dated lines that the first pass may miss.
 */
export function parseTransactionsFromText(text: string): Transaction[] {
  return parseTransactionsHybrid(text).transactions;
}

export function parseTransactionsHybrid(text: string): ParseHybridResult {
  const yearHint = inferYearFromContext(text);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const txns: Transaction[] = [];
  let pending: Transaction | null = null;
  let recoveredContinuationLines = 0;
  const enginesTried = [
    "line-parser",
    "continuation-recovery",
    "column-pass",
    "st-george-multiline",
  ];

  for (const line of lines) {
    if (!isLikelyTxnLine(line)) {
      // Amount-only continuation line: -$99.30   $64,474.33
      if (pending) {
        const amtLine = line.match(
          new RegExp(`^(${AMOUNT_TOKEN})\\s+(${AMOUNT_TOKEN})$`, "i"),
        );
        if (amtLine) {
          const a0 = parseAmount(amtLine[1]);
          const a1 = parseAmount(amtLine[2]);
          if (a0 != null && a1 != null) {
            if (a0 < 0 || /debit|purchase|withdrawal|payment|eftpos|osko withdrawal/i.test(pending.description)) {
              pending.debit = Math.abs(a0);
              pending.credit = null;
            } else if (a0 > 0 && /deposit|salary|credit|sct|transfer|leav/i.test(pending.description)) {
              pending.credit = Math.abs(a0);
              pending.debit = null;
            } else if (a0 < 0) {
              pending.debit = Math.abs(a0);
            } else {
              // signed amount on St George: negative prefix = debit
              const raw = amtLine[1];
              if (/^\s*-/.test(raw) || raw.includes("-$")) {
                pending.debit = Math.abs(a0);
                pending.credit = null;
              } else {
                pending.credit = Math.abs(a0);
                pending.debit = null;
              }
            }
            pending.balance = Math.abs(a1);
            continue;
          }
        }
      }
      if (pending && line.length > 2 && !HEADER_HINT.test(line) && !NOISE.test(line)) {
        if (!AMOUNT_TOKEN.test(line) || line.length > 20) {
          pending.description = `${pending.description} ${line}`.trim();
          recoveredContinuationLines += 1;
        }
      }
      continue;
    }

    const dated = extractDateWithYear(line, yearHint);
    if (!dated) continue;

    const { description, amounts } = extractAmounts(dated.rest);
    // St George often has description on date line without amounts yet
    if (!description && amounts.length === 0) continue;

    const { debit, credit, balance } = classifyDebitCredit(amounts, description);
    // Allow pending without amounts (filled by next amount line)
    if (debit == null && credit == null && balance == null && !description) continue;

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
  let filtered = txns.filter((t) => {
    if (HEADER_HINT.test(t.description) && t.description.split(" ").length <= 6) {
      return false;
    }
    // drop rows still missing all money after multi-line fill
    if (t.debit == null && t.credit == null && t.balance == null) return false;
    return true;
  });

  // Secondary pass: tab/multi-space column split for lines the primary may have mis-split
  const secondary = secondaryColumnPass(lines, filtered, yearHint);
  if (secondary.length > filtered.length) {
    filtered = secondary;
  }

  // St George multi-line specialist when still sparse
  if (filtered.length < 5) {
    const stg = parseStGeorgeMultiline(lines, yearHint);
    if (stg.length > filtered.length) {
      filtered = stg;
    }
  }

  const withOriginals = attachOriginals(filtered);

  return {
    transactions: withOriginals,
    meta: {
      lineParserCount: filtered.length,
      recoveredContinuationLines,
      aiValidated: false,
      enginesTried,
    },
  };
}

function extractDateWithYear(
  line: string,
  yearHint: number,
): { date: string; rest: string } | null {
  for (const re of DATE_PATTERNS) {
    const m = line.match(re);
    if (m && m.index != null) {
      const date = normalizeDate(m[1], yearHint);
      // require ISO-like result
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const rest = (
        line.slice(0, m.index) + line.slice(m.index + m[0].length)
      ).trim();
      return { date, rest };
    }
  }
  return null;
}

/**
 * St George "Transaction Listing" multi-line rows:
 *   18 Nov   Visa Purchase 14Nov
 *   Oz Lotteries Melbourne
 *   -$99.30   $64,474.33
 */
function parseStGeorgeMultiline(
  lines: string[],
  yearHint: number,
): Transaction[] {
  const monRe = new RegExp(
    `^(\\d{1,2}\\s+(?:${MONTH})[a-z]*)\\s+(.+)$`,
    "i",
  );
  const amtRe =
    /^(-?\s*\$?\s*-?\s*[\d,]+\.\d{2})\s+(\$?\s*[\d,]+\.\d{2})\s*$/;

  const out: Transaction[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(monRe);
    if (!m) {
      i += 1;
      continue;
    }
    const date = normalizeDate(m[1], yearHint);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      i += 1;
      continue;
    }
    let description = m[2].trim();
    // strip trailing amounts if present on same line
    let j = i + 1;
    let debit: number | null = null;
    let credit: number | null = null;
    let balance: number | null = null;

    // gather description lines until amount line
    while (j < lines.length && !amtRe.test(lines[j]) && !monRe.test(lines[j])) {
      if (
        lines[j].length > 1 &&
        !HEADER_HINT.test(lines[j]) &&
        !NOISE.test(lines[j])
      ) {
        description = `${description} ${lines[j]}`.trim();
      }
      j += 1;
    }

    if (j < lines.length && amtRe.test(lines[j])) {
      const am = lines[j].match(amtRe)!;
      const a0 = parseAmount(am[1]);
      const a1 = parseAmount(am[2]);
      if (a0 != null && a1 != null) {
        const signedDebit =
          /^\s*-/.test(am[1]) || am[1].includes("-$") || a0 < 0;
        if (signedDebit) {
          debit = Math.abs(a0);
        } else if (
          /deposit|salary|credit|sct|transfer|leav|refund|interest/i.test(
            description,
          )
        ) {
          credit = Math.abs(a0);
        } else if (
          /purchase|debit|withdrawal|payment|eftpos|fee|osko withdrawal|visa/i.test(
            description,
          )
        ) {
          debit = Math.abs(a0);
        } else if (a0 < 0) {
          debit = Math.abs(a0);
        } else {
          credit = Math.abs(a0);
        }
        balance = Math.abs(a1);
      }
      j += 1;
    }

    if (debit != null || credit != null || balance != null) {
      const { category, confidence } = categorizeDescription(
        description,
        credit,
        debit,
      );
      out.push({
        id: uid("stg", out.length),
        date,
        description,
        debit,
        credit,
        balance,
        category,
        categorySource: "heuristic",
        categoryConfidence: confidence,
        flags: ["st-george"],
      });
    }
    i = Math.max(j, i + 1);
  }
  return out;
}

/** Recover rows using multi-space / tab column heuristics when primary under-extracts. */
function secondaryColumnPass(
  lines: string[],
  existing: Transaction[],
  yearHint?: number,
): Transaction[] {
  if (existing.length >= 3) return existing;

  const found: Transaction[] = [...existing];
  const seen = new Set(
    existing.map((t) => `${t.date}|${t.description.slice(0, 24)}|${t.debit}|${t.credit}`),
  );

  for (const line of lines) {
    const dated = extractDateWithYear(line, yearHint ?? new Date().getUTCFullYear());
    if (!dated) continue;
    const parts = dated.rest.split(/\s{2,}|\t+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;

    const amountParts: number[] = [];
    const textParts: string[] = [];
    for (const p of parts) {
      const n = parseAmount(p);
      if (n != null && /[\d]/.test(p) && Math.abs(n) >= 0.01 && p.length < 16) {
        amountParts.push(Math.abs(n));
      } else {
        textParts.push(p);
      }
    }
    if (amountParts.length === 0) continue;
    const description = textParts.join(" ").trim() || "Transaction";
    const { debit, credit, balance } = classifyDebitCredit(amountParts, description);
    const key = `${dated.date}|${description.slice(0, 24)}|${debit}|${credit}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { category, confidence } = categorizeDescription(description, credit, debit);
    found.push({
      id: uid("txn-sec", found.length),
      date: dated.date,
      description,
      debit,
      credit,
      balance,
      category,
      categorySource: "heuristic",
      categoryConfidence: confidence,
      flags: ["secondary-pass"],
    });
  }

  return found;
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
  hybrid?: HybridParseMeta;
  aiValidated?: boolean;
  aiScoreHint?: number | null;
  findings?: CompletenessFinding[];
  parser?: ExtractionResult["parser"];
}): ExtractionResult {
  const limitedExtraction =
    params.rawText.trim().length < 80 || params.transactions.length === 0;

  const transactions = attachOriginals(params.transactions);
  const summary = buildSummary(transactions);
  const findings = params.findings
    ? [...params.findings]
    : analyzeCompleteness(transactions);

  if (limitedExtraction && !findings.some((f) => f.id === "limited")) {
    findings.unshift({
      id: "limited",
      severity: "warning",
      title: "Limited text extraction",
      detail:
        "This PDF has little extractable text (often a scan). Results may be incomplete. Optical character recognition is not enabled in this version.",
    });
  }

  const completenessScore = computeCompletenessScore({
    transactions,
    rawTextLength: params.rawText.length,
    pageCount: params.pageCount,
    findings,
    limitedExtraction,
    aiValidated: params.aiValidated ?? params.hybrid?.aiValidated ?? false,
    aiScoreHint: params.aiScoreHint,
  });

  return {
    fileName: params.fileName,
    pageCount: params.pageCount,
    rawText: params.rawText,
    textLength: params.rawText.length,
    limitedExtraction,
    transactions,
    summary,
    findings,
    completenessScore,
    extractedAt: new Date().toISOString(),
    hybrid: params.hybrid,
    parser: params.parser,
  };
}
