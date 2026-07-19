import { describe, expect, it } from "vitest";
import {
  appendAuditEvent,
  appendChange,
  buildMergedAuditReport,
  buildWorkflowDraft,
  canRedo,
  canUndo,
  createChangeEntry,
  emptyUndoState,
  pushSnapshot,
  redo as redoStack,
  undo as undoStack,
} from "@/lib/audit";
import { clampMaxRetries, clampVisualDiff, normalizeThresholds } from "@/lib/verification/thresholds";
import type { Transaction } from "@/lib/types";

const sampleTxn = (id: string, debit: number | null = 10): Transaction => ({
  id,
  date: "2026-03-01",
  description: "Test",
  debit,
  credit: null,
  balance: 100,
  category: "Other",
  categorySource: "heuristic",
  categoryConfidence: 0.5,
  flags: [],
});

describe("thresholds", () => {
  it("clamps visualDiff to 0.005–0.10", () => {
    expect(clampVisualDiff(0.001)).toBe(0.005);
    expect(clampVisualDiff(0.5)).toBe(0.1);
    expect(clampVisualDiff(0.02)).toBe(0.02);
  });

  it("clamps maxRetries to 1–10", () => {
    expect(clampMaxRetries(0)).toBe(1);
    expect(clampMaxRetries(99)).toBe(10);
    expect(clampMaxRetries(3.7)).toBe(4);
  });

  it("normalizes thresholds with fixed 300 DPI", () => {
    const t = normalizeThresholds({ visualDiff: 0.01, maxRetries: 5 });
    expect(t.dpi).toBe(300);
    expect(t.visualDiff).toBe(0.01);
    expect(t.maxRetries).toBe(5);
  });
});

describe("audit log append-only", () => {
  it("appends without mutating prior array identity chain", () => {
    const a = appendAuditEvent([], "session.start", "start");
    const b = appendAuditEvent(a, "txn.edit", "edit");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
    expect(b[0].id).toBe(a[0].id);
    expect(b[0]).toEqual(a[0]);
  });
});

describe("change history", () => {
  it("records field changes", () => {
    const h = appendChange(
      [],
      createChangeEntry("txn-1", "debit", 10, 20, "edit"),
    );
    expect(h).toHaveLength(1);
    expect(h[0].from).toBe(10);
    expect(h[0].to).toBe(20);
  });
});

describe("undo/redo stack", () => {
  it("undo restores previous transactions", () => {
    let state = emptyUndoState();
    const t1 = [sampleTxn("a", 10)];
    const t2 = [sampleTxn("a", 20)];
    state = pushSnapshot(state, "before-edit", t1, "edit");
    expect(canUndo(state)).toBe(true);
    const { state: s2, restored } = undoStack(state, {
      transactions: t2,
      workflowStep: "edit",
    });
    expect(restored?.transactions[0].debit).toBe(10);
    expect(canRedo(s2)).toBe(true);
    const { restored: redone } = redoStack(s2, {
      transactions: restored!.transactions,
      workflowStep: "edit",
    });
    expect(redone?.transactions[0].debit).toBe(20);
  });
});

describe("workflow draft + merged report", () => {
  it("builds workflow.json-shaped draft", () => {
    const thr = normalizeThresholds();
    const draft = buildWorkflowDraft({
      fileName: "s.pdf",
      parserId: "mindee",
      workflowStep: "visual",
      transactions: [sampleTxn("a")],
      auditLog: appendAuditEvent([], "parse.complete", "ok"),
      changeHistory: [],
      thresholds: thr,
      pixelReportSummary: {
        status: "pass",
        score: 99,
        dpi: 300,
        attempts: 1,
      },
      mathSummary: null,
      meta: {
        pageCount: 1,
        limitedExtraction: false,
        completenessOverall: 80,
      },
    });
    expect(draft.path).toBe("audit/workflow.json");
    expect(draft.kind).toBe("statement-lens.workflow");
    expect(draft.thresholds.dpi).toBe(300);
  });

  it("merges audit + verification into report", () => {
    const report = buildMergedAuditReport({
      fileName: "s.pdf",
      thresholds: normalizeThresholds(),
      auditLog: appendAuditEvent([], "visual.result", "pass"),
      changeHistory: [],
      pixelReport: null,
      mathResult: null,
      transactionCount: 3,
      dirtyCount: 1,
    });
    expect(report.kind).toBe("statement-lens.audit-report");
    expect(report.summary.transactionCount).toBe(3);
    expect(report.auditLog).toHaveLength(1);
  });
});
