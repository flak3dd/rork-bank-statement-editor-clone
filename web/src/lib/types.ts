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
}

export interface CompletenessFinding {
  id: string;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  transactionId?: string;
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
  extractedAt: string;
}

export type AppPhase = "upload" | "extracting" | "workspace";

export type ExtractStepId =
  | "read"
  | "parse"
  | "structure"
  | "ai"
  | "done";

export interface ExtractStep {
  id: ExtractStepId;
  label: string;
  status: "pending" | "active" | "done" | "error" | "skipped";
}
