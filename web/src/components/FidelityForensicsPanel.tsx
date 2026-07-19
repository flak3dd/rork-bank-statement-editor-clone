import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  FileText,
  Loader2,
  ScanSearch,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { FidelityForensicsReport } from "@/lib/forensics";
import {
  downloadForensicsJson,
  downloadForensicsMarkdown,
} from "@/lib/forensics";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface FidelityForensicsPanelProps {
  report: FidelityForensicsReport | null;
  running?: boolean;
  onRun: () => void;
  onSelectRow?: (id: string) => void;
}

function VerdictIcon({
  verdict,
}: {
  verdict: FidelityForensicsReport["verdict"];
}) {
  if (verdict === "pass") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  }
  if (verdict === "warn") {
    return <AlertTriangle className="h-5 w-5 text-amber-600" />;
  }
  return <XCircle className="h-5 w-5 text-destructive" />;
}

export function FidelityForensicsPanel({
  report,
  running,
  onRun,
  onSelectRow,
}: FidelityForensicsPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <ScanSearch className="h-5 w-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <h3 className="text-sm font-semibold tracking-tight">
                AI fidelity &amp; authenticity forensics
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
                Multi-layer investigation of the <strong>result statement</strong>{" "}
                vs the <strong>original source extract</strong>: structure,
                quantities, narrative, authenticity markers, source alignment,
                generation-logic integrity, optional pixel scores, and AI review.
              </p>
            </div>
          </div>
          <Button
            className="rounded-full shrink-0"
            disabled={running}
            onClick={onRun}
          >
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldAlert className="mr-2 h-4 w-4" />
            )}
            {report ? "Re-run forensics" : "Run full forensics"}
          </Button>
        </div>

        {running && (
          <div className="space-y-2">
            <Progress value={70} className="h-2 animate-pulse" />
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Probing all forensic layers…
            </p>
          </div>
        )}

        {!report && !running && (
          <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border/80 px-4 py-8 text-center">
            Run forensics after parse/edit/generate to verify the working ledger
            against the original source file at every level.
          </p>
        )}

        {report && (
          <>
            <div
              className={cn(
                "rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3",
                report.verdict === "pass" &&
                  "border-emerald-500/30 bg-emerald-500/10",
                report.verdict === "warn" &&
                  "border-amber-500/40 bg-amber-500/10",
                report.verdict === "fail" &&
                  "border-destructive/40 bg-destructive/10",
              )}
            >
              <VerdictIcon verdict={report.verdict} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold capitalize">
                  {report.verdict} · grade {report.grade}
                </p>
                <p className="text-xs text-muted-foreground">
                  Overall {report.overallScore}/100 · confidence{" "}
                  {(report.confidence * 100).toFixed(0)}% ·{" "}
                  {report.durationMs}ms · source {report.source.originalCount} →
                  working {report.source.workingCount}
                </p>
              </div>
              <Badge variant="secondary" className="tabular-nums text-base px-3">
                {report.overallScore}
              </Badge>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              {report.judgment}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Metric
                label="Structural"
                value={report.metrics.structuralMatch.toFixed(0)}
              />
              <Metric
                label="Quantitative"
                value={report.metrics.quantitativeMatch.toFixed(0)}
              />
              <Metric
                label="Narrative"
                value={report.metrics.narrativeMatch.toFixed(0)}
              />
              <Metric
                label="Authenticity"
                value={report.metrics.authenticityScore.toFixed(0)}
              />
              <Metric
                label="Source align"
                value={report.metrics.sourceAlignment.toFixed(0)}
              />
              <Metric
                label="Gen logic"
                value={report.metrics.generationConsistency.toFixed(0)}
              />
              <Metric
                label="AI fidelity"
                value={
                  report.metrics.aiFidelity != null
                    ? report.metrics.aiFidelity.toFixed(0)
                    : "—"
                }
              />
              <Metric
                label="Pixel"
                value={
                  report.metrics.visualScore != null
                    ? String(report.metrics.visualScore)
                    : "—"
                }
              />
            </div>

            {/* Layers */}
            <div className="space-y-2">
              <p className="text-xs font-semibold">Forensic layers</p>
              <ul className="space-y-2">
                {report.layers.map((l) => (
                  <li
                    key={l.layer}
                    className={cn(
                      "rounded-xl border px-3 py-2.5",
                      l.status === "pass" && "border-border/60 bg-muted/20",
                      l.status === "warn" &&
                        "border-amber-500/30 bg-amber-500/5",
                      l.status === "fail" &&
                        "border-destructive/30 bg-destructive/5",
                      l.status === "skipped" &&
                        "border-border/40 bg-muted/10 opacity-80",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{l.label}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {l.status}
                      </Badge>
                      <span className="text-xs tabular-nums text-muted-foreground ml-auto">
                        {l.status === "skipped" ? "—" : `${l.score.toFixed(0)}/100`}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {l.summary}
                    </p>
                    {l.status !== "skipped" && (
                      <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            l.status === "pass" && "bg-emerald-500/80",
                            l.status === "warn" && "bg-amber-500/80",
                            l.status === "fail" && "bg-destructive/80",
                          )}
                          style={{ width: `${Math.min(100, l.score)}%` }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* AI box */}
            {report.ai && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 space-y-2 text-xs">
                <p className="font-semibold">
                  AI forensic review{" "}
                  {report.ai.skipped ? "(skipped)" : report.ai.ran ? "" : ""}
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  {report.ai.summary}
                </p>
                {!!report.ai.strengths?.length && (
                  <div>
                    <p className="font-medium text-[11px] mb-1">Strengths</p>
                    <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                      {report.ai.strengths.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!report.ai.risks?.length && (
                  <div>
                    <p className="font-medium text-[11px] mb-1">Risks</p>
                    <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                      {report.ai.risks.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Findings */}
            <div className="rounded-2xl border border-border/70 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between">
                <p className="text-xs font-semibold">
                  Findings ({report.findings.length})
                </p>
              </div>
              {report.findings.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                  No forensic findings raised.
                </p>
              ) : (
                <ScrollArea className="h-[min(40vh,360px)]">
                  <ul className="divide-y divide-border/50">
                    {report.findings.map((f) => (
                      <li key={f.id} className="px-4 py-3 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              f.severity === "critical" || f.severity === "material"
                                ? "destructive"
                                : "secondary"
                            }
                            className="text-[10px] capitalize"
                          >
                            {f.severity}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {f.layer}
                          </Badge>
                          <span className="text-sm font-medium">{f.title}</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {f.detail}
                        </p>
                        {f.evidence && (
                          <p className="text-[11px] font-mono text-muted-foreground truncate">
                            {f.evidence}
                          </p>
                        )}
                        {f.transactionId && (
                          <button
                            type="button"
                            className="text-[11px] text-primary hover:underline"
                            onClick={() => onSelectRow?.(f.transactionId!)}
                          >
                            View row
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => downloadForensicsMarkdown(report)}
              >
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                Export MD report
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => downloadForensicsJson(report)}
              >
                <FileJson className="mr-1.5 h-3.5 w-3.5" />
                Export JSON
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => {
                  const blob = new Blob([report.markdown], {
                    type: "text/markdown",
                  });
                  const url = URL.createObjectURL(blob);
                  window.open(url, "_blank");
                }}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Open report
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
