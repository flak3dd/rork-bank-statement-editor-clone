import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";

interface BalanceOutPreviewProps {
  preview: BalancePreviewResult;
  engine: BalanceEngineId;
  onEngineChange: (engine: BalanceEngineId) => void;
  onSelectRow?: (transactionId: string) => void;
}

type RowFilter = "all" | "mismatch" | "dirty";

/**
 * Balance Out Preview — always reflects the current working ledger
 * (including Additional Tools / generator replacements), not a frozen snapshot.
 */
export function BalanceOutPreview({
  preview,
  engine,
  onEngineChange,
  onSelectRow,
}: BalanceOutPreviewProps) {
  const [filter, setFilter] = useState<RowFilter>("all");

  const visible = useMemo(() => {
    if (filter === "mismatch") return preview.rows.filter((r) => r.mismatched);
    if (filter === "dirty") return preview.rows.filter((r) => r.isDirty);
    return preview.rows;
  }, [preview.rows, filter]);

  const dirtyCount = preview.dirtyCount;
  const mismatchCount = preview.mismatchCount;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Diff className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight">
                Balance Out Preview
              </h3>
              <Badge variant="secondary" className="text-[10px] tabular-nums">
                {preview.rows.length} rows · live
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
              Live working ledger (table + Additional tools replacements). Stated
              vs engine-expected balances. Yellow = drift above $0.05.
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
            value={String(mismatchCount)}
            tone={mismatchCount === 0 ? "good" : "warn"}
          />
          <Stat label="Edited / replaced" value={String(dirtyCount)} />
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
              ? `Chain healthy under ${engine} — stated balances align with expected for the current replacement ledger.`
              : `${mismatchCount} row(s) diverge under ${engine}. Values below are the current working set (after Additional tools). Continue to Confirm & Render to apply engine balances.`}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", `All (${preview.rows.length})`],
              ["mismatch", `Mismatches (${mismatchCount})`],
              ["dirty", `Dirty (${dirtyCount})`],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={filter === id ? "default" : "outline"}
              className="rounded-full h-7 text-[11px]"
              onClick={() => setFilter(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Full live ledger — always shows current replacement descriptions / amounts */}
      <div className="rounded-2xl border border-border/70 bg-card/80 shadow-sm overflow-hidden">
        <div className="border-b border-border/50 bg-muted/30 px-4 py-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold">
            Working ledger · {visible.length} shown
          </p>
          <p className="text-[10px] text-muted-foreground">
            Description / debit / credit update when Additional tools replace
          </p>
        </div>
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No rows match this filter.
          </p>
        ) : (
          <ScrollArea className="h-[min(48vh,420px)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card/95 backdrop-blur border-b border-border/60 z-10">
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium w-8">#</th>
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Description</th>
                  <th className="px-2 py-2 font-medium text-right">Debit</th>
                  <th className="px-2 py-2 font-medium text-right">Credit</th>
                  <th className="px-2 py-2 font-medium text-right">Stated</th>
                  <th className="px-2 py-2 font-medium text-right">Expected</th>
                  <th className="px-2 py-2 font-medium text-right">Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {visible.map((r) => (
                  <tr
                    key={r.transactionId}
                    className={cn(
                      "hover:bg-muted/40 cursor-pointer transition-colors",
                      r.mismatched && "row-balance-mismatch bg-amber-500/5",
                      r.isDirty && !r.mismatched && "bg-primary/5",
                    )}
                    onClick={() => onSelectRow?.(r.transactionId)}
                  >
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">
                      {r.index + 1}
                    </td>
                    <td className="px-2 py-2 tabular-nums whitespace-nowrap">
                      {r.date}
                    </td>
                    <td className="px-2 py-2 max-w-[14rem]">
                      <div className="flex items-start gap-1.5 min-w-0">
                        <span className="truncate font-medium" title={r.description}>
                          {r.description}
                        </span>
                        {r.isDirty && (
                          <Badge
                            variant="secondary"
                            className="text-[9px] h-4 px-1 shrink-0 bg-amber-500/15"
                          >
                            {r.fieldsChanged.join(",") || "edit"}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums money-out">
                      {r.debit != null ? formatMoney(r.debit) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums money-in">
                      {r.credit != null ? formatMoney(r.credit) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatMoney(r.statedBalance)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">
                      {formatMoney(r.expectedBalance)}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2 text-right tabular-nums",
                        r.mismatched &&
                          "text-amber-800 dark:text-amber-200 font-semibold",
                      )}
                    >
                      {r.delta != null ? formatMoney(r.delta) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </div>
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
      <p className="text-sm font-semibold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
