import { ArrowDownLeft, ArrowUpRight, Hash, Scale, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { StatementSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SummaryCardsProps {
  summary: StatementSummary;
  limited?: boolean;
  /**
   * compact (default for workspace): single quiet strip — not the visual hero.
   * full: original large cards (rare).
   */
  variant?: "compact" | "full";
}

function CompactStat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "in" | "out" | "neutral";
  hint?: string;
}) {
  return (
    <div className="min-w-0 px-2 py-1 first:pl-0 last:pr-0">
      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground leading-none">
        {label}
      </p>
      <p
        className={cn(
          "text-[12px] sm:text-[13px] font-semibold tabular-nums tracking-tight leading-tight mt-0.5 truncate",
          tone === "in" && "money-in",
          tone === "out" && "money-out",
        )}
        title={hint ? `${value} · ${hint}` : value}
      >
        {value}
      </p>
      {hint && (
        <p className="text-[9px] text-muted-foreground truncate mt-0.5 leading-none">
          {hint}
        </p>
      )}
    </div>
  );
}

function FullCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "in" | "out" | "neutral";
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              "text-lg sm:text-xl font-semibold tabular-nums tracking-tight truncate",
              tone === "in" && "money-in",
              tone === "out" && "money-out",
            )}
          >
            {value}
          </p>
          {hint && (
            <p className="text-xs text-muted-foreground truncate">{hint}</p>
          )}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/80 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export function SummaryCards({
  summary,
  limited,
  variant = "compact",
}: SummaryCardsProps) {
  const period =
    summary.periodStart && summary.periodEnd
      ? `${summary.periodStart} → ${summary.periodEnd}`
      : summary.periodStart || summary.periodEnd || undefined;

  if (variant === "full") {
    return (
      <div className="space-y-3">
        {limited && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
            Limited extraction — this PDF may be scanned or lightly texted.
            Review carefully.
          </div>
        )}
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
          <FullCard
            label="Money in"
            value={formatMoney(summary.totalIn)}
            icon={ArrowDownLeft}
            tone="in"
          />
          <FullCard
            label="Money out"
            value={formatMoney(summary.totalOut)}
            icon={ArrowUpRight}
            tone="out"
          />
          <FullCard
            label="Net"
            value={formatMoney(summary.net)}
            icon={Scale}
            tone={summary.net >= 0 ? "in" : "out"}
          />
          <FullCard
            label="Transactions"
            value={String(summary.transactionCount)}
            hint={period}
            icon={Hash}
          />
          <FullCard
            label="Opening bal."
            value={formatMoney(summary.openingBalance)}
            icon={Wallet}
          />
          <FullCard
            label="Closing bal."
            value={formatMoney(summary.closingBalance)}
            icon={Wallet}
          />
        </div>
      </div>
    );
  }

  // Compact strip — secondary meta, not the page hero
  return (
    <div className="space-y-1.5">
      {limited && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-900 dark:text-amber-100">
          Limited extraction — review carefully.
        </div>
      )}
      <div
        className="flex flex-wrap items-stretch gap-0 divide-x divide-border/60 rounded-lg border border-border/50 bg-muted/25 px-2 py-1"
        role="group"
        aria-label="Statement summary (compact)"
      >
        <CompactStat
          label="Money in"
          value={formatMoney(summary.totalIn)}
          tone="in"
        />
        <CompactStat
          label="Money out"
          value={formatMoney(summary.totalOut)}
          tone="out"
        />
        <CompactStat
          label="Net"
          value={formatMoney(summary.net)}
          tone={summary.net >= 0 ? "in" : "out"}
        />
        <CompactStat
          label="Txns"
          value={String(summary.transactionCount)}
          hint={period}
        />
        <CompactStat
          label="Open"
          value={formatMoney(summary.openingBalance)}
        />
        <CompactStat
          label="Close"
          value={formatMoney(summary.closingBalance)}
        />
      </div>
    </div>
  );
}
