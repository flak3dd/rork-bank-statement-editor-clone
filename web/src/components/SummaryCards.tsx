import { ArrowDownLeft, ArrowUpRight, Hash, Scale, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { StatementSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SummaryCardsProps {
  summary: StatementSummary;
  limited?: boolean;
}

function Card({
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
          {hint && <p className="text-xs text-muted-foreground truncate">{hint}</p>}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/80 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export function SummaryCards({ summary, limited }: SummaryCardsProps) {
  const period =
    summary.periodStart && summary.periodEnd
      ? `${summary.periodStart} → ${summary.periodEnd}`
      : summary.periodStart || summary.periodEnd || undefined;

  return (
    <div className="space-y-3">
      {limited && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          Limited extraction — this PDF may be scanned or lightly texted. Review carefully.
        </div>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
        <Card
          label="Money in"
          value={formatMoney(summary.totalIn)}
          icon={ArrowDownLeft}
          tone="in"
        />
        <Card
          label="Money out"
          value={formatMoney(summary.totalOut)}
          icon={ArrowUpRight}
          tone="out"
        />
        <Card
          label="Net"
          value={formatMoney(summary.net)}
          icon={Scale}
          tone={summary.net >= 0 ? "in" : "out"}
        />
        <Card
          label="Transactions"
          value={String(summary.transactionCount)}
          hint={period}
          icon={Hash}
        />
        <Card
          label="Opening bal."
          value={formatMoney(summary.openingBalance)}
          icon={Wallet}
        />
        <Card
          label="Closing bal."
          value={formatMoney(summary.closingBalance)}
          icon={Wallet}
        />
      </div>
    </div>
  );
}
