import { Check, Lock } from "lucide-react";
import { WORKFLOW_STEPS, type WorkflowStep } from "@/lib/types";
import { cn } from "@/lib/utils";

interface WorkflowStepperProps {
  current: WorkflowStep;
  onStepClick?: (step: WorkflowStep) => void;
  /** Steps the user may jump back to (already visited). */
  unlocked?: WorkflowStep[];
  /** Optional per-step gate labels shown under the active step. */
  gateChips?: Partial<Record<WorkflowStep, string>>;
}

const ORDER: WorkflowStep[] = WORKFLOW_STEPS.map((s) => s.id);

export function WorkflowStepper({
  current,
  onStepClick,
  unlocked = [],
  gateChips,
}: WorkflowStepperProps) {
  const currentIdx = ORDER.indexOf(current);
  const progressPct =
    ORDER.length <= 1 ? 0 : Math.round((currentIdx / (ORDER.length - 1)) * 100);

  return (
    <nav aria-label="Editor workflow" className="w-full space-y-2.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Pipeline · step {currentIdx + 1} of {ORDER.length}
        </p>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {progressPct}%
        </p>
      </div>

      <div className="h-1 w-full rounded-full bg-muted/60 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${progressPct}%` }}
          aria-hidden
        />
      </div>

      <ol className="flex flex-wrap gap-1.5 sm:gap-1">
        {WORKFLOW_STEPS.map((step, i) => {
          const done = i < currentIdx;
          const active = step.id === current;
          const isUnlocked = unlocked.includes(step.id) || done || active;
          const canClick = Boolean(onStepClick) && isUnlocked;
          const gate = gateChips?.[step.id];

          return (
            <li key={step.id} className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                disabled={!canClick}
                onClick={() => canClick && onStepClick?.(step.id)}
                title={step.description}
                className={cn(
                  "group flex items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition-colors",
                  active &&
                    "border-primary/45 bg-primary/12 text-foreground shadow-sm shadow-primary/10",
                  done &&
                    !active &&
                    "border-border/70 bg-card/90 text-foreground",
                  !done &&
                    !active &&
                    isUnlocked &&
                    "border-border/50 bg-muted/30 text-muted-foreground",
                  !done &&
                    !active &&
                    !isUnlocked &&
                    "border-transparent bg-muted/20 text-muted-foreground/70",
                  canClick && !active && "hover:bg-muted/70 cursor-pointer",
                  !canClick && "cursor-default opacity-75",
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
                  {done ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : !isUnlocked ? (
                    <Lock className="h-3 w-3 opacity-70" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold leading-none">
                    {step.short}
                  </span>
                  <span className="hidden xl:block text-[10px] text-muted-foreground mt-0.5 max-w-[8.5rem] truncate">
                    {step.label}
                  </span>
                  {active && gate && (
                    <span className="mt-0.5 block text-[10px] font-medium text-primary/90">
                      {gate}
                    </span>
                  )}
                </span>
              </button>
              {i < WORKFLOW_STEPS.length - 1 && (
                <span
                  className={cn(
                    "hidden sm:block h-px w-2.5 shrink-0",
                    i < currentIdx ? "bg-primary/50" : "bg-border/70",
                  )}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
