import { useState } from "react";
import {
  Layers3,
  Loader2,
  ScanEye,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
} from "lucide-react";
import type { VisualValidateResult } from "@/lib/types";
import type { VisualVerificationReport } from "@/lib/verification";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

interface VisualValidateProps {
  result: VisualValidateResult;
  pixelReport?: VisualVerificationReport | null;
  pixelRunning?: boolean;
  pixelProgress?: string;
  onRunPixelCheck?: () => void;
  onSelectRow?: (id: string) => void;
  highlightId?: string | null;
  hasPdfBytes?: boolean;
  /** Queued generator / click-to-edit PDF replacements. */
  pdfEditCount?: number;
  /** Whether working ledger differs from frozen original. */
  hasGenerationDelta?: boolean;
  /** Download last materialized regenerated PDF (if any). */
  onDownloadCandidate?: () => void;
  hasCandidatePdf?: boolean;
}

const LAYER_LABEL: Record<string, string> = {
  date: "Date",
  description: "Description",
  debit: "Debit",
  credit: "Credit",
  balance: "Balance",
};

function StatusIcon({
  status,
}: {
  status: "pass" | "warn" | "fail" | "skipped" | "error" | "unresolved";
}) {
  if (status === "pass") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
  }
  if (status === "warn" || status === "unresolved" || status === "skipped") {
    return <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
  }
  return <XCircle className="h-4 w-4 text-destructive" />;
}

export function VisualValidate({
  result,
  pixelReport,
  pixelRunning,
  pixelProgress,
  onRunPixelCheck,
  onSelectRow,
  highlightId,
  hasPdfBytes,
  pdfEditCount = 0,
  hasGenerationDelta = false,
  onDownloadCandidate,
  hasCandidatePdf = false,
}: VisualValidateProps) {
  const [showPreviews, setShowPreviews] = useState(true);
  const changed = result.rows.filter((r) => r.anyChanged);
  const willDiff =
    hasPdfBytes && (pdfEditCount > 0 || hasGenerationDelta);

  return (
    <div className="space-y-4">
      {/* Pixel verification — original PDF vs regenerated candidate */}
      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <ScanEye className="h-5 w-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <h3 className="text-sm font-semibold tracking-tight">
                Pixel verification · original vs regenerated
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong>Baseline:</strong> original uploaded PDF ·{" "}
                <strong>Candidate:</strong> re-rendered PDF with generator /
                bank-desc / table updates applied (cover + text insert, no redactions).{" "}
                Pdfium @ <strong>300 DPI</strong> · per-pixel Δ · SSIM · pHash ·
                tile-max · Applitools optional.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button
              className="rounded-full"
              disabled={pixelRunning || !hasPdfBytes}
              onClick={onRunPixelCheck}
            >
              {pixelRunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ScanEye className="mr-2 h-4 w-4" />
              )}
              {pixelReport
                ? "Re-run original vs regenerated"
                : "Run original vs regenerated @ 300 DPI"}
            </Button>
            {hasCandidatePdf && onDownloadCandidate && (
              <Button
                variant="outline"
                className="rounded-full"
                onClick={onDownloadCandidate}
              >
                Download regenerated PDF
              </Button>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              Baseline
            </p>
            <p className="font-medium mt-0.5">Original PDF (frozen at parse)</p>
          </div>
          <div
            className={cn(
              "rounded-xl border px-3 py-2",
              willDiff
                ? "border-primary/30 bg-primary/10"
                : "border-border/60 bg-muted/20",
            )}
          >
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              Candidate
            </p>
            <p className="font-medium mt-0.5">
              {pdfEditCount > 0
                ? `Regenerated PDF · ${pdfEditCount} queued edit(s)`
                : hasGenerationDelta
                  ? "Regenerated PDF · auto-link generator data"
                  : "Same as original (no edits yet)"}
            </p>
          </div>
        </div>

        {!hasPdfBytes && (
          <p className="text-xs text-amber-800 dark:text-amber-200 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            No PDF bytes in memory — re-upload a statement to enable Pdfium
            rendering.
          </p>
        )}

        {hasPdfBytes && !willDiff && (
          <p className="text-xs text-amber-800 dark:text-amber-200 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            No generator PDF delta yet. Apply generated rows + bank-desc replace
            (or edit table fields linked to PDF runs) so the candidate differs
            from the original. Otherwise this run is an identity check.
          </p>
        )}

        {pixelRunning && (
          <div className="space-y-2">
            <Progress value={66} className="h-2 animate-pulse" />
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {pixelProgress || "Running verification…"}
            </p>
          </div>
        )}

        {pixelReport && (
          <>
            <div
              className={cn(
                "rounded-xl border px-3 py-2.5 flex flex-wrap items-center gap-3",
                pixelReport.pixelStatus === "pass" &&
                  "border-emerald-500/30 bg-emerald-500/10",
                pixelReport.pixelStatus === "warn" &&
                  "border-amber-500/40 bg-amber-500/10",
                (pixelReport.pixelStatus === "fail" ||
                  !pixelReport.rendererOk) &&
                  "border-destructive/40 bg-destructive/10",
                pixelReport.pixelStatus === "skipped" &&
                  "border-border/60 bg-muted/30",
              )}
            >
              <StatusIcon
                status={
                  !pixelReport.rendererOk ? "fail" : pixelReport.pixelStatus
                }
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold capitalize">
                  {pixelReport.rendererOk
                    ? `Pixel ${pixelReport.pixelStatus}`
                    : "Renderer error"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Score {pixelReport.pixelScore}/100 ·{" "}
                  {pixelReport.pages.length} page(s) · {pixelReport.dpi} DPI ·
                  attempt {pixelReport.attempts}/
                  {pixelReport.thresholds.maxRetries} · thr{" "}
                  {pixelReport.thresholds.visualDiff} · {pixelReport.durationMs}
                  ms · mode{" "}
                  <strong>{pixelReport.compareMode ?? "identity"}</strong>
                  {(pixelReport.candidateEditCount ?? 0) > 0
                    ? ` · ${pixelReport.candidateEditCount} candidate edit(s)`
                    : ""}
                </p>
              </div>
              <Badge variant="secondary" className="tabular-nums">
                {pixelReport.pixelScore}
              </Badge>
            </div>

            {pixelReport.notes.length > 0 && (
              <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
                {pixelReport.notes.slice(0, 6).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Metric
                label="Per-pixel Δ"
                value={
                  pixelReport.pages[0]
                    ? pixelReport.pages[0].metrics.perPixel.meanAbsDelta.toFixed(
                        4,
                      )
                    : "—"
                }
                ok={pixelReport.alwaysOn.perPixelDelta}
              />
              <Metric
                label="SSIM"
                value={
                  pixelReport.pages[0]
                    ? pixelReport.pages[0].metrics.ssim.ssim.toFixed(3)
                    : "—"
                }
                ok={pixelReport.alwaysOn.ssim}
              />
              <Metric
                label="pHash Δ"
                value={
                  pixelReport.pages[0]
                    ? String(pixelReport.pages[0].metrics.phash.hammingDistance)
                    : "—"
                }
                ok={pixelReport.alwaysOn.perceptualHash}
              />
              <Metric
                label="Tile-max"
                value={
                  pixelReport.pages[0]
                    ? pixelReport.pages[0].metrics.tileMax.tileMaxDiff.toFixed(3)
                    : "—"
                }
                ok={pixelReport.alwaysOn.tileMaxDiff}
              />
              <Metric
                label="Applitools"
                value={
                  pixelReport.applitools.skipped
                    ? "optional"
                    : pixelReport.applitools.status ?? "ran"
                }
                ok={
                  !pixelReport.applitools.skipped &&
                  pixelReport.applitools.status === "pass"
                }
              />
            </div>

            {/* Applitools detail */}
            <div className="rounded-xl border border-border/60 px-3 py-2.5 text-xs space-y-1">
              <p className="font-semibold">Applitools Eyes (optional)</p>
              <p className="text-muted-foreground leading-relaxed">
                {pixelReport.applitools.message}
              </p>
              {pixelReport.applitools.skipped && (
                <a
                  href="https://applitools.com/users/register/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary font-medium hover:underline"
                >
                  Sign up for Applitools
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {pixelReport.applitools.sessionUrl && (
                <a
                  href={pixelReport.applitools.sessionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary font-medium hover:underline"
                >
                  Open Eyes session
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {/* Per-page metrics */}
            {pixelReport.pages.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Per-page metrics</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowPreviews((v) => !v)}
                  >
                    {showPreviews ? "Hide previews" : "Show previews"}
                  </Button>
                </div>
                <ScrollArea className="h-[min(40vh,360px)]">
                  <ul className="space-y-3 pr-2">
                    {pixelReport.pages.map((p) => (
                      <li
                        key={p.pageNumber}
                        className="rounded-xl border border-border/60 p-3 space-y-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusIcon status={p.metrics.status} />
                          <span className="text-sm font-semibold">
                            Page {p.pageNumber}
                          </span>
                          <Badge variant="outline" className="text-[10px] tabular-nums">
                            {p.metrics.score}/100
                          </Badge>
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            Δ {p.metrics.perPixel.meanAbsDelta.toFixed(4)} · SSIM{" "}
                            {p.metrics.ssim.ssim.toFixed(3)} · pHash{" "}
                            {p.metrics.phash.hammingDistance} · tile{" "}
                            {p.metrics.tileMax.tileMaxDiff.toFixed(3)}
                          </span>
                        </div>
                        {p.metrics.failedGates.length > 0 && (
                          <ul className="text-[10px] text-destructive space-y-0.5">
                            {p.metrics.failedGates.map((g) => (
                              <li key={g}>· {g}</li>
                            ))}
                          </ul>
                        )}
                        {showPreviews &&
                          (p.baselinePreviewUrl || p.candidatePreviewUrl) && (
                            <div className="grid grid-cols-2 gap-2">
                              <Preview
                                label="Baseline (Pdfium)"
                                src={p.baselinePreviewUrl}
                              />
                              <Preview
                                label="Candidate (Pdfium)"
                                src={p.candidatePreviewUrl}
                              />
                            </div>
                          )}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            )}

            {pixelReport.notes.length > 0 && (
              <ul className="text-[11px] text-muted-foreground space-y-1">
                {pixelReport.notes.map((n, i) => (
                  <li key={i}>· {n}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Field-layer comparison (existing) */}
      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Layers3 className="h-5 w-5" />
          </div>
          <div className="space-y-1 min-w-0">
            <h3 className="text-sm font-semibold tracking-tight">
              Field-layer compare
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Multi-layer original parse vs current working set: field, amount
              movement, and balance layers.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Metric label="Changed rows" value={String(result.changedRowCount)} />
          <Metric
            label="Field changes"
            value={String(result.totalFieldChanges)}
          />
          <Metric
            label="Net Δ"
            value={formatMoney(
              result.totals.currentNet - result.totals.originalNet,
            )}
          />
          <Metric label="Rows" value={`${result.structure.currentCount}`} />
        </div>

        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="bg-muted/40 px-3 py-2 border-b border-border/60">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Layer: Totals
            </p>
          </div>
          <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/60">
            <TotalCol
              label="Money in"
              original={result.totals.originalIn}
              current={result.totals.currentIn}
              tone="in"
            />
            <TotalCol
              label="Money out"
              original={result.totals.originalOut}
              current={result.totals.currentOut}
              tone="out"
            />
            <TotalCol
              label="Net"
              original={result.totals.originalNet}
              current={result.totals.currentNet}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card/80 shadow-sm overflow-hidden">
        <div className="border-b border-border/60 px-4 py-2.5 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">Layer: Per-row field diffs</p>
          <Badge variant="secondary" className="text-[10px]">
            {changed.length} changed
          </Badge>
        </div>
        {changed.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground text-center">
            No field-level differences from the original parse.
          </p>
        ) : (
          <ScrollArea className="h-[min(42vh,400px)]">
            <ul className="divide-y divide-border/60">
              {changed.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRow?.(row.id)}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors",
                      highlightId === row.id && "bg-primary/10",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-xs font-semibold tabular-nums">
                        Row {row.index + 1}
                      </span>
                      {row.amountDelta !== 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          mov Δ {formatMoney(row.amountDelta)}
                        </Badge>
                      )}
                      {row.balanceDelta != null && row.balanceDelta !== 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-amber-500/40"
                        >
                          bal Δ {formatMoney(row.balanceDelta)}
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {row.layers
                        .filter((l) => l.changed)
                        .map((layer) => (
                          <div
                            key={layer.field}
                            className="grid grid-cols-[88px_1fr] gap-2 text-xs"
                          >
                            <span className="text-muted-foreground font-medium">
                              {LAYER_LABEL[layer.field] ?? layer.field}
                            </span>
                            <div className="min-w-0 space-y-0.5">
                              <p className="truncate text-muted-foreground line-through decoration-muted-foreground/50">
                                {layer.original}
                              </p>
                              <p className="truncate font-medium cell-dirty rounded px-1 -mx-1">
                                {layer.current}
                              </p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2",
        ok === true && "border-emerald-500/25 bg-emerald-500/5",
        ok === false && "border-border/60 bg-muted/30",
        ok === undefined && "border-border/60 bg-muted/30",
      )}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function TotalCol({
  label,
  original,
  current,
  tone,
}: {
  label: string;
  original: number;
  current: number;
  tone?: "in" | "out";
}) {
  const changed = Math.abs(original - current) > 0.005;
  return (
    <div className="px-3 py-3 space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-sm tabular-nums text-muted-foreground",
          changed && "line-through decoration-muted-foreground/40",
        )}
      >
        {formatMoney(original)}
      </p>
      <p
        className={cn(
          "text-base font-semibold tabular-nums",
          tone === "in" && "money-in",
          tone === "out" && "money-out",
          changed && "cell-dirty rounded px-1 -mx-1 inline-block",
        )}
      >
        {formatMoney(current)}
      </p>
    </div>
  );
}

function Preview({ label, src }: { label: string; src?: string }) {
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden bg-white">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 py-1 bg-muted/40">
        {label}
      </p>
      {src ? (
        <img src={src} alt={label} className="w-full h-auto block" />
      ) : (
        <p className="text-xs text-muted-foreground p-4 text-center">No preview</p>
      )}
    </div>
  );
}
