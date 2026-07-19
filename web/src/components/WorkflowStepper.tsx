import { Check } from "lucide-react";
import { WORKFLOW_STEPS, type WorkflowStep } from "@/lib/types";
import { cn } from "@/lib/utils";

interface WorkflowStepperProps {
  current: WorkflowStep;
  onStepClick?: (step: WorkflowStep) => void;
  /** Steps the user may jump back to (already visited). */
  unlocked?: WorkflowStep[];
}

const ORDER: WorkflowStep[] = WORKFLOW_STEPS.map((s) => s.id);

export function WorkflowStepper({
  current,
  onStepClick,
  unlocked = [],
}: WorkflowStepperProps) {
  const currentIdx = ORDER.indexOf(current);

  return (
    <nav aria-label="Editor workflow" className="w-full">
      <ol className="flex flex-wrap gap-2 sm:gap-1">
        {WORKFLOW_STEPS.map((step, i) => {
          const done = i < currentIdx;
          const active = step.id === current;
          const canClick =
            Boolean(onStepClick) &&
            (unlocked.includes(step.id) || done || active);

          return (
            <li key={step.id} className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                disabled={!canClick}
                onClick={() => canClick && onStepClick?.(step.id)}
                title={step.description}
                className={cn(
                  "group flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-left transition-colors",
                  active && "border-primary/40 bg-primary/10 text-foreground",
                  done && !active && "border-border/70 bg-card/80 text-foreground",
                  !done && !active && "border-transparent bg-muted/40 text-muted-foreground",
                  canClick && !active && "hover:bg-muted/70 cursor-pointer",
                  !canClick && "cursor-default opacity-70",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    active && "bg-primary text-primary-foreground",
                    done && !active && "bg-primary/20 text-primary",
                    !done && !active && "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold leading-none">
                    {step.short}
                  </span>
                  <span className="hidden lg:block text-[10px] text-muted-foreground mt-0.5 max-w-[9rem] truncate">
                    {step.label}
                  </span>
                </span>
              </button>
              {i < WORKFLOW_STEPS.length - 1 && (
                <span className="hidden sm:block h-px w-3 bg-border/80 shrink-0" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
