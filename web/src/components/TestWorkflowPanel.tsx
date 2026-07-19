/**
 * Test Lab checklist — guides generate → validate → replace → fidelity workflow.
 */
import {
  CheckCircle2,
  Circle,
  FlaskConical,
  Loader2,
  AlertTriangle,
  ArrowRight,
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
}

export function TestWorkflowPanel({
  stages,
  onJump,
  onRunStress,
  stressRunning,
  stressSummary,
  className,
}: TestWorkflowPanelProps) {
  const passed = stages.filter((s) => s.status === "pass").length;
  const failed = stages.filter((s) => s.status === "fail").length;

  return (
    <div
      className={cn(
        "rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/10 to-card/80 shadow-sm overflow-hidden",
        className,
      )}
    >
      <div className="border-b border-border/60 px-4 py-3 flex items-start gap-2">
        <FlaskConical className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold tracking-tight">Test Lab</p>
            <Badge
              variant={failed ? "destructive" : passed === stages.length ? "default" : "secondary"}
              className="text-[10px]"
            >
              {passed}/{stages.length} pass
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Generate → validate → apply → bank-desc replace → math → visual →
            forensics → export
          </p>
        </div>
      </div>

      <ol className="p-3 space-y-1.5">
        {stages.map((stage, i) => (
          <li key={stage.id}>
            <button
              type="button"
              disabled={!onJump}
              onClick={() => onJump?.(stage.id, stage.step)}
              className={cn(
                "w-full flex items-start gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors",
                stage.status === "active" &&
                  "border-primary/40 bg-primary/10",
                stage.status === "pass" &&
                  "border-emerald-500/30 bg-emerald-500/5",
                stage.status === "fail" &&
                  "border-destructive/40 bg-destructive/5",
                stage.status === "warn" &&
                  "border-amber-500/40 bg-amber-500/5",
                stage.status === "idle" &&
                  "border-transparent bg-muted/20 hover:bg-muted/40",
                onJump && "cursor-pointer",
              )}
            >
              <StageIcon status={stage.status} index={i + 1} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold leading-none">
                  {stage.label}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                  {stage.detail}
                </p>
              </div>
              {onJump && (
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 mt-1 opacity-50" />
              )}
            </button>
          </li>
        ))}
      </ol>

      <div className="border-t border-border/60 px-3 py-3 space-y-2">
        {onRunStress && (
          <Button
            size="sm"
            variant="outline"
            className="w-full rounded-full text-xs"
            disabled={stressRunning}
            onClick={onRunStress}
          >
            {stressRunning ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
            )}
            {stressRunning ? "Running stress suite…" : "Run stress suite (50 seeds)"}
          </Button>
        )}
        {stressSummary && (
          <p className="text-[10px] text-muted-foreground leading-relaxed px-0.5">
            {stressSummary}
          </p>
        )}
      </div>
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
      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
    );
  }
  if (status === "fail") {
    return (
      <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
    );
  }
  if (status === "warn") {
    return (
      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
    );
  }
  if (status === "active") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground shrink-0 mt-0.5">
        {index}
      </span>
    );
  }
  return <Circle className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-0.5" />;
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
          ? input.applied
            ? "idle"
            : "idle"
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
