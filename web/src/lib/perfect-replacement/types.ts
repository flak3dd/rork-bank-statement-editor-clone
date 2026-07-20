/**
 * Perfect Replacement Pipeline — types & coverage contracts.
 *
 * Goal: for ANY uploaded statement PDF, produce a regenerated candidate that
 * carries every intended field change with geometric fidelity and zero blank
 * redactions. Integrated into auto workflow after parse / ledger replace / export.
 */
import type { PdfEdit, Transaction } from "@/lib/types";
import type { StatementVariableOverrides } from "@/lib/statement-gen/variables";

export type ReplacementStrategyId =
  | "template-tokens" // St George / {TOKEN} shells
  | "geometry-link" // baseline value → PDF run → new value
  | "row-cluster" // Y-clustered row slots when values are sparse
  | "queued-edits" // explicit PdfEdit queue (click / prior tools)
  | "hybrid-merge"; // union of strategies after dedupe

export type DocumentClass =
  | "token-template" // placeholders like {BSB}
  | "filled-statement" // real bank statement text
  | "unknown";

export interface FieldCoverage {
  date: { linked: number; changed: number; applied: number };
  description: { linked: number; changed: number; applied: number };
  debit: { linked: number; changed: number; applied: number };
  credit: { linked: number; changed: number; applied: number };
  balance: { linked: number; changed: number; applied: number };
  chrome: { linked: number; changed: number; applied: number };
}

export interface PerfectReplacementRequest {
  /** Uploaded / active source PDF (template or filled). */
  sourcePdf: Uint8Array;
  /** Values still drawn on the PDF (parse freeze). */
  sourceBaseline: Transaction[];
  /** Desired working ledger after generate / edit. */
  current: Transaction[];
  /** Optional identity / period overrides for template chrome. */
  variables?: StatementVariableOverrides | null;
  /** Explicit edits already queued (click-to-edit, tools). */
  queuedEdits?: PdfEdit[];
  /** Pre-extracted raw text (optional — extracted if missing). */
  rawText?: string;
  maxPages?: number;
  /**
   * Minimum fraction of changed description fields that must apply (0–1).
   * Default 0.5 for auto; raise for strict export gates.
   */
  minDescriptionCoverage?: number;
  /** When true, throw if coverage gates fail. Default false (soft). */
  strict?: boolean;
}

export interface PerfectReplacementResult {
  ok: boolean;
  strategy: ReplacementStrategyId;
  documentClass: DocumentClass;
  candidatePdf: Uint8Array;
  appliedEdits: PdfEdit[];
  editCount: number;
  coverage: FieldCoverage;
  /** 0–100 composite readiness score for auto workflow. */
  score: number;
  gates: Array<{
    id: string;
    pass: boolean;
    detail: string;
  }>;
  strategiesTried: ReplacementStrategyId[];
  notes: string[];
  durationMs: number;
}

export function emptyFieldCoverage(): FieldCoverage {
  const z = () => ({ linked: 0, changed: 0, applied: 0 });
  return {
    date: z(),
    description: z(),
    debit: z(),
    credit: z(),
    balance: z(),
    chrome: z(),
  };
}
