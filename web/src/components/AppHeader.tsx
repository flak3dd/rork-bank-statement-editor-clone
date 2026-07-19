import { ScanSearch } from "lucide-react";
import type { ApiStatusReport } from "@/lib/api-status";
import { ApiStatusStrip } from "@/components/ApiStatusPanel";

interface AppHeaderProps {
  subtitle?: string;
  apiStatus?: ApiStatusReport | null;
}

export function AppHeader({ subtitle, apiStatus }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 surface-glass">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30">
            <ScanSearch className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold tracking-tight leading-none">Statement Lens</p>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              {subtitle ?? "Parse · edit · balance · verify · Test Lab"}
            </p>
          </div>
        </div>
        <div className="hidden sm:flex flex-col items-end gap-0.5 min-w-0">
          <ApiStatusStrip report={apiStatus ?? null} />
          <p className="text-[10px] text-muted-foreground">
            Pdfium · SSIM · tile · pHash · Eyes optional
          </p>
        </div>
      </div>
    </header>
  );
}
