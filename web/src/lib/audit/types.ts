import type { Transaction, WorkflowStep } from "@/lib/types";
import type { VerificationThresholds } from "@/lib/verification/thresholds";
import type { DocumentParserId } from "@/lib/parsers";

export type AuditActor = "user" | "system" | "ai";

export type AuditEventType =
  | "session.start"
  | "session.reset"
  | "parse.complete"
  | "txn.edit"
  | "txn.revert"
  | "txn.category"
  | "workflow.step"
  | "balance.preview"
  | "render.apply"
  | "visual.run"
  | "visual.result"
  | "math.run"
  | "math.result"
  | "undo"
  | "redo"
  | "draft.save"
  | "draft.restore"
  | "export"
  | "threshold.change"
  | "note";

/** Append-only audit log entry (never mutated after insert). */
export interface AuditLogEntry {
  id: string;
  ts: string;
  type: AuditEventType;
  message: string;
  actor: AuditActor;
  /** Optional structured payload (JSON-serializable). */
  payload?: Record<string, unknown>;
}

/** Field-level change history for transactions. */
export interface ChangeHistoryEntry {
  id: string;
  ts: string;
  transactionId: string;
  field: string;
  from: string | number | null;
  to: string | number | null;
  source: "edit" | "revert" | "render" | "category" | "undo" | "redo";
}

/** Snapshot for undo/redo. */
export interface UndoSnapshot {
  id: string;
  ts: string;
  label: string;
  transactions: Transaction[];
  workflowStep: WorkflowStep;
}

/**
 * Autosaved draft shape — written as audit/workflow.json (download or OPFS).
 */
export interface WorkflowDraft {
  version: 1;
  kind: "statement-lens.workflow";
  path: "audit/workflow.json";
  savedAt: string;
  fileName: string;
  parserId: DocumentParserId | null;
  workflowStep: WorkflowStep;
  transactions: Transaction[];
  auditLog: AuditLogEntry[];
  changeHistory: ChangeHistoryEntry[];
  thresholds: VerificationThresholds;
  pixelReportSummary: {
    status: string;
    score: number;
    dpi: number;
    attempts: number;
  } | null;
  mathSummary: {
    status: string;
    score: number;
  } | null;
  meta: {
    pageCount: number;
    limitedExtraction: boolean;
    completenessOverall: number | null;
  };
}

/** Injection pipeline summary embedded in the merged audit report. */
export interface InjectionAuditSection {
  product: "Bank Statement Fidelity Editor";
  goal: string;
  strategy: string | null;
  documentClass: string | null;
  score: number | null;
  editCount: number;
  notes: string[];
  gates: Array<{ id: string; pass: boolean; detail: string }>;
  coverage: {
    description: { applied: number; changed: number; linked: number };
    balance: { applied: number; changed: number; linked: number };
    date: { applied: number; changed: number; linked: number };
  } | null;
  writePolicy: string;
}

/** Auto-merged verification + audit JSON report. */
export interface MergedAuditReport {
  version: 2;
  kind: "bank-statement-fidelity-editor.audit-report";
  product: "Bank Statement Fidelity Editor";
  generatedAt: string;
  fileName: string;
  thresholds: VerificationThresholds;
  auditLog: AuditLogEntry[];
  changeHistory: ChangeHistoryEntry[];
  /** Logic-generator data injection pipeline outcome. */
  injection: InjectionAuditSection | null;
  verification: {
    dpi: number;
    pixelStatus: string;
    pixelScore: number;
    attempts: number;
    pages: Array<{
      pageNumber: number;
      score: number;
      status: string;
      ssim: number;
      meanAbsDelta: number;
      phashDistance: number;
      tileMaxDiff: number;
      failedGates: string[];
    }>;
    notes: string[];
  } | null;
  math: {
    status: string;
    score: number;
    items: Array<{ id: string; status: string; title: string }>;
  } | null;
  summary: {
    transactionCount: number;
    dirtyCount: number;
    auditEvents: number;
    changes: number;
  };
}
