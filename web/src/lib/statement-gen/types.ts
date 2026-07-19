/** Shared taxonomy for statement generation (generic, brand-agnostic). */
export type GenCategory =
  | "Wages"
  | "Groceries"
  | "Dining"
  | "Alcohol"
  | "OnlineShopping"
  | "Transport"
  | "Fuel"
  | "Telecom"
  | "Utilities"
  | "Health"
  | "HomeImprovement"
  | "Retail"
  | "Entertainment"
  | "Insurance"
  | "Financial"
  | "TaxSuper"
  | "Savings"
  | "Transfer"
  | "BPAY"
  | "Pending"
  | "Other"
  | "BalanceMarker";

/** Bill / DD categories the user can toggle in configuration. */
export const BILL_CATEGORY_OPTIONS: GenCategory[] = [
  "Telecom",
  "Utilities",
  "Health",
  "Insurance",
  "Entertainment",
  "Financial",
  "TaxSuper",
  "Other",
];

export type TxnType =
  | "opening"
  | "closing"
  | "credit"
  | "debit"
  | "transfer"
  | "direct_debit"
  | "card"
  | "peer"
  | "interest"
  | "rental";

export type Frequency = "weekly" | "fortnightly" | "monthly" | "none";

/** Account / identity block (user-configurable). */
export interface AccountMeta {
  /** Display product / account name */
  accountName: string;
  /** Alias of accountName used in older print templates */
  productName: string;
  /** Primary holder — also exposed as holderName / accountHolder */
  holderName: string;
  accountHolder: string;
  customerID: string;
  customerNumber: string;
  bsb: string;
  bsbCode: string;
  accountNumber: string;
  interestRate: number;
  /** Alias for interestRate (print / legacy) */
  interestRatePct: number;
  brandLabel: string;
  branch: string;
  timezone: string;
  /** Linked accounts */
  bonusAccount: string;
  bonusBsb: string;
  everydayAccount: string;
  everydayBsb: string;
}

/** Residential / mailing address. */
export interface AddressMeta {
  addressLine1: string;
  addressLine2: string;
  addressStreet: string;
  addressCity: string;
}

/** Entity / legal identity printed on statement chrome. */
export interface EntityMeta {
  entityName: string;
  entityAddress: string;
  entityCity: string;
  entityState: string;
  entityCountry: string;
}

export interface ScheduleAmount {
  amount: number;
  frequency: Frequency;
}

export interface DirectDebitTemplate {
  merchant: string;
  baseAmount: number;
  intervalDays: number;
  offsetDays: number;
  category: GenCategory;
  /** When true, treated as a subscription (gated by hasSubscriptions). */
  isSubscription?: boolean;
}

export interface MerchantProfile {
  name: string;
  min: number;
  max: number;
  weight: number;
  category: GenCategory;
  cardSuffix?: string;
  location?: string;
  card?: boolean;
}

/**
 * Full user-configurable generator configuration.
 *
 * Field names mirror the product cfg surface (startDate/durationDays aliases
 * are provided as periodStart/periodDays for engine compatibility).
 */
export interface StatementConfig {
  // ── Period & balances ──────────────────────────────────────────
  /** ISO start date (alias: startDate) */
  periodStart: string;
  /** Length of statement period in days (alias: durationDays) */
  periodDays: number;
  openingBalance: number;
  savingsOpeningBalance: number;

  // ── Salary / income ────────────────────────────────────────────
  salaryDescription: string;
  salaryAmount: number;
  salaryFrequency: Frequency;
  salaryAccount: string;
  /** Nested schedule (kept in sync with salary*) for calibrate/engine */
  income: ScheduleAmount;
  rentalDescription: string;
  rentalAmount: number;
  hasRentalIncome: boolean;

  // ── Savings ────────────────────────────────────────────────────
  savingsDescription: string;
  savingsAmount: number;
  savingsFrequency: Frequency;
  savingsAccount: string;
  savings: ScheduleAmount;

  // ── Mortgage / rent ────────────────────────────────────────────
  mortgageDescription: string;
  mortgageLender: string;
  mortgageAmount: number;
  mortgageFrequency: Frequency;
  loanReference: string;
  mortgage: ScheduleAmount;

  // ── Card & spending controls ───────────────────────────────────
  cardLast4: string;
  /** 0–100 percent of expected income for card spend */
  cardSpendPct: number;
  /** 0–100 percent of expected income for bills/subscriptions */
  billsSubsPct: number;
  /** Multiplier applied to scaled direct-debit amounts */
  billSpendMultiplier: number;
  /** 0–1 shares derived from pct fields (engine/calibrate) */
  cardSpendIncomeShare: number;
  billsIncomeShare: number;

  // ── Direct debits / bills ──────────────────────────────────────
  hasDirectDebits: boolean;
  /** Alias of hasDirectDebits for legacy callers */
  enableDirectDebits: boolean;
  hasSubscriptions: boolean;
  selectedBillCategories: GenCategory[];
  directDebits: DirectDebitTemplate[];

  // ── Identity / address / entity ────────────────────────────────
  account: AccountMeta;
  address: AddressMeta;
  entity: EntityMeta;

  // ── RNG ────────────────────────────────────────────────────────
  seed: number;
}

/** Full transaction record (concepts §3). */
export interface LedgerRow {
  id: string;
  description: string;
  secondaryDescription?: string;
  date: string;
  effectiveDate: string;
  /** Signed amount: +credit, −debit, 0 for markers */
  amount: number;
  balance: number;
  type: TxnType;
  category: GenCategory;
}

export interface GenerationResult {
  config: StatementConfig;
  rows: LedgerRow[];
  summary: {
    openingBalance: number;
    closingBalance: number;
    totalCredits: number;
    totalDebits: number;
    transactionCount: number;
    expectedIncome: number;
  };
  periodEnd: string;
}

export interface ValidationIssue {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  rowId?: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  chronological: boolean;
  balanceConsistent: boolean;
  noSameDayDupes: boolean;
}

/** A4 pagination units in CSS px @ 96dpi approximation for screen print. */
export interface PageLayout {
  pageHeight: number;
  pageWidth: number;
  paddingTop: number;
  paddingBottom: number;
  footerHeight: number;
  firstPageHeaderHeight: number;
  continuationHeaderHeight: number;
  singleRowHeight: number;
  dualRowHeight: number;
  disclaimerHeight: number;
}

export interface PaginatedPage {
  pageIndex: number;
  isFirst: boolean;
  isLast: boolean;
  rows: LedgerRow[];
}

export const DEFAULT_PAGE_LAYOUT: PageLayout = {
  pageHeight: 1123, // ~A4 @ 96dpi
  pageWidth: 794,
  paddingTop: 36,
  paddingBottom: 28,
  footerHeight: 48,
  firstPageHeaderHeight: 280,
  continuationHeaderHeight: 72,
  singleRowHeight: 22,
  dualRowHeight: 34,
  disclaimerHeight: 90,
};

/** Clamp 0–100 pct → 0–1 share. */
export function pctToShare(pct: number): number {
  const n = Number.isFinite(pct) ? pct : 0;
  return Math.min(1, Math.max(0, n / 100));
}

/**
 * Keep nested schedule/share fields in sync after a partial UI patch.
 * Call after mutating salary, savings, mortgage, or percent fields.
 */
export function normalizeStatementConfig(c: StatementConfig): StatementConfig {
  const cardSpendPct = clamp(c.cardSpendPct, 0, 100);
  const billsSubsPct = clamp(c.billsSubsPct, 0, 100);
  const holder = c.account.holderName || c.account.accountHolder;
  const product = c.account.accountName || c.account.productName;
  const bsb = c.account.bsb || c.account.bsbCode;
  const customer = c.account.customerID || c.account.customerNumber;
  const rate = c.account.interestRate ?? c.account.interestRatePct ?? 0;

  return {
    ...c,
    periodDays: Math.max(1, Math.min(366, Math.round(c.periodDays) || 30)),
    openingBalance: roundMoney(c.openingBalance),
    savingsOpeningBalance: roundMoney(c.savingsOpeningBalance),
    salaryAmount: roundMoney(c.salaryAmount),
    salaryFrequency: c.salaryFrequency,
    rentalAmount: roundMoney(c.rentalAmount),
    savingsAmount: roundMoney(c.savingsAmount),
    mortgageAmount: roundMoney(c.mortgageAmount),
    cardSpendPct,
    billsSubsPct,
    billSpendMultiplier: Math.max(0, c.billSpendMultiplier || 1),
    cardSpendIncomeShare: pctToShare(cardSpendPct),
    billsIncomeShare: pctToShare(billsSubsPct),
    hasDirectDebits: Boolean(c.hasDirectDebits),
    enableDirectDebits: Boolean(c.hasDirectDebits),
    hasSubscriptions: Boolean(c.hasSubscriptions),
    selectedBillCategories:
      c.selectedBillCategories?.length > 0
        ? c.selectedBillCategories
        : [...BILL_CATEGORY_OPTIONS],
    income: {
      amount: roundMoney(c.salaryAmount),
      frequency: c.salaryFrequency,
    },
    savings: {
      amount: roundMoney(c.savingsAmount),
      frequency: c.savingsFrequency,
    },
    mortgage: {
      amount: roundMoney(c.mortgageAmount),
      frequency: c.mortgageFrequency,
    },
    account: {
      ...c.account,
      holderName: holder,
      accountHolder: holder,
      accountName: product,
      productName: product,
      bsb,
      bsbCode: c.account.bsbCode || bsb,
      customerID: customer,
      customerNumber: c.account.customerNumber || customer,
      interestRate: rate,
      interestRatePct: rate,
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

function roundMoney(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

export function defaultStatementConfig(): StatementConfig {
  const today = new Date();
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );
  const raw: StatementConfig = {
    periodStart: start.toISOString().slice(0, 10),
    periodDays: 30,
    openingBalance: 3240.55,
    savingsOpeningBalance: 12500,
    salaryDescription: "SALARY / WAGES",
    salaryAmount: 3200,
    salaryFrequency: "fortnightly",
    salaryAccount: "PAYROLL",
    income: { amount: 3200, frequency: "fortnightly" },
    rentalDescription: "RENTAL INCOME",
    rentalAmount: 0,
    hasRentalIncome: false,
    savingsDescription: "TRANSFER TO SAVINGS",
    savingsAmount: 200,
    savingsFrequency: "fortnightly",
    savingsAccount: "BONUS SAVER",
    savings: { amount: 200, frequency: "fortnightly" },
    mortgageDescription: "HOME LOAN REPAYMENT",
    mortgageLender: "HOME LENDER",
    mortgageAmount: 1450,
    mortgageFrequency: "monthly",
    loanReference: "LN-1002941",
    mortgage: { amount: 1450, frequency: "monthly" },
    cardLast4: "4532",
    cardSpendPct: 28,
    billsSubsPct: 22,
    billSpendMultiplier: 1,
    cardSpendIncomeShare: 0.28,
    billsIncomeShare: 0.22,
    hasDirectDebits: true,
    enableDirectDebits: true,
    hasSubscriptions: true,
    selectedBillCategories: [...BILL_CATEGORY_OPTIONS],
    seed: 42,
    account: {
      accountName: "Everyday Transaction Account",
      productName: "Everyday Transaction Account",
      holderName: "A Sample Customer",
      accountHolder: "A Sample Customer",
      customerID: "CUS-1002941",
      customerNumber: "CUS-1002941",
      bsb: "062-000",
      bsbCode: "062-000",
      accountNumber: "1234 5678",
      interestRate: 0.05,
      interestRatePct: 0.05,
      brandLabel: "Statement Demo Bank",
      branch: "Main Street Branch",
      timezone: "Australia/Sydney",
      bonusAccount: "9876 5432",
      bonusBsb: "062-001",
      everydayAccount: "1234 5678",
      everydayBsb: "062-000",
    },
    address: {
      addressLine1: "12 Sample Street",
      addressLine2: "",
      addressStreet: "12 Sample Street",
      addressCity: "Sydney NSW 2000",
    },
    entity: {
      entityName: "Statement Demo Bank Pty Ltd",
      entityAddress: "100 Demo Tower",
      entityCity: "Sydney",
      entityState: "NSW",
      entityCountry: "Australia",
    },
    directDebits: [
      {
        merchant: "STREAMING SUBSCRIPTION",
        baseAmount: 16.99,
        intervalDays: 30,
        offsetDays: 3,
        category: "Entertainment",
        isSubscription: true,
      },
      {
        merchant: "MOBILE PLAN",
        baseAmount: 49,
        intervalDays: 30,
        offsetDays: 7,
        category: "Telecom",
        isSubscription: true,
      },
      {
        merchant: "HEALTH FUND",
        baseAmount: 128.4,
        intervalDays: 14,
        offsetDays: 2,
        category: "Health",
      },
      {
        merchant: "INSURANCE PREMIUM",
        baseAmount: 89.5,
        intervalDays: 30,
        offsetDays: 12,
        category: "Insurance",
      },
      {
        merchant: "INTERNET NBN",
        baseAmount: 79,
        intervalDays: 30,
        offsetDays: 18,
        category: "Telecom",
        isSubscription: true,
      },
      {
        merchant: "ELECTRICITY",
        baseAmount: 145,
        intervalDays: 30,
        offsetDays: 9,
        category: "Utilities",
      },
      {
        merchant: "COUNCIL RATES",
        baseAmount: 210,
        intervalDays: 90,
        offsetDays: 5,
        category: "Utilities",
      },
    ],
  };
  return normalizeStatementConfig(raw);
}
