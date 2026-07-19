import type { Frequency, StatementConfig } from "./types";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Count how many times a frequency fires in the period.
 * MUST match `isDueOnDay` exactly so income estimates / card caps / bill
 * scaling stay calibrated to what the engine actually deposits.
 */
export function countOccurrences(
  _startIso: string,
  periodDays: number,
  frequency: Frequency,
): number {
  if (frequency === "none" || periodDays <= 0) return 0;
  let count = 0;
  for (let d = 0; d < periodDays; d++) {
    if (isDueOnDay(d, frequency)) count += 1;
  }
  return count;
}

export function isDueOnDay(
  dayIndex: number,
  frequency: Frequency,
): boolean {
  if (frequency === "none") return false;
  if (frequency === "weekly") return dayIndex % 7 === 0;
  if (frequency === "fortnightly") return dayIndex % 14 === 0;
  if (frequency === "monthly") return dayIndex === 0 || dayIndex % 30 === 0;
  return false;
}

/** Estimate total income deposits in the period (salary + optional rental). */
export function estimateExpectedIncome(config: StatementConfig): number {
  const salaryFreq = config.salaryFrequency ?? config.income.frequency;
  const salaryAmt = config.salaryAmount ?? config.income.amount;
  const n = countOccurrences(
    config.periodStart,
    config.periodDays,
    salaryFreq,
  );
  let total = n * salaryAmt;
  if (config.hasRentalIncome && config.rentalAmount > 0) {
    // One rental credit per statement period when enabled
    total += config.rentalAmount;
  }
  return round2(total);
}

/**
 * Nominal sum of scheduled direct debits over the period (before income scaling).
 * Respects hasDirectDebits / hasSubscriptions / selectedBillCategories.
 */
export function nominalDirectDebitTotal(
  config: StatementConfig,
): number {
  if (!config.hasDirectDebits && !config.enableDirectDebits) return 0;
  const cats = new Set(
    config.selectedBillCategories?.length
      ? config.selectedBillCategories
      : config.directDebits.map((d) => d.category),
  );
  let total = 0;
  for (const dd of config.directDebits) {
    if (!cats.has(dd.category)) continue;
    if (dd.isSubscription && config.hasSubscriptions === false) continue;
    for (let d = 0; d < config.periodDays; d++) {
      if (d >= dd.offsetDays && (d - dd.offsetDays) % dd.intervalDays === 0) {
        total += dd.baseAmount;
      }
    }
  }
  return round2(total);
}

/** Scale factor so DD total ≈ billsIncomeShare × expected income. */
export function directDebitScale(config: StatementConfig): number {
  const expected = estimateExpectedIncome(config);
  const billsShare =
    config.billsIncomeShare ??
    (typeof config.billsSubsPct === "number" ? config.billsSubsPct / 100 : 0.22);
  const target = round2(expected * billsShare);
  const nominal = nominalDirectDebitTotal(config);
  if (nominal <= 0 || target <= 0) return 1;
  return target / nominal;
}

export function cardSpendCap(config: StatementConfig): number {
  const share =
    config.cardSpendIncomeShare ??
    (typeof config.cardSpendPct === "number" ? config.cardSpendPct / 100 : 0.28);
  return round2(estimateExpectedIncome(config) * share);
}
