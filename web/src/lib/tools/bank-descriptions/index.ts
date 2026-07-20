/**
 * Bank-authentic transactional description generators.
 * Thin typed wrapper around transactionalDescriptionGenerator.js
 * (ported from repo root /transactionalDescriptionGenerator.js).
 */

import {
  generators as rawGenerators,
  genAnz,
  genCba,
  genWestpac,
  genIng,
  genBankwest,
  genSuncorp,
  genMacquarie,
  genRams,
  genOther,
} from "./transactionalDescriptionGenerator.js";
import {
  formatDescriptionToStructure,
  joinStructuredDescription,
  type BankTransactionStructureProfile,
} from "@/lib/statement-layout/txn-structure";
import { assistLedgerWithBankTemplate } from "@/lib/generation/from-bank-template";

export type BankId =
  | "anz"
  | "cba"
  | "westpac"
  | "ing"
  | "bankwest"
  | "suncorp"
  | "macquarie"
  | "rams"
  | "other";

export const BANK_IDS: BankId[] = [
  "anz",
  "cba",
  "westpac",
  "ing",
  "bankwest",
  "suncorp",
  "macquarie",
  "rams",
  "other",
];

export const BANK_LABELS: Record<BankId, string> = {
  anz: "ANZ",
  cba: "CBA / CommBank",
  westpac: "Westpac",
  ing: "ING",
  bankwest: "Bankwest",
  suncorp: "Suncorp",
  macquarie: "Macquarie",
  rams: "RAMS",
  other: "Other / Generic",
};

const ALIASES: Record<string, BankId> = {
  anz: "anz",
  cba: "cba",
  commonwealth: "cba",
  commbank: "cba",
  "commonwealth bank": "cba",
  westpac: "westpac",
  ing: "ing",
  bankwest: "bankwest",
  suncorp: "suncorp",
  macquarie: "macquarie",
  rams: "rams",
  other: "other",
  generic: "other",
};

export function normalizeBankId(bank: string | null | undefined): BankId {
  const key = (bank ?? "other").trim().toLowerCase();
  return ALIASES[key] ?? (BANK_IDS.includes(key as BankId) ? (key as BankId) : "other");
}

type GenFn = () => string;

const MAP: Record<BankId, GenFn> = {
  anz: genAnz as GenFn,
  cba: genCba as GenFn,
  westpac: genWestpac as GenFn,
  ing: genIng as GenFn,
  bankwest: genBankwest as GenFn,
  suncorp: genSuncorp as GenFn,
  macquarie: genMacquarie as GenFn,
  rams: genRams as GenFn,
  other: genOther as GenFn,
};

/** Generate one bank-authentic description. */
export function generateBankDescription(bank: string = "anz"): string {
  const id = normalizeBankId(bank);
  return MAP[id]();
}

/** Generate N descriptions for a bank. */
export function generateBankDescriptions(
  bank: string,
  count: number,
): string[] {
  const id = normalizeBankId(bank);
  const fn = MAP[id];
  const n = Math.max(0, Math.min(500, count));
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(fn());
  return out;
}

/**
 * Replace transaction descriptions in-place with bank-authentic strings.
 * Mutates a copy — does not touch the original array.
 *
 * When `options.rawText` is provided, YAML bank templates under
 * `parsers/templates` detect the brand and map to the right generator +
 * descriptionCleanup rules.
 */
export function rewriteTransactionDescriptions<
  T extends { description: string; flags?: string[] },
>(
  transactions: T[],
  bank: string,
  options?: { rawText?: string; useYamlTemplate?: boolean },
): T[] {
  if (options?.useYamlTemplate !== false && (options?.rawText || bank === "auto")) {
    const assisted = assistLedgerWithBankTemplate({
      transactions: transactions as Array<T & { description: string; flags?: string[] }>,
      rawText: options?.rawText ?? "",
      bankHint: bank === "auto" ? null : bank,
      rewriteDescriptions: true,
      applyCleanup: true,
    });
    return assisted.transactions as T[];
  }

  const id = normalizeBankId(bank === "auto" ? "other" : bank);
  const fn = MAP[id];
  return transactions.map((t) => ({
    ...t,
    description: fn(),
    flags: [...new Set([...(t.flags ?? []), "bank-desc", id])],
  }));
}

/**
 * Same as rewriteTransactionDescriptions, but reshapes each generated line
 * to match a source-document structure profile (Step 2 fidelity):
 * multi-line primary/secondary, embedded dates, standalone refs, etc.
 */
export function rewriteTransactionDescriptionsWithStructure<
  T extends { description: string; flags?: string[] },
>(
  transactions: T[],
  bank: string,
  structure: Partial<BankTransactionStructureProfile> | null,
): T[] {
  const id = normalizeBankId(bank);
  const fn = MAP[id];
  if (!structure) return rewriteTransactionDescriptions(transactions, bank);

  const profile: BankTransactionStructureProfile = {
    bankId: structure.bankId ?? id,
    bankName: structure.bankName ?? id,
    confidence: structure.confidence ?? 0.7,
    dateFormat: structure.dateFormat ?? "auto",
    amountLayout: structure.amountLayout ?? "unknown",
    multiLineDescription: structure.multiLineDescription ?? true,
    secondaryLineRole: structure.secondaryLineRole ?? "mixed",
    embedsDateInDescription: structure.embedsDateInDescription ?? false,
    hasStandaloneReference: structure.hasStandaloneReference ?? false,
    descriptionPatterns: structure.descriptionPatterns ?? [],
    samplePrimaries: structure.samplePrimaries ?? [],
    sampleSecondaries: structure.sampleSecondaries ?? [],
    recipe: structure.recipe ?? "",
    notes: structure.notes ?? [],
  };

  return transactions.map((t) => {
    const raw = fn();
    const parts = formatDescriptionToStructure(profile, raw);
    const description = joinStructuredDescription(parts);
    return {
      ...t,
      description,
      flags: [
        ...new Set([...(t.flags ?? []), "bank-desc", id, "struct-preserve"]),
      ],
    };
  });
}

export {
  genAnz,
  genCba,
  genWestpac,
  genIng,
  genBankwest,
  genSuncorp,
  genMacquarie,
  genRams,
  genOther,
  rawGenerators,
};
