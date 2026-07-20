import { useMemo } from "react";
import { CalendarDays, Filter, Hash, Tag, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Transaction } from "@/lib/types";

/** Date range filter (YYYY-MM-DD). Empty string = open bound. */
export interface DateRangeFilter {
  from: string;
  to: string;
}

/** Amount range filter. null = open bound. Amount = |debit| or |credit|. */
export interface AmountRangeFilter {
  min: number | null;
  max: number | null;
}

export interface FilterBarState {
  dateRange: DateRangeFilter;
  amountRange: AmountRangeFilter;
  /** Comma/space separated category keywords (case-insensitive). */
  categoryKeywords: string;
}

export const EMPTY_FILTERS: FilterBarState = {
  dateRange: { from: "", to: "" },
  amountRange: { min: null, max: null },
  categoryKeywords: "",
};

export function isFiltersEmpty(state: FilterBarState): boolean {
  return (
    !state.dateRange.from &&
    !state.dateRange.to &&
    state.amountRange.min == null &&
    state.amountRange.max == null &&
    !state.categoryKeywords.trim()
  );
}

interface FilterBarProps {
  value: FilterBarState;
  onChange: (next: FilterBarState) => void;
  transactions: Transaction[];
  className?: string;
}

/** Parse a free-text amount into a number, or null when blank/invalid. */
function parseAmountInput(raw: string): number | null {
  const s = raw.trim().replace(/[$£€,]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function FilterBar({
  value,
  onChange,
  transactions,
  className,
}: FilterBarProps) {
  const activeCount = useMemo(() => {
    let n = 0;
    if (value.dateRange.from || value.dateRange.to) n += 1;
    if (value.amountRange.min != null || value.amountRange.max != null) n += 1;
    if (value.categoryKeywords.trim()) n += 1;
    return n;
  }, [value]);

  const hasFilters = activeCount > 0;

  const minAmountStr =
    value.amountRange.min == null ? "" : String(value.amountRange.min);
  const maxAmountStr =
    value.amountRange.max == null ? "" : String(value.amountRange.max);

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-card/80 p-3 sm:p-4 shadow-sm space-y-3",
        className,
      )}
      role="search"
      aria-label="Filter transactions"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Filter className="h-4 w-4 text-primary shrink-0" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Filters
          </h3>
          {hasFilters && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold tabular-nums text-primary-foreground">
              {activeCount}
            </span>
          )}
        </div>
        {hasFilters && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 rounded-full text-[11px] text-muted-foreground"
            onClick={() => onChange(EMPTY_FILTERS)}
            aria-label="Clear all filters"
          >
            <X className="mr-1 h-3 w-3" />
            Clear
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Date range */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            Date range
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={value.dateRange.from}
              max={value.dateRange.to || undefined}
              onChange={(e) =>
                onChange({
                  ...value,
                  dateRange: { ...value.dateRange, from: e.target.value },
                })
              }
              className="h-8 text-xs bg-background"
              aria-label="From date"
            />
            <span className="text-muted-foreground text-xs">→</span>
            <Input
              type="date"
              value={value.dateRange.to}
              min={value.dateRange.from || undefined}
              onChange={(e) =>
                onChange({
                  ...value,
                  dateRange: { ...value.dateRange, to: e.target.value },
                })
              }
              className="h-8 text-xs bg-background"
              aria-label="To date"
            />
          </div>
        </div>

        {/* Amount range */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Hash className="h-3.5 w-3.5" />
            Amount range
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              type="text"
              inputMode="decimal"
              value={minAmountStr}
              placeholder="min"
              onChange={(e) =>
                onChange({
                  ...value,
                  amountRange: {
                    ...value.amountRange,
                    min: parseAmountInput(e.target.value),
                  },
                })
              }
              className="h-8 text-xs bg-background tabular-nums"
              aria-label="Minimum amount"
            />
            <span className="text-muted-foreground text-xs">→</span>
            <Input
              type="text"
              inputMode="decimal"
              value={maxAmountStr}
              placeholder="max"
              onChange={(e) =>
                onChange({
                  ...value,
                  amountRange: {
                    ...value.amountRange,
                    max: parseAmountInput(e.target.value),
                  },
                })
              }
              className="h-8 text-xs bg-background tabular-nums"
              aria-label="Maximum amount"
            />
          </div>
        </div>

        {/* Category keywords */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Tag className="h-3.5 w-3.5" />
            Category keywords
          </label>
          <Input
            type="text"
            value={value.categoryKeywords}
            placeholder="e.g. groceries, dining"
            onChange={(e) =>
              onChange({ ...value, categoryKeywords: e.target.value })
            }
            className="h-8 text-xs bg-background"
            aria-label="Category keywords"
          />
        </div>
      </div>

      {transactions.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Upload a statement to filter its transactions.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Filters apply on top of the search box and category dropdown above.
          Amount matches either debit or credit.
        </p>
      )}
    </div>
  );
}

/** Apply FilterBar state to a transaction list (pure predicate). */
export function applyFilters(
  txns: Transaction[],
  filters: FilterBarState,
): Transaction[] {
  if (isFiltersEmpty(filters)) return txns;

  const keywords = filters.categoryKeywords
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return txns.filter((t) => {
    // Date range — transaction dates are normalized to YYYY-MM-DD.
    const d = t.date?.slice(0, 10) ?? "";
    if (filters.dateRange.from && d < filters.dateRange.from) return false;
    if (filters.dateRange.to && d > filters.dateRange.to) return false;

    // Amount range — absolute value of debit or credit.
    if (filters.amountRange.min != null || filters.amountRange.max != null) {
      const amount = Math.abs(t.debit ?? t.credit ?? 0);
      if (filters.amountRange.min != null && amount < filters.amountRange.min)
        return false;
      if (filters.amountRange.max != null && amount > filters.amountRange.max)
        return false;
    }

    // Category keywords — all must match (substring, case-insensitive).
    if (keywords.length > 0) {
      const cat = (t.category ?? "").toLowerCase();
      if (!keywords.every((k) => cat.includes(k))) return false;
    }

    return true;
  });
}
