import type { MathCheckResult } from "@/lib/types";
import type { VisualVerificationReport } from "@/lib/verification";
import type { VerificationThresholds } from "@/lib/verification/thresholds";
import type {
  AuditLogEntry,
  ChangeHistoryEntry,
  MergedAuditReport,
} from "./types";

export function buildMergedAuditReport(params: {
  fileName: string;
  thresholds: VerificationThresholds;
  auditLog: AuditLogEntry[];
  changeHistory: ChangeHistoryEntry[];
  pixelReport: VisualVerificationReport | null;
  mathResult: MathCheckResult | null;
  transactionCount: number;
  dirtyCount: number;
}): MergedAuditReport {
  const { pixelReport, mathResult } = params;

  return {
    version: 1,
    kind: "statement-lens.audit-report",
    generatedAt: new Date().toISOString(),
    fileName: params.fileName,
    thresholds: params.thresholds,
    auditLog: params.auditLog,
    changeHistory: params.changeHistory,
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
