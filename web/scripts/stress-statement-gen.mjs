/**
 * Extreme generation stress harness.
 * Generates many configs, validates ledger invariants, realism, and
 * (optionally) PyMuPDF layout replication of a fixture.
 *
 * Usage: node scripts/stress-statement-gen.mjs
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, "..");
const repoRoot = resolve(webRoot, "..");

// Load via vitest-friendly dynamic import of built modules is hard;
// use tsx if available, else compile inline with node --experimental
// Prefer importing through vite-node / tsx
async function loadGen() {
  try {
    // Use tsx register path
    const { register } = await import("node:module");
    // fallback: spawn vitest-style import via dynamic path
  } catch {
    /* ignore */
  }
  // Use child process with npx tsx
  return null;
}

const stressRunnerTs = `
import {
  defaultStatementConfig,
  generateStatement,
  normalizeStatementConfig,
  validateLedger,
  paginateLedger,
  ledgerToCsv,
  type StatementConfig,
  type Frequency,
  type GenCategory,
} from "../src/lib/statement-gen/index.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const FREQS: Frequency[] = ["none", "weekly", "fortnightly", "monthly"];
const BILL_CATS: GenCategory[] = [
  "Telecom", "Utilities", "Health", "Insurance", "Entertainment", "Financial", "TaxSuper", "Other",
];

type Issue = { seed: number; tag: string; severity: string; message: string };

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
  const selected = [...BILL_CATS].sort(() => rng() - 0.5).slice(0, nCats);
  return normalizeStatementConfig({
    ...base,
    seed,
    periodStart: \`2025-\${String(1 + Math.floor(rng() * 12)).padStart(2, "0")}-01\`,
    periodDays,
    openingBalance: Math.round((200 + rng() * 15000) * 100) / 100,
    savingsOpeningBalance: Math.round(rng() * 50000 * 100) / 100,
    salaryAmount: Math.round((800 + rng() * 6000) * 100) / 100,
    salaryFrequency: pick(rng, FREQS.filter((f) => f !== "none")),
    salaryDescription: "SALARY STRESS TEST CORP",
    salaryAccount: "PAY-" + Math.floor(rng() * 9999),
    hasRentalIncome: hasRental,
    rentalAmount: hasRental ? Math.round((200 + rng() * 2000) * 100) / 100 : 0,
    rentalDescription: "RENTAL INCOME STRESS",
    savingsAmount: Math.round(rng() * 800 * 100) / 100,
    savingsFrequency: pick(rng, FREQS),
    savingsDescription: "TO BONUS SAVER",
    savingsAccount: "SAV-99",
    mortgageAmount: Math.round((500 + rng() * 2500) * 100) / 100,
    mortgageFrequency: pick(rng, FREQS),
    mortgageDescription: "HOME LOAN STRESS",
    mortgageLender: "LENDER CO",
    loanReference: "LN-" + Math.floor(rng() * 1e6),
    cardLast4: String(1000 + Math.floor(rng() * 9000)),
    cardSpendPct: Math.round(rng() * 50),
    billsSubsPct: Math.round(rng() * 40),
    billSpendMultiplier: Math.round((0.5 + rng() * 2) * 100) / 100,
    hasDirectDebits: hasDD,
    hasSubscriptions: hasSubs,
    selectedBillCategories: selected,
    account: {
      ...base.account,
      holderName: "Stress Tester " + seed,
      accountName: "Everyday Stress",
      bsb: "062-" + String(100 + Math.floor(rng() * 800)).padStart(3, "0"),
      accountNumber: String(10000000 + Math.floor(rng() * 89999999)),
      customerID: "CUS-" + seed,
      interestRate: Math.round(rng() * 5 * 100) / 100,
      branch: "Stress Branch",
      timezone: "Australia/Sydney",
      bonusAccount: "11112222",
      bonusBsb: "062-111",
      everydayAccount: "33334444",
      everydayBsb: "062-000",
    },
    address: {
      addressLine1: seed + " Stress St",
      addressLine2: "Unit " + (1 + Math.floor(rng() * 20)),
      addressStreet: seed + " Stress St",
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
    issues.push({ seed: config.seed, tag: "structure", severity: "error", message: "First row not opening" });
  }
  if (close?.type !== "closing") {
    issues.push({ seed: config.seed, tag: "structure", severity: "error", message: "Last row not closing" });
  }

  // No NaN / Infinity
  for (const r of rows) {
    if (!Number.isFinite(r.amount) || !Number.isFinite(r.balance)) {
      issues.push({ seed: config.seed, tag: "nan", severity: "error", message: \`Non-finite on \${r.id}\` });
    }
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(r.date)) {
      issues.push({ seed: config.seed, tag: "date", severity: "error", message: \`Bad date \${r.date}\` });
    }
    if (r.description.trim().length === 0) {
      issues.push({ seed: config.seed, tag: "desc", severity: "error", message: \`Empty description \${r.id}\` });
    }
    // Amount signs vs type
    if (r.type === "credit" || r.type === "rental") {
      if (r.amount <= 0) {
        issues.push({ seed: config.seed, tag: "sign", severity: "error", message: \`\${r.type} non-positive \${r.amount}\` });
      }
    }
    if (["debit", "transfer", "direct_debit", "card", "peer"].includes(r.type)) {
      if (r.amount >= 0) {
        issues.push({ seed: config.seed, tag: "sign", severity: "error", message: \`\${r.type} non-negative \${r.amount}\` });
      }
    }
    if (r.type === "opening" || r.type === "closing") {
      if (r.amount !== 0) {
        issues.push({ seed: config.seed, tag: "marker", severity: "error", message: \`Marker amount \${r.amount}\` });
      }
    }
  }

  // Salary description applied
  if (config.salaryAmount > 0 && config.salaryFrequency !== "none") {
    const sal = rows.filter((r) => r.description === config.salaryDescription);
    if (sal.length === 0) {
      issues.push({ seed: config.seed, tag: "salary", severity: "warning", message: "Configured salary description never appeared" });
    }
  }

  // Card last4 on card rows
  const cards = rows.filter((r) => r.type === "card");
  for (const c of cards) {
    if (!c.description.includes("*" + config.cardLast4)) {
      issues.push({ seed: config.seed, tag: "card", severity: "error", message: \`Card row missing *\${config.cardLast4}: \${c.description}\` });
    }
  }

  // Subscriptions off → no SUBSCRIPTION secondary
  if (!config.hasSubscriptions) {
    const subs = rows.filter((r) => r.secondaryDescription === "SUBSCRIPTION");
    if (subs.length) {
      issues.push({ seed: config.seed, tag: "subs", severity: "error", message: \`\${subs.length} subscriptions despite hasSubscriptions=false\` });
    }
  }

  // Direct debits off
  if (!config.hasDirectDebits) {
    const dd = rows.filter((r) => r.type === "direct_debit");
    if (dd.length) {
      issues.push({ seed: config.seed, tag: "dd", severity: "error", message: \`\${dd.length} DD rows despite hasDirectDebits=false\` });
    }
  }

  // Summary consistency
  let credits = 0, debits = 0;
  for (const r of rows) {
    if (r.amount > 0) credits += r.amount;
    if (r.amount < 0) debits += -r.amount;
  }
  credits = Math.round(credits * 100) / 100;
  debits = Math.round(debits * 100) / 100;
  if (Math.abs(credits - result.summary.totalCredits) > 0.02) {
    issues.push({ seed: config.seed, tag: "summary", severity: "error", message: \`Credits summary \${result.summary.totalCredits} vs \${credits}\` });
  }
  if (Math.abs(debits - result.summary.totalDebits) > 0.02) {
    issues.push({ seed: config.seed, tag: "summary", severity: "error", message: \`Debits summary \${result.summary.totalDebits} vs \${debits}\` });
  }

  // Closing = opening + credits - debits
  const netClose = Math.round((config.openingBalance + credits - debits) * 100) / 100;
  if (Math.abs(netClose - result.summary.closingBalance) > 0.02) {
    issues.push({ seed: config.seed, tag: "net", severity: "error", message: \`Net close \${result.summary.closingBalance} ≠ open+net \${netClose}\` });
  }

  // Pagination covers all rows
  const pages = paginateLedger(rows);
  const packed = pages.reduce((s, p) => s + p.rows.length, 0);
  if (packed !== rows.length) {
    issues.push({ seed: config.seed, tag: "page", severity: "error", message: \`Pagination \${packed} ≠ \${rows.length}\` });
  }
  if (!pages[0]?.isFirst || !pages[pages.length - 1]?.isLast) {
    issues.push({ seed: config.seed, tag: "page", severity: "error", message: "Page first/last flags wrong" });
  }

  // CSV non-empty
  const csv = ledgerToCsv(rows);
  if (csv.split("\\n").length < rows.length) {
    issues.push({ seed: config.seed, tag: "csv", severity: "error", message: "CSV row count short" });
  }

  // Dates within period
  const start = config.periodStart;
  const end = result.periodEnd;
  for (const r of rows) {
    if (r.date < start || r.date > end) {
      issues.push({ seed: config.seed, tag: "period", severity: "error", message: \`Date \${r.date} outside \${start}..\${end}\` });
    }
  }

  // Money precision max 2 decimals
  for (const r of rows) {
    const a = Math.round(r.amount * 100) / 100;
    const b = Math.round(r.balance * 100) / 100;
    if (Math.abs(a - r.amount) > 1e-9 || Math.abs(b - r.balance) > 1e-9) {
      issues.push({ seed: config.seed, tag: "precision", severity: "error", message: \`>2dp on \${r.id}\` });
    }
  }

  return issues;
}

const N = Number(process.env.STRESS_N || 200);
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

  if (i < 5 || hasError) {
    samples.push({
      seed,
      ok: !hasError,
      rows: result.rows.length,
      open: result.summary.openingBalance,
      close: result.summary.closingBalance,
      credits: result.summary.totalCredits,
      debits: result.summary.totalDebits,
      issues: [...v.issues.map((x) => x.message), ...deep.map((d) => d.message)].slice(0, 12),
    });
  }
}

// Determinism re-check on 20 seeds
for (let i = 0; i < 20; i++) {
  const seed = 5000 + i;
  const c = randomConfig(seed);
  const a = generateStatement(c);
  const b = generateStatement(c);
  if (JSON.stringify(a.rows) !== JSON.stringify(b.rows)) {
    allIssues.push({ seed, tag: "determinism", severity: "error", message: "Non-deterministic generation" });
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
  sampleErrors: errors.slice(0, 40),
  samples,
  perfect: errors.length === 0 && failConfigs === 0,
};

const outDir = resolve("scripts/.stress-out");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.perfect ? 0 : 1);
`;

const outPath = resolve(webRoot, "scripts/stress-statement-gen-runner.ts");
writeFileSync(outPath, stressRunnerTs);

console.log("Running stress generation (N=%s)...", process.env.STRESS_N || 200);
const r = spawnSync(
  "npx",
  ["tsx", "scripts/stress-statement-gen-runner.ts"],
  { cwd: webRoot, encoding: "utf8", env: { ...process.env }, maxBuffer: 20 * 1024 * 1024 },
);
console.log(r.stdout || "");
if (r.stderr) console.error(r.stderr);
process.exit(r.status ?? 1);
