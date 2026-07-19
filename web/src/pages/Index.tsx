import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { UploadDropzone } from "@/components/UploadDropzone";
import { ExtractProgress } from "@/components/ExtractProgress";
import { SummaryCards } from "@/components/SummaryCards";
import { FindingsPanel } from "@/components/FindingsPanel";
import { StatementCharts } from "@/components/StatementCharts";
import { TransactionTable } from "@/components/TransactionTable";
import { Toolbar } from "@/components/Toolbar";
import { aiCategorizeTransactions, aiCompletenessCheck, AI_MODEL_ID } from "@/lib/ai";
import { exportCsv, exportJson } from "@/lib/export";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import {
  buildExtractionResult,
  buildSummary,
  parseTransactionsFromText,
} from "@/lib/parse-transactions";
import type {
  AppPhase,
  ExtractStep,
  ExtractionResult,
  SortDir,
  SortKey,
  Transaction,
  TransactionCategory,
} from "@/lib/types";
import { FileText, Layers3, Sparkles } from "lucide-react";

function initialSteps(): ExtractStep[] {
  return [
    { id: "read", label: "Read PDF pages", status: "pending" },
    { id: "parse", label: "Parse statement text", status: "pending" },
    { id: "structure", label: "Structure transactions", status: "pending" },
    { id: "ai", label: "AI categories & completeness", status: "pending" },
    { id: "done", label: "Ready to review", status: "pending" },
  ];
}

function setStep(
  steps: ExtractStep[],
  id: ExtractStep["id"],
  status: ExtractStep["status"],
): ExtractStep[] {
  return steps.map((s) => (s.id === id ? { ...s, status } : s));
}

function compareTxns(a: Transaction, b: Transaction, key: SortKey, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "number" && typeof bv === "number") return (av - bv) * mul;
  return String(av).localeCompare(String(bv), undefined, { numeric: true }) * mul;
}

const Index = () => {
  const [phase, setPhase] = useState<AppPhase>("upload");
  const [steps, setSteps] = useState<ExtractStep[]>(initialSteps);
  const [progress, setProgress] = useState(0);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState("Statement.pdf");
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [includeNotes, setIncludeNotes] = useState(true);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase("upload");
    setSteps(initialSteps());
    setProgress(0);
    setExtractError(null);
    setActiveFileName("Statement.pdf");
    setResult(null);
    setTransactions([]);
    setQuery("");
    setCategoryFilter("all");
    setSortKey("date");
    setSortDir("asc");
    setHighlightId(null);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setPhase("extracting");
    setActiveFileName(file.name);
    setExtractError(null);
    setProgress(0.02);
    let next = initialSteps();
    setSteps(next);

    try {
      next = setStep(next, "read", "active");
      setSteps([...next]);

      const pdf = await extractTextFromPdf(file, (ratio) => {
        setProgress(0.05 + ratio * 0.35);
      });

      next = setStep(next, "read", "done");
      next = setStep(next, "parse", "active");
      setSteps([...next]);
      setProgress(0.45);

      // Yield so UI paints
      await new Promise((r) => setTimeout(r, 40));
      const rawText = pdf.text;

      next = setStep(next, "parse", "done");
      next = setStep(next, "structure", "active");
      setSteps([...next]);
      setProgress(0.58);

      await new Promise((r) => setTimeout(r, 40));
      let txns = parseTransactionsFromText(rawText);
      let extraction = buildExtractionResult({
        fileName: file.name,
        pageCount: pdf.pageCount,
        rawText,
        transactions: txns,
      });

      next = setStep(next, "structure", "done");
      next = setStep(next, "ai", "active");
      setSteps([...next]);
      setProgress(0.7);

      try {
        txns = await aiCategorizeTransactions(txns);
        const findings = await aiCompletenessCheck(txns, extraction.findings);
        extraction = {
          ...extraction,
          transactions: txns,
          findings,
          summary: buildSummary(txns),
        };
        next = setStep(next, "ai", "done");
      } catch {
        next = setStep(next, "ai", "skipped");
        toast.message("AI review unavailable", {
          description: "Showing heuristic categories and local completeness checks.",
        });
      }

      setSteps([...next]);
      setProgress(0.95);
      next = setStep(next, "done", "done");
      setSteps([...next]);
      setProgress(1);

      setResult(extraction);
      setTransactions(extraction.transactions);
      setPhase("workspace");
      toast.success("Statement ready", {
        description: `${extraction.summary.transactionCount} transactions from ${extraction.pageCount} page(s).`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to process PDF";
      setExtractError(message);
      setSteps((prev) => {
        const active = prev.find((s) => s.status === "active");
        if (!active) return prev;
        return setStep(prev, active.id, "error");
      });
      toast.error("Extraction failed", { description: message });
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = transactions;
    if (categoryFilter !== "all") {
      list = list.filter((t) => t.category === categoryFilter);
    }
    if (q) {
      list = list.filter((t) => {
        const hay = [
          t.date,
          t.description,
          t.category,
          t.debit?.toFixed(2) ?? "",
          t.credit?.toFixed(2) ?? "",
          t.balance?.toFixed(2) ?? "",
          t.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return [...list].sort((a, b) => compareTxns(a, b, sortKey, sortDir));
  }, [transactions, query, categoryFilter, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "description" || key === "category" ? "asc" : "desc");
    }
  };

  const onCategoryChange = (id: string, category: TransactionCategory) => {
    setTransactions((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              category,
              categorySource: "manual",
              categoryConfidence: 1,
            }
          : t,
      ),
    );
    if (result) {
      setResult((r) =>
        r
          ? {
              ...r,
              transactions: r.transactions.map((t) =>
                t.id === id
                  ? { ...t, category, categorySource: "manual", categoryConfidence: 1 }
                  : t,
              ),
            }
          : r,
      );
    }
  };

  const liveSummary = useMemo(() => buildSummary(transactions), [transactions]);

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader
        subtitle={
          result
            ? `${result.fileName} · ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`
            : undefined
        }
      />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-8 sm:py-10">
        {phase === "upload" && (
          <div className="space-y-10">
            <div className="text-center space-y-3 max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                AI-assisted · {AI_MODEL_ID}
              </div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                See every line clearly
              </h1>
              <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
                Upload one bank statement PDF. Statement Lens extracts transactions, suggests
                categories, flags completeness issues, and exports clean data — without changing
                the original file.
              </p>
            </div>

            <UploadDropzone onFile={handleFile} />

            <div className="grid sm:grid-cols-3 gap-3 max-w-3xl mx-auto">
              {[
                {
                  icon: FileText,
                  title: "1. Extract",
                  body: "Browser-side PDF text pull into a structured table.",
                },
                {
                  icon: Sparkles,
                  title: "2. Analyze",
                  body: "AI categories + local balance consistency report.",
                },
                {
                  icon: Layers3,
                  title: "3. Export",
                  body: "Download CSV or JSON with your manual overrides.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-border/70 bg-card/70 p-4 text-left shadow-sm"
                >
                  <item.icon className="h-5 w-5 text-primary mb-2" />
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === "extracting" && (
          <div className="flex min-h-[60vh] items-center justify-center">
            <ExtractProgress
              fileName={activeFileName}
              steps={steps}
              progress={progress}
              error={extractError}
            />
            {extractError && (
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg"
                >
                  Try another file
                </button>
              </div>
            )}
          </div>
        )}

        {phase === "workspace" && result && (
          <div className="space-y-5">
            <Toolbar
              query={query}
              onQueryChange={setQuery}
              category={categoryFilter}
              onCategoryChange={setCategoryFilter}
              includeNotes={includeNotes}
              onIncludeNotesChange={setIncludeNotes}
              onExportCsv={() => {
                exportCsv(result, filtered, includeNotes);
                toast.success("CSV downloaded");
              }}
              onExportJson={() => {
                exportJson(
                  { ...result, summary: liveSummary, transactions },
                  filtered,
                  includeNotes,
                );
                toast.success("JSON downloaded");
              }}
              onReset={reset}
              resultCount={filtered.length}
              totalCount={transactions.length}
            />

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4 min-w-0">
                <SummaryCards summary={liveSummary} limited={result.limitedExtraction} />
                <TransactionTable
                  transactions={filtered}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  onCategoryChange={onCategoryChange}
                  highlightId={highlightId}
                />
              </div>
              <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
                <StatementCharts transactions={transactions} />
                <FindingsPanel
                  findings={result.findings}
                  onSelect={(id) => {
                    if (!id) return;
                    setHighlightId(id);
                    setQuery("");
                    setCategoryFilter("all");
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-border/60 py-4 text-center text-xs text-muted-foreground">
        Statement Lens · view & analyze only · never rewrites PDFs
      </footer>
    </div>
  );
};

export default Index;
