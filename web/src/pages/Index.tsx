import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { UploadDropzone } from "@/components/UploadDropzone";
import { ExtractProgress } from "@/components/ExtractProgress";
import { SummaryCards } from "@/components/SummaryCards";
import { FindingsPanel } from "@/components/FindingsPanel";
import { StatementCharts } from "@/components/StatementCharts";
import { TransactionTable } from "@/components/TransactionTable";
import { Toolbar } from "@/components/Toolbar";
import { WorkflowStepper } from "@/components/WorkflowStepper";
import { CompletenessScoreCard } from "@/components/CompletenessScoreCard";
import { BalanceOutPreview } from "@/components/BalanceOutPreview";
import { ConfirmRenderPanel } from "@/components/ConfirmRenderPanel";
import { VisualValidate } from "@/components/VisualValidate";
import { ApiStatusPanel } from "@/components/ApiStatusPanel";
import { FinalMathCheck } from "@/components/FinalMathCheck";
import { PdfDocumentViewer } from "@/components/PdfDocumentViewer";
import { Button } from "@/components/ui/button";
import {
  aiCategorizeTransactions,
  aiHybridValidate,
  AI_MODEL_ID,
} from "@/lib/ai";
import { applyRenderWithFallbacks, buildBalancePreview } from "@/lib/balance-engine";
import { countDirty } from "@/lib/edit-utils";
import { cloneUint8Array } from "@/lib/bytes";
import { exportCsv, exportJson, downloadBytes } from "@/lib/export";
import { runFinalMathCheck } from "@/lib/math-check";
import { loadPdfWithFallbacks, type EngineId } from "@/lib/pdf-engines";
import {
  DEFAULT_DOCUMENT_PARSER,
  loadParserPreference,
  runDocumentParser,
  saveParserPreference,
  type DocumentParserId,
} from "@/lib/parsers";
import {
  analyzeCompleteness,
  buildExtractionResult,
  buildSummary,
} from "@/lib/parse-transactions";
import { buildVisualComparison } from "@/lib/visual-validate";
import {
  materializeCandidatePdf,
  runVisualVerification,
  type VisualVerificationReport,
} from "@/lib/verification";
import type { ApiStatusReport } from "@/lib/api-status";
import {
  runFidelityForensics,
  type FidelityForensicsReport,
} from "@/lib/forensics";
import {
  isRemoteEngineConfigured,
  loadEngineMode,
  remoteParsePdf,
  saveEngineMode,
  type EngineMode,
} from "@/lib/tools";
import {
  appendAuditEvent,
  appendChange,
  buildMergedAuditReport,
  buildWorkflowDraft,
  canRedo,
  canUndo,
  createAutosaveController,
  diffTransactionFields,
  downloadMergedReport,
  emptyUndoState,
  loadDraftFromStorage,
  pushSnapshot,
  redo as redoStack,
  undo as undoStack,
  writeWorkflowJsonFile,
  type AuditLogEntry,
  type ChangeHistoryEntry,
  type UndoRedoState,
  type WorkflowDraft,
} from "@/lib/audit";
import {
  loadThresholds,
  saveThresholds,
  type VerificationThresholds,
  VERIFICATION_DPI,
} from "@/lib/verification/thresholds";
import { AuditPanel } from "@/components/AuditPanel";
import { AdditionalToolsPanel } from "@/components/AdditionalToolsPanel";
import { VerificationThresholdsPanel } from "@/components/VerificationThresholds";
import { StatementGeneratorDashboard } from "@/components/StatementGeneratorDashboard";
import { FidelityForensicsPanel } from "@/components/FidelityForensicsPanel";
import { SideBySideComparison } from "@/components/SideBySideComparison";
import {
  TestWorkflowPanel,
  buildTestStages,
  type TestStageId,
} from "@/components/TestWorkflowPanel";
import {
  defaultStatementConfig,
  generateStatement,
  ledgerToAppTransactions,
  runStressSuite,
  type GenerationQualityReport,
} from "@/lib/statement-gen";
import type {
  AppPhase,
  BalanceEngineId,
  ExtractStep,
  CompletenessFinding,
  ExtractionResult,
  MathCheckResult,
  PdfEdit,
  RenderResult,
  SortDir,
  SortKey,
  Transaction,
  TransactionCategory,
  WorkflowStep,
} from "@/lib/types";
import { WORKFLOW_STEPS } from "@/lib/types";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Layers3,
  Sparkles,
  Eye,
  Table,
  FlaskConical,
  ArrowLeftRight,
} from "lucide-react";

function initialSteps(parserLabel?: string): ExtractStep[] {
  return [
    { id: "read", label: "Load PDF bytes", status: "pending" },
    {
      id: "parse",
      label: parserLabel ? `Parse · ${parserLabel}` : "Document parser",
      status: "pending",
    },
    { id: "structure", label: "Structure transactions", status: "pending" },
    { id: "ai", label: "AI validate & categorize", status: "pending" },
    { id: "score", label: "Completeness scoring", status: "pending" },
    { id: "done", label: "Ready to edit", status: "pending" },
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

const STEP_ORDER: WorkflowStep[] = WORKFLOW_STEPS.map((s) => s.id);

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

  // Workflow state
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>("edit");
  const [unlocked, setUnlocked] = useState<WorkflowStep[]>(["edit"]);
  const [balanceEngine, setBalanceEngine] = useState<BalanceEngineId>("hybrid");
  const [renderEngine, setRenderEngine] = useState<BalanceEngineId>("hybrid");
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [mathResult, setMathResult] = useState<MathCheckResult | null>(null);
  const [mathRunning, setMathRunning] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfEdits, setPdfEdits] = useState<PdfEdit[]>([]);
  const [viewMode, setViewMode] = useState<"table" | "pdf" | "compare">("table");
  const [activeEngine, setActiveEngine] = useState<EngineId | null>(null);
  const [selectedTxnId, setSelectedTxnId] = useState<string | null>(null);
  const [parserId, setParserId] = useState<DocumentParserId>(() => {
    try {
      return loadParserPreference();
    } catch {
      return DEFAULT_DOCUMENT_PARSER;
    }
  });
  const [engineMode, setEngineMode] = useState<EngineMode>(() => {
    try {
      return loadEngineMode();
    } catch {
      return "local";
    }
  });

  const [apiStatus, setApiStatus] = useState<ApiStatusReport | null>(null);
  const [pixelReport, setPixelReport] = useState<VisualVerificationReport | null>(null);
  const [pixelRunning, setPixelRunning] = useState(false);
  const [pixelProgress, setPixelProgress] = useState("");
  /** Last materialized candidate PDF (generator-updated) for visual step. */
  const [editedPdfBytes, setEditedPdfBytes] = useState<Uint8Array | null>(null);
  const [forensicsReport, setForensicsReport] = useState<FidelityForensicsReport | null>(null);
  const [forensicsRunning, setForensicsRunning] = useState(false);
  /** Frozen original parse ledger for fidelity forensics vs working set. */
  const [sourceBaseline, setSourceBaseline] = useState<Transaction[]>([]);

  /** Test Lab: generate → validate → replace → fidelity workflow. */
  const [testLabMode, setTestLabMode] = useState(false);
  const [genQuality, setGenQuality] = useState<GenerationQualityReport | null>(
    null,
  );
  const [genApplied, setGenApplied] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [exportedOnce, setExportedOnce] = useState(false);
  const [stressRunning, setStressRunning] = useState(false);
  const [stressSummary, setStressSummary] = useState<string | null>(null);

  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [changeHistory, setChangeHistory] = useState<ChangeHistoryEntry[]>([]);
  const [undoState, setUndoState] = useState<UndoRedoState>(() => emptyUndoState());
  const [thresholds, setThresholds] = useState<VerificationThresholds>(() => {
    try {
      return loadThresholds();
    } catch {
      return loadThresholds();
    }
  });
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<string | null>(null);
  const autosaveRef = useRef<ReturnType<typeof createAutosaveController> | null>(null);
  const skipUndoPush = useRef(false);


  const unlockThrough = useCallback((step: WorkflowStep) => {
    setUnlocked((prev) => {
      const idx = STEP_ORDER.indexOf(step);
      const next = new Set(prev);
      for (let i = 0; i <= idx; i++) next.add(STEP_ORDER[i]);
      return STEP_ORDER.filter((s) => next.has(s));
    });
  }, []);

  const goToStep = useCallback(
    (step: WorkflowStep) => {
      setWorkflowStep(step);
      unlockThrough(step);
    },
    [unlockThrough],
  );

  const advance = useCallback(() => {
    const idx = STEP_ORDER.indexOf(workflowStep);
    if (idx < STEP_ORDER.length - 1) {
      goToStep(STEP_ORDER[idx + 1]);
    }
  }, [workflowStep, goToStep]);

  const back = useCallback(() => {
    const idx = STEP_ORDER.indexOf(workflowStep);
    if (idx > 0) {
      setWorkflowStep(STEP_ORDER[idx - 1]);
    }
  }, [workflowStep]);

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
    setWorkflowStep("edit");
    setUnlocked(["edit"]);
    setBalanceEngine("hybrid");
    setRenderEngine("hybrid");
    setRenderResult(null);
    setMathResult(null);
    setPdfBytes(null);
    setPdfEdits([]);
    setViewMode("table");
    setActiveEngine(null);
    setSelectedTxnId(null);
    setPixelReport(null);
    setPixelProgress("");
    setEditedPdfBytes(null);
    setAuditLog([]);
    setChangeHistory([]);
    setUndoState(emptyUndoState());
    setLastDraftSavedAt(null);
    setForensicsReport(null);
    setSourceBaseline([]);
    setTestLabMode(false);
    setGenQuality(null);
    setGenApplied(false);
    setHasGenerated(false);
    setExportedOnce(false);
    setStressSummary(null);
  }, []);

  /** Start Test Lab without a PDF — synthetic generation workspace. */
  const startTestLab = useCallback(() => {
    const config = defaultStatementConfig();
    const generated = generateStatement(config);
    const txns = ledgerToAppTransactions(generated.rows);
    const extraction = buildExtractionResult({
      fileName: "test-lab-synthetic.pdf",
      pageCount: 1,
      rawText: "[Test Lab synthetic ledger — no source PDF]",
      transactions: txns,
      hybrid: {
        lineParserCount: txns.length,
        recoveredContinuationLines: 0,
        aiValidated: false,
        enginesTried: ["statement-gen"],
      },
      findings: analyzeCompleteness(txns),
      parser: {
        id: "offline-heuristic",
        label: "Test Lab · statement-gen",
        durationMs: 0,
        fallbackUsed: false,
        enginesTried: ["statement-gen"],
        warnings: ["Synthetic generation — upload a PDF later for geometry replace"],
        structuredFromApi: false,
      },
    });

    setTestLabMode(true);
    setPhase("workspace");
    setActiveFileName("test-lab-synthetic.pdf");
    setResult(extraction);
    setTransactions(extraction.transactions);
    setSourceBaseline(extraction.transactions.map((t) => ({ ...t })));
    setPdfBytes(null);
    setPdfEdits([]);
    setViewMode("compare");
    setWorkflowStep("generate");
    setUnlocked([
      "edit",
      "balance",
      "render",
      "visual",
      "math",
      "generate",
      "fidelity",
      "complete",
    ]);
    setGenApplied(false);
    setHasGenerated(true);
    setRenderResult(null);
    setMathResult(null);
    setPixelReport(null);
    setForensicsReport(null);
    setViewMode("table");
    setAuditLog((log) =>
      appendAuditEvent(
        log,
        "note",
        "Test Lab started (synthetic generation workspace)",
        { actor: "user", payload: { rows: txns.length } },
      ),
    );
    toast.success("Test Lab ready", {
      description:
        "Configure generation → perfect validation → apply → replace → verify",
    });
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setPhase("extracting");
    setActiveFileName(file.name);
    setExtractError(null);
    setProgress(0.02);
    let next = initialSteps(parserId);
    setSteps(next);
    setWorkflowStep("edit");
    setUnlocked(["edit"]);
    setRenderResult(null);
    setMathResult(null);
    setPdfBytes(null);
    setPdfEdits([]);
    setViewMode("table");
    setActiveEngine(null);
    setSelectedTxnId(null);
    setPixelReport(null);
    setPixelProgress("");
    setEditedPdfBytes(null);
    setAuditLog([]);
    setChangeHistory([]);
    setUndoState(emptyUndoState());
    setLastDraftSavedAt(null);
    setForensicsReport(null);
    setSourceBaseline([]);

    try {
      next = setStep(next, "read", "active");
      setSteps([...next]);

      // Own buffer for parsers; store a separate clone in state so engines
      // that transfer/detach cannot poison React state.
      const bytes = new Uint8Array(await file.arrayBuffer());
      setPdfBytes(cloneUint8Array(bytes));
      setProgress(0.08);

      next = setStep(next, "read", "done");
      next = setStep(next, "parse", "active");
      setSteps([...next]);

      const useRemote =
        engineMode === "remote" && isRemoteEngineConfigured();

      let rawText = "";
      let txns: Transaction[] = [];
      let pageCount = 1;
      let parserMeta: NonNullable<ExtractionResult["parser"]>;
      let parserFindings: CompletenessFinding[] = [];

      if (useRemote) {
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "parse" ? { ...s, label: "Remote engine /v1/parse" } : s,
          ),
        );
        const started = performance.now();
        try {
          const remote = await remoteParsePdf({
            fileName: file.name,
            bytes: cloneUint8Array(bytes),
            parserHint: parserId,
            onProgress: (message) => {
              setProgress((p) => Math.min(0.55, p + 0.05));
              setSteps((prev) =>
                prev.map((s) =>
                  s.id === "parse" && s.status === "active"
                    ? { ...s, label: message }
                    : s,
                ),
              );
            },
          });
          txns = remote.transactions;
          rawText = remote.rawText ?? "";
          pageCount = remote.pageCount ?? 1;
          const warnings = remote.warnings ?? [];
          if (!txns.length) {
            warnings.push("Remote engine returned no transactions — falling back to local parser.");
            const parsed = await runDocumentParser(parserId, {
              file,
              bytes: cloneUint8Array(bytes),
              fileName: file.name,
              onProgress: (ratio, message) => {
                setProgress(0.1 + ratio * 0.45);
                if (message) {
                  setSteps((prev) =>
                    prev.map((s) =>
                      s.id === "parse" && s.status === "active"
                        ? { ...s, label: message }
                        : s,
                    ),
                  );
                }
              },
            });
            txns = parsed.transactions;
            rawText = parsed.rawText || rawText;
            pageCount = parsed.pageCount || pageCount;
            parserMeta = {
              id: "remote",
              label: `Remote engine → ${parsed.meta.parserLabel}`,
              durationMs: Math.round(performance.now() - started),
              fallbackUsed: true,
              fallbackFrom: "remote",
              enginesTried: ["remote", ...parsed.meta.enginesTried],
              bankTemplateId: parsed.meta.bankTemplateId,
              bankTemplateName: parsed.meta.bankTemplateName,
              warnings: [...warnings, ...parsed.meta.warnings],
              structuredFromApi: parsed.meta.structuredFromApi,
            };
          } else {
            parserMeta = {
              id: "remote",
              label: `Remote engine (${remote.engine ?? "hosted"})`,
              durationMs: Math.round(performance.now() - started),
              fallbackUsed: false,
              enginesTried: ["remote", remote.engine ?? "hosted"],
              bankTemplateId: null,
              bankTemplateName: null,
              warnings,
              structuredFromApi: true,
            };
          }
          parserFindings = (parserMeta.warnings ?? []).map((w, i) => ({
            id: `parser-warn-${i}`,
            severity: "info" as const,
            title: "Parser note",
            detail: w,
          }));
        } catch (remoteErr) {
          const msg =
            remoteErr instanceof Error ? remoteErr.message : String(remoteErr);
          toast.message("Remote engine failed — local fallback", {
            description: msg,
          });
          const parsed = await runDocumentParser(parserId, {
            file,
            bytes: cloneUint8Array(bytes),
            fileName: file.name,
            onProgress: (ratio, message) => {
              setProgress(0.1 + ratio * 0.45);
              if (message) {
                setSteps((prev) =>
                  prev.map((s) =>
                    s.id === "parse" && s.status === "active"
                      ? { ...s, label: message }
                      : s,
                  ),
                );
              }
            },
          });
          txns = parsed.transactions;
          rawText = parsed.rawText;
          pageCount = parsed.pageCount;
          parserMeta = {
            id: parsed.meta.parserId,
            label: parsed.meta.parserLabel,
            durationMs: parsed.meta.durationMs,
            fallbackUsed: true,
            fallbackFrom: "remote",
            enginesTried: ["remote", ...parsed.meta.enginesTried],
            bankTemplateId: parsed.meta.bankTemplateId,
            bankTemplateName: parsed.meta.bankTemplateName,
            warnings: [`Remote error: ${msg}`, ...parsed.meta.warnings],
            structuredFromApi: parsed.meta.structuredFromApi,
          };
          parserFindings = parserMeta.warnings.map((w, i) => ({
            id: `parser-warn-${i}`,
            severity: "info" as const,
            title: "Parser note",
            detail: w,
          }));
        }
      } else {
        if (engineMode === "remote" && !isRemoteEngineConfigured()) {
          toast.message("Remote mode on, but no engine URL", {
            description: "Set VITE_REMOTE_ENGINE_URL or configure Tools → Remote. Using local parsers.",
          });
        }
        const parsed = await runDocumentParser(parserId, {
          file,
          bytes: cloneUint8Array(bytes),
          fileName: file.name,
          onProgress: (ratio, message) => {
            setProgress(0.1 + ratio * 0.45);
            if (message) {
              setSteps((prev) =>
                prev.map((s) =>
                  s.id === "parse" && s.status === "active"
                    ? { ...s, label: message }
                    : s,
                ),
              );
            }
          },
        });
        rawText = parsed.rawText;
        txns = parsed.transactions;
        pageCount = parsed.pageCount;
        parserMeta = {
          id: parsed.meta.parserId,
          label: parsed.meta.parserLabel,
          durationMs: parsed.meta.durationMs,
          fallbackUsed: parsed.meta.fallbackUsed,
          fallbackFrom: parsed.meta.fallbackFrom,
          enginesTried: parsed.meta.enginesTried,
          bankTemplateId: parsed.meta.bankTemplateId,
          bankTemplateName: parsed.meta.bankTemplateName,
          warnings: parsed.meta.warnings,
          structuredFromApi: parsed.meta.structuredFromApi,
        };
        parserFindings = parsed.meta.warnings.map((w, i) => ({
          id: `parser-warn-${i}`,
          severity: "info" as const,
          title: "Parser note",
          detail: w,
        }));
      }

      next = setStep(next, "parse", "done");
      next = setStep(next, "structure", "active");
      setSteps([...next]);
      setProgress(0.58);

      await new Promise((r) => setTimeout(r, 30));

      let extraction = buildExtractionResult({
        fileName: file.name,
        pageCount,
        rawText,
        transactions: txns,
        hybrid: {
          lineParserCount: txns.length,
          recoveredContinuationLines: 0,
          aiValidated: false,
          enginesTried: parserMeta.enginesTried,
        },
        parser: parserMeta,
        findings: [...parserFindings, ...analyzeCompleteness(txns)],
      });

      next = setStep(next, "structure", "done");
      next = setStep(next, "ai", "active");
      setSteps([...next]);
      setProgress(0.7);

      try {
        txns = await aiCategorizeTransactions(txns);
        const localFindings = analyzeCompleteness(txns);
        const ai = await aiHybridValidate(txns, localFindings);
        extraction = buildExtractionResult({
          fileName: file.name,
          pageCount,
          rawText,
          transactions: txns,
          hybrid: {
            lineParserCount: txns.length,
            recoveredContinuationLines: 0,
            aiValidated: ai.validated,
            enginesTried: parserMeta.enginesTried,
          },
          aiValidated: ai.validated,
          aiScoreHint: ai.scoreHint,
          findings: [...parserFindings, ...ai.findings],
          parser: parserMeta,
        });
        next = setStep(next, "ai", "done");
      } catch {
        next = setStep(next, "ai", "skipped");
        toast.message("AI review unavailable", {
          description: "Showing heuristic categories and local completeness scoring.",
        });
        extraction = buildExtractionResult({
          fileName: file.name,
          pageCount,
          rawText,
          transactions: txns,
          hybrid: {
            lineParserCount: txns.length,
            recoveredContinuationLines: 0,
            aiValidated: false,
            enginesTried: parserMeta.enginesTried,
          },
          aiValidated: false,
          parser: parserMeta,
          findings: extraction.findings,
        });
      }

      next = setStep(next, "score", "active");
      setSteps([...next]);
      setProgress(0.9);
      await new Promise((r) => setTimeout(r, 30));

      next = setStep(next, "score", "done");
      next = setStep(next, "done", "done");
      setSteps([...next]);
      setProgress(1);

      setResult(extraction);
      setTransactions(extraction.transactions);
      // Freeze source extract for later fidelity forensics
      setSourceBaseline(
        extraction.transactions.map((t) => ({
          ...t,
          flags: [...t.flags],
          original: t.original ? { ...t.original } : undefined,
        })),
      );
      setPhase("workspace");
      // Open live original vs current compare for the rest of the workflow
      setViewMode("compare");
      // Test Lab + PDF: land on Generate for cfg / bank-replace workflow
      if (testLabMode) {
        setWorkflowStep("generate");
        unlockThrough("generate");
      }

      const parserNote = parserMeta.fallbackUsed
        ? ` via fallback (${parserMeta.id})`
        : ` via ${parserMeta.label}`;
      const tpl = parserMeta.bankTemplateName
        ? ` · template ${parserMeta.bankTemplateName}`
        : "";
      toast.success("Parse + AI validate complete", {
        description: `${extraction.summary.transactionCount} txns${parserNote}${tpl} · score ${extraction.completenessScore.overall.toFixed(0)}/100 (${extraction.completenessScore.grade})`,
      });
      setAuditLog((prev) =>
        appendAuditEvent(prev, "parse.complete", `Parsed ${extraction.summary.transactionCount} transactions via ${parserMeta.label}`, {
          actor: "system",
          payload: {
            parserId: parserMeta.id,
            count: extraction.summary.transactionCount,
            completeness: extraction.completenessScore.overall,
          },
        }),
      );
      setUndoState(emptyUndoState());
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
  }, [parserId, engineMode, testLabMode, unlockThrough]);

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

  const patchTransaction = useCallback((next: Transaction) => {
    setTransactions((prev) => {
      const before = prev.find((t) => t.id === next.id);
      if (before && !skipUndoPush.current) {
        setUndoState((s) => pushSnapshot(s, `edit ${next.id}`, prev, workflowStep));
        const diffs = diffTransactionFields(before, next, "edit");
        if (diffs.length) {
          setChangeHistory((h) => diffs.reduce((acc, d) => appendChange(acc, d), h));
          setAuditLog((log) =>
            appendAuditEvent(log, "txn.edit", `Edited ${diffs.map((d) => d.field).join(", ")} on row`, {
              actor: "user",
              payload: { id: next.id, fields: diffs.map((d) => d.field) },
            }),
          );
        }
      }
      return prev.map((t) => (t.id === next.id ? next : t));
    });
    setResult((r) =>
      r
        ? {
            ...r,
            transactions: r.transactions.map((t) => (t.id === next.id ? next : t)),
          }
        : r,
    );
    setRenderResult(null);
    setMathResult(null);
    autosaveRef.current?.touch();
  }, [workflowStep]);

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
  };

  const onUpdateTransaction = useCallback(
    (id: string, field: keyof Transaction, value: string | number | null) => {
      setTransactions((prev) =>
        prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)),
      );
      setResult((r) =>
        r
          ? {
              ...r,
              transactions: r.transactions.map((t) =>
                t.id === id ? { ...t, [field]: value } : t,
              ),
            }
          : r,
      );
      setRenderResult(null);
      setMathResult(null);
    },
    [],
  );

  const liveSummary = useMemo(() => buildSummary(transactions), [transactions]);
  const dirtyCount = useMemo(() => countDirty(transactions), [transactions]);

  const balancePreview = useMemo(
    () => buildBalancePreview(transactions, balanceEngine),
    [transactions, balanceEngine],
  );

  const mismatchIds = useMemo(
    () => new Set(balancePreview.rows.filter((r) => r.mismatched).map((r) => r.transactionId)),
    [balancePreview],
  );

  const expectedBalances = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const r of balancePreview.rows) {
      map[r.transactionId] = r.expectedBalance;
    }
    return map;
  }, [balancePreview]);

  const visualResult = useMemo(
    () => buildVisualComparison(transactions),
    [transactions],
  );

  /** True when working ledger differs from source baseline (final PDF must rewrite). */
  const hasGenerationDelta = useMemo(() => {
    if (!sourceBaseline.length || !transactions.length) return false;
    if (transactions.length !== sourceBaseline.length) return true;
    return transactions.some((t, i) => {
      const o = sourceBaseline[i];
      if (!o) return true;
      return (
        t.date !== o.date ||
        t.description !== o.description ||
        t.debit !== o.debit ||
        t.credit !== o.credit ||
        t.balance !== o.balance
      );
    });
  }, [sourceBaseline, transactions]);

  const canExportFinalPdf =
    Boolean(pdfBytes) && (pdfEdits.length > 0 || hasGenerationDelta);

  const handleExportPdf = useCallback(async () => {
    if (!pdfBytes) {
      toast.message("No PDF loaded", {
        description: "Upload a statement first.",
      });
      return;
    }
    if (pdfEdits.length === 0 && !hasGenerationDelta) {
      toast.message("No replacements to apply", {
        description:
          "Generate/replace transactions or edit PDF fields first so the final PDF includes all new data.",
      });
      return;
    }
    try {
      // Full materialize: queued edits + every changed field on every row
      const material = await materializeCandidatePdf({
        originalPdf: pdfBytes,
        pdfEdits,
        sourceBaseline:
          sourceBaseline.length > 0 ? sourceBaseline : transactions,
        current: transactions,
        maxPages: 40,
      });
      if (material.editCount === 0) {
        toast.message("Could not link replacements to PDF geometry", {
          description:
            material.notes.join(" ") ||
            "No text runs matched. Try bank-desc replace or click-to-edit.",
        });
        return;
      }
      // Keep edit queue complete so subsequent exports/visual stay full
      if (material.appliedEdits.length > 0) {
        setPdfEdits(material.appliedEdits);
      }
      setEditedPdfBytes(material.candidatePdf);
      const base = activeFileName.replace(/\.pdf$/i, "") || "statement";
      downloadBytes(
        `${base}-regenerated.pdf`,
        material.candidatePdf,
        "application/pdf",
      );
      const bf = material.coverage.byField;
      toast.success("Final PDF downloaded", {
        description:
          `${material.editCount} replacement(s) · mode=${material.mode} · ` +
          `desc=${bf.description} date=${bf.date} debit=${bf.debit} credit=${bf.credit} bal=${bf.balance}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF export failed";
      toast.error("PDF export failed", { description: message });
    }
  }, [
    pdfBytes,
    pdfEdits,
    sourceBaseline,
    transactions,
    activeFileName,
    hasGenerationDelta,
  ]);

  const handleConfirmRender = useCallback(async () => {
    const rendered = applyRenderWithFallbacks(transactions, renderEngine);

    let pdfEngineMeta: RenderResult["pdfEngine"];
    if (pdfBytes) {
      try {
        const loaded = await loadPdfWithFallbacks(cloneUint8Array(pdfBytes));
        pdfEngineMeta = {
          engineUsed: loaded.engineUsed,
          enginesTried: loaded.enginesTried,
          fallbackUsed: loaded.fallbackUsed,
          pageCount: loaded.document.pageCount,
        };
        loaded.document.destroy();
      } catch (err) {
        const message = err instanceof Error ? err.message : "PDF engine probe failed";
        toast.message("PDF engines unavailable", { description: message });
      }
    }

    const full: RenderResult = {
      ...rendered,
      pdfEngine: pdfEngineMeta,
      summary: pdfEngineMeta
        ? `${rendered.summary} PDF engine: ${pdfEngineMeta.engineUsed}${
            pdfEngineMeta.fallbackUsed ? " (fallback)" : ""
          }.`
        : rendered.summary,
    };

    setTransactions(full.transactions);
    setResult((r) =>
      r
        ? {
            ...r,
            transactions: full.transactions,
            summary: buildSummary(full.transactions),
          }
        : r,
    );
    setRenderResult(full);
    setMathResult(null);
    toast.success("Render applied", { description: full.summary });
    unlockThrough("render");
    return full;
  }, [transactions, renderEngine, unlockThrough, pdfBytes]);

  const handleMathCheck = useCallback(() => {
    setMathRunning(true);
    try {
      const check = runFinalMathCheck({
        transactions,
        rawText: result?.rawText,
      });
      setMathResult(check);
      unlockThrough("math");
      if (check.status === "pass") {
        toast.success("Math check passed", {
          description: `Score ${check.score}/100`,
        });
      } else if (check.status === "warn") {
        toast.message("Math check warnings", {
          description: `Score ${check.score}/100 — review items below`,
        });
      } else {
        toast.error("Math check failed", {
          description: `Score ${check.score}/100`,
        });
      }
    } finally {
      setMathRunning(false);
    }
  }, [transactions, result?.rawText, unlockThrough]);

  const handlePixelCheck = useCallback(async () => {
    if (!pdfBytes) {
      toast.message("No PDF loaded", {
        description: "Upload a statement to run original vs regenerated pixel check.",
      });
      return;
    }
    setPixelRunning(true);
    setPixelProgress("Materializing candidate PDF from generator data…");
    try {
      // Original PDF (left) vs regenerated PDF with ALL replacement data (right)
      const material = await materializeCandidatePdf({
        originalPdf: pdfBytes,
        pdfEdits,
        sourceBaseline:
          sourceBaseline.length > 0 ? sourceBaseline : transactions,
        current: transactions,
        maxPages: 40,
        onProgress: (msg) => setPixelProgress(msg),
      });
      if (material.appliedEdits.length > 0) {
        setPdfEdits(material.appliedEdits);
      }
      setEditedPdfBytes(
        material.mode === "identity" ? null : material.candidatePdf,
      );

      setPixelProgress(
        material.mode === "identity"
          ? "Rendering identity pair @ 300 DPI…"
          : `Rendering original vs full regenerated PDF (${material.editCount} edit(s) · ${material.mode}) @ 300 DPI…`,
      );

      const report = await runVisualVerification({
        baselinePdf: material.baselinePdf,
        candidatePdf: material.candidatePdf,
        transactions,
        thresholds,
        runApplitools: true,
        compareMode:
          material.mode === "identity"
            ? "identity"
            : material.mode === "auto-linked"
              ? "auto-linked"
              : "edited",
        candidateEditCount: material.editCount,
        extraNotes: [
          ...material.notes,
          `coverage rows=${material.coverage.rowsPaired}/${material.coverage.baselineRows} fieldsApplied=${material.coverage.fieldsApplied}`,
        ],
        onProgress: (msg) => {
          setPixelProgress(msg);
        },
      });
      setPixelReport(report);
      unlockThrough("visual");
      setAuditLog((log) =>
        appendAuditEvent(
          log,
          "visual.result",
          `Visual @ ${report.dpi} DPI: ${report.pixelStatus} score ${report.pixelScore} · mode=${report.compareMode} edits=${report.candidateEditCount}`,
          {
            actor: "system",
            payload: {
              status: report.pixelStatus,
              score: report.pixelScore,
              dpi: report.dpi,
              attempts: report.attempts,
              visualDiff: report.thresholds.visualDiff,
              compareMode: report.compareMode,
              candidateEditCount: report.candidateEditCount,
            },
          },
        ),
      );
      autosaveRef.current?.touch();
      if (!report.rendererOk) {
        toast.error("Pdfium renderer failed", {
          description: report.rendererError ?? "Unknown error",
        });
      } else if (report.compareMode === "identity") {
        toast.message("Identity pixel check", {
          description:
            "No generator PDF edits linked yet — original vs original. Apply generate + bank-desc replace (or edit fields) for a true delta.",
        });
      } else if (report.pixelStatus === "pass") {
        toast.success("Original vs regenerated pixel check passed", {
          description: `Score ${report.pixelScore}/100 · ${report.candidateEditCount} edit(s) · ${report.compareMode}`,
        });
      } else if (report.pixelStatus === "warn") {
        toast.message("Pixel verification warnings", {
          description: `Score ${report.pixelScore}/100 · ${report.compareMode}`,
        });
      } else {
        toast.error("Pixel verification failed", {
          description: `Score ${report.pixelScore}/100 · original ≠ regenerated in places`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Visual verification failed";
      toast.error("Visual verification failed", { description: message });
    } finally {
      setPixelRunning(false);
      setPixelProgress("");
    }
  }, [
    pdfBytes,
    pdfEdits,
    sourceBaseline,
    transactions,
    unlockThrough,
    thresholds,
  ]);

  const handleUndo = useCallback(() => {
    const { state, restored } = undoStack(undoState, {
      transactions,
      workflowStep,
    });
    if (!restored) return;
    skipUndoPush.current = true;
    setUndoState(state);
    setTransactions(restored.transactions);
    setWorkflowStep(restored.workflowStep);
    setResult((r) =>
      r ? { ...r, transactions: restored.transactions, summary: buildSummary(restored.transactions) } : r,
    );
    setAuditLog((log) =>
      appendAuditEvent(log, "undo", `Undo: ${restored.label}`, { actor: "user" }),
    );
    skipUndoPush.current = false;
    autosaveRef.current?.touch();
    toast.message("Undone", { description: restored.label });
  }, [undoState, transactions, workflowStep]);

  const handleRedo = useCallback(() => {
    const { state, restored } = redoStack(undoState, {
      transactions,
      workflowStep,
    });
    if (!restored) return;
    skipUndoPush.current = true;
    setUndoState(state);
    setTransactions(restored.transactions);
    setWorkflowStep(restored.workflowStep);
    setResult((r) =>
      r ? { ...r, transactions: restored.transactions, summary: buildSummary(restored.transactions) } : r,
    );
    setAuditLog((log) =>
      appendAuditEvent(log, "redo", `Redo: ${restored.label}`, { actor: "user" }),
    );
    skipUndoPush.current = false;
    autosaveRef.current?.touch();
    toast.message("Redone", { description: restored.label });
  }, [undoState, transactions, workflowStep]);

  const mergedReport = useMemo(() => {
    if (!result) return null;
    return buildMergedAuditReport({
      fileName: result.fileName,
      thresholds,
      auditLog,
      changeHistory,
      pixelReport,
      mathResult,
      transactionCount: transactions.length,
      dirtyCount,
    });
  }, [result, thresholds, auditLog, changeHistory, pixelReport, mathResult, transactions.length, dirtyCount]);

  const buildCurrentDraft = useCallback((): WorkflowDraft | null => {
    if (!result) return null;
    return buildWorkflowDraft({
      fileName: result.fileName,
      parserId: (result.parser?.id as DocumentParserId) ?? parserId,
      workflowStep,
      transactions,
      auditLog,
      changeHistory,
      thresholds,
      pixelReportSummary: pixelReport
        ? {
            status: pixelReport.pixelStatus,
            score: pixelReport.pixelScore,
            dpi: pixelReport.dpi,
            attempts: pixelReport.attempts,
          }
        : null,
      mathSummary: mathResult
        ? { status: mathResult.status, score: mathResult.score }
        : null,
      meta: {
        pageCount: result.pageCount,
        limitedExtraction: result.limitedExtraction,
        completenessOverall: result.completenessScore?.overall ?? null,
      },
    });
  }, [
    result,
    parserId,
    workflowStep,
    transactions,
    auditLog,
    changeHistory,
    thresholds,
    pixelReport,
    mathResult,
  ]);

  // Autosave drafts (no audit append on autosave — avoids log/save feedback loops)
  useEffect(() => {
    autosaveRef.current = createAutosaveController(buildCurrentDraft, (d) => {
      setLastDraftSavedAt(d.savedAt);
    });
    return () => autosaveRef.current?.stop();
  }, [buildCurrentDraft]);

  useEffect(() => {
    autosaveRef.current?.touch();
  }, [transactions, workflowStep, changeHistory.length, thresholds, pixelReport?.pixelScore, mathResult?.score]);

  // Keyboard undo/redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo]);

  const handleDownloadDraft = useCallback(async () => {
    const draft = buildCurrentDraft();
    if (!draft) {
      toast.message("Nothing to save yet");
      return;
    }
    const mode = await writeWorkflowJsonFile(draft);
    setLastDraftSavedAt(draft.savedAt);
    toast.success(mode === "fs" ? "Wrote audit/workflow.json" : "Downloaded workflow.json");
    setAuditLog((log) =>
      appendAuditEvent(log, "draft.save", `Manual save (${mode})`, { actor: "user" }),
    );
  }, [buildCurrentDraft]);

  const handleDownloadReport = useCallback(() => {
    if (!mergedReport) {
      toast.message("Run verification or math check first");
      return;
    }
    downloadMergedReport(mergedReport);
    setAuditLog((log) =>
      appendAuditEvent(log, "export", "Downloaded merged audit report", { actor: "user" }),
    );
  }, [mergedReport]);

  const handleForensics = useCallback(async () => {
    if (!result) {
      toast.message("No extraction result");
      return;
    }
    setForensicsRunning(true);
    try {
      const source =
        sourceBaseline.length > 0
          ? sourceBaseline
          : result.transactions.map((t) => {
              const o = t.original;
              if (!o) return t;
              return {
                ...t,
                date: o.date,
                description: o.description,
                debit: o.debit,
                credit: o.credit,
                balance: o.balance,
              };
            });

      const report = await runFidelityForensics({
        fileName: result.fileName,
        pageCount: result.pageCount,
        rawText: result.rawText,
        sourceTransactions: source,
        workingTransactions: transactions,
        findings: result.findings,
        pixelScore: pixelReport?.pixelScore ?? null,
        pixelStatus: pixelReport?.pixelStatus ?? null,
        limitedExtraction: result.limitedExtraction,
        runAi: true,
      });
      setForensicsReport(report);
      unlockThrough("fidelity");
      setAuditLog((log) =>
        appendAuditEvent(
          log,
          "note",
          `Forensics ${report.verdict}: ${report.overallScore}/100 (${report.grade})`,
          {
            actor: "system",
            payload: {
              verdict: report.verdict,
              score: report.overallScore,
              layers: report.layers.map((l) => ({
                id: l.layer,
                score: l.score,
                status: l.status,
              })),
            },
          },
        ),
      );
      if (report.verdict === "pass") {
        toast.success("Forensics pass", {
          description: `Score ${report.overallScore}/100 · grade ${report.grade}`,
        });
      } else if (report.verdict === "warn") {
        toast.message("Forensics warnings", {
          description: `Score ${report.overallScore}/100 — review findings`,
        });
      } else {
        toast.error("Forensics failed", {
          description: `Score ${report.overallScore}/100`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Forensics failed";
      toast.error("Forensics failed", { description: message });
    } finally {
      setForensicsRunning(false);
    }
  }, [result, transactions, pixelReport, unlockThrough, sourceBaseline]);

  const currentStepMeta = WORKFLOW_STEPS.find((s) => s.id === workflowStep);

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader
        subtitle={
          result
            ? `${result.fileName} · ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} · ${workflowStep}`
            : undefined
        }
        apiStatus={apiStatus}
      />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-8 sm:py-10">
        {phase === "upload" && (
          <div className="space-y-10">
            <div className="text-center space-y-3 max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Multi-parser · AI validate · {AI_MODEL_ID}
              </div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                Parse, edit, balance, verify
              </h1>
              <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
                Choose Mindee Financial (default), LlamaParse, Google Document AI, PyMuPDF,
                Local OCR, or offline heuristic + bank YAML templates — then edit, balance,
                and verify. Or open <strong>Test Lab</strong> for perfect generation
                without a PDF.
              </p>
            </div>

            {/* Test Lab entry */}
            <div className="max-w-2xl mx-auto w-full rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-card to-card p-5 shadow-sm space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                  <FlaskConical className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Test Lab workflow</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                    Configure statement cfg → generate → perfect validation → apply →
                    bank-desc replace (with PDF) → math → visual pixel checks →
                    forensics → export. Stress suite available in-session.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button className="rounded-full" onClick={startTestLab}>
                  <FlaskConical className="mr-1.5 h-4 w-4" />
                  Start Test Lab (no PDF)
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    setTestLabMode(true);
                    toast.message("Upload a PDF to begin Test Lab with geometry", {
                      description:
                        "After parse, jump to Generate for cfg + bank replace",
                    });
                  }}
                >
                  Test Lab + PDF upload
                </Button>
              </div>
              <ol className="grid sm:grid-cols-4 gap-2 text-[10px] text-muted-foreground">
                {[
                  "1 Configure & generate",
                  "2 Perfect validate",
                  "3 Apply / replace",
                  "4 Math · visual · forensics",
                ].map((s) => (
                  <li
                    key={s}
                    className="rounded-lg border border-border/50 bg-background/50 px-2 py-1.5"
                  >
                    {s}
                  </li>
                ))}
              </ol>
            </div>

            {engineMode === "remote" && (
              <div className="max-w-2xl mx-auto w-full rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-xs text-primary">
                <strong>Remote engine mode</strong> — upload will call hosted{" "}
                <code className="text-[10px]">/v1/parse</code>
                {!isRemoteEngineConfigured() && (
                  <span className="text-amber-700 dark:text-amber-300">
                    {" "}
                    (no URL configured yet — will fall back to local parsers)
                  </span>
                )}
                . Switch in Tools → Remote.
              </div>
            )}

            <UploadDropzone
              onFile={(f) => {
                if (testLabMode) {
                  /* keep flag so checklist shows after parse */
                }
                void handleFile(f);
              }}
              parserId={parserId}
              onParserChange={(id) => {
                setParserId(id);
                saveParserPreference(id);
              }}
            />

            <div className="max-w-2xl mx-auto w-full">
              <ApiStatusPanel onReport={setApiStatus} />
            </div>

            <div className="grid sm:grid-cols-3 gap-3 max-w-3xl mx-auto">
              {[
                {
                  icon: FileText,
                  title: "1. Multi-parser",
                  body: "Mindee · LlamaParse · Doc AI · PyMuPDF · Local OCR · Offline YAML.",
                },
                {
                  icon: Sparkles,
                  title: "2. Edit & balance",
                  body: "Inline table edits, yellow mismatch overlays, engine fallbacks.",
                },
                {
                  icon: Layers3,
                  title: "3. Validate & export",
                  body: "Visual multi-layer diff, final math check, CSV/JSON export.",
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
            <div className="rounded-2xl border border-border/70 bg-card/70 p-3 sm:p-4 space-y-3 shadow-sm">
              <WorkflowStepper
                current={workflowStep}
                unlocked={unlocked}
                onStepClick={(s) => {
                  if (unlocked.includes(s) || STEP_ORDER.indexOf(s) <= STEP_ORDER.indexOf(workflowStep)) {
                    setWorkflowStep(s);
                  }
                }}
              />
              {currentStepMeta && (
                <p className="text-xs text-muted-foreground px-1">
                  <span className="font-semibold text-foreground">
                    {currentStepMeta.label}:
                  </span>{" "}
                  {currentStepMeta.description}
                </p>
              )}
            </div>

            <Toolbar
              query={query}
              onQueryChange={setQuery}
              category={categoryFilter}
              onCategoryChange={setCategoryFilter}
              includeNotes={includeNotes}
              onIncludeNotesChange={setIncludeNotes}
              onExportCsv={() => {
                exportCsv(
                  { ...result, summary: liveSummary, transactions },
                  filtered,
                  includeNotes,
                );
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
              canUndo={canUndo(undoState)}
              canRedo={canRedo(undoState)}
              onUndo={handleUndo}
              onRedo={handleRedo}
            />

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4 min-w-0">
                <SummaryCards summary={liveSummary} limited={result.limitedExtraction} />

                {/* Step-specific panels */}
                {workflowStep === "balance" && (
                  <BalanceOutPreview
                    preview={balancePreview}
                    engine={balanceEngine}
                    onEngineChange={setBalanceEngine}
                    onSelectRow={(id) => {
                      setHighlightId(id);
                      setQuery("");
                      setCategoryFilter("all");
                    }}
                  />
                )}

                {workflowStep === "render" && (
                  <ConfirmRenderPanel
                    preferredEngine={renderEngine}
                    onPreferredEngineChange={setRenderEngine}
                    mismatchCount={balancePreview.mismatchCount}
                    dirtyCount={dirtyCount}
                    onConfirm={handleConfirmRender}
                    lastResult={renderResult}
                    hasPdfBytes={Boolean(pdfBytes)}
                  />
                )}

                {workflowStep === "visual" && (
                  <>
                    <VerificationThresholdsPanel
                      value={thresholds}
                      onChange={(t) => {
                        setThresholds(t);
                        saveThresholds(t);
                        setAuditLog((log) =>
                          appendAuditEvent(
                            log,
                            "threshold.change",
                            `Thresholds: visualDiff=${t.visualDiff}, retries=${t.maxRetries}`,
                            { actor: "user", payload: { ...t } },
                          ),
                        );
                      }}
                    />
                    <VisualValidate
                      result={visualResult}
                      highlightId={highlightId}
                      onSelectRow={(id) => setHighlightId(id)}
                      pixelReport={pixelReport}
                      pixelRunning={pixelRunning}
                      pixelProgress={pixelProgress}
                      onRunPixelCheck={() => void handlePixelCheck()}
                      hasPdfBytes={Boolean(pdfBytes)}
                      pdfEditCount={pdfEdits.length}
                      hasGenerationDelta={hasGenerationDelta}
                      hasCandidatePdf={Boolean(editedPdfBytes)}
                      onDownloadCandidate={() => {
                        if (!editedPdfBytes) return;
                        const base =
                          activeFileName.replace(/\.pdf$/i, "") || "statement";
                        downloadBytes(
                          `${base}-regenerated.pdf`,
                          editedPdfBytes,
                          "application/pdf",
                        );
                        toast.success("Regenerated PDF downloaded");
                      }}
                    />
                  </>
                )}

                {workflowStep === "math" && (
                  <FinalMathCheck
                    result={mathResult}
                    onRun={handleMathCheck}
                    running={mathRunning}
                    onSelectRow={(id) => setHighlightId(id)}
                  />
                )}

                {workflowStep === "generate" && (
                  <StatementGeneratorDashboard
                    hasPdfBytes={Boolean(pdfBytes)}
                    pdfBytes={pdfBytes}
                    pdfEditCount={pdfEdits.length}
                    onQualityChange={(q) => {
                      setGenQuality(q);
                      setHasGenerated(true);
                    }}
                    onApplyToWorkspace={(txns, label, extras) => {
                      setUndoState((s) =>
                        pushSnapshot(s, label, transactions, workflowStep),
                      );
                      // Freeze original before overwrite so compare has a left column
                      if (sourceBaseline.length === 0) {
                        setSourceBaseline(
                          transactions.length
                            ? transactions.map((t) => ({ ...t }))
                            : txns.map((t) => ({ ...t })),
                        );
                      }
                      setTransactions(txns);
                      setResult((r) =>
                        r
                          ? {
                              ...r,
                              transactions: txns,
                              summary: buildSummary(txns),
                            }
                          : r,
                      );
                      // Unredacter chrome edits (identity/address) — never blank
                      if (extras?.pdfEdits?.length) {
                        setPdfEdits((prev) => [
                          ...prev,
                          ...extras.pdfEdits!.filter(
                            (e) => e.replacement.trim().length > 0,
                          ),
                        ]);
                      }
                      setGenApplied(true);
                      setViewMode("compare");
                      setRenderResult(null);
                      setMathResult(null);
                      setAuditLog((log) =>
                        appendAuditEvent(log, "note", label, {
                          actor: "user",
                          payload: {
                            count: txns.length,
                            quality: genQuality?.score,
                            unredactEdits: extras?.pdfEdits?.length ?? 0,
                          },
                        }),
                      );
                      autosaveRef.current?.touch();
                      toast.success(label, {
                        description: `${txns.length} transactions applied${
                          extras?.pdfEdits?.length
                            ? ` · ${extras.pdfEdits.length} Unredacter edit(s)`
                            : ""
                        } · compare view open`,
                      });
                      unlockThrough("generate");
                    }}
                    onAppliedAndContinue={() => {
                      setTestLabMode(true);
                      if (pdfBytes) {
                        goToStep("edit");
                        toast.message("Next: bank-desc replace or Continue → Math", {
                          description:
                            "Use Additional tools → Generator, or jump Math / Visual",
                        });
                      } else {
                        goToStep("math");
                        toast.message("Next: Final math check", {
                          description:
                            "Upload a PDF later for visual/pixel & bank-desc replace",
                        });
                      }
                    }}
                    onBankReplaceRequest={() => {
                      setTestLabMode(true);
                      goToStep("edit");
                      toast.message("Open Additional tools → Generator", {
                        description:
                          "Replace original descriptions with bank generators + font link",
                      });
                    }}
                    onAudit={(message) => {
                      setAuditLog((log) =>
                        appendAuditEvent(log, "note", message, {
                          actor: "user",
                        }),
                      );
                    }}
                  />
                )}

                {workflowStep === "fidelity" && (
                  <FidelityForensicsPanel
                    report={forensicsReport}
                    running={forensicsRunning}
                    onRun={() => void handleForensics()}
                    onSelectRow={(id) => {
                      setHighlightId(id);
                      setQuery("");
                      setCategoryFilter("all");
                    }}
                  />
                )}

                {workflowStep === "complete" && (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-3">
                    <h3 className="text-sm font-semibold">Pipeline complete</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Working set is ready for export. Completeness grade{" "}
                      <strong>{result.completenessScore.grade}</strong> (
                      {result.completenessScore.overall.toFixed(0)}/100)
                      {mathResult
                        ? ` · math ${mathResult.status} (${mathResult.score}/100)`
                        : " · run math check for a verification score"}
                      {renderResult
                        ? ` · rendered with ${renderResult.engineUsed}`
                        : ""}
                      {forensicsReport
                        ? ` · forensics ${forensicsReport.verdict} ${forensicsReport.overallScore}/100 (${forensicsReport.grade})`
                        : " · run Fidelity Forensics for source-match audit"}
                      .
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="rounded-full"
                        onClick={() => {
                          exportCsv(
                            { ...result, summary: liveSummary, transactions },
                            transactions,
                            includeNotes,
                          );
                          setExportedOnce(true);
                          toast.success("CSV downloaded");
                        }}
                      >
                        Export CSV
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-full"
                        onClick={() => {
                          exportJson(
                            { ...result, summary: liveSummary, transactions },
                            transactions,
                            includeNotes,
                          );
                          setExportedOnce(true);
                          toast.success("JSON downloaded");
                        }}
                      >
                        Export JSON
                      </Button>
                      {canExportFinalPdf && (
                        <Button
                          variant="outline"
                          className="rounded-full"
                          onClick={() => {
                            void handleExportPdf();
                            setExportedOnce(true);
                          }}
                        >
                          <FileText className="h-4 w-4" />
                          Export final PDF
                          {pdfEdits.length > 0
                            ? ` (${pdfEdits.length})`
                            : hasGenerationDelta
                              ? " (all data)"
                              : ""}
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* View mode: Table · Compare · PDF */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={viewMode === "table" ? "default" : "outline"}
                    size="sm"
                    className="rounded-full"
                    onClick={() => setViewMode("table")}
                  >
                    <Table className="h-3.5 w-3.5" />
                    Table
                  </Button>
                  <Button
                    type="button"
                    variant={viewMode === "compare" ? "default" : "outline"}
                    size="sm"
                    className="rounded-full"
                    onClick={() => setViewMode("compare")}
                    disabled={sourceBaseline.length === 0}
                    title={
                      sourceBaseline.length === 0
                        ? "Parse a statement to freeze the original baseline"
                        : "Live original vs current generation"
                    }
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                    Compare
                    {sourceBaseline.length > 0 && (
                      <span className="ml-1 text-[10px] opacity-80">
                        live
                      </span>
                    )}
                  </Button>
                  {pdfBytes &&
                    (workflowStep === "edit" || workflowStep === "balance") && (
                      <Button
                        type="button"
                        variant={viewMode === "pdf" ? "default" : "outline"}
                        size="sm"
                        className="rounded-full"
                        onClick={() => setViewMode("pdf")}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        PDF Editor
                      </Button>
                    )}
                  {viewMode === "pdf" && activeEngine && (
                    <span className="text-xs text-muted-foreground ml-1">
                      Engine: {activeEngine}
                    </span>
                  )}
                  {viewMode === "pdf" && canExportFinalPdf && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="rounded-full ml-auto"
                      onClick={() => void handleExportPdf()}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Export final PDF
                      {pdfEdits.length > 0 ? ` (${pdfEdits.length})` : ""}
                    </Button>
                  )}
                  {viewMode === "compare" && (
                    <span className="text-[10px] text-muted-foreground ml-auto max-w-xs text-right leading-snug">
                      Right column tracks edits, generate apply, bank-desc
                      replace, and balance engines
                    </span>
                  )}
                </div>

                {viewMode === "compare" ? (
                  <SideBySideComparison
                    original={sourceBaseline}
                    current={transactions}
                    highlightId={highlightId}
                    onSelectRow={(id) => {
                      setHighlightId(id);
                      setSelectedTxnId(id);
                    }}
                    originalLabel="Original (frozen at parse)"
                    currentLabel="Current / generation (live)"
                  />
                ) : viewMode === "pdf" &&
                  pdfBytes &&
                  (workflowStep === "edit" || workflowStep === "balance") ? (
                  <PdfDocumentViewer
                    fileData={pdfBytes}
                    pageCount={result.pageCount}
                    edits={pdfEdits}
                    onEditsChange={setPdfEdits}
                    transactions={transactions}
                    onUpdateTransaction={onUpdateTransaction}
                    selectedTransactionId={selectedTxnId}
                    onEngineChange={setActiveEngine}
                  />
                ) : (
                  <TransactionTable
                    transactions={filtered}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                    onCategoryChange={onCategoryChange}
                    onTransactionChange={patchTransaction}
                    highlightId={highlightId}
                    editable={
                      workflowStep === "edit" || workflowStep === "balance"
                    }
                    readOnly={
                      workflowStep === "visual" ||
                      workflowStep === "math" ||
                      workflowStep === "generate" ||
                      workflowStep === "fidelity" ||
                      workflowStep === "complete"
                    }
                    mismatchIds={
                      workflowStep === "balance" || workflowStep === "render"
                        ? mismatchIds
                        : undefined
                    }
                    expectedBalances={
                      workflowStep === "balance" || workflowStep === "render"
                        ? expectedBalances
                        : undefined
                    }
                  />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <Button
                    variant="outline"
                    className="rounded-full"
                    disabled={workflowStep === "edit"}
                    onClick={back}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Back
                  </Button>
                  <div className="flex items-center gap-2">
                    {workflowStep === "math" && !mathResult && (
                      <Button
                        variant="secondary"
                        className="rounded-full"
                        onClick={handleMathCheck}
                      >
                        Run check first
                      </Button>
                    )}
                    {workflowStep === "render" && !renderResult && (
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        Confirm render, or skip ahead
                      </span>
                    )}
                    <Button
                      className="rounded-full"
                      disabled={workflowStep === "complete"}
                      onClick={() => {
                        if (workflowStep === "math" && !mathResult) {
                          handleMathCheck();
                        }
                        if (workflowStep === "render" && !renderResult) {
                          void handleConfirmRender().then(() => advance());
                          return;
                        }
                        if (workflowStep === "fidelity" && !forensicsReport) {
                          void handleForensics().then(() => advance());
                          return;
                        }
                        advance();
                      }}
                    >
                      {workflowStep === "complete" ? "Done" : "Continue"}
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
                {(testLabMode ||
                  workflowStep === "generate" ||
                  hasGenerated ||
                  genApplied) && (
                  <TestWorkflowPanel
                    stages={buildTestStages({
                      workflowStep,
                      hasGenerated: hasGenerated || workflowStep === "generate",
                      qualityOk: genQuality?.ok ?? null,
                      qualityScore: genQuality?.score ?? null,
                      applied: genApplied,
                      pdfEdits: pdfEdits.length,
                      hasPdf: Boolean(pdfBytes),
                      mathOk: mathResult
                        ? mathResult.status === "pass" ||
                          (mathResult.score ?? 0) >= 70
                        : null,
                      visualOk: pixelReport
                        ? pixelReport.pixelStatus === "pass" ||
                          pixelReport.pixelScore >= 90
                        : null,
                      forensicsOk: forensicsReport
                        ? forensicsReport.verdict === "pass"
                        : null,
                      exported: exportedOnce,
                    })}
                    onJump={(id: TestStageId, step) => {
                      if (step) goToStep(step);
                      if (id === "replace") {
                        toast.message("Bank-desc replace", {
                          description:
                            "Additional tools → Generator → Replace original descriptions",
                        });
                      }
                    }}
                    stressRunning={stressRunning}
                    stressSummary={stressSummary}
                    onRunStress={() => {
                      setStressRunning(true);
                      setStressSummary(null);
                      // Defer so UI can paint spinner
                      window.setTimeout(() => {
                        try {
                          const report = runStressSuite(50, 4242);
                          const msg = report.perfect
                            ? `Stress PASS · ${report.passed}/${report.n} · ${report.totalRows} rows · ${report.durationMs}ms`
                            : `Stress FAIL · ${report.failed}/${report.n} failed · e.g. seed ${report.failures[0]?.seed}: ${report.failures[0]?.messages[0] ?? ""}`;
                          setStressSummary(msg);
                          setAuditLog((log) =>
                            appendAuditEvent(log, "note", msg, {
                              actor: "user",
                              payload: {
                                perfect: report.perfect,
                                passed: report.passed,
                                n: report.n,
                              },
                            }),
                          );
                          if (report.perfect) {
                            toast.success("Stress suite perfect", {
                              description: msg,
                            });
                          } else {
                            toast.error("Stress suite failures", {
                              description: msg,
                            });
                          }
                        } catch (err) {
                          const message =
                            err instanceof Error ? err.message : "Stress failed";
                          setStressSummary(message);
                          toast.error("Stress suite error", {
                            description: message,
                          });
                        } finally {
                          setStressRunning(false);
                        }
                      }, 30);
                    }}
                  />
                )}
                <CompletenessScoreCard score={result.completenessScore} />
                {result.parser && (
                  <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm space-y-2 text-xs">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Document parser
                    </p>
                    <p className="text-sm font-semibold">{result.parser.label}</p>
                    <p className="text-muted-foreground leading-relaxed">
                      {result.parser.durationMs}ms
                      {result.parser.fallbackUsed ? " · fallback used" : ""}
                      {result.parser.structuredFromApi ? " · structured API" : ""}
                      {result.parser.bankTemplateName
                        ? ` · ${result.parser.bankTemplateName}`
                        : ""}
                    </p>
                    {result.parser.enginesTried.length > 0 && (
                      <p className="text-[10px] text-muted-foreground break-all">
                        {result.parser.enginesTried.join(" → ")}
                      </p>
                    )}
                  </div>
                )}
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
                <AdditionalToolsPanel
                  transactions={transactions}
                  pdfBytes={pdfBytes}
                  fileName={result.fileName}
                  engineMode={engineMode}
                  onEngineModeChange={(m) => {
                    setEngineMode(m);
                    saveEngineMode(m);
                  }}
                  onReplaceTransactions={(txns, label) => {
                    setUndoState((s) => pushSnapshot(s, label, transactions, workflowStep));
                    if (sourceBaseline.length === 0) {
                      setSourceBaseline(transactions.map((t) => ({ ...t })));
                    }
                    setTransactions(txns);
                    setResult((r) =>
                      r
                        ? {
                            ...r,
                            transactions: txns,
                            summary: buildSummary(txns),
                          }
                        : r,
                    );
                    setViewMode("compare");
                    setRenderResult(null);
                    setMathResult(null);
                    setAuditLog((log) =>
                      appendAuditEvent(log, "note", label, {
                        actor: "user",
                        payload: { count: txns.length },
                      }),
                    );
                    autosaveRef.current?.touch();
                    toast.success(label, {
                      description: `${txns.length} transactions · compare view open`,
                    });
                  }}
                  onAddPdfEdits={(edits) => {
                    if (!edits.length) return;
                    setPdfEdits((prev) => [...prev, ...edits]);
                    toast.message("Font-replicated edits queued", {
                      description: `${edits.length} replacement(s)`,
                    });
                  }}
                  onAudit={(type, message) => {
                    setAuditLog((log) =>
                      appendAuditEvent(log, "note", message, { actor: "user" }),
                    );
                  }}
                />
                <AuditPanel
                  auditLog={auditLog}
                  changeHistory={changeHistory}
                  mergedReport={mergedReport}
                  onDownloadDraft={() => void handleDownloadDraft()}
                  onDownloadReport={handleDownloadReport}
                  lastDraftSavedAt={lastDraftSavedAt}
                />
                {dirtyCount > 0 && (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-950 dark:text-amber-100">
                    <strong>{dirtyCount}</strong> row(s) differ from the original
                    parse. Per-row revert is available on the Edit step.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-border/60 py-4 text-center text-xs text-muted-foreground">
        Statement Lens · Pdfium verify · SSIM · tile · pHash · Eyes optional
      </footer>
    </div>
  );
};

export default Index;
