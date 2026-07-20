import type { StatementLayoutAnalysis } from "@/lib/statement-layout/types";

/** Spending categories used for AI + heuristic labeling. */
export type TransactionCategory =
  | "Income"
  | "Transfer"
  | "Groceries"
  | "Dining"
  | "Transport"
  | "Housing"
  | "Utilities"
  | "Shopping"
  | "Health"
  | "Entertainment"
  | "Fees"
  | "Other";

export const CATEGORIES: TransactionCategory[] = [
  "Income",
  "Transfer",
  "Groceries",
  "Dining",
  "Transport",
  "Housing",
  "Utilities",
  "Shopping",
  "Health",
  "Entertainment",
  "Fees",
  "Other",
];

export type SortKey = "date" | "description" | "debit" | "credit" | "balance" | "category";
export type SortDir = "asc" | "desc";

/** Editable money/text fields on a transaction row. */
export type EditableField = "date" | "description" | "debit" | "credit" | "balance";

export const EDITABLE_FIELDS: EditableField[] = [
  "date",
  "description",
  "debit",
  "credit",
  "balance",
];

export interface Transaction {
  id: string;
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  category: TransactionCategory;
  categorySource: "heuristic" | "ai" | "manual";
  categoryConfidence: number;
  flags: string[];
  notes?: string;
  /** Snapshot of values at parse time — used for per-row revert. */
  original?: TransactionSnapshot;
  /** True after Confirm & Render applied engine balances to this row. */
  rendered?: boolean;
}

export interface TransactionSnapshot {
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
}

export interface CompletenessFinding {
  id: string;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  transactionId?: string;
}

/** Hybrid extraction completeness score (0–100). */
export interface CompletenessScore {
  /** Overall 0–100 score. */
  overall: number;
  grade: "A" | "B" | "C" | "D" | "F";
  dimensions: {
    extractionDensity: number;
    dateCoverage: number;
    amountCoverage: number;
    balanceChain: number;
    descriptionQuality: number;
    aiConfidence: number;
  };
  weights: Record<keyof CompletenessScore["dimensions"], number>;
  summary: string;
  limitedExtraction: boolean;
}

export interface StatementSummary {
  transactionCount: number;
  totalIn: number;
  totalOut: number;
  net: number;
  openingBalance: number | null;
  closingBalance: number | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface ExtractionResult {
  fileName: string;
  pageCount: number;
  rawText: string;
  textLength: number;
  limitedExtraction: boolean;
  transactions: Transaction[];
  summary: StatementSummary;
  findings: CompletenessFinding[];
  completenessScore: CompletenessScore;
  extractedAt: string;
  /** Hybrid parse metadata. */
  hybrid?: HybridParseMeta;
  /** Document parser used for extraction. */
  parser?: DocumentParserMeta;
  /**
   * Frozen three-part layout profile from upload (Stage 1 Step 1).
   * Static chrome · header/footer variables · transaction table + structure profile.
   * Downstream OEM replica reuses this — does not re-classify cold.
   */
  layout?: StatementLayoutAnalysis | null;
}

export interface HybridParseMeta {
  lineParserCount: number;
  recoveredContinuationLines: number;
  aiValidated: boolean;
  enginesTried: string[];
}

/** Snapshot of which document parser produced the extraction. */
export interface DocumentParserMeta {
  id: string;
  label: string;
  durationMs: number;
  fallbackUsed: boolean;
  fallbackFrom?: string;
  enginesTried: string[];
  bankTemplateId?: string | null;
  bankTemplateName?: string | null;
  warnings: string[];
  structuredFromApi: boolean;
}

export type AppPhase = "upload" | "extracting" | "workspace";

/**
 * Post-extract workflow steps for the megabuild editor pipeline.
 * parse happens during extraction; workspace starts at edit.
 */
export type WorkflowStep =
  | "edit"
  | "balance"
  | "render"
  | "visual"
  | "math"
  | "generate"
  | "fidelity"
  | "complete";

export const WORKFLOW_STEPS: Array<{
  id: WorkflowStep;
  label: string;
  short: string;
  description: string;
}> = [
  {
    id: "edit",
    label: "Inline Edit",
    short: "Edit",
    description: "Edit Date, Description, Debit, Credit, Balance — revert any row",
  },
  {
    id: "balance",
    label: "Balance Out Preview",
    short: "Balance",
    description: "Per-row diffs with yellow overlays on mismatches",
  },
  {
    id: "render",
    label: "Confirm & Render",
    short: "Render",
    description: "Apply edits with balance-engine fallbacks",
  },
  {
    id: "visual",
    label: "Visual Validate",
    short: "Visual",
    description:
      "Pdfium render + SSIM · tile-max · pHash (always) · Applitools Eyes optional",
  },
  {
    id: "math",
    label: "Final Math Check",
    short: "Math",
    description: "Re-parse integrity and running-balance verification",
  },
  {
    id: "generate",
    label: "Statement Generate",
    short: "Generate",
    description:
      "Config → engine → A4 pagination → print view · CSV · apply to table",
  },
  {
    id: "fidelity",
    label: "Fidelity Forensics",
    short: "Forensics",
    description:
      "AI fidelity + authenticity forensics vs original source (all layers)",
  },
  {
    id: "complete",
    label: "Complete",
    short: "Done",
    description: "Export verified data",
  },
];

export type ExtractStepId =
  | "read"
  | "parse"
  | "structure"
  | "ai"
  | "score"
  | "done";

export interface ExtractStep {
  id: ExtractStepId;
  label: string;
  status: "pending" | "active" | "done" | "error" | "skipped";
}

export interface PdfFontSpec {
  family: string;
  weight: number;
  style: "normal" | "italic" | "oblique";
  stretch: string;
}

export interface PdfEdit {
  id: string;
  page: number;
  runId: string;
  original: string;
  replacement: string;
  bbox: { x: number; y: number; width: number; height: number };
  fontSpec: PdfFontSpec;
  linkedTransactionId?: string;
  linkedField?: keyof Transaction;
}

/** Balance computation engines (with fallback chain). */
export type BalanceEngineId = "stated" | "recompute" | "hybrid";

export interface BalanceEngineOption {
  id: BalanceEngineId;
  label: string;
  description: string;
}

export const BALANCE_ENGINES: BalanceEngineOption[] = [
  {
    id: "hybrid",
    label: "Hybrid (recommended)",
    description: "Keep stated balances where consistent; recompute gaps and drifts",
  },
  {
    id: "recompute",
    label: "Recompute chain",
    description: "Rebuild every balance from opening + credits − debits",
  },
  {
    id: "stated",
    label: "Stated only",
    description: "Keep statement balances as entered; no auto-fix",
  },
];

export interface RowBalanceDiff {
  transactionId: string;
  index: number;
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  statedBalance: number | null;
  expectedBalance: number | null;
  /** expected − stated (null if either missing). */
  delta: number | null;
  /** Absolute drift above tolerance. */
  mismatched: boolean;
  fieldsChanged: EditableField[];
  isDirty: boolean;
}

export interface BalancePreviewResult {
  engine: BalanceEngineId;
  rows: RowBalanceDiff[];
  mismatchCount: number;
  dirtyCount: number;
  openingBalance: number | null;
  closingStated: number | null;
  closingExpected: number | null;
  chainHealthy: boolean;
}

export interface RenderResult {
  engineUsed: BalanceEngineId;
  enginesTried: BalanceEngineId[];
  fallbackUsed: boolean;
  transactions: Transaction[];
  appliedAt: string;
  rowsUpdated: number;
  summary: string;
  /** PDF render engine chain result (mupdf → pdfium → pdfjs). */
  pdfEngine?: {
    engineUsed: string;
    enginesTried: string[];
    fallbackUsed: boolean;
    pageCount: number;
  };
}

export interface FieldLayerDiff {
  field: EditableField;
  original: string;
  current: string;
  changed: boolean;
}

export interface VisualRowCompare {
  id: string;
  index: number;
  layers: FieldLayerDiff[];
  anyChanged: boolean;
  amountDelta: number;
  balanceDelta: number | null;
}

export interface VisualValidateResult {
  rows: VisualRowCompare[];
  changedRowCount: number;
  totalFieldChanges: number;
  totals: {
    originalIn: number;
    currentIn: number;
    originalOut: number;
    currentOut: number;
    originalNet: number;
    currentNet: number;
  };
  structure: {
    originalCount: number;
    currentCount: number;
    countChanged: boolean;
  };
}

export type MathCheckStatus = "pass" | "warn" | "fail";

export interface MathCheckItem {
  id: string;
  status: MathCheckStatus;
  title: string;
  detail: string;
  transactionId?: string;
}

export interface MathCheckResult {
  status: MathCheckStatus;
  score: number;
  items: MathCheckItem[];
  reparsedCount: number;
  balanceChainOk: boolean;
  openingPlusNetOk: boolean | null;
  checkedAt: string;
}
