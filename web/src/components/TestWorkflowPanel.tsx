/**
 * Test Lab checklist — compact trigger + hover/click expand panel.
 * Minimises layout footprint; full stage list lives in a floating window.
 */
import { useEffect, useId, useRef, useState } from "react";
import {
  CheckCircle2,
  Circle,
  FlaskConical,
  Loader2,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WorkflowStep } from "@/lib/types";

export type TestStageId =
  | "generate"
  | "validate"
  | "apply"
  | "replace"
  | "math"
  | "visual"
  | "forensics"
  | "export";

export interface TestStageStatus {
  id: TestStageId;
  label: string;
  detail: string;
  status: "idle" | "active" | "pass" | "warn" | "fail";
  step?: WorkflowStep;
}

interface TestWorkflowPanelProps {
  stages: TestStageStatus[];
  onJump?: (stage: TestStageId, step?: WorkflowStep) => void;
  onRunStress?: () => void;
  stressRunning?: boolean;
  stressSummary?: string | null;
  className?: string;
  /**
   * compact (default) — chip + hover/click flyout
   * inline — full expanded card (rare; upload landing only)
   */
  variant?: "compact" | "inline";
  /** Prefer hover flyout vs click-only popover. Default hover. */
  expandOn?: "hover" | "click";
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}

export function TestWorkflowPanel({
  stages,
  onJump,
  onRunStress,
  stressRunning,
  stressSummary,
  className,
  variant = "compact",
  expandOn = "hover",
  align = "end",
  side = "bottom",
}: TestWorkflowPanelProps) {
  const passed = stages.filter((s) => s.status === "pass").length;
  const failed = stages.filter((s) => s.status === "fail").length;
  const active = stages.find((s) => s.status === "active");
  const [pinned, setPinned] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!pinned) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  if (variant === "inline") {
    return (
      <div
        className={cn(
          "rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/10 to-card/80 shadow-sm overflow-hidden",
          className,
        )}
      >
        <PanelHeader passed={passed} total={stages.length} failed={failed} />
        <StageList stages={stages} onJump={onJump} dense />
        <PanelFooter
          onRunStress={onRunStress}
          stressRunning={stressRunning}
          stressSummary={stressSummary}
        />
      </div>
    );
  }

  // Compact: chip takes ~1 line; panel expands on hover or pin (click)
  const showPanel = expandOn === "hover" ? undefined /* CSS group-hover */ : pinned;
  void showPanel;
  void align;
  void side;

  return (
    <div
      ref={rootRef}
      className={cn("relative inline-flex z-40", className)}
      onMouseLeave={() => {
        if (expandOn === "hover" && !pinned) {
          /* panel hides via CSS group-hover */
        }
      }}
    >
      <div className="group/lab relative inline-flex">
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 pl-2 pr-2.5 py-1",
            "text-[11px] font-semibold text-foreground shadow-sm transition-colors",
            "hover:bg-primary/15 hover:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pinned && "bg-primary/20 border-primary/50 ring-1 ring-primary/25",
          )}
          aria-expanded={pinned}
          aria-controls={panelId}
          aria-label={`Test Lab ${passed} of ${stages.length} stages. Hover or click to expand.`}
          onClick={() => setPinned((v) => !v)}
        >
          <FlaskConical className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="hidden sm:inline">Lab</span>
          <Badge
            variant={
              failed
                ? "destructive"
                : passed === stages.length
                  ? "default"
                  : "secondary"
            }
            className="h-4 min-w-[1.75rem] justify-center px-1 text-[9px] font-mono"
          >
            {passed}/{stages.length}
          </Badge>
          {active && (
            <span className="hidden lg:inline max-w-[4.5rem] truncate text-[10px] font-normal text-muted-foreground">
              {active.label.replace(/^\d+\.\s*/, "")}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-3 w-3 text-muted-foreground opacity-70 transition-transform",
              pinned && "rotate-180",
            )}
          />
        </button>

        {/* Expanding hover / pin window */}
        <div
          id={panelId}
          role="dialog"
          aria-label="Test Lab stages"
          className={cn(
            "absolute top-full right-0 mt-1.5 z-50",
            "w-[min(19.5rem,calc(100vw-1.5rem))]",
            "rounded-xl border border-primary/25 bg-popover text-popover-foreground shadow-xl",
            "origin-top-right transition-all duration-150",
            // Hover expand
            expandOn === "hover" &&
              !pinned &&
              "invisible opacity-0 scale-95 pointer-events-none",
            expandOn === "hover" &&
              !pinned &&
              "group-hover/lab:visible group-hover/lab:opacity-100 group-hover/lab:scale-100 group-hover/lab:pointer-events-auto",
            expandOn === "hover" &&
              !pinned &&
              "group-focus-within/lab:visible group-focus-within/lab:opacity-100 group-focus-within/lab:scale-100 group-focus-within/lab:pointer-events-auto",
            // Pinned (click)
            pinned && "visible opacity-100 scale-100 pointer-events-auto",
            // Click-only mode when not pinned
            expandOn === "click" &&
              !pinned &&
              "invisible opacity-0 scale-95 pointer-events-none",
          )}
        >
          <div className="max-h-[min(26rem,70vh)] flex flex-col overflow-hidden rounded-xl">
            <PanelHeader
              passed={passed}
              total={stages.length}
              failed={failed}
              compact
            />
            <div className="overflow-y-auto flex-1 min-h-0">
              <StageList
                stages={stages}
                onJump={(id, step) => {
                  onJump?.(id, step);
                  setPinned(false);
                }}
                dense
              />
            </div>
            <PanelFooter
              onRunStress={onRunStress}
              stressRunning={stressRunning}
              stressSummary={stressSummary}
              compact
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PanelHeader({
  passed,
  total,
  failed,
  compact,
}: {
  passed: number;
  total: number;
  failed: number;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-b border-border/60 flex items-start gap-2",
        compact ? "px-3 py-2" : "px-4 py-3",
      )}
    >
      <FlaskConical className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-xs font-semibold tracking-tight">Test Lab</p>
          <Badge
            variant={
              failed
                ? "destructive"
                : passed === total
                  ? "default"
                  : "secondary"
            }
            className="text-[9px] h-4 px-1.5"
          >
            {passed}/{total} pass
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
          Generate → apply → replace → verify → export
        </p>
      </div>
    </div>
  );
}

function StageList({
  stages,
  onJump,
  dense,
}: {
  stages: TestStageStatus[];
  onJump?: (stage: TestStageId, step?: WorkflowStep) => void;
  dense?: boolean;
}) {
  return (
    <ol className={cn(dense ? "p-1.5 space-y-0.5" : "p-3 space-y-1.5")}>
      {stages.map((stage, i) => (
        <li key={stage.id}>
          <button
            type="button"
            disabled={!onJump}
            onClick={() => onJump?.(stage.id, stage.step)}
            className={cn(
              "w-full flex items-start gap-2 rounded-lg border text-left transition-colors",
              dense ? "px-2 py-1.5" : "px-2.5 py-2 gap-2.5 rounded-xl",
              stage.status === "active" && "border-primary/40 bg-primary/10",
              stage.status === "pass" &&
                "border-emerald-500/30 bg-emerald-500/5",
              stage.status === "fail" &&
                "border-destructive/40 bg-destructive/5",
              stage.status === "warn" && "border-amber-500/40 bg-amber-500/5",
              stage.status === "idle" &&
                "border-transparent bg-muted/15 hover:bg-muted/35",
              onJump && "cursor-pointer",
            )}
          >
            <StageIcon status={stage.status} index={i + 1} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold leading-none">
                {stage.label}
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                {stage.detail}
              </p>
            </div>
            {onJump && (
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5 opacity-40" />
            )}
          </button>
        </li>
      ))}
    </ol>
  );
}

function PanelFooter({
  onRunStress,
  stressRunning,
  stressSummary,
  compact,
}: {
  onRunStress?: () => void;
  stressRunning?: boolean;
  stressSummary?: string | null;
  compact?: boolean;
}) {
  if (!onRunStress && !stressSummary) return null;
  return (
    <div
      className={cn(
        "border-t border-border/60 space-y-1.5",
        compact ? "px-2 py-2" : "px-3 py-3 space-y-2",
      )}
    >
      {onRunStress && (
        <Button
          size="sm"
          variant="outline"
          className="w-full rounded-full text-[11px] h-8"
          disabled={stressRunning}
          onClick={onRunStress}
        >
          {stressRunning ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
          )}
          {stressRunning ? "Running…" : "Stress suite (50 seeds)"}
        </Button>
      )}
      {stressSummary && (
        <p className="text-[9px] text-muted-foreground leading-relaxed px-0.5 line-clamp-3">
          {stressSummary}
        </p>
      )}
    </div>
  );
}

function StageIcon({
  status,
  index,
}: {
  status: TestStageStatus["status"];
  index: number;
}) {
  if (status === "pass") {
    return (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
    );
  }
  if (status === "fail") {
    return (
      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
    );
  }
  if (status === "warn") {
    return (
      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
    );
  }
  if (status === "active") {
    return (
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground shrink-0 mt-0.5">
        {index}
      </span>
    );
  }
  return (
    <Circle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />
  );
}

/** Build stage list from live app state for Index. */
export function buildTestStages(input: {
  workflowStep: WorkflowStep;
  hasGenerated: boolean;
  qualityOk: boolean | null;
  qualityScore: number | null;
  applied: boolean;
  pdfEdits: number;
  hasPdf: boolean;
  mathOk: boolean | null;
  visualOk: boolean | null;
  forensicsOk: boolean | null;
  exported: boolean;
}): TestStageStatus[] {
  const active = (id: TestStageId, step?: WorkflowStep) =>
    input.workflowStep === step ||
    (id === "generate" && input.workflowStep === "generate");

  return [
    {
      id: "generate",
      label: "1. Configure & generate",
      detail: input.hasGenerated
        ? "Ledger generated from cfg"
        : "Set period, salary, bills, identity…",
      status: input.hasGenerated
        ? "pass"
        : active("generate", "generate")
          ? "active"
          : "idle",
      step: "generate",
    },
    {
      id: "validate",
      label: "2. Perfect validation",
      detail:
        input.qualityOk == null
          ? "Run quality checks on ledger"
          : input.qualityOk
            ? `Pass · score ${input.qualityScore ?? "—"}/100`
            : `Fail · score ${input.qualityScore ?? "—"}/100`,
      status:
        input.qualityOk == null
          ? input.hasGenerated
            ? "active"
            : "idle"
          : input.qualityOk
            ? "pass"
            : "fail",
      step: "generate",
    },
    {
      id: "apply",
      label: "3. Apply to workspace",
      detail: input.applied
        ? "Transactions in working table"
        : "Push generated rows into editor",
      status: input.applied ? "pass" : input.hasGenerated ? "active" : "idle",
      step: "generate",
    },
    {
      id: "replace",
      label: "4. Bank-desc replace + PDF",
      detail: input.hasPdf
        ? input.pdfEdits > 0
          ? `${input.pdfEdits} PdfEdit(s) queued`
          : "Optional: ANZ/CBA generators + run-match"
        : "Optional · needs PDF for geometry link",
      status:
        input.pdfEdits > 0
          ? "pass"
          : input.applied && input.hasPdf
            ? "active"
            : "idle",
      step: "edit",
    },
    {
      id: "math",
      label: "5. Final math check",
      detail:
        input.mathOk == null
          ? "Re-parse balance integrity"
          : input.mathOk
            ? "Math pass"
            : "Math issues",
      status:
        input.mathOk == null
          ? "idle"
          : input.mathOk
            ? "pass"
            : "fail",
      step: "math",
    },
    {
      id: "visual",
      label: "6. Visual / pixel verify",
      detail:
        input.visualOk == null
          ? "SSIM · tile-max · pHash @ 300 DPI"
          : input.visualOk
            ? "Visual thresholds met"
            : "Visual below threshold",
      status:
        input.visualOk == null
          ? "idle"
          : input.visualOk
            ? "pass"
            : "fail",
      step: "visual",
    },
    {
      id: "forensics",
      label: "7. Fidelity forensics",
      detail:
        input.forensicsOk == null
          ? "AI + layers vs source baseline"
          : input.forensicsOk
            ? "Forensics pass"
            : "Forensics warn/fail",
      status:
        input.forensicsOk == null
          ? "idle"
          : input.forensicsOk
            ? "pass"
            : "warn",
      step: "fidelity",
    },
    {
      id: "export",
      label: "8. Export artefacts",
      detail: input.exported
        ? "Export completed"
        : "CSV / JSON / edited PDF",
      status: input.exported ? "pass" : "idle",
      step: "complete",
    },
  ];
}
