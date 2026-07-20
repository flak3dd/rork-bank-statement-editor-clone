import type { MathCheckResult } from "@/lib/types";
import type { VisualVerificationReport } from "@/lib/verification";
import type { VerificationThresholds } from "@/lib/verification/thresholds";
import type {
  AuditLogEntry,
  ChangeHistoryEntry,
  InjectionAuditSection,
  MergedAuditReport,
} from "./types";

export interface BuildMergedAuditReportParams {
  fileName: string;
  thresholds: VerificationThresholds;
  auditLog: AuditLogEntry[];
  changeHistory: ChangeHistoryEntry[];
  pixelReport: VisualVerificationReport | null;
  mathResult: MathCheckResult | null;
  transactionCount: number;
  dirtyCount: number;
  /** Perfect-replacement / generator injection snapshot. */
  injection?: Partial<InjectionAuditSection> | null;
}

export function buildMergedAuditReport(
  params: BuildMergedAuditReportParams,
): MergedAuditReport {
  const { pixelReport, mathResult } = params;

  const injection: InjectionAuditSection | null = params.injection
    ? {
        product: "Bank Statement Fidelity Editor",
        goal:
          params.injection.goal ??
          "Exact replica via automated logic generator data injection",
        strategy: params.injection.strategy ?? null,
        documentClass: params.injection.documentClass ?? null,
        score: params.injection.score ?? null,
        editCount: params.injection.editCount ?? 0,
        notes: params.injection.notes ?? [],
        gates: params.injection.gates ?? [],
        coverage: params.injection.coverage ?? null,
        writePolicy:
          params.injection.writePolicy ??
          "Square cover + FreeText; redactions never written",
      }
    : null;

  return {
    version: 2,
    kind: "bank-statement-fidelity-editor.audit-report",
    product: "Bank Statement Fidelity Editor",
    generatedAt: new Date().toISOString(),
    fileName: params.fileName,
    thresholds: params.thresholds,
    auditLog: params.auditLog,
    changeHistory: params.changeHistory,
    injection,
    verification: pixelReport
      ? {
          dpi: pixelReport.dpi,
          pixelStatus: pixelReport.pixelStatus,
          pixelScore: pixelReport.pixelScore,
          attempts: pixelReport.attempts,
          pages: pixelReport.pages.map((p) => ({
            pageNumber: p.pageNumber,
            score: p.metrics.score,
            status: p.metrics.status,
            ssim: p.metrics.ssim.ssim,
            meanAbsDelta: p.metrics.perPixel.meanAbsDelta,
            phashDistance: p.metrics.phash.hammingDistance,
            tileMaxDiff: p.metrics.tileMax.tileMaxDiff,
            failedGates: p.metrics.failedGates,
          })),
          notes: pixelReport.notes,
        }
      : null,
    math: mathResult
      ? {
          status: mathResult.status,
          score: mathResult.score,
          items: mathResult.items.map((i) => ({
            id: i.id,
            status: i.status,
            title: i.title,
          })),
        }
      : null,
    summary: {
      transactionCount: params.transactionCount,
      dirtyCount: params.dirtyCount,
      auditEvents: params.auditLog.length,
      changes: params.changeHistory.length,
    },
  };
}

export function downloadMergedReport(report: MergedAuditReport): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const base = report.fileName.replace(/\.pdf$/i, "") || "statement";
  a.download = `${base}-audit-report.json`;
  a.click();
  URL.revokeObjectURL(url);
}
