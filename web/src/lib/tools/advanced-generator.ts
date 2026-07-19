import { categorizeDescription } from "@/lib/categorize";
import { attachOriginals, snapshotOf } from "@/lib/edit-utils";
import {
  formatDateLikeOriginal,
  formatMoneyLikeOriginal,
  round2,
} from "@/lib/money";
import { matchFontSpec } from "@/lib/pdf-render";
import type { PdfEdit, PdfFontSpec, Transaction } from "@/lib/types";
import {
  generateBankDescription,
  normalizeBankId,
  type BankId,
} from "./bank-descriptions";

export interface GeneratorOptions {
  count: number;
  /** ISO date start of period */
  periodStart: string;
  /** ISO date end of period */
  periodEnd: string;
  openingBalance: number;
  seed?: number;
  locale?: "au" | "us" | "uk";
  includeIncome?: boolean;
  /**
   * Bank id for authentic description generation
   * (anz|cba|westpac|ing|bankwest|suncorp|macquarie|rams|other).
   * When set, uses transactionalDescriptionGenerator formats.
   */
  bank?: string;
}

export interface GeneratedBundle {
  transactions: Transaction[];
  seed: number;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance: number;
}

export interface ReplaceWithFontOptions {
  /** Existing PDF text runs to style-match against */
  donorFont?: PdfFontSpec;
  page?: number;
  /** Optional geometry anchors for each row (y baseline) */
  rowBaselines?: number[];
}

const MERCHANTS_AU = [
  "WOOLWORTHS",
  "COLES",
  "BP FUEL",
  "UBER TRIP",
  "NETFLIX.COM",
  "SPOTIFY",
  "TELSTRA",
  "ORIGIN ENERGY",
  "CHEMIST WAREHOUSE",
  "MCDONALDS",
  "KMART",
  "BUNNINGS",
  "OFFICEWORKS",
  "AMAZON AU",
  "TRANSPORT NSW",
];

const MERCHANTS_US = [
  "WHOLE FOODS",
  "SHELL OIL",
  "UBER TRIP",
  "NETFLIX.COM",
  "SPOTIFY",
  "COMCAST",
  "CVS PHARMACY",
  "MCDONALDS",
  "TARGET",
  "HOME DEPOT",
  "AMAZON.COM",
  "STARBUCKS",
  "WALMART",
  "COSTCO",
  "DELTA AIR",
];

const INCOME_LABELS = ["SALARY ACME CORP", "DIRECT DEPOSIT PAYROLL", "INTEREST CREDIT"];

/** Mulberry32 PRNG for reproducible demo data. */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseIso(d: string): Date {
  const x = new Date(d + "T12:00:00Z");
  if (Number.isNaN(x.getTime())) return new Date();
  return x;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function money(rng: () => number, min: number, max: number): number {
  return round2(min + rng() * (max - min));
}

/**
 * Advanced transaction generator — realistic merchant mix, income rows,
 * and running balances for demos / pipeline testing.
 */
export function advancedGenerator(options: GeneratorOptions): GeneratedBundle {
  const seed = options.seed ?? Math.floor(Math.random() * 1e9);
  const rng = createRng(seed);
  const start = parseIso(options.periodStart);
  const end = parseIso(options.periodEnd);
  const spanMs = Math.max(end.getTime() - start.getTime(), 86400000);
  const merchants =
    options.locale === "us" ? MERCHANTS_US : MERCHANTS_AU;
  const includeIncome = options.includeIncome !== false;
  const count = Math.max(1, Math.min(200, options.count));
  // Only use bank-format generators when explicitly requested (Math.random
  // inside generators would break seed-deterministic advancedGenerator tests).
  const bank: BankId | null = options.bank
    ? normalizeBankId(options.bank)
    : null;

  const txns: Transaction[] = [];
  let balance = options.openingBalance;

  for (let i = 0; i < count; i++) {
    const t = start.getTime() + (spanMs * (i + rng() * 0.4)) / count;
    const date = toIso(new Date(t));
    const isIncome =
      includeIncome && (i === Math.floor(count / 3) || (rng() < 0.08 && i > 2));

    let description: string;
    let debit: number | null = null;
    let credit: number | null = null;

    if (isIncome) {
      // Prefer bank-format income-ish descriptions when bank is set
      description = bank
        ? generateBankDescription(bank)
        : pick(rng, INCOME_LABELS);
      credit = money(rng, 1800, 4200);
      balance = round2(balance + credit);
    } else {
      description = bank
        ? generateBankDescription(bank)
        : pick(rng, merchants);
      debit = money(rng, 4.5, 220);
      // occasional large
      if (rng() < 0.08) debit = money(rng, 400, 1800);
      balance = round2(balance - debit);
    }

    const { category, confidence } = categorizeDescription(
      description,
      credit,
      debit,
    );

    const row: Transaction = {
      id: `gen-${seed.toString(36)}-${i}`,
      date,
      description,
      debit,
      credit,
      balance,
      category,
      categorySource: "heuristic",
      categoryConfidence: confidence,
      flags: ["generated"],
    };
    row.original = snapshotOf(row);
    txns.push(row);
  }

  return {
    transactions: attachOriginals(txns),
    seed,
    periodStart: options.periodStart,
    periodEnd: options.periodEnd,
    openingBalance: options.openingBalance,
    closingBalance: balance,
  };
}

/**
 * Build PdfEdit replacements for generated/edited values using donor font replication.
 * Aligns string replacements to run geometry when provided.
 */
export type FontRunMatch = {
  transactionId: string;
  field: "date" | "description" | "debit" | "credit" | "balance";
  runId: string;
  page: number;
  original: string;
  bbox: { x: number; y: number; width: number; height: number };
  fontName?: string;
  fontFamily?: string;
};

export function buildFontReplicatedReplacements(params: {
  transactions: Transaction[];
  /** Map transaction field display strings → existing run ids to overwrite */
  runMatches?: FontRunMatch[];
  donorFont?: PdfFontSpec;
  /** When true, empty money fields clear the run with spaces. */
  clearEmpty?: boolean;
  /**
   * When true (default), money/dates are formatted like the original PDF
   * glyphs (e.g. "-$99.30", "18 Nov") so the final PDF keeps visual style.
   */
  matchOriginalStyle?: boolean;
}): PdfEdit[] {
  const donor =
    params.donorFont ?? matchFontSpec("Helvetica", "Helvetica");
  const style = params.matchOriginalStyle !== false;
  const edits: PdfEdit[] = [];

  for (const m of params.runMatches ?? []) {
    const t = params.transactions.find((x) => x.id === m.transactionId);
    if (!t) continue;
    let replacement = "";
    if (m.field === "date") {
      replacement = style
        ? formatDateLikeOriginal(t.date, m.original)
        : t.date;
    } else if (m.field === "description") {
      replacement = t.description;
    } else if (m.field === "debit") {
      replacement =
        t.debit != null
          ? style
            ? formatMoneyLikeOriginal(t.debit, m.original)
            : t.debit.toFixed(2)
          : "";
    } else if (m.field === "credit") {
      replacement =
        t.credit != null
          ? style
            ? formatMoneyLikeOriginal(t.credit, m.original)
            : t.credit.toFixed(2)
          : "";
    } else if (m.field === "balance") {
      replacement =
        t.balance != null
          ? style
            ? formatMoneyLikeOriginal(t.balance, m.original)
            : t.balance.toFixed(2)
          : "";
    }

    if (!replacement) {
      if (!params.clearEmpty) continue;
      replacement = " ".repeat(Math.max(1, m.original.length));
    }
    if (replacement === m.original) continue;

    edits.push({
      id: `rep-${m.runId}-${Math.random().toString(36).slice(2, 8)}`,
      page: m.page,
      runId: m.runId,
      original: m.original,
      replacement,
      bbox: m.bbox,
      fontSpec: m.fontName
        ? matchFontSpec(m.fontFamily, m.fontName)
        : donor,
      linkedTransactionId: m.transactionId,
      linkedField: m.field,
    });
  }

  return edits;
}

/**
 * Replace working-set transactions with generated ones (keeps originals for revert
 * on each new row via attachOriginals).
 */
export function replaceWithGenerated(
  generated: GeneratedBundle,
): Transaction[] {
  return attachOriginals(
    generated.transactions.map((t) => ({
      ...t,
      flags: [...new Set([...t.flags, "generated", "replaced"])],
    })),
  );
}
