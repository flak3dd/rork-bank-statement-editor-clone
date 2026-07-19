import { AlertTriangle, CheckCircle2, Diff } from "lucide-react";
import type { BalanceEngineId, BalancePreviewResult } from "@/lib/types";
import { BALANCE_ENGINES } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface BalanceOutPreviewProps {
  preview: BalancePreviewResult;
  engine: BalanceEngineId;
  onEngineChange: (engine: BalanceEngineId) => void;
  onSelectRow?: (transactionId: string) => void;
}

export function BalanceOutPreview({
  preview,
  engine,
  onEngineChange,
  onSelectRow,
}: BalanceOutPreviewProps) {
  const mismatches = preview.rows.filter((r) => r.mismatched);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Diff className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight">
                Balance Out Preview
              </h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
              Per-row stated vs engine-expected balances. Yellow overlays mark
              drifts above $0.05. Dirty (edited) rows are tagged separately.
            </p>
          </div>
          <Select
            value={engine}
            onValueChange={(v) => onEngineChange(v as BalanceEngineId)}
          >
            <SelectTrigger className="w-full sm:w-[220px] h-9 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BALANCE_ENGINES.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat
            label="Mismatches"
            value={String(preview.mismatchCount)}
            tone={preview.mismatchCount === 0 ? "good" : "warn"}
          />
          <Stat label="Edited rows" value={String(preview.dirtyCount)} />
          <Stat
            label="Opening"
            value={formatMoney(preview.openingBalance)}
          />
          <Stat
            label="Closing exp."
            value={formatMoney(preview.closingExpected)}
          />
        </div>

        <div
          className={cn(
            "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm",
            preview.chainHealthy
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
              : "border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100",
          )}
        >
          {preview.chainHealthy ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <p className="text-xs leading-relaxed">
            {preview.chainHealthy
              ? `Chain healthy under ${engine} engine — stated balances align with expected.`
              : `${preview.mismatchCount} row(s) diverge under ${engine}. Review yellow rows in the table, or continue to Confirm & Render to apply engine balances.`}
          </p>
        </div>
      </div>

      {mismatches.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-card/80 shadow-sm overflow-hidden">
          <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2.5">
            <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
              Mismatch detail ({mismatches.length})
            </p>
          </div>
          <ScrollArea className="h-[min(36vh,320px)]">
            <ul className="divide-y divide-border/60">
              {mismatches.map((r) => (
                <li key={r.transactionId}>
                  <button
                    type="button"
                    className="w-full text-left px-4 py-3 hover:bg-amber-500/5 transition-colors row-balance-mismatch"
                    onClick={() => onSelectRow?.(r.transactionId)}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-xs font-medium tabular-nums">
                        #{r.index + 1}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {r.date}
                      </span>
                      {r.isDirty && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] bg-amber-500/15"
                        >
                          edited
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{r.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-3 text-xs tabular-nums">
                      <span>
                        Stated{" "}
                        <strong>{formatMoney(r.statedBalance)}</strong>
                      </span>
                      <span>
                        Expected{" "}
                        <strong>{formatMoney(r.expectedBalance)}</strong>
                      </span>
                      <span className="text-amber-800 dark:text-amber-200">
                        Δ {r.delta != null ? formatMoney(r.delta) : "—"}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2",
        tone === "good" && "border-emerald-500/30 bg-emerald-500/5",
        tone === "warn" && "border-amber-500/40 bg-amber-500/10",
        !tone && "border-border/60 bg-muted/30",
      )}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums mt-0.5 truncate">{value}</p>
    </div>
  );
}
