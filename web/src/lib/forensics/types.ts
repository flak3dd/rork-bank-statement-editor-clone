import type { CompletenessFinding, Transaction } from "@/lib/types";

export type ForensicSeverity = "critical" | "material" | "minor" | "supporting";
export type ForensicLayerId =
  | "structural"
  | "quantitative"
  | "narrative"
  | "authenticity"
  | "source-alignment"
  | "visual-pixel"
  | "generation-logic"
  | "ai-fidelity";

export interface ForensicFinding {
  id: string;
  layer: ForensicLayerId;
  severity: ForensicSeverity;
  title: string;
  detail: string;
  transactionId?: string;
  evidence?: string;
}

export interface LayerScore {
  layer: ForensicLayerId;
  label: string;
  score: number;
  weight: number;
  status: "pass" | "warn" | "fail" | "skipped";
  summary: string;
  findings: ForensicFinding[];
}

export interface FidelityForensicsReport {
  overallScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  /** pass = high fidelity to source; warn = intentional diffs; fail = breaks */
  verdict: "pass" | "warn" | "fail";
  confidence: number;
  judgment: string;
  layers: LayerScore[];
  findings: ForensicFinding[];
  source: {
    fileName: string;
    originalCount: number;
    workingCount: number;
    rawTextLength: number;
    pageCount: number;
  };
  metrics: {
    structuralMatch: number;
    quantitativeMatch: number;
    narrativeMatch: number;
    authenticityScore: number;
    sourceAlignment: number;
    generationConsistency: number;
    aiFidelity: number | null;
    visualScore: number | null;
  };
  ai?: {
    ran: boolean;
    skipped: boolean;
    summary?: string;
    risks?: string[];
    strengths?: string[];
  };
  checkedAt: string;
  durationMs: number;
  /** Markdown report body for export */
  markdown: string;
}

export interface ForensicInput {
  fileName: string;
  pageCount: number;
  rawText: string;
  /** Original parse-time transactions (from source PDF). */
  sourceTransactions: Transaction[];
  /** Current working set (edits / generation applied). */
  workingTransactions: Transaction[];
  findings?: CompletenessFinding[];
  pixelScore?: number | null;
  pixelStatus?: string | null;
  limitedExtraction?: boolean;
  runAi?: boolean;
  signal?: AbortSignal;
}
