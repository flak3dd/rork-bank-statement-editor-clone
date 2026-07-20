/**
 * OEM Perfect Replica — contracts.
 *
 * Goal: a regenerated PDF that is visually indistinguishable from a real
 * OEM bank statement: same static chrome, same txn structure, updated data only.
 */
import type { PdfEdit, Transaction } from "@/lib/types";
import type { StatementLayoutAnalysis } from "@/lib/statement-layout";
import type { PerfectReplacementResult } from "@/lib/perfect-replacement";
import type { StatementVariableOverrides } from "@/lib/statement-gen/variables";

export type OemReplicaPath =
  | "filled-geometry" // rewrite on original filled OEM PDF (best visual match)
  | "st-george-layered" // TEMPLATE 2 base + placement geometry
  | "token-template" // pure {TOKEN} shell fill
  | "hybrid-fallback"; // perfect replacement soft path

export interface OemPerfectReplicaRequest {
  /** Source PDF bytes (uploaded statement, template, or base shell). */
  sourcePdf: Uint8Array;
  /** Parse freeze — values still drawn on the PDF when filled. */
  sourceBaseline: Transaction[];
  /** Working ledger after generate / edit / bank-desc. */
  current: Transaction[];
  /** Explicit tool / click edits. */
  queuedEdits?: PdfEdit[];
  variables?: StatementVariableOverrides | null;
  rawText?: string;
  fileName?: string;
  maxPages?: number;
  /**
   * Optional pure base PDF (e.g. TEMPLATE 2). When source is a placement map
   * or we force layered St George compose, paint onto this instead.
   */
  basePdf?: Uint8Array | null;
  /**
   * When true (default), reshape descriptions to match Part-3 structure profile
   * before writing so OEM txn identity style is preserved.
   */
  preserveTxnStructure?: boolean;
  /** Soft coverage gate for description apply ratio. */
  minDescriptionCoverage?: number;
  /** Throw if OEM gates fail. Default false. */
  strict?: boolean;
  /**
   * Frozen Stage-1 layout from upload (`analyzeStatementLayout` at parse time).
   * When provided, the pipeline skips re-analysis and reuses Part1/2/3 + structure.
   */
  layout?: StatementLayoutAnalysis | null;
}

export interface OemPerfectReplicaResult {
  ok: boolean;
  /** Final OEM-looking PDF. */
  candidatePdf: Uint8Array;
  path: OemReplicaPath;
  /** Structure-preserving ledger actually painted. */
  structuredLedger: Transaction[];
  appliedEdits: PdfEdit[];
  editCount: number;
  /** 0–100 composite OEM readiness (layout + coverage + write). */
  score: number;
  layout: StatementLayoutAnalysis | null;
  perfect: PerfectReplacementResult | null;
  gates: Array<{ id: string; pass: boolean; detail: string }>;
  notes: string[];
  durationMs: number;
  /** Audit-friendly summary. */
  summary: {
    bankId: string | null;
    documentClass: string;
    staticRuns: number;
    varRuns: number;
    txnRowsMapped: number;
    structureRecipe: string | null;
    writePolicy: string;
  };
}
