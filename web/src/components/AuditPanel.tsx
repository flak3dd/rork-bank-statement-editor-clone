import {
  Download,
  FileJson,
  History,
  ScrollText,
  Save,
} from "lucide-react";
import type { AuditLogEntry, ChangeHistoryEntry, MergedAuditReport } from "@/lib/audit";
import { downloadMergedReport } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface AuditPanelProps {
  auditLog: AuditLogEntry[];
  changeHistory: ChangeHistoryEntry[];
  mergedReport: MergedAuditReport | null;
  onDownloadDraft: () => void;
  onDownloadReport: () => void;
  lastDraftSavedAt?: string | null;
}

export function AuditPanel({
  auditLog,
  changeHistory,
  mergedReport,
  onDownloadDraft,
  onDownloadReport,
  lastDraftSavedAt,
}: AuditPanelProps) {
  const reversedLog = [...auditLog].reverse();
  const reversedChanges = [...changeHistory].reverse();

  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 shadow-sm overflow-hidden">
      <div className="border-b border-border/60 px-4 py-3 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <ScrollText className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight">
              Verification &amp; audit
            </p>
            <p className="text-[11px] text-muted-foreground">
              Append-only log · change history ·{" "}
              <code className="text-[10px]">audit/workflow.json</code>
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="text-[10px] tabular-nums shrink-0">
          {auditLog.length} events
        </Badge>
      </div>

      <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-border/60">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full h-8 text-xs"
          onClick={onDownloadDraft}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          Save workflow.json
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full h-8 text-xs"
          onClick={onDownloadReport}
          disabled={!mergedReport}
        >
          <FileJson className="mr-1.5 h-3.5 w-3.5" />
          Merged report
        </Button>
        {mergedReport && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="rounded-full h-8 text-xs"
            onClick={() => downloadMergedReport(mergedReport)}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download
          </Button>
        )}
      </div>

      {lastDraftSavedAt && (
        <p className="px-4 py-1.5 text-[10px] text-muted-foreground border-b border-border/40">
          Autosaved {new Date(lastDraftSavedAt).toLocaleString()}
        </p>
      )}

      {/* Merged report summary page */}
      {mergedReport && (
        <div className="px-4 py-3 border-b border-border/60 space-y-2 bg-muted/20">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Auto-merged JSON report
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat label="Txns" value={String(mergedReport.summary.transactionCount)} />
            <Stat label="Changes" value={String(mergedReport.summary.changes)} />
            <Stat
              label="Pixel"
              value={
                mergedReport.verification
                  ? `${mergedReport.verification.pixelStatus} ${mergedReport.verification.pixelScore}`
                  : "—"
              }
            />
            <Stat
              label="Math"
              value={
                mergedReport.math
                  ? `${mergedReport.math.status} ${mergedReport.math.score}`
                  : "—"
              }
            />
          </div>
          {mergedReport.verification && (
            <p className="text-[10px] text-muted-foreground tabular-nums">
              {mergedReport.verification.dpi} DPI · attempts{" "}
              {mergedReport.verification.attempts} · thr visualDiff=
              {mergedReport.thresholds.visualDiff}
            </p>
          )}
        </div>
      )}

      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/60">
        <div>
          <div className="px-3 py-2 border-b border-border/50 flex items-center gap-1.5">
            <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[11px] font-semibold">Audit log</p>
          </div>
          <ScrollArea className="h-[220px]">
            {reversedLog.length === 0 ? (
              <p className="px-3 py-6 text-xs text-muted-foreground text-center">
                No events yet
              </p>
            ) : (
              <ul className="divide-y divide-border/40">
                {reversedLog.map((e) => (
                  <li key={e.id} className="px-3 py-2 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-[9px] font-normal px-1.5 py-0"
                      >
                        {e.type}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {new Date(e.ts).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-xs leading-snug">{e.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>

        <div>
          <div className="px-3 py-2 border-b border-border/50 flex items-center gap-1.5">
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[11px] font-semibold">Change history</p>
          </div>
          <ScrollArea className="h-[220px]">
            {reversedChanges.length === 0 ? (
              <p className="px-3 py-6 text-xs text-muted-foreground text-center">
                No field changes yet
              </p>
            ) : (
              <ul className="divide-y divide-border/40">
                {reversedChanges.map((c) => (
                  <li key={c.id} className="px-3 py-2 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="secondary"
                        className="text-[9px] font-normal"
                      >
                        {c.field}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {c.source}
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {new Date(c.ts).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">
                      <span className="line-through">{fmt(c.from)}</span>
                      {" → "}
                      <span className="text-foreground font-medium">
                        {fmt(c.to)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/60 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("text-xs font-semibold tabular-nums truncate")}>{value}</p>
    </div>
  );
}

function fmt(v: string | number | null): string {
  if (v == null) return "—";
  return String(v);
}
