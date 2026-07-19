import { useCallback, useRef, useState } from "react";
import { FileText, ShieldCheck, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface UploadDropzoneProps {
  disabled?: boolean;
  onFile: (file: File) => void;
}

export function UploadDropzone({ disabled, onFile }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      setError(null);
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setError("Please upload a PDF bank statement.");
        return;
      }
      if (file.size > 40 * 1024 * 1024) {
        setError("File is too large (max 40 MB).");
        return;
      }
      onFile(file);
    },
    [onFile],
  );

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled) return;
          acceptFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={cn(
          "relative overflow-hidden rounded-2xl border border-dashed p-10 sm:p-14 text-center transition-all cursor-pointer",
          "surface-glass shadow-sm",
          dragging
            ? "border-primary bg-primary/5 scale-[1.01] shadow-lg shadow-primary/10"
            : "border-border/80 hover:border-primary/50 hover:bg-accent/40",
          disabled && "opacity-60 pointer-events-none",
        )}
      >
        <div className="pointer-events-none absolute inset-0 grid-fade opacity-40" />
        <div className="relative flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <UploadCloud className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">
              Drop a statement PDF
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              Extract transactions, review categories, check completeness, and export CSV or JSON.
              Your original PDF is never rewritten.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button type="button" size="lg" className="rounded-full px-6" disabled={disabled}>
              <FileText className="mr-2 h-4 w-4" />
              Choose PDF
            </Button>
          </div>
          {error && (
            <p className="text-sm text-destructive font-medium" role="alert">
              {error}
            </p>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          disabled={disabled}
          onChange={(e) => acceptFile(e.target.files?.[0])}
        />
      </div>

      <div className="mt-5 flex items-start gap-3 rounded-xl border border-border/70 bg-card/70 px-4 py-3 text-left">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Privacy:</span> processing is for analysis
          and export only. Statement Lens does not forge balances or modify the PDF file.
        </p>
      </div>
    </div>
  );
}
