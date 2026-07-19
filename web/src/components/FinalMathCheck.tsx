import {
  Calculator,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
} from "lucide-react";
import type { MathCheckResult, MathCheckStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface FinalMathCheckProps {
  result: MathCheckResult | null;
  onRun: () => void;
  onSelectRow?: (id: string) => void;
  running?: boolean;
}

function StatusIcon({ status }: { status: MathCheckStatus }) {
  if (status === "pass") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
  }
  if (status === "warn") {
    return <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
  }
  return <XCircle className="h-4 w-4 text-destructive" />;
}

function statusBanner(status: MathCheckStatus): string {
  switch (status) {
    case "pass":
      return "border-emerald-500/30 bg-emerald-500/10";
    case "warn":
      return "border-amber-500/40 bg-amber-500/10";
    case "fail":
      return "border-destructive/40 bg-destructive/10";
  }
}

export function FinalMathCheck({
  result,
  onRun,
  onSelectRow,
  running,
}: FinalMathCheckProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-4 sm:p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Calculator className="h-5 w-5" />
          </div>
          <div className="space-y-1 min-w-0">
            <h3 className="text-sm font-semibold tracking-tight">
              Final Math Check
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Re-derive totals, verify the running balance chain, and re-parse
              raw text for integrity drift against the working set.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          className="rounded-full shrink-0"
          onClick={onRun}
          disabled={running}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", running && "animate-spin")} />
          {result ? "Re-run check" : "Run math check"}
        </Button>
      </div>

      {!result && (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border/80 px-4 py-6 text-center">
          Run the final math check to verify balances and re-parse integrity.
        </p>
      )}

      {result && (
        <>
          <div
            className={cn(
              "rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3",
              statusBanner(result.status),
            )}
          >
            <StatusIcon status={result.status} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold capitalize">{result.status}</p>
              <p className="text-xs text-muted-foreground">
                Score {result.score}/100 · chain{" "}
                {result.balanceChainOk ? "OK" : "issues"} · opening+net{" "}
                {result.openingPlusNetOk == null
                  ? "n/a"
                  : result.openingPlusNetOk
                    ? "OK"
                    : "drift"}
              </p>
            </div>
            <Badge variant="secondary" className="tabular-nums">
              {result.score}
            </Badge>
          </div>

          <Progress value={result.score} className="h-2" />

          <ul className="space-y-2">
            {result.items.map((item) => (
              <li
                key={item.id}
                className={cn(
                  "rounded-xl border px-3 py-2.5 flex gap-3",
                  item.status === "pass" && "border-border/60 bg-muted/20",
                  item.status === "warn" && "border-amber-500/30 bg-amber-500/5",
                  item.status === "fail" && "border-destructive/30 bg-destructive/5",
                )}
              >
                <StatusIcon status={item.status} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{item.title}</p>
                    {item.transactionId && (
                      <button
                        type="button"
                        className="text-[10px] text-primary underline-offset-2 hover:underline"
                        onClick={() => onSelectRow?.(item.transactionId!)}
                      >
                        view row
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <p className="text-[10px] text-muted-foreground">
            Checked {new Date(result.checkedAt).toLocaleString()}
            {result.reparsedCount > 0
              ? ` · re-parse count ${result.reparsedCount}`
              : ""}
          </p>
        </>
      )}
    </div>
  );
}
