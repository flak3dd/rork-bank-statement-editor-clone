import { FlaskConical, ScanSearch, Workflow } from "lucide-react";
import type { ApiStatusReport } from "@/lib/api-status";
import { ApiStatusStrip } from "@/components/ApiStatusPanel";
import { cn } from "@/lib/utils";

export type UiMode = "editor" | "testlab";

interface AppHeaderProps {
  subtitle?: string;
  apiStatus?: ApiStatusReport | null;
  /** Editor | Test Lab mode chrome (workspace only). */
  uiMode?: UiMode;
  onUiModeChange?: (mode: UiMode) => void;
  /** Show mode switch (workspace phase). */
  showModeSwitch?: boolean;
  /** PDF engine tag, e.g. "pdfjs" | "mupdf". */
  engineTag?: string | null;
  /** Engine mode: local | remote. */
  engineMode?: "local" | "remote";
}

export function AppHeader({
  subtitle,
  apiStatus,
  uiMode = "editor",
  onUiModeChange,
  showModeSwitch = false,
  engineTag,
  engineMode,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 surface-glass">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30">
            <ScanSearch className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold tracking-tight leading-none">
              Bank Statement Fidelity Editor
            </p>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              {subtitle ??
                "Exact replica · logic generator injection · verify · export"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {showModeSwitch && onUiModeChange && (
            <div className="mode-toggle shrink-0" role="group" aria-label="Workspace mode">
              <button
                type="button"
                className={cn(
                  "mode-toggle-btn",
                  uiMode === "editor" && "mode-toggle-btn-active",
                )}
                onClick={() => onUiModeChange("editor")}
                aria-pressed={uiMode === "editor"}
              >
                <Workflow className="h-3.5 w-3.5" />
                <span className="hidden xs:inline sm:inline">Editor</span>
              </button>
              <button
                type="button"
                className={cn(
                  "mode-toggle-btn",
                  uiMode === "testlab" && "mode-toggle-btn-active",
                )}
                onClick={() => onUiModeChange("testlab")}
                aria-pressed={uiMode === "testlab"}
              >
                <FlaskConical className="h-3.5 w-3.5" />
                <span className="hidden xs:inline sm:inline">Test Lab</span>
              </button>
            </div>
          )}

          <div className="hidden md:flex flex-col items-end gap-0.5 min-w-0">
            <ApiStatusStrip report={apiStatus ?? null} />
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {engineMode && (
                <span className="font-mono uppercase tracking-wide">
                  {engineMode}
                </span>
              )}
              {engineTag && (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-mono">{engineTag}</span>
                </>
              )}
              {!engineTag && !engineMode && (
                <span>Pdfium · SSIM · tile · pHash</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
