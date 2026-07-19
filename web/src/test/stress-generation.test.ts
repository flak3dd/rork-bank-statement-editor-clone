/**
 * Extreme generation stress suite — many random configs, full invariants.
 * Run: npx vitest run src/test/stress-generation.test.ts
 */
import { describe, expect, it } from "vitest";
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
} from "@/lib/statement-gen";

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

function assertPerfect(
  config: StatementConfig,
  result: ReturnType<typeof generateStatement>,
) {
  const v = validateLedger(result.rows, config.openingBalance);
  const errors = v.issues.filter((i) => i.severity === "error");
  expect(errors, JSON.stringify(errors)).toEqual([]);
  expect(v.ok).toBe(true);
  expect(v.chronological).toBe(true);
  expect(v.balanceConsistent).toBe(true);

  const rows = result.rows;
  expect(rows[0].type).toBe("opening");
  expect(rows[rows.length - 1].type).toBe("closing");

  for (const r of rows) {
    expect(Number.isFinite(r.amount)).toBe(true);
    expect(Number.isFinite(r.balance)).toBe(true);
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.description.trim().length).toBeGreaterThan(0);
    expect(Math.round(r.amount * 100) / 100).toBeCloseTo(r.amount, 8);
    expect(Math.round(r.balance * 100) / 100).toBeCloseTo(r.balance, 8);
    if (r.type === "credit" || r.type === "rental") expect(r.amount).toBeGreaterThan(0);
    if (["debit", "transfer", "direct_debit", "card", "peer"].includes(r.type)) {
      expect(r.amount).toBeLessThan(0);
    }
    if (r.type === "opening" || r.type === "closing") expect(r.amount).toBe(0);
    expect(r.date >= config.periodStart).toBe(true);
    expect(r.date <= result.periodEnd).toBe(true);
  }

  for (const c of rows.filter((r) => r.type === "card")) {
    expect(c.description).toContain("*" + config.cardLast4);
  }

  if (!config.hasSubscriptions) {
    expect(
      rows.filter((r) => r.secondaryDescription === "SUBSCRIPTION"),
    ).toHaveLength(0);
  }
  if (!config.hasDirectDebits) {
    expect(rows.filter((r) => r.type === "direct_debit")).toHaveLength(0);
  }

  const allowed = new Set(config.selectedBillCategories);
  for (const r of rows.filter((x) => x.type === "direct_debit")) {
    expect(allowed.has(r.category as GenCategory)).toBe(true);
  }

  let credits = 0;
  let debits = 0;
  for (const r of rows) {
    if (r.amount > 0) credits += r.amount;
    if (r.amount < 0) debits += -r.amount;
  }
  credits = Math.round(credits * 100) / 100;
  debits = Math.round(debits * 100) / 100;
  expect(result.summary.totalCredits).toBeCloseTo(credits, 1);
  expect(result.summary.totalDebits).toBeCloseTo(debits, 1);
  const netClose =
    Math.round((config.openingBalance + credits - debits) * 100) / 100;
  expect(result.summary.closingBalance).toBeCloseTo(netClose, 1);

  const pages = paginateLedger(rows);
  expect(pages.reduce((s, p) => s + p.rows.length, 0)).toBe(rows.length);
  expect(pages[0].isFirst).toBe(true);
  expect(pages[pages.length - 1].isLast).toBe(true);

  const csv = ledgerToCsv(rows);
  expect(csv.split("\n").length).toBeGreaterThanOrEqual(rows.length);
}

describe("extreme generation stress", () => {
  it("passes 300 random configs with perfect invariants", () => {
    const N = 300;
    let totalRows = 0;
    const failures: string[] = [];

    for (let i = 0; i < N; i++) {
      const seed = 1000 + i * 17 + (i % 7);
      const config = randomConfig(seed);
      try {
        const result = generateStatement(config);
        totalRows += result.rows.length;
        assertPerfect(config, result);
      } catch (e) {
        failures.push(
          `seed=${seed}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Determinism
    for (let i = 0; i < 40; i++) {
      const seed = 9000 + i;
      const c = randomConfig(seed);
      const a = generateStatement(c);
      const b = generateStatement(c);
      if (JSON.stringify(a.rows) !== JSON.stringify(b.rows)) {
        failures.push(`seed=${seed}: non-deterministic`);
      }
    }

    if (failures.length) {
      console.error(
        "FAILURES",
        failures.slice(0, 30),
        `… total ${failures.length}`,
      );
    }
    expect(failures, failures.slice(0, 10).join("\n")).toEqual([]);
    expect(totalRows).toBeGreaterThan(N * 5);
  });

  it("edge configs: zero spend, high salary, no DD, rent only", () => {
    const edges: Partial<StatementConfig>[] = [
      {
        seed: 1,
        cardSpendPct: 0,
        billsSubsPct: 0,
        hasDirectDebits: false,
        hasSubscriptions: false,
        mortgageFrequency: "none",
        savingsFrequency: "none",
        periodDays: 14,
      },
      {
        seed: 2,
        salaryAmount: 12000,
        salaryFrequency: "weekly",
        cardSpendPct: 60,
        billsSubsPct: 35,
        billSpendMultiplier: 2.5,
        hasRentalIncome: true,
        rentalAmount: 3000,
        periodDays: 45,
      },
      {
        seed: 3,
        openingBalance: 0.5,
        salaryAmount: 50,
        salaryFrequency: "monthly",
        cardSpendPct: 5,
        billsSubsPct: 5,
        periodDays: 7,
      },
      {
        seed: 4,
        hasDirectDebits: true,
        hasSubscriptions: false,
        selectedBillCategories: ["Utilities"],
        periodDays: 31,
      },
    ];

    for (const partial of edges) {
      const config = normalizeStatementConfig({
        ...defaultStatementConfig(),
        ...partial,
      } as StatementConfig);
      const result = generateStatement(config);
      assertPerfect(config, result);
    }
  });
});
