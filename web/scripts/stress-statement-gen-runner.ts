/**
 * Extreme statement-generation stress harness.
 * Run: npx tsx scripts/stress-statement-gen-runner.ts
 * Env: STRESS_N=500 (default 250)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultStatementConfig,
  generateStatement,
  ledgerToCsv,
  normalizeStatementConfig,
  paginateLedger,
  validateLedger,
  type Frequency,
  type GenCategory,
  type StatementConfig,
} from "../src/lib/statement-gen/index.ts";

const FREQS: Frequency[] = ["none", "weekly", "fortnightly", "monthly"];
const BILL_CATS: GenCategory[] = [
  "Telecom",
  "Utilities",
  "Health",
  "Insurance",
  "Entertainment",
  "Financial",
  "TaxSuper",
  "Other",
];

type Issue = {
  seed: number;
  tag: string;
  severity: "error" | "warning";
  message: string;
};

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function randomConfig(seed: number): StatementConfig {
  const rng = mulberry(seed);
  const base = defaultStatementConfig();
  const periodDays = 7 + Math.floor(rng() * 60);
  const hasRental = rng() > 0.6;
  const hasDD = rng() > 0.15;
  const hasSubs = rng() > 0.35;
  const nCats = 1 + Math.floor(rng() * BILL_CATS.length);
  const shuffled = [...BILL_CATS].sort(() => rng() - 0.5);
  const selected = shuffled.slice(0, nCats);
  const month = 1 + Math.floor(rng() * 12);

  return normalizeStatementConfig({
    ...base,
    seed,
    periodStart: `2025-${String(month).padStart(2, "0")}-01`,
    periodDays,
    openingBalance: Math.round((200 + rng() * 15000) * 100) / 100,
    savingsOpeningBalance: Math.round(rng() * 50000 * 100) / 100,
    salaryAmount: Math.round((800 + rng() * 6000) * 100) / 100,
    salaryFrequency: pick(
      rng,
      FREQS.filter((f) => f !== "none"),
    ),
    salaryDescription: "SALARY STRESS TEST CORP",
    salaryAccount: `PAY-${Math.floor(rng() * 9999)}`,
    hasRentalIncome: hasRental,
    rentalAmount: hasRental
      ? Math.round((200 + rng() * 2000) * 100) / 100
      : 0,
    rentalDescription: "RENTAL INCOME STRESS",
    savingsAmount: Math.round(rng() * 800 * 100) / 100,
    savingsFrequency: pick(rng, FREQS),
    savingsDescription: "TO BONUS SAVER",
    savingsAccount: "SAV-99",
    mortgageAmount: Math.round((500 + rng() * 2500) * 100) / 100,
    mortgageFrequency: pick(rng, FREQS),
    mortgageDescription: "HOME LOAN STRESS",
    mortgageLender: "LENDER CO",
    loanReference: `LN-${Math.floor(rng() * 1e6)}`,
    cardLast4: String(1000 + Math.floor(rng() * 9000)),
    cardSpendPct: Math.round(rng() * 50),
    billsSubsPct: Math.round(rng() * 40),
    billSpendMultiplier: Math.round((0.5 + rng() * 2) * 100) / 100,
    hasDirectDebits: hasDD,
    hasSubscriptions: hasSubs,
    selectedBillCategories: selected,
    account: {
      ...base.account,
      holderName: `Stress Tester ${seed}`,
      accountName: "Everyday Stress",
      bsb: `062-${String(100 + Math.floor(rng() * 800)).padStart(3, "0")}`,
      accountNumber: String(10000000 + Math.floor(rng() * 89999999)),
      customerID: `CUS-${seed}`,
      interestRate: Math.round(rng() * 5 * 100) / 100,
      branch: "Stress Branch",
      timezone: "Australia/Sydney",
      bonusAccount: "11112222",
      bonusBsb: "062-111",
      everydayAccount: "33334444",
      everydayBsb: "062-000",
    },
    address: {
      addressLine1: `${seed} Stress St`,
      addressLine2: `Unit ${1 + Math.floor(rng() * 20)}`,
      addressStreet: `${seed} Stress St`,
      addressCity: "Sydney NSW 2000",
    },
    entity: {
      entityName: "Stress Bank Pty Ltd",
      entityAddress: "1 Tower",
      entityCity: "Sydney",
      entityState: "NSW",
      entityCountry: "Australia",
    },
  });
}

function deepRealismChecks(
  result: ReturnType<typeof generateStatement>,
  config: StatementConfig,
): Issue[] {
  const issues: Issue[] = [];
  const rows = result.rows;
  const open = rows[0];
  const close = rows[rows.length - 1];

  if (open?.type !== "opening") {
    issues.push({
      seed: config.seed,
      tag: "structure",
      severity: "error",
      message: "First row not opening",
    });
  }
  if (close?.type !== "closing") {
    issues.push({
      seed: config.seed,
      tag: "structure",
      severity: "error",
      message: "Last row not closing",
    });
  }

  for (const r of rows) {
    if (!Number.isFinite(r.amount) || !Number.isFinite(r.balance)) {
      issues.push({
        seed: config.seed,
        tag: "nan",
        severity: "error",
        message: `Non-finite on ${r.id}`,
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      issues.push({
        seed: config.seed,
        tag: "date",
        severity: "error",
        message: `Bad date ${r.date}`,
      });
    }
    if (r.description.trim().length === 0) {
      issues.push({
        seed: config.seed,
        tag: "desc",
        severity: "error",
        message: `Empty description ${r.id}`,
      });
    }
    if (r.type === "credit" || r.type === "rental") {
      if (r.amount <= 0) {
        issues.push({
          seed: config.seed,
          tag: "sign",
          severity: "error",
          message: `${r.type} non-positive ${r.amount}`,
        });
      }
    }
    if (
      ["debit", "transfer", "direct_debit", "card", "peer"].includes(r.type)
    ) {
      if (r.amount >= 0) {
        issues.push({
          seed: config.seed,
          tag: "sign",
          severity: "error",
          message: `${r.type} non-negative ${r.amount}`,
        });
      }
    }
    if (r.type === "opening" || r.type === "closing") {
      if (r.amount !== 0) {
        issues.push({
          seed: config.seed,
          tag: "marker",
          severity: "error",
          message: `Marker amount ${r.amount}`,
        });
      }
    }
    const a = Math.round(r.amount * 100) / 100;
    const b = Math.round(r.balance * 100) / 100;
    if (Math.abs(a - r.amount) > 1e-9 || Math.abs(b - r.balance) > 1e-9) {
      issues.push({
        seed: config.seed,
        tag: "precision",
        severity: "error",
        message: `>2dp on ${r.id}`,
      });
    }
  }

  if (config.salaryAmount > 0 && config.salaryFrequency !== "none") {
    const sal = rows.filter((r) => r.description === config.salaryDescription);
    if (sal.length === 0) {
      issues.push({
        seed: config.seed,
        tag: "salary",
        severity: "warning",
        message: "Configured salary description never appeared",
      });
    }
  }

  for (const c of rows.filter((r) => r.type === "card")) {
    if (!c.description.includes("*" + config.cardLast4)) {
      issues.push({
        seed: config.seed,
        tag: "card",
        severity: "error",
        message: `Card row missing *${config.cardLast4}: ${c.description}`,
      });
    }
  }

  if (!config.hasSubscriptions) {
    const subs = rows.filter((r) => r.secondaryDescription === "SUBSCRIPTION");
    if (subs.length) {
      issues.push({
        seed: config.seed,
        tag: "subs",
        severity: "error",
        message: `${subs.length} subscriptions despite hasSubscriptions=false`,
      });
    }
  }

  if (!config.hasDirectDebits) {
    const dd = rows.filter((r) => r.type === "direct_debit");
    if (dd.length) {
      issues.push({
        seed: config.seed,
        tag: "dd",
        severity: "error",
        message: `${dd.length} DD rows despite hasDirectDebits=false`,
      });
    }
  }

  let credits = 0;
  let debits = 0;
  for (const r of rows) {
    if (r.amount > 0) credits += r.amount;
    if (r.amount < 0) debits += -r.amount;
  }
  credits = Math.round(credits * 100) / 100;
  debits = Math.round(debits * 100) / 100;
  if (Math.abs(credits - result.summary.totalCredits) > 0.02) {
    issues.push({
      seed: config.seed,
      tag: "summary",
      severity: "error",
      message: `Credits summary ${result.summary.totalCredits} vs ${credits}`,
    });
  }
  if (Math.abs(debits - result.summary.totalDebits) > 0.02) {
    issues.push({
      seed: config.seed,
      tag: "summary",
      severity: "error",
      message: `Debits summary ${result.summary.totalDebits} vs ${debits}`,
    });
  }

  const netClose =
    Math.round((config.openingBalance + credits - debits) * 100) / 100;
  if (Math.abs(netClose - result.summary.closingBalance) > 0.02) {
    issues.push({
      seed: config.seed,
      tag: "net",
      severity: "error",
      message: `Net close ${result.summary.closingBalance} ≠ open+net ${netClose}`,
    });
  }

  const pages = paginateLedger(rows);
  const packed = pages.reduce((s, p) => s + p.rows.length, 0);
  if (packed !== rows.length) {
    issues.push({
      seed: config.seed,
      tag: "page",
      severity: "error",
      message: `Pagination ${packed} ≠ ${rows.length}`,
    });
  }
  if (!pages[0]?.isFirst || !pages[pages.length - 1]?.isLast) {
    issues.push({
      seed: config.seed,
      tag: "page",
      severity: "error",
      message: "Page first/last flags wrong",
    });
  }

  const csv = ledgerToCsv(rows);
  if (csv.split("\n").length < rows.length) {
    issues.push({
      seed: config.seed,
      tag: "csv",
      severity: "error",
      message: "CSV row count short",
    });
  }

  const start = config.periodStart;
  const end = result.periodEnd;
  for (const r of rows) {
    if (r.date < start || r.date > end) {
      issues.push({
        seed: config.seed,
        tag: "period",
        severity: "error",
        message: `Date ${r.date} outside ${start}..${end}`,
      });
    }
  }

  // Category filter: DD categories must be selected
  const allowed = new Set(config.selectedBillCategories);
  for (const r of rows.filter((x) => x.type === "direct_debit")) {
    if (!allowed.has(r.category as GenCategory)) {
      issues.push({
        seed: config.seed,
        tag: "category",
        severity: "error",
        message: `DD category ${r.category} not in selectedBillCategories`,
      });
    }
  }

  return issues;
}

const N = Number(process.env.STRESS_N || 250);
const allIssues: Issue[] = [];
let failConfigs = 0;
let passConfigs = 0;
let totalRows = 0;
const samples: unknown[] = [];

for (let i = 0; i < N; i++) {
  const seed = 1000 + i * 17 + (i % 7);
  const config = randomConfig(seed);
  const result = generateStatement(config);
  totalRows += result.rows.length;
  const v = validateLedger(result.rows, config.openingBalance);
  const deep = deepRealismChecks(result, config);

  for (const iss of v.issues) {
    if (iss.severity === "error" || iss.severity === "warning") {
      allIssues.push({
        seed,
        tag: "validate",
        severity: iss.severity,
        message: iss.message,
      });
    }
  }
  allIssues.push(...deep);

  const hasError =
    !v.ok ||
    deep.some((d) => d.severity === "error") ||
    v.issues.some((i) => i.severity === "error");

  if (hasError) failConfigs += 1;
  else passConfigs += 1;

  if (i < 3 || hasError) {
    samples.push({
      seed,
      ok: !hasError,
      rows: result.rows.length,
      open: result.summary.openingBalance,
      close: result.summary.closingBalance,
      issues: [
        ...v.issues.map((x) => x.message),
        ...deep.map((d) => d.message),
      ].slice(0, 15),
    });
  }
}

// Determinism
for (let i = 0; i < 30; i++) {
  const seed = 5000 + i;
  const c = randomConfig(seed);
  const a = generateStatement(c);
  const b = generateStatement(c);
  if (JSON.stringify(a.rows) !== JSON.stringify(b.rows)) {
    allIssues.push({
      seed,
      tag: "determinism",
      severity: "error",
      message: "Non-deterministic generation",
    });
    failConfigs += 1;
  }
}

const errors = allIssues.filter((i) => i.severity === "error");
const warnings = allIssues.filter((i) => i.severity === "warning");
const byTag = new Map<string, number>();
for (const i of errors) byTag.set(i.tag, (byTag.get(i.tag) || 0) + 1);

const report = {
  N,
  passConfigs,
  failConfigs,
  totalRows,
  errorCount: errors.length,
  warningCount: warnings.length,
  errorsByTag: Object.fromEntries(byTag),
  sampleErrors: errors.slice(0, 50),
  samples: samples.slice(0, 20),
  perfect: errors.length === 0,
};

const outDir = resolve("scripts/.stress-out");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.perfect ? 0 : 1);
