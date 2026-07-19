import { describe, expect, it } from "vitest";
import {
  defaultStatementConfig,
  generateStatement,
  normalizeStatementConfig,
  validateLedger,
  countOccurrences,
  isDueOnDay,
  estimateExpectedIncome,
  type Frequency,
} from "@/lib/statement-gen";

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("generation quality audit", () => {
  it("reports and bounds warning rates; no negative-balance explosion", () => {
    const N = 200;
    let warnDupes = 0;
    let negBalanceRows = 0;
    let totalRows = 0;
    let errorConfigs = 0;
    let salaryCountMismatches = 0;

    for (let i = 0; i < N; i++) {
      const seed = 20000 + i * 13;
      const rng = mulberry(seed);
      const freqs: Frequency[] = ["weekly", "fortnightly", "monthly"];
      const freq = freqs[Math.floor(rng() * 3)];
      const days = 14 + Math.floor(rng() * 45);
      const config = normalizeStatementConfig({
        ...defaultStatementConfig(),
        seed,
        periodDays: days,
        salaryFrequency: freq,
        salaryAmount: 1000 + Math.floor(rng() * 4000),
        cardSpendPct: Math.floor(rng() * 45),
        billsSubsPct: Math.floor(rng() * 35),
        hasDirectDebits: rng() > 0.2,
        openingBalance: 500 + rng() * 5000,
      });
      const result = generateStatement(config);
      totalRows += result.rows.length;
      const v = validateLedger(result.rows, config.openingBalance);
      if (!v.ok) errorConfigs += 1;
      if (!v.noSameDayDupes) warnDupes += 1;
      for (const r of result.rows) {
        if (r.balance < -0.01) negBalanceRows += 1;
      }

      // Salary fires: isDueOnDay count vs actual rows
      let due = 0;
      for (let d = 0; d < config.periodDays; d++) {
        if (isDueOnDay(d, config.salaryFrequency)) due += 1;
      }
      const occ = countOccurrences(
        config.periodStart,
        config.periodDays,
        config.salaryFrequency,
      );
      // engine uses isDueOnDay; estimate uses countOccurrences — flag large gaps
      if (Math.abs(due - occ) > 1) {
        salaryCountMismatches += 1;
      }
      const salaryRows = result.rows.filter(
        (r) => r.description === config.salaryDescription,
      );
      if (salaryRows.length !== due) {
        // may skip if... no, salary always deposits
        if (salaryRows.length !== due) {
          // record as mismatch only if not equal
          if (Math.abs(salaryRows.length - due) > 0) {
            // allow and track
          }
        }
      }
      expect(salaryRows.length).toBe(due);
    }

    // Hard: zero validation errors
    expect(errorConfigs).toBe(0);
    // Soft bounds for quality
    const dupeRate = warnDupes / N;
    const negRate = negBalanceRows / totalRows;
    // Document rates
    console.log(
      JSON.stringify({
        N,
        totalRows,
        errorConfigs,
        warnDupes,
        dupeRate,
        negBalanceRows,
        negRate,
        salaryCountMismatches,
      }),
    );
    // Perfect generation: no same-day dupe configs if possible; allow small rate
    expect(dupeRate).toBeLessThan(0.25);
    expect(negRate).toBeLessThan(0.05);
    // isDueOnDay vs countOccurrences should stay close
    expect(salaryCountMismatches).toBe(0);
  });

  it("aligns expected income with actual salary deposits", () => {
    for (const freq of ["weekly", "fortnightly", "monthly"] as Frequency[]) {
      for (const days of [7, 14, 28, 30, 31, 45, 60]) {
        const config = normalizeStatementConfig({
          ...defaultStatementConfig(),
          seed: 1,
          periodStart: "2025-01-01",
          periodDays: days,
          salaryFrequency: freq,
          salaryAmount: 1000,
          hasRentalIncome: false,
          cardSpendPct: 0,
          billsSubsPct: 0,
          hasDirectDebits: false,
          savingsFrequency: "none",
          mortgageFrequency: "none",
        });
        const result = generateStatement(config);
        let due = 0;
        for (let d = 0; d < days; d++) if (isDueOnDay(d, freq)) due += 1;
        const expected = estimateExpectedIncome(config);
        const actualSalary = result.rows
          .filter((r) => r.type === "credit")
          .reduce((s, r) => s + r.amount, 0);
        // estimate uses countOccurrences; actual uses isDueOnDay
        expect(actualSalary).toBeCloseTo(due * 1000, 5);
        // If estimate drifts from due*amount, that's a calibration bug
        const estDue =
          Math.round(expected / 1000);
        // Allow document — we will fix if off
        if (Math.abs(expected - due * 1000) > 0.01) {
          console.log({ freq, days, due, expected, actualSalary });
        }
        expect(Math.abs(expected - due * 1000)).toBeLessThan(0.02);
      }
    }
  });
});
