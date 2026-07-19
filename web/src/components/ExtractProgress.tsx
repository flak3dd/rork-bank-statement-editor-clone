import { Check, Circle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExtractStep } from "@/lib/types";
import { Progress } from "@/components/ui/progress";

interface ExtractProgressProps {
  fileName: string;
  steps: ExtractStep[];
  progress: number;
  error?: string | null;
}

export function ExtractProgress({ fileName, steps, progress, error }: ExtractProgressProps) {
  return (
    <div className="mx-auto w-full max-w-lg rounded-2xl border border-border/80 surface-glass p-6 sm:p-8 shadow-sm">
      <div className="mb-6 space-y-1">
        <p className="text-xs uppercase tracking-[0.16em] text-primary font-semibold">Extracting</p>
        <h2 className="text-xl font-semibold tracking-tight truncate" title={fileName}>
          {fileName}
        </h2>
        <p className="text-sm text-muted-foreground">
          Reading the PDF, structuring rows, then running an AI review.
        </p>
      </div>

      <Progress value={Math.round(progress * 100)} className="h-2 mb-6" />

      <ol className="space-y-3">
        {steps.map((step) => {
          const Icon =
            step.status === "done"
              ? Check
              : step.status === "active"
                ? Loader2
                : step.status === "error"
                  ? X
                  : Circle;
          return (
            <li
              key={step.id}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 border",
                step.status === "active" && "border-primary/30 bg-primary/5",
                step.status === "done" && "border-border/60 bg-card/50",
                step.status === "pending" && "border-transparent opacity-60",
                step.status === "skipped" && "border-transparent opacity-50",
                step.status === "error" && "border-destructive/40 bg-destructive/5",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full",
                  step.status === "done" && "bg-primary/15 text-primary",
                  step.status === "active" && "bg-primary text-primary-foreground",
                  step.status === "error" && "bg-destructive/15 text-destructive",
                  (step.status === "pending" || step.status === "skipped") &&
                    "bg-muted text-muted-foreground",
                )}
              >
                <Icon
                  className={cn("h-4 w-4", step.status === "active" && "animate-spin")}
                />
              </span>
              <span className="text-sm font-medium">{step.label}</span>
              {step.status === "skipped" && (
                <span className="ml-auto text-xs text-muted-foreground">skipped</span>
              )}
            </li>
          );
        })}
      </ol>

      {error && (
        <p className="mt-5 text-sm text-destructive font-medium" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
