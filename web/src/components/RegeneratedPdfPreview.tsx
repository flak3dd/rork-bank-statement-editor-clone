/**
 * Live preview of the regenerated candidate PDF (materialized with all
 * current ledger + PdfEdit replacements). Parent rebuilds candidate bytes
 * after each workflow step.
 *
 * NEVER shows redaction-only blanks — materialize only applies text inserts.
 */
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileStack,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { cloneUint8Array } from "@/lib/bytes";
import {
  loadPdfWithFallbacks,
  type PdfEngineDocument,
} from "@/lib/pdf-engines";

export interface RegeneratedPdfPreviewProps {
  candidatePdf: Uint8Array | null;
  originalPdf?: Uint8Array | null;
  pageCountHint?: number;
  materializing?: boolean;
  materializeMode?: string | null;
  editCount?: number;
  notes?: string[];
  className?: string;
  onRefresh?: () => void;
  title?: string;
}

/** Safe canvas blit — avoids "IndexSizeError: index or size is negative…" */
function paintImageData(
  canvas: HTMLCanvasElement,
  imageData: ImageData,
): void {
  const w = Math.max(1, Math.floor(imageData.width || 1));
  const h = Math.max(1, Math.floor(imageData.height || 1));
  const expected = w * h * 4;
  if (
    !imageData.data ||
    imageData.data.length < expected ||
    w > 8192 ||
    h > 8192
  ) {
    throw new Error(
      `Invalid page image (${w}×${h}, data=${imageData.data?.length ?? 0})`,
    );
  }
  // Canvas size must be integers matching ImageData exactly
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  // Prefer createImageData + set to avoid putImageData size quirks across browsers
  try {
    if (imageData.width === w && imageData.height === h) {
      ctx.putImageData(imageData, 0, 0);
    } else {
      const copy = new ImageData(
        new Uint8ClampedArray(imageData.data.buffer, imageData.data.byteOffset, expected),
        w,
        h,
      );
      ctx.putImageData(copy, 0, 0);
    }
  } catch {
    const copy = ctx.createImageData(w, h);
    copy.data.set(imageData.data.subarray(0, expected));
    ctx.putImageData(copy, 0, 0);
  }
}

export function RegeneratedPdfPreview({
  candidatePdf,
  originalPdf = null,
  pageCountHint = 1,
  materializing = false,
  materializeMode = null,
  editCount = 0,
  notes = [],
  className,
  onRefresh,
  title = "Regenerated statement preview",
}: RegeneratedPdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PdfEngineDocument | null>(null);
  const [page, setPage] = useState(1);
  const [showOriginal, setShowOriginal] = useState(false);
  const [pageCount, setPageCount] = useState(
    Math.max(1, Math.floor(pageCountHint) || 1),
  );
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docEpoch, setDocEpoch] = useState(0);

  const activeBytes = showOriginal ? originalPdf : candidatePdf;
  const label = showOriginal ? "Original (source)" : "Regenerated (live)";
  const hasCandidate = Boolean(candidatePdf && candidatePdf.byteLength > 100);

  // Load document when bytes or source/regen toggle change
  useEffect(() => {
    let cancelled = false;
    docRef.current?.destroy();
    docRef.current = null;

    if (!activeBytes || activeBytes.byteLength < 50) {
      setPageCount(Math.max(1, Math.floor(pageCountHint) || 1));
      setError(null);
      setLoadingPage(false);
      // clear canvas
      const c = canvasRef.current;
      if (c) {
        c.width = 1;
        c.height = 1;
      }
      return;
    }

    setLoadingPage(true);
    setError(null);
    setPage(1);

    loadPdfWithFallbacks(cloneUint8Array(activeBytes))
      .then(({ document }) => {
        if (cancelled) {
          document.destroy();
          return;
        }
        const n = Math.max(1, Math.floor(document.pageCount) || 1);
        docRef.current = document;
        setPageCount(n);
        setDocEpoch((e) => e + 1);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoadingPage(false);
        }
      });

    return () => {
      cancelled = true;
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [activeBytes, pageCountHint]);

  // Render current page with safe canvas sizing
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) {
      if (!activeBytes) setLoadingPage(false);
      return;
    }
    let cancelled = false;
    setLoadingPage(true);
    setError(null);

    const total = Math.max(1, Math.floor(doc.pageCount) || 1);
    const p = Math.min(Math.max(1, Math.floor(page) || 1), total);
    // Cap scale so huge pages don't explode memory
    const scale = 1.15;

    doc
      .renderPage(p, scale)
      .then((rendered) => {
        if (cancelled) return;
        paintImageData(canvas, rendered.imageData);
        setLoadingPage(false);
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(
            msg.includes("IndexSizeError") || msg.includes("index or size")
              ? "Could not paint this page (invalid image size). Try Refresh or Original."
              : msg,
          );
          setLoadingPage(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [page, docEpoch, activeBytes]);

  const maxPage = Math.max(1, pageCount);

  return (
    <div
      className={cn(
        "rounded-2xl border border-primary/25 bg-card shadow-md overflow-hidden ring-1 ring-primary/10",
        className,
      )}
    >
      <div className="border-b border-border/50 bg-gradient-to-b from-primary/10 to-transparent px-3 py-2.5 flex flex-wrap items-center gap-2">
        <FileStack className="h-4 w-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight">{title}</p>
          <p className="text-[10px] text-muted-foreground">
            Live after every step · text inserts only (never blank redaction)
          </p>
        </div>
        {materializing && (
          <Badge variant="secondary" className="text-[10px] gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Building…
          </Badge>
        )}
        {!materializing && materializeMode && (
          <Badge
            variant={materializeMode === "identity" ? "outline" : "secondary"}
            className="text-[10px] font-mono"
          >
            {materializeMode}
            {editCount > 0 ? ` · ${editCount} edits` : ""}
          </Badge>
        )}
        {onRefresh && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 rounded-full text-[11px]"
            onClick={onRefresh}
            disabled={materializing}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", materializing && "animate-spin")}
            />
            Refresh
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/40">
        <Button
          type="button"
          size="sm"
          variant={!showOriginal ? "default" : "outline"}
          className="h-7 rounded-full text-[11px]"
          onClick={() => setShowOriginal(false)}
          disabled={!hasCandidate && !materializing}
        >
          Regenerated
        </Button>
        {originalPdf && (
          <Button
            type="button"
            size="sm"
            variant={showOriginal ? "default" : "outline"}
            className="h-7 rounded-full text-[11px]"
            onClick={() => setShowOriginal(true)}
          >
            Original
          </Button>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
          {label}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[11px] tabular-nums min-w-[4rem] text-center">
          {Math.min(page, maxPage)} / {maxPage}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          disabled={page >= maxPage}
          onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="relative bg-muted/30 min-h-[220px] flex items-center justify-center p-3 overflow-auto max-h-[min(70vh,640px)]">
        {(materializing || loadingPage) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[1px] pointer-events-none">
            <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-full bg-card border px-3 py-1.5 shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {materializing ? "Applying updates to PDF…" : "Rendering page…"}
            </div>
          </div>
        )}
        {error && (
          <p className="text-xs text-destructive text-center px-4 max-w-md leading-relaxed">
            {error}
          </p>
        )}
        {!error && !activeBytes && !materializing && (
          <p className="text-xs text-muted-foreground text-center max-w-sm leading-relaxed">
            {originalPdf
              ? "No regenerated PDF yet — edit the ledger, run Additional tools, or Confirm & Render. Preview rebuilds automatically."
              : "Upload a statement PDF to enable live regenerated preview."}
          </p>
        )}
        <canvas
          ref={canvasRef}
          className={cn(
            "max-w-full h-auto shadow-md rounded border border-border/50 bg-white",
            (!activeBytes || error) && "hidden",
          )}
        />
      </div>

      {notes.length > 0 && !showOriginal && (
        <div className="border-t border-border/40 px-3 py-2">
          <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">
            {notes[notes.length - 1]}
          </p>
        </div>
      )}
    </div>
  );
}
