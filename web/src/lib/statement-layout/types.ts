/**
 * Two-step statement fidelity model (bank-agnostic):
 *
 * Step 1 — Perfect initial analysis/parse maps every page into THREE parts:
 *   Part 1: Static chrome (unchanged base layer)
 *   Part 2: Header / footer variables
 *   Part 3: Transaction table (date · description · credit/debit · balance)
 *
 * Step 2 — Preserve each bank’s transaction identification structure when
 * injecting synthetic rows (refs, embedded dates, multi-line desc, etc.).
 */

import type { Transaction } from "@/lib/types";

/** Coarse region of a statement page. */
export type LayoutPartId = "static" | "header_footer_vars" | "transaction_table";

export type RunRole =
  | "static_label"
  | "static_legal"
  | "static_brand"
  | "static_rule_hint"
  | "var_identity"
  | "var_address"
  | "var_account"
  | "var_bsb"
  | "var_period"
  | "var_balance_summary"
  | "var_opened"
  | "var_page"
  | "var_created"
  | "var_other"
  | "table_header"
  | "txn_date"
  | "txn_description_primary"
  | "txn_description_secondary"
  | "txn_debit"
  | "txn_credit"
  | "txn_amount"
  | "txn_balance"
  | "txn_reference"
  | "unknown";

export interface LayoutRun {
  id: string;
  page: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  fontSize?: number;
  /** Assigned after classification. */
  part: LayoutPartId;
  role: RunRole;
  /** Transaction row index within the statement (0-based), if any. */
  txnRowIndex?: number;
  confidence: number;
}

/** Part 1 — items that stay identical on the replica base. */
export interface StaticLayer {
  runs: LayoutRun[];
  /** Human labels detected (table headers, section titles). */
  labels: string[];
  /** Legal / ABN / licence lines. */
  legalLines: string[];
  notes: string[];
}

/** Part 2 — header & footer variable slots (identity, period, page chrome). */
export interface HeaderFooterVariables {
  runs: LayoutRun[];
  fields: {
    holderName?: string | null;
    addressLines?: string[];
    bsb?: string | null;
    accountNumber?: string | null;
    accountOpened?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    periodDays?: number | null;
    currentBalance?: number | null;
    openingBalance?: number | null;
    dateCreated?: string | null;
    pageLabel?: string | null;
  };
  /** Geometry slots for injection (role → runs). */
  slots: Partial<Record<RunRole, LayoutRun[]>>;
  notes: string[];
}

/** One physical transaction row (may span multiple text lines). */
export interface TransactionTableRow {
  index: number;
  page: number;
  /** Top Y of the primary line (source coordinate system). */
  y: number;
  dateRaw: string | null;
  dateIso: string | null;
  /** Full description as the bank laid it out (joined lines). */
  description: string;
  primaryLine: string;
  secondaryLines: string[];
  /** Optional bank reference line(s). */
  referenceLines: string[];
  debit: number | null;
  credit: number | null;
  /** Single signed amount when bank uses one amount column. */
  amount: number | null;
  balance: number | null;
  runs: LayoutRun[];
  /** Structure tags inferred for this row. */
  structureTags: string[];
}

/** Part 3 — transaction table geometry + parsed rows. */
export interface TransactionTableLayer {
  runs: LayoutRun[];
  columnOrder: Array<
    "date" | "description" | "debit" | "credit" | "amount" | "balance"
  >;
  /** Approximate column X anchors. */
  columns: {
    dateX?: number;
    descriptionX?: number;
    debitX?: number;
    creditX?: number;
    amountX?: number;
    balanceX?: number;
  };
  headerY?: number;
  bodyYMin?: number;
  bodyYMax?: number;
  rowPitchMedian?: number;
  rows: TransactionTableRow[];
  notes: string[];
}

/**
 * How a bank formats transaction identity text.
 * Synthetic generators must match this — not invent a foreign style.
 */
export interface BankTransactionStructureProfile {
  bankId: string;
  bankName: string;
  confidence: number;
  /** e.g. "dd mmm", "dd/mm/yyyy", "mm/dd/yyyy" */
  dateFormat: string;
  /** Single amount column vs separate debit/credit. */
  amountLayout: "signed_amount_balance" | "debit_credit_balance" | "credit_debit_balance" | "unknown";
  multiLineDescription: boolean;
  /** Secondary line is continuation of merchant / type. */
  secondaryLineRole: "merchant" | "type" | "reference" | "mixed" | "none";
  /** Description often embeds a processing date (Visa Purchase 14Nov). */
  embedsDateInDescription: boolean;
  /** Numeric/alphanumeric reference on its own line. */
  hasStandaloneReference: boolean;
  /** Patterns observed in source descriptions (regex sources). */
  descriptionPatterns: string[];
  /** Example primary lines from the source (for style matching). */
  samplePrimaries: string[];
  sampleSecondaries: string[];
  /** Human-readable structure recipe. */
  recipe: string;
  notes: string[];
}

/** Full Step-1 analysis result. */
export interface StatementLayoutAnalysis {
  version: 1;
  kind: "statement-layout.three-part";
  fileName?: string;
  pageCount: number;
  pageSize?: { width: number; height: number };
  bankHint: string | null;
  documentClass: "filled-statement" | "token-template" | "base-shell" | "unknown";
  /** All classified runs. */
  runs: LayoutRun[];
  part1: StaticLayer;
  part2: HeaderFooterVariables;
  part3: TransactionTableLayer;
  /** Step-2 structure profile derived from Part 3 samples. */
  txnStructure: BankTransactionStructureProfile;
  /** Parsed transactions (structure-preserving). */
  transactions: Transaction[];
  score: number;
  gates: Array<{ id: string; pass: boolean; detail: string }>;
  notes: string[];
  durationMs: number;
}

export interface AnalyzeLayoutOptions {
  fileName?: string;
  maxPages?: number;
  /** Optional pre-extracted raw text. */
  rawText?: string;
  bankHint?: string | null;
}
