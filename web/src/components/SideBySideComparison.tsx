/**
 * Live side-by-side: frozen original (left) vs current/generated (right).
 * Recomputes on every transactions / baseline change.
 */
import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Filter,
  GitCompare,
  Minus,
  Plus,
  Equal,
  Pencil,
} from "lucide-react";
import {
  compareLedgers,
  formatCompareMoney,
  type CompareField,
  type RowPair,
} from "@/lib/compare-ledger";
import { formatMoney } from "@/lib/money";
import type { Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface SideBySideComparisonProps {
  original: Transaction[];
  current: Transaction[];
  /** Optional row highlight (shared id / pair key). */
  highlightId?: string | null;
  onSelectRow?: (id: string | null) => void;
  className?: string;
  /** Label under "Current" column header. */
  currentLabel?: string;
  originalLabel?: string;
}

type FilterMode = "all" | "changed" | "added" | "removed" | "unchanged";

function cell(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return formatMoney(v);
  return String(v);
}

function StatusBadge({ status }: { status: RowPair["status"] }) {
  const map = {
    unchanged: {
      label: "Same",
      className: "border-border/60 text-muted-foreground",
      icon: Equal,
    },
    changed: {
      label: "Changed",
      className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
      icon: Pencil,
    },
    added: {
      label: "Added",
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
      icon: Plus,
    },
    removed: {
      label: "Removed",
      className: "border-destructive/40 bg-destructive/10 text-destructive",
      icon: Minus,
    },
  } as const;
  const m = map[status];
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={cn("text-[9px] gap-0.5 font-normal", m.className)}>
      <Icon className="h-2.5 w-2.5" />
      {m.label}
    </Badge>
  );
}

function MoneyDelta({ n }: { n: number | null | undefined }) {
  if (n == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "tabular-nums font-medium",
        n > 0 && "money-in",
        n < 0 && "money-out",
        n === 0 && "text-muted-foreground",
      )}
    >
      {formatCompareMoney(n)}
    </span>
  );
}

function SideCell({
  value,
  changed,
  side,
}: {
  value: string | number | null;
  changed: boolean;
  side: "original" | "current";
}) {
  return (
    <td
      className={cn(
        "px-2 py-1.5 text-xs align-top max-w-[10rem]",
        changed && side === "original" && "bg-rose-500/10 text-rose-900 dark:text-rose-100",
        changed && side === "current" && "bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
      )}
    >
      <span className={cn("break-words", side === "original" && changed && "line-through opacity-80")}>
        {cell(value)}
      </span>
    </td>
  );
}

export function SideBySideComparison({
  original,
  current,
  highlightId,
  onSelectRow,
  className,
  currentLabel = "Current / generated",
  originalLabel = "Original (frozen)",
}: SideBySideComparisonProps) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [focusField, setFocusField] = useState<CompareField | "all">("all");

  const report = useMemo(
    () => compareLedgers(original, current),
    [original, current],
  );

  const visible = useMemo(() => {
    let list = report.pairs;
    if (filter !== "all") {
      list = list.filter((p) => p.status === filter);
    }
    if (focusField !== "all") {
      list = list.filter((p) =>
        p.diffs.some((d) => d.field === focusField && d.changed),
      );
    }
    return list;
  }, [report.pairs, filter, focusField]);

  const hasBaseline = original.length > 0;

  if (!hasBaseline) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-dashed border-border/70 bg-muted/20 p-6 text-center",
          className,
        )}
      >
        <GitCompare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm font-medium">No original baseline yet</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-relaxed">
          Upload and parse a statement (or start Test Lab) to freeze the original
          ledger. The right column updates live as you edit, generate, or
          bank-replace.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-card/80 shadow-sm overflow-hidden",
        className,
      )}
    >
      {/* Header — primary workspace surface */}
      <div className="border-b border-border/60 px-4 py-3.5 space-y-3 bg-gradient-to-b from-primary/8 to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/25">
              <ArrowLeftRight className="h-4 w-4" />
            </div>
            <div>
              <p className="text-base font-semibold tracking-tight">
                Live side-by-side comparison
              </p>
              <p className="text-[11px] text-muted-foreground">
                Left stays frozen · right updates as you edit, generate, or replace
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="text-[10px]">
              {report.stats.changed} changed
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {report.stats.added} added
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {report.stats.removed} removed
            </Badge>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {report.stats.unchanged} same
            </Badge>
          </div>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <SummaryChip
            label="Credits Δ"
            value={<MoneyDelta n={report.summaryDeltas.totalIn} />}
          />
          <SummaryChip
            label="Debits Δ"
            value={<MoneyDelta n={report.summaryDeltas.totalOut} />}
          />
          <SummaryChip
            label="Net Δ"
            value={<MoneyDelta n={report.summaryDeltas.net} />}
          />
          <SummaryChip
            label="Closing Δ"
            value={<MoneyDelta n={report.summaryDeltas.closingBalance} />}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={filter} onValueChange={(v) => setFilter(v as FilterMode)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Filter rows" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rows</SelectItem>
              <SelectItem value="changed">Changed only</SelectItem>
              <SelectItem value="added">Added only</SelectItem>
              <SelectItem value="removed">Removed only</SelectItem>
              <SelectItem value="unchanged">Unchanged only</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={focusField}
            onValueChange={(v) => setFocusField(v as CompareField | "all")}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue placeholder="Field focus" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any field</SelectItem>
              <SelectItem value="description">Description</SelectItem>
              <SelectItem value="date">Date</SelectItem>
              <SelectItem value="debit">Debit</SelectItem>
              <SelectItem value="credit">Credit</SelectItem>
              <SelectItem value="balance">Balance</SelectItem>
              <SelectItem value="category">Category</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
            showing {visible.length} / {report.pairs.length} pairs · orig{" "}
            {report.stats.totalOriginal} · cur {report.stats.totalCurrent}
          </span>
        </div>
      </div>

      {/* Dual table */}
      <ScrollArea className="h-[min(62vh,640px)]">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b border-border/60">
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 w-8">#</th>
              <th className="px-2 py-2 w-20">Status</th>
              <th
                className="px-2 py-2 border-l border-border/50 bg-muted/30"
                colSpan={3}
              >
                {originalLabel}
              </th>
              <th
                className="px-2 py-2 border-l border-primary/20 bg-primary/5"
                colSpan={3}
              >
                {currentLabel}
              </th>
            </tr>
            <tr className="text-[10px] text-muted-foreground border-b border-border/40">
              <th />
              <th />
              <th className="px-2 py-1 border-l border-border/50 bg-muted/20">Date</th>
              <th className="px-2 py-1 bg-muted/20">Description</th>
              <th className="px-2 py-1 bg-muted/20 text-right">Amount / bal</th>
              <th className="px-2 py-1 border-l border-primary/20 bg-primary/5">Date</th>
              <th className="px-2 py-1 bg-primary/5">Description</th>
              <th className="px-2 py-1 bg-primary/5 text-right">Amount / bal</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((pair, i) => {
              const id = pair.current?.id ?? pair.original?.id ?? pair.key;
              const active = highlightId === id || highlightId === pair.key;
              const dDate = pair.diffs.find((d) => d.field === "date");
              const dDesc = pair.diffs.find((d) => d.field === "description");
              const dDebit = pair.diffs.find((d) => d.field === "debit");
              const dCredit = pair.diffs.find((d) => d.field === "credit");
              const dBal = pair.diffs.find((d) => d.field === "balance");
              const amountChanged =
                Boolean(dDebit?.changed) ||
                Boolean(dCredit?.changed) ||
                Boolean(dBal?.changed);

              return (
                <tr
                  key={pair.key}
                  className={cn(
                    "border-b border-border/40 hover:bg-muted/20 cursor-pointer",
                    active && "ring-1 ring-inset ring-primary/40 bg-primary/5",
                    pair.status === "changed" && "bg-amber-500/[0.03]",
                    pair.status === "added" && "bg-emerald-500/[0.04]",
                    pair.status === "removed" && "bg-destructive/[0.04]",
                  )}
                  onClick={() => onSelectRow?.(id)}
                >
                  <td className="px-2 py-1.5 text-[10px] text-muted-foreground tabular-nums">
                    {i + 1}
                  </td>
                  <td className="px-2 py-1.5">
                    <StatusBadge status={pair.status} />
                  </td>
                  <SideCell
                    value={pair.original?.date ?? null}
                    changed={Boolean(dDate?.changed)}
                    side="original"
                  />
                  <SideCell
                    value={pair.original?.description ?? null}
                    changed={Boolean(dDesc?.changed)}
                    side="original"
                  />
                  <td
                    className={cn(
                      "px-2 py-1.5 text-xs text-right tabular-nums border-r border-border/30",
                      amountChanged && "bg-rose-500/10",
                    )}
                  >
                    <AmountBal t={pair.original} />
                  </td>
                  <SideCell
                    value={pair.current?.date ?? null}
                    changed={Boolean(dDate?.changed)}
                    side="current"
                  />
                  <SideCell
                    value={pair.current?.description ?? null}
                    changed={Boolean(dDesc?.changed)}
                    side="current"
                  />
                  <td
                    className={cn(
                      "px-2 py-1.5 text-xs text-right tabular-nums",
                      amountChanged && "bg-emerald-500/10",
                    )}
                  >
                    <AmountBal t={pair.current} />
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-xs text-muted-foreground"
                >
                  No rows match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>

      {/* Field change histogram */}
      <div className="border-t border-border/60 px-4 py-2.5 flex flex-wrap gap-2 text-[10px]">
        {(Object.entries(report.stats.fieldChangeCounts) as [CompareField, number][]).map(
          ([field, n]) => (
            <button
              key={field}
              type="button"
              onClick={() =>
                setFocusField((f) => (f === field ? "all" : field))
              }
              className={cn(
                "rounded-full border px-2 py-0.5 transition-colors",
                focusField === field
                  ? "border-primary bg-primary/15"
                  : "border-border/60 hover:bg-muted/40",
                n === 0 && "opacity-50",
              )}
            >
              {field}: {n}
            </button>
          ),
        )}
        {(filter !== "all" || focusField !== "all") && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] ml-auto"
            onClick={() => {
              setFilter("all");
              setFocusField("all");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

function AmountBal({ t }: { t: Transaction | null }) {
  if (!t) return <span className="text-muted-foreground">—</span>;
  const debit = t.debit != null ? formatMoney(t.debit) : null;
  const credit = t.credit != null ? formatMoney(t.credit) : null;
  const bal = t.balance != null ? formatMoney(t.balance) : null;
  return (
    <div className="space-y-0.5">
      {debit != null && (
        <div className="money-out">{debit} dr</div>
      )}
      {credit != null && (
        <div className="money-in">{credit} cr</div>
      )}
      {debit == null && credit == null && (
        <div className="text-muted-foreground">—</div>
      )}
      {bal != null && (
        <div className="text-[10px] text-muted-foreground">bal {bal}</div>
      )}
    </div>
  );
}

function SummaryChip({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-2.5 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="text-sm mt-0.5">{value}</div>
    </div>
  );
}
