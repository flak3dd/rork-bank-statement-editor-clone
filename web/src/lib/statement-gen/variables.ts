/**
 * Optional statement variables.
 *
 * Only fields that are *set* (non-empty string, finite number, or boolean true)
 * are merged into generation config and/or Unredacter PDF chrome.
 * Unset / empty fields leave defaults or original PDF text alone.
 */
import type { Frequency, StatementConfig } from "./types";
import { defaultStatementConfig, normalizeStatementConfig } from "./types";

/** Keys the product exposes as optional injection variables. */
export const STATEMENT_VARIABLE_KEYS = [
  // Account / identity
  "holderName",
  "accountName",
  "accountNumber",
  "bsb",
  "bsbCode",
  // Address / location
  "addressLine1",
  "addressLine2",
  // Salary / income
  "salaryDescription",
  "salaryAmount",
  "salaryFrequency",
  "salaryAccount",
  "rentalDescription",
  "rentalAmount",
  "hasRentalIncome",
  // Savings
  "savingsDescription",
  "savingsAmount",
  "savingsFrequency",
  "savingsAccount",
  // Mortgage / rent
  "mortgageDescription",
  "mortgageLender",
  "mortgageAmount",
  "mortgageFrequency",
  "loanReference",
] as const;

export type StatementVariableKey = (typeof STATEMENT_VARIABLE_KEYS)[number];

/**
 * Flat optional overrides. Omit or leave empty to skip.
 * When set, values must reflect on the generated statement (ledger + PDF Unredacter).
 */
export type StatementVariableOverrides = {
  holderName?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  bsb?: string | null;
  bsbCode?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  salaryDescription?: string | null;
  salaryAmount?: number | null;
  salaryFrequency?: Frequency | null;
  salaryAccount?: string | null;
  rentalDescription?: string | null;
  rentalAmount?: number | null;
  hasRentalIncome?: boolean | null;
  savingsDescription?: string | null;
  savingsAmount?: number | null;
  savingsFrequency?: Frequency | null;
  savingsAccount?: string | null;
  mortgageDescription?: string | null;
  mortgageLender?: string | null;
  mortgageAmount?: number | null;
  mortgageFrequency?: Frequency | null;
  loanReference?: string | null;
};

/** True when a value should be treated as user-provided. */
export function isVariableSet(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true; // explicit true/false both count as set
  return false;
}

/** List keys that are currently set on an overrides object. */
export function setVariableKeys(
  overrides: StatementVariableOverrides | null | undefined,
): StatementVariableKey[] {
  if (!overrides) return [];
  return STATEMENT_VARIABLE_KEYS.filter((k) =>
    isVariableSet(overrides[k as keyof StatementVariableOverrides]),
  );
}

/**
 * Merge optional overrides into a full StatementConfig.
 * Only set fields overwrite base (defaults).
 */
export function applyStatementVariableOverrides(
  base: StatementConfig,
  overrides: StatementVariableOverrides | null | undefined,
): StatementConfig {
  if (!overrides || setVariableKeys(overrides).length === 0) {
    return normalizeStatementConfig(base);
  }

  const next: StatementConfig = {
    ...base,
    account: { ...base.account },
    address: { ...base.address },
    entity: { ...base.entity },
  };

  if (isVariableSet(overrides.holderName)) {
    const v = String(overrides.holderName).trim();
    next.account.holderName = v;
    next.account.accountHolder = v;
  }
  if (isVariableSet(overrides.accountName)) {
    const v = String(overrides.accountName).trim();
    next.account.accountName = v;
    next.account.productName = v;
  }
  if (isVariableSet(overrides.accountNumber)) {
    next.account.accountNumber = String(overrides.accountNumber).trim();
  }
  if (isVariableSet(overrides.bsb) || isVariableSet(overrides.bsbCode)) {
    const bsb = String(overrides.bsb ?? overrides.bsbCode).trim();
    next.account.bsb = bsb;
    next.account.bsbCode = bsb;
  }

  if (isVariableSet(overrides.addressLine1)) {
    const v = String(overrides.addressLine1).trim();
    next.address.addressLine1 = v;
    next.address.addressStreet = v;
  }
  if (isVariableSet(overrides.addressLine2)) {
    next.address.addressLine2 = String(overrides.addressLine2).trim();
  }

  if (isVariableSet(overrides.salaryDescription)) {
    next.salaryDescription = String(overrides.salaryDescription).trim();
  }
  if (isVariableSet(overrides.salaryAmount)) {
    next.salaryAmount = Number(overrides.salaryAmount);
  }
  if (isVariableSet(overrides.salaryFrequency)) {
    next.salaryFrequency = overrides.salaryFrequency as Frequency;
  }
  if (isVariableSet(overrides.salaryAccount)) {
    next.salaryAccount = String(overrides.salaryAccount).trim();
  }
  if (isVariableSet(overrides.rentalDescription)) {
    next.rentalDescription = String(overrides.rentalDescription).trim();
  }
  if (isVariableSet(overrides.rentalAmount)) {
    next.rentalAmount = Number(overrides.rentalAmount);
  }
  if (isVariableSet(overrides.hasRentalIncome)) {
    next.hasRentalIncome = Boolean(overrides.hasRentalIncome);
  }

  if (isVariableSet(overrides.savingsDescription)) {
    next.savingsDescription = String(overrides.savingsDescription).trim();
  }
  if (isVariableSet(overrides.savingsAmount)) {
    next.savingsAmount = Number(overrides.savingsAmount);
  }
  if (isVariableSet(overrides.savingsFrequency)) {
    next.savingsFrequency = overrides.savingsFrequency as Frequency;
  }
  if (isVariableSet(overrides.savingsAccount)) {
    next.savingsAccount = String(overrides.savingsAccount).trim();
  }

  if (isVariableSet(overrides.mortgageDescription)) {
    next.mortgageDescription = String(overrides.mortgageDescription).trim();
  }
  if (isVariableSet(overrides.mortgageLender)) {
    next.mortgageLender = String(overrides.mortgageLender).trim();
  }
  if (isVariableSet(overrides.mortgageAmount)) {
    next.mortgageAmount = Number(overrides.mortgageAmount);
  }
  if (isVariableSet(overrides.mortgageFrequency)) {
    next.mortgageFrequency = overrides.mortgageFrequency as Frequency;
  }
  if (isVariableSet(overrides.loanReference)) {
    next.loanReference = String(overrides.loanReference).trim();
  }

  return normalizeStatementConfig(next);
}

/** Build overrides object from a full config (every listed key as set). */
export function overridesFromConfig(
  config: StatementConfig,
): StatementVariableOverrides {
  return {
    holderName: config.account.holderName,
    accountName: config.account.accountName,
    accountNumber: config.account.accountNumber,
    bsb: config.account.bsb,
    bsbCode: config.account.bsbCode,
    addressLine1: config.address.addressLine1,
    addressLine2: config.address.addressLine2 || undefined,
    salaryDescription: config.salaryDescription,
    salaryAmount: config.salaryAmount,
    salaryFrequency: config.salaryFrequency,
    salaryAccount: config.salaryAccount,
    rentalDescription: config.rentalDescription,
    rentalAmount: config.rentalAmount,
    hasRentalIncome: config.hasRentalIncome,
    savingsDescription: config.savingsDescription,
    savingsAmount: config.savingsAmount,
    savingsFrequency: config.savingsFrequency,
    savingsAccount: config.savingsAccount,
    mortgageDescription: config.mortgageDescription,
    mortgageLender: config.mortgageLender,
    mortgageAmount: config.mortgageAmount,
    mortgageFrequency: config.mortgageFrequency,
    loanReference: config.loanReference,
  };
}

/**
 * Chrome / identity fields that Unredacter draws onto the PDF header
 * (never redaction-only blanks).
 */
export const CHROME_VARIABLE_KEYS: StatementVariableKey[] = [
  "holderName",
  "accountName",
  "accountNumber",
  "bsb",
  "bsbCode",
  "addressLine1",
  "addressLine2",
];

/** Empty optional overrides (all unset). */
export function emptyVariableOverrides(): StatementVariableOverrides {
  return {};
}

/** Start from defaults but clear chrome identity so only user-set values inject. */
export function generationConfigWithOptionalChrome(
  overrides: StatementVariableOverrides,
  base: StatementConfig = defaultStatementConfig(),
): StatementConfig {
  return applyStatementVariableOverrides(base, overrides);
}
