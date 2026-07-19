import {
  clampMaxRetries,
  clampVisualDiff,
  loadThresholds,
  saveThresholds,
  suggestedSsimMin,
  type VerificationThresholds,
  VERIFICATION_DPI,
} from "@/lib/verification/thresholds";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";

interface VerificationThresholdsProps {
  value: VerificationThresholds;
  onChange: (next: VerificationThresholds) => void;
}

export function VerificationThresholdsPanel({
  value,
  onChange,
}: VerificationThresholdsProps) {
  const set = (partial: Partial<VerificationThresholds>) => {
    const next = {
      ...value,
      ...partial,
      dpi: VERIFICATION_DPI,
    };
    if (partial.visualDiff != null && partial.ssimMin == null) {
      next.ssimMin = suggestedSsimMin(partial.visualDiff);
    }
    onChange(next);
    saveThresholds(next);
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">
            Verification thresholds
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            300 DPI Pdfium · per-pixel Δ · SSIM · pHash · retries
          </p>
        </div>
        <Badge variant="secondary" className="text-[10px] tabular-nums">
          {VERIFICATION_DPI} DPI
        </Badge>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Visual diff threshold</Label>
          <span className="text-xs font-semibold tabular-nums">
            {value.visualDiff.toFixed(3)}
          </span>
        </div>
        <Slider
          min={0.005}
          max={0.1}
          step={0.001}
          value={[value.visualDiff]}
          onValueChange={([v]) => set({ visualDiff: clampVisualDiff(v) })}
        />
        <p className="text-[10px] text-muted-foreground">
          Range 0.005–0.10 · fail when mean per-pixel Δ ≥ threshold
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ssim-min" className="text-xs">
            SSIM min
          </Label>
          <Input
            id="ssim-min"
            type="number"
            min={0.5}
            max={0.999}
            step={0.001}
            className="h-9"
            value={value.ssimMin}
            onChange={(e) =>
              set({ ssimMin: Number(e.target.value) || value.ssimMin })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phash-max" className="text-xs">
            pHash max Δ
          </Label>
          <Input
            id="phash-max"
            type="number"
            min={0}
            max={64}
            step={1}
            className="h-9"
            value={value.phashMaxDistance}
            onChange={(e) =>
              set({
                phashMaxDistance: Number(e.target.value) || value.phashMaxDistance,
              })
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Max retries</Label>
          <span className="text-xs font-semibold tabular-nums">
            {value.maxRetries}
          </span>
        </div>
        <Slider
          min={1}
          max={10}
          step={1}
          value={[value.maxRetries]}
          onValueChange={([v]) => set({ maxRetries: clampMaxRetries(v) })}
        />
        <p className="text-[10px] text-muted-foreground">
          Range 1–10 · re-render + re-compare on fail
        </p>
      </div>

      <button
        type="button"
        className="text-[11px] text-primary hover:underline"
        onClick={() => {
          const defaults = loadThresholds();
          void defaults;
          const reset = {
            visualDiff: 0.02,
            ssimMin: 0.95,
            phashMaxDistance: 8,
            maxRetries: 3,
            dpi: VERIFICATION_DPI,
          };
          onChange(reset);
          saveThresholds(reset);
        }}
      >
        Reset to defaults
      </button>
    </div>
  );
}
