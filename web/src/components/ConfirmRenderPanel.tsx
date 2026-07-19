import { useState } from "react";
import { Loader2, ShieldCheck, Workflow } from "lucide-react";
import type { BalanceEngineId, RenderResult } from "@/lib/types";
import { BALANCE_ENGINES } from "@/lib/types";
import { ENGINE_CHAIN } from "@/lib/pdf-engines/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ConfirmRenderPanelProps {
  preferredEngine: BalanceEngineId;
  onPreferredEngineChange: (engine: BalanceEngineId) => void;
  mismatchCount: number;
  dirtyCount: number;
  onConfirm: () => Promise<RenderResult> | RenderResult;
  lastResult?: RenderResult | null;
  disabled?: boolean;
  hasPdfBytes?: boolean;
}

export function ConfirmRenderPanel({
  preferredEngine,
  onPreferredEngineChange,
  mismatchCount,
  dirtyCount,
  onConfirm,
  lastResult,
  disabled,
  hasPdfBytes,
}: ConfirmRenderPanelProps) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  const engineMeta = BALANCE_ENGINES.find((e) => e.id === preferredEngine);

  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-4 sm:p-5 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold tracking-tight">
            Confirm &amp; Render
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Apply working edits and resolve balances with the selected engine.
            Balance fallbacks: hybrid → recompute → stated. PDF page engines
            (when bytes available):{" "}
            {ENGINE_CHAIN.map((e) => e.id).join(" → ")}.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-2">
        <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
          <p className="text-[10px] uppercase text-muted-foreground">Edited</p>
          <p className="text-sm font-semibold tabular-nums">{dirtyCount}</p>
        </div>
        <div
          className={cn(
            "rounded-xl border px-3 py-2",
            mismatchCount > 0
              ? "border-amber-500/40 bg-amber-500/10"
              : "border-border/60 bg-muted/30",
          )}
        >
          <p className="text-[10px] uppercase text-muted-foreground">
            Balance Δ rows
          </p>
          <p className="text-sm font-semibold tabular-nums">{mismatchCount}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
          <p className="text-[10px] uppercase text-muted-foreground">Fallback</p>
          <p className="text-sm font-semibold">auto</p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Preferred balance engine
        </label>
        <Select
          value={preferredEngine}
          onValueChange={(v) => onPreferredEngineChange(v as BalanceEngineId)}
        >
          <SelectTrigger className="h-10 bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BALANCE_ENGINES.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                <span className="font-medium">{e.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {engineMeta && (
          <p className="text-xs text-muted-foreground">{engineMeta.description}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="rounded-full"
          disabled={disabled || busy}
          onClick={() => void handleConfirm()}
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Workflow className="mr-2 h-4 w-4" />
          )}
          Confirm &amp; apply render
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Updates structured data only — original PDF file is not rewritten.
        </p>
      </div>

      {!hasPdfBytes && (
        <p className="text-[11px] text-muted-foreground rounded-lg border border-dashed border-border/70 px-3 py-2">
          No in-memory PDF bytes — balance engines only. Re-upload to enable PDF
          engine probe during render.
        </p>
      )}

      {lastResult && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              balance: {lastResult.engineUsed}
            </Badge>
            {lastResult.fallbackUsed && (
              <Badge
                variant="outline"
                className="text-[10px] border-amber-500/40 text-amber-800 dark:text-amber-200"
              >
                bal fallback
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              {lastResult.rowsUpdated} bal updated
            </Badge>
            {lastResult.pdfEngine && (
              <Badge variant="outline" className="text-[10px]">
                pdf: {lastResult.pdfEngine.engineUsed}
                {lastResult.pdfEngine.fallbackUsed ? " (fallback)" : ""}
              </Badge>
            )}
          </div>
          <p className="text-xs leading-relaxed">{lastResult.summary}</p>
          <p className="text-[10px] text-muted-foreground">
            Balance tried: {lastResult.enginesTried.join(" → ")}
            {lastResult.pdfEngine
              ? ` · PDF tried: ${lastResult.pdfEngine.enginesTried.join(" → ")} (${lastResult.pdfEngine.pageCount}p)`
              : ""}{" "}
            · {new Date(lastResult.appliedAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
