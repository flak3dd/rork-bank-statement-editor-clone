import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import type { CompletenessFinding } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FindingsPanelProps {
  findings: CompletenessFinding[];
  onSelect?: (transactionId?: string) => void;
}

export function FindingsPanel({ findings, onSelect }: FindingsPanelProps) {
  if (findings.length === 0) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 text-sm text-muted-foreground">
        No completeness issues flagged. Local math checks look clean.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 shadow-sm overflow-hidden">
      <div className="border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-semibold tracking-tight">Completeness report</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Read-only findings — the PDF is never modified.
        </p>
      </div>
      <ScrollArea className="h-[280px]">
        <ul className="divide-y divide-border/60">
          {findings.map((f) => {
            const Icon =
              f.severity === "error"
                ? ShieldAlert
                : f.severity === "warning"
                  ? AlertTriangle
                  : Info;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  className={cn(
                    "w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors",
                    f.transactionId && "cursor-pointer",
                  )}
                  onClick={() => onSelect?.(f.transactionId)}
                >
                  <div className="flex gap-3">
                    <Icon
                      className={cn(
                        "h-4 w-4 mt-0.5 shrink-0",
                        f.severity === "error" && "text-destructive",
                        f.severity === "warning" && "text-amber-500",
                        f.severity === "info" && "text-primary",
                      )}
                    />
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium leading-snug">{f.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {f.detail}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}
