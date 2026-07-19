import type { CompletenessScore } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

interface CompletenessScoreCardProps {
  score: CompletenessScore;
  compact?: boolean;
}

const DIM_LABELS: Record<keyof CompletenessScore["dimensions"], string> = {
  extractionDensity: "Extraction density",
  dateCoverage: "Date coverage",
  amountCoverage: "Amount coverage",
  balanceChain: "Balance chain",
  descriptionQuality: "Descriptions",
  aiConfidence: "AI confidence",
};

function gradeTone(grade: CompletenessScore["grade"]): string {
  switch (grade) {
    case "A":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
    case "B":
      return "bg-primary/15 text-primary border-primary/30";
    case "C":
      return "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/30";
    case "D":
      return "bg-orange-500/15 text-orange-800 dark:text-orange-200 border-orange-500/30";
    default:
      return "bg-destructive/15 text-destructive border-destructive/30";
  }
}

export function CompletenessScoreCard({
  score,
  compact = false,
}: CompletenessScoreCardProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Parse + AI completeness
          </p>
          <p className="text-sm text-muted-foreground leading-snug">{score.summary}</p>
        </div>
        <div
          className={cn(
            "flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl border",
            gradeTone(score.grade),
          )}
        >
          <span className="text-lg font-bold leading-none">{score.grade}</span>
          <span className="text-[10px] font-medium tabular-nums mt-0.5">
            {score.overall.toFixed(0)}
          </span>
        </div>
      </div>

      <Progress value={score.overall} className="h-2" />

      {!compact && (
        <ul className="grid grid-cols-2 gap-2">
          {(Object.keys(score.dimensions) as Array<keyof typeof score.dimensions>).map(
            (key) => (
              <li
                key={key}
                className="rounded-xl border border-border/50 bg-muted/30 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground truncate">
                    {DIM_LABELS[key]}
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums">
                    {score.dimensions[key].toFixed(0)}
                  </span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.min(100, score.dimensions[key])}%` }}
                  />
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
