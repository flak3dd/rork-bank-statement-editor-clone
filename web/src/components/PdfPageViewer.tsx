import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cloneUint8Array } from "@/lib/bytes";
import {
  loadPdfWithFallbacks,
  type EngineId,
  type PdfEngineDocument,
  type TextRun,
} from "@/lib/pdf-engines";

interface PdfPageViewerProps {
  fileData: Uint8Array;
  pageNumber: number;
  scale?: number;
  replacements: Record<string, string>;
  onEdit: (run: TextRun, replacement: string) => void;
  selectedTransactionId?: string | null;
  onEngineChange?: (engine: EngineId) => void;
}

export function PdfPageViewer({
  fileData,
  pageNumber,
  scale = 1.4,
  replacements,
  onEdit,
  selectedTransactionId,
  onEngineChange,
}: PdfPageViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PdfEngineDocument | null>(null);
  const [runs, setRuns] = useState<TextRun[]>([]);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Clone so engine transfer cannot detach parent React state
    loadPdfWithFallbacks(cloneUint8Array(fileData)).then(
      ({ document, engineUsed }) => {
        if (cancelled) {
          document.destroy();
          return;
        }
        docRef.current = document;
        onEngineChange?.(engineUsed);
      },
    );
    return () => {
      cancelled = true;
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [fileData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !docRef.current) return;
    let cancelled = false;
    setLoading(true);

    docRef.current.renderPage(pageNumber, scale).then((page) => {
      if (cancelled) return;
      // Use ImageData integer dims — float page.width caused IndexSizeError
      const w = Math.max(1, Math.floor(page.imageData.width || page.width || 1));
      const h = Math.max(
        1,
        Math.floor(page.imageData.height || page.height || 1),
      );
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        try {
          ctx.putImageData(page.imageData, 0, 0);
        } catch {
          const copy = ctx.createImageData(w, h);
          const n = Math.min(copy.data.length, page.imageData.data.length);
          copy.data.set(page.imageData.data.subarray(0, n));
          ctx.putImageData(copy, 0, 0);
        }
      }
      setRuns(page.runs);
      setDims({ width: w, height: h });
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [pageNumber, scale]);

  useEffect(() => {
    if (!active) return;
    const run = runs.find((r) => r.id === active);
    setDraft(run ? (replacements[run.id] ?? run.text) : "");
  }, [active, runs, replacements]);

  const commit = (run: TextRun, value: string) => {
    if (value !== run.text) onEdit(run, value);
    setActive(null);
  };

  if (loading || !dims) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card/80 p-8 text-center text-sm text-muted-foreground">
        Rendering page {pageNumber}…
      </div>
    );
  }

  const activeRun = runs.find((r) => r.id === active);

  return (
    <div
      className="relative overflow-auto rounded-2xl border border-border/70 bg-white shadow-sm"
      style={{ maxWidth: "100%" }}
    >
      <canvas ref={canvasRef} className="block" />
      <div
        className="absolute inset-0"
        style={{ width: dims.width, height: dims.height }}
        onClick={() => setActive(null)}
      >
        {runs.map((run) => {
          const replacement = replacements[run.id];
          const isReplaced = replacement !== undefined;
          const isActive = active === run.id;

          const style: CSSProperties = {
            position: "absolute",
            left: run.x,
            top: run.y - run.height,
            width: Math.max(run.width, 2),
            height: Math.max(run.height, 2),
            fontSize: run.fontSize,
            fontFamily: run.fontSpec.family,
            fontWeight: run.fontSpec.weight,
            fontStyle: run.fontSpec.style,
            fontStretch: run.fontSpec.stretch,
            lineHeight: 1,
            whiteSpace: "pre",
            transform: `rotate(${run.angle}deg)`,
            transformOrigin: "0 0",
            userSelect: "none",
          };

          return (
            <span
              key={run.id}
              onClick={(e) => {
                e.stopPropagation();
                setActive(run.id);
              }}
              className={cn(
                "block hover:bg-primary/20 cursor-text",
                isReplaced && "bg-white text-black",
                !isReplaced && "text-transparent",
                isActive && "ring-2 ring-primary bg-primary/10",
                selectedTransactionId && "cursor-crosshair",
              )}
              style={style}
            >
              {isReplaced ? replacement : run.text}
            </span>
          );
        })}
      </div>
      {activeRun && (
        <div
          className="absolute z-20 flex gap-1 rounded border border-border bg-card/95 p-1 shadow-lg"
          style={{
            left: activeRun.x,
            top: activeRun.y - activeRun.height - 44,
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(activeRun, draft);
              } else if (e.key === "Escape") {
                setActive(null);
              }
            }}
            onBlur={() => commit(activeRun, draft)}
            autoFocus
            className="h-8 w-48 text-sm"
          />
          <Button
            type="button"
            size="sm"
            onMouseDown={(e) => {
              e.preventDefault();
              commit(activeRun, draft);
            }}
          >
            Set
          </Button>
        </div>
      )}
    </div>
  );
}
