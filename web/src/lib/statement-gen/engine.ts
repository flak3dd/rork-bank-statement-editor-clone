/**
 * Statement generation pipeline (concepts §4–§5).
 * Calendar walk with schedules, calibrated direct debits, weighted card spend.
 * All narrative amounts/descriptions read from user-configurable StatementConfig.
 */
import { MERCHANT_POOL } from "./merchants";
import {
  cardSpendCap,
  directDebitScale,
  estimateExpectedIncome,
  isDueOnDay,
  round2,
} from "./calibrate";
import { addDaysIso, periodEndIso } from "./format";
import type {
  GenerationResult,
  LedgerRow,
  MerchantProfile,
  StatementConfig,
} from "./types";
import { normalizeStatementConfig } from "./types";

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uid(prefix: string, i: number, seed: number): string {
  return `${prefix}-${seed.toString(36)}-${i}`;
}

function pickWeighted(
  rng: () => number,
  pool: MerchantProfile[],
): MerchantProfile {
  const total = pool.reduce((s, m) => s + m.weight, 0);
  let r = rng() * total;
  for (const m of pool) {
    r -= m.weight;
    if (r <= 0) return m;
  }
  return pool[pool.length - 1];
}

function moneyInRange(rng: () => number, min: number, max: number): number {
  return round2(min + rng() * (max - min));
}

function formatCardDesc(
  m: MerchantProfile,
  cardLast4: string,
): { description: string; secondary?: string } {
  const suffix = (cardLast4 || m.cardSuffix || "0000").replace(/\D/g, "").slice(-4);
  if (m.card) {
    return {
      description: `CARD *${suffix} ${m.name}`,
      secondary: m.location ? `${m.location}` : undefined,
    };
  }
  return {
    description: m.name,
    secondary: m.location,
  };
}

/** Active direct-debit templates after subscription/category filters. */
export function activeDirectDebits(config: StatementConfig) {
  if (!config.hasDirectDebits && !config.enableDirectDebits) return [];
  const cats = new Set(config.selectedBillCategories);
  return config.directDebits.filter((dd) => {
    if (!cats.has(dd.category)) return false;
    if (dd.isSubscription && !config.hasSubscriptions) return false;
    return true;
  });
}

/**
 * Full generation pipeline: opening marker → day walk → closing marker.
 */
export function generateStatement(input: StatementConfig): GenerationResult {
  const config = normalizeStatementConfig(input);
  const rng = createRng(config.seed);
  const rows: LedgerRow[] = [];
  let balance = round2(config.openingBalance);
  let seq = 0;
  const periodEnd = periodEndIso(config.periodStart, config.periodDays);
  const ddScale =
    directDebitScale(config) * Math.max(0, config.billSpendMultiplier || 1);
  let cardSpent = 0;
  const cardCap = cardSpendCap(config);
  const expectedIncome = estimateExpectedIncome(config);
  const debits = activeDirectDebits(config);

  // Opening marker
  rows.push({
    id: uid("open", seq++, config.seed),
    description: "OPENING BALANCE",
    date: config.periodStart,
    effectiveDate: config.periodStart,
    amount: 0,
    balance,
    type: "opening",
    category: "BalanceMarker",
  });

  for (let day = 0; day < config.periodDays; day++) {
    const date = addDaysIso(config.periodStart, day);

    // Salary / wages
    if (
      isDueOnDay(day, config.salaryFrequency) &&
      config.salaryAmount > 0
    ) {
      const amt = round2(config.salaryAmount);
      balance = round2(balance + amt);
      rows.push({
        id: uid("inc", seq++, config.seed),
        description: config.salaryDescription || "SALARY / WAGES",
        secondaryDescription: config.salaryAccount
          ? `FROM ${config.salaryAccount}`
          : "DIRECT CREDIT",
        date,
        effectiveDate: date,
        amount: amt,
        balance,
        type: "credit",
        category: "Wages",
      });
    }

    // Optional rental income (mid-month style)
    if (
      config.hasRentalIncome &&
      config.rentalAmount > 0 &&
      (day === 14 || (config.periodDays > 20 && day === Math.floor(config.periodDays / 2)))
    ) {
      const amt = round2(config.rentalAmount);
      balance = round2(balance + amt);
      rows.push({
        id: uid("rent", seq++, config.seed),
        description: config.rentalDescription || "RENTAL INCOME",
        secondaryDescription: "DIRECT CREDIT",
        date,
        effectiveDate: date,
        amount: amt,
        balance,
        type: "rental",
        category: "Other",
      });
    }

    // Savings transfer
    if (
      isDueOnDay(day, config.savingsFrequency) &&
      config.savingsAmount > 0 &&
      balance >= config.savingsAmount + 100
    ) {
      const amt = round2(config.savingsAmount);
      balance = round2(balance - amt);
      rows.push({
        id: uid("sav", seq++, config.seed),
        description: config.savingsDescription || "TRANSFER TO SAVINGS",
        secondaryDescription: config.savingsAccount
          ? `TO ${config.savingsAccount}`
          : "OWN ACCOUNT",
        date,
        effectiveDate: date,
        amount: -amt,
        balance,
        type: "transfer",
        category: "Savings",
      });
    }

    // Mortgage / loan
    if (
      isDueOnDay(day, config.mortgageFrequency) &&
      config.mortgageAmount > 0 &&
      balance >= config.mortgageAmount + 50
    ) {
      const amt = round2(config.mortgageAmount);
      balance = round2(balance - amt);
      const lender = config.mortgageLender?.trim();
      const ref = config.loanReference?.trim();
      rows.push({
        id: uid("mtg", seq++, config.seed),
        description: config.mortgageDescription || "HOME LOAN REPAYMENT",
        secondaryDescription: [lender, ref ? `REF ${ref}` : null]
          .filter(Boolean)
          .join(" · ") || "BPAY / LOAN",
        date,
        effectiveDate: date,
        amount: -amt,
        balance,
        type: "debit",
        category: "Financial",
      });
    }

    // Peer-to-peer on staggered cycle (every 11 days, offset 4)
    if (day >= 4 && (day - 4) % 11 === 0 && balance > 80) {
      const amt = moneyInRange(rng, 25, 120);
      if (balance >= amt + 40) {
        balance = round2(balance - amt);
        rows.push({
          id: uid("p2p", seq++, config.seed),
          description: "PEER TRANSFER",
          secondaryDescription: "OSKO / PAYID",
          date,
          effectiveDate: date,
          amount: -amt,
          balance,
          type: "peer",
          category: "Transfer",
        });
      }
    }

    // Direct debits (scaled + category/subscription filtered)
    for (const dd of debits) {
      if (
        day >= dd.offsetDays &&
        (day - dd.offsetDays) % dd.intervalDays === 0
      ) {
        const amt = round2(dd.baseAmount * ddScale);
        if (amt > 0 && balance >= amt) {
          balance = round2(balance - amt);
          rows.push({
            id: uid("dd", seq++, config.seed),
            description: dd.merchant,
            secondaryDescription: dd.isSubscription
              ? "SUBSCRIPTION"
              : "DIRECT DEBIT",
            date,
            effectiveDate: date,
            amount: -amt,
            balance,
            type: "direct_debit",
            category: dd.category,
          });
        }
      }
    }

    // Card / non-card purchases — ~0–3 per day, cap monthly spend
    const purchasesToday = Math.floor(rng() * 3);
    for (let p = 0; p < purchasesToday; p++) {
      if (cardSpent >= cardCap) break;
      if (balance < 30) break;
      const m = pickWeighted(rng, MERCHANT_POOL);
      let amt = moneyInRange(rng, m.min, m.max);
      if (cardSpent + amt > cardCap) amt = round2(cardCap - cardSpent);
      if (amt < 2) break;
      if (balance < amt + 20) continue;

      balance = round2(balance - amt);
      cardSpent = round2(cardSpent + amt);
      const { description, secondary } = formatCardDesc(m, config.cardLast4);
      rows.push({
        id: uid("pos", seq++, config.seed),
        description,
        secondaryDescription: secondary,
        date,
        effectiveDate: date,
        amount: -amt,
        balance,
        type: m.card ? "card" : "debit",
        category: m.category,
      });
    }
  }

  // Closing marker
  rows.push({
    id: uid("close", seq++, config.seed),
    description: "CLOSING BALANCE",
    date: periodEnd,
    effectiveDate: periodEnd,
    amount: 0,
    balance,
    type: "closing",
    category: "BalanceMarker",
  });

  let totalCredits = 0;
  let totalDebits = 0;
  for (const r of rows) {
    if (r.amount > 0) totalCredits += r.amount;
    if (r.amount < 0) totalDebits += -r.amount;
  }

  return {
    config,
    rows,
    periodEnd,
    summary: {
      openingBalance: config.openingBalance,
      closingBalance: balance,
      totalCredits: round2(totalCredits),
      totalDebits: round2(totalDebits),
      transactionCount: rows.filter(
        (r) => r.type !== "opening" && r.type !== "closing",
      ).length,
      expectedIncome,
    },
  };
}
