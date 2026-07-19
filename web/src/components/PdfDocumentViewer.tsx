import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdfPageViewer } from "./PdfPageViewer";
import { applyEditToTransaction } from "@/lib/pdf-render";
import type { EngineId, TextRun } from "@/lib/pdf-engines";
import type { PdfEdit, Transaction } from "@/lib/types";

interface PdfDocumentViewerProps {
  fileData: Uint8Array;
  pageCount: number;
  edits: PdfEdit[];
  onEditsChange: (edits: PdfEdit[]) => void;
  transactions: Transaction[];
  onUpdateTransaction: (id: string, field: keyof Transaction, value: string | number | null) => void;
  selectedTransactionId?: string | null;
  onEngineChange?: (engine: EngineId) => void;
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function PdfDocumentViewer({
  fileData,
  pageCount,
  edits,
  onEditsChange,
  transactions,
  onUpdateTransaction,
  selectedTransactionId,
  onEngineChange,
}: PdfDocumentViewerProps) {
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.4);

  const replacements = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of edits) map[e.runId] = e.replacement;
    return map;
  }, [edits]);

  const currentEdits = useMemo(() => edits.filter((e) => e.page === page), [edits, page]);

  const handleEdit = (run: TextRun, replacement: string) => {
    const edit: PdfEdit = {
      id: newId(),
      page: run.page,
      runId: run.id,
      original: run.text,
      replacement,
      bbox: { x: run.x, y: run.y - run.height, width: run.width, height: run.height },
      fontSpec: run.fontSpec,
      linkedTransactionId: selectedTransactionId ?? undefined,
    };
    const next = [...edits.filter((e) => e.runId !== run.id), edit];
    onEditsChange(next);

    const update = applyEditToTransaction(transactions, {
      original: edit.original,
      replacement: edit.replacement,
      linkedTransactionId: edit.linkedTransactionId,
    });
    if (update) onUpdateTransaction(update.id, update.field, update.value);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm tabular-nums">
            Page {page} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Zoom</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setScale((s) => Math.max(0.8, +(s - 0.2).toFixed(2)))}
          >
            −
          </Button>
          <span className="w-10 text-center text-xs tabular-nums">{(scale * 100).toFixed(0)}%</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setScale((s) => Math.min(2.5, +(s + 0.2).toFixed(2)))}
          >
            +
          </Button>
        </div>
      </div>

      <PdfPageViewer
        fileData={fileData}
        pageNumber={page}
        scale={scale}
        replacements={replacements}
        onEdit={handleEdit}
        selectedTransactionId={selectedTransactionId}
        onEngineChange={onEngineChange}
      />

      {currentEdits.length > 0 && (
        <div className="rounded-xl border border-border/70 bg-card/80 p-3">
          <p className="mb-2 text-xs font-medium">Replacements on this page</p>
          <ul className="space-y-1">
            {currentEdits.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="max-w-[200px] truncate font-mono text-muted-foreground">{e.original}</span>
                <span className="text-muted-foreground">→</span>
                <span className="max-w-[200px] truncate font-mono">{e.replacement}</span>
                <button
                  type="button"
                  className="text-destructive hover:underline"
                  onClick={() => onEditsChange(edits.filter((x) => x.id !== e.id))}
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
