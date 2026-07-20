import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { AppHeader, type UiMode } from "@/components/AppHeader";
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
import { RegeneratedPdfPreview } from "@/components/RegeneratedPdfPreview";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  aiCategorizeTransactions,
  aiHybridValidate,
  AI_MODEL_ID,
} from "@/lib/ai";
import {
  applyRenderWithFallbacks,
  buildBalancePreview,
  recomputeBalances,
  inferOpeningBalance,
} from "@/lib/balance-engine";
import { countDirty, withSourceOriginals } from "@/lib/edit-utils";
import { cloneUint8Array } from "@/lib/bytes";
import { exportCsv, exportJson, downloadBytes } from "@/lib/export";
import { runFinalMathCheck } from "@/lib/math-check";
import {
  loadPdfWithFallbacks,
  type EngineId,
} from "@/lib/pdf-engines";
import { safeErrorMessage } from "@/lib/pdf-engines/mupdf-engine";
import {
  DEFAULT_DOCUMENT_PARSER,
  loadParserPreference,
  runDocumentParser,
  runRequiredCloudParser,
  cloudParserStatus,
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
import { runPerfectReplacement } from "@/lib/perfect-replacement";
import { runOemPerfectReplica } from "@/lib/oem-replica";
import {
  analyzeStatementLayout,
  summarizeLayoutAnalysis,
  type StatementLayoutAnalysis,
} from "@/lib/statement-layout";
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
  appendAuditPageToPdf,
  emptyUndoState,
  loadDraftFromStorage,
  pushSnapshot,
  redo as redoStack,
  undo as undoStack,
  writeWorkflowJsonFile,
  type AuditLogEntry,
  type ChangeHistoryEntry,
  type InjectionAuditSection,
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
import {
  AdditionalToolsPanel,
  type AdditionalToolsTab,
} from "@/components/AdditionalToolsPanel";
import { VerificationThresholdsPanel } from "@/components/VerificationThresholds";
import {
  StatementGeneratorDashboard,
  type StatementGeneratorHandle,
} from "@/components/StatementGeneratorDashboard";
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Sparkles,
  Eye,
  Table,
  FlaskConical,
  ArrowLeftRight,
  PanelRight,
  PanelRightClose,
} from "lucide-react";
import { cn } from "@/lib/utils";

function initialSteps(parserLabel?: string): ExtractStep[] {
  return [
    { id: "read", label: "Load PDF bytes", status: "pending" },
    {
      id: "parse",
      label: parserLabel ? `Parse · ${parserLabel}` : "Document parser",
      status: "pending",
    },
    {
      id: "structure",
      label: "Three-part layout (static · vars · txns)",
      status: "pending",
    },
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
  /** Default to live compare — primary workspace surface. */
  const [viewMode, setViewMode] = useState<"table" | "pdf" | "compare">("compare");
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
  /** Live materialized candidate PDF — rebuilds after every ledger/edit step. */
  const [editedPdfBytes, setEditedPdfBytes] = useState<Uint8Array | null>(null);
  const [liveMaterializing, setLiveMaterializing] = useState(false);
  const [liveMaterializeMode, setLiveMaterializeMode] = useState<string | null>(
    null,
  );
  const [liveMaterializeEdits, setLiveMaterializeEdits] = useState(0);
  const [liveMaterializeNotes, setLiveMaterializeNotes] = useState<string[]>(
    [],
  );
  const liveMaterializeSeq = useRef(0);
  const [forensicsReport, setForensicsReport] = useState<FidelityForensicsReport | null>(null);
  const [forensicsRunning, setForensicsRunning] = useState(false);
  /** Frozen original parse ledger for fidelity forensics vs working set. */
  const [sourceBaseline, setSourceBaseline] = useState<Transaction[]>([]);
  /**
   * Frozen Stage-1 three-part layout profile (upload-time).
   * Layer 1 static-chrome · Layer 2 variables · Layer 3 transactions + structure.
   * Passed into OEM rematerialize so write path does not re-classify cold.
   */
  const [layoutProfile, setLayoutProfile] =
    useState<StatementLayoutAnalysis | null>(null);

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

  /** Workspace chrome: mode, collapsible rail, advanced tools tab. */
  const [railOpen, setRailOpen] = useState(true);
  /** Secondary rail panels — closed by default; click header to show. */
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [parserOpen, setParserOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [completenessOpen, setCompletenessOpen] = useState(false);
  /** Advanced tools are a primary surface — open by default. */
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [toolsTab, setToolsTab] = useState<AdditionalToolsTab>("generator");
  /** Generate step: workspace ledger collapsed unless operator expands. */
  const [workspaceLedgerOpen, setWorkspaceLedgerOpen] = useState(false);
  const generatorRef = useRef<StatementGeneratorHandle | null>(null);

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
    setViewMode("compare");
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
    setLayoutProfile(null);
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
    setViewMode("compare");
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
    setViewMode("compare");
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
    setLayoutProfile(null);

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

      // Product rule: every parse MUST call LlamaParse or Google Document AI
      // (unless pure remote engine is used). Local parsers cannot satisfy this alone.
      const cloudStatus = cloudParserStatus();
      if (!useRemote && !cloudStatus.any) {
        throw new Error(
          "LlamaParse or Google Document AI is required. Set VITE_LLAMAPARSE_API_KEY and/or VITE_GOOGLE_DOCAI_* credentials.",
        );
      }

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
            description:
              "Set VITE_REMOTE_ENGINE_URL or configure Tools → Remote. Using required cloud parsers (LlamaParse / Doc AI).",
          });
        }
        // Exactly one cloud engine: dropdown selection, or default (LlamaParse if set).
        // Never runs LlamaParse and Google DocAI in the same upload.
        const preferredCloud =
          parserId === "llamaparse" || parserId === "google-docai"
            ? parserId
            : cloudStatus.llamaparse
              ? "llamaparse"
              : "google-docai";
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "parse"
              ? { ...s, label: `Cloud parse (${preferredCloud} only)…` }
              : s,
          ),
        );
        const parsed = await runRequiredCloudParser(
          {
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
          },
          preferredCloud,
        );
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

      // Stage 1 Step 1 — freeze three-part layout at upload (not only at OEM write).
      // Layer 1 static-chrome · Layer 2 variables · Layer 3 transactions + structure profile.
      let frozenLayout: StatementLayoutAnalysis | null = null;
      const bankHint =
        parserMeta.bankTemplateId ??
        parserMeta.bankTemplateName ??
        file.name;
      try {
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "structure" && s.status === "active"
              ? {
                  ...s,
                  label: "Three-part layout · geometry runs + bank profile…",
                }
              : s,
          ),
        );
        frozenLayout = await analyzeStatementLayout(cloneUint8Array(bytes), {
          fileName: file.name,
          maxPages: Math.min(pageCount || 12, 12),
          rawText,
          bankHint,
        });
        setLayoutProfile(frozenLayout);
        setProgress(0.62);
      } catch (layoutErr) {
        const msg =
          layoutErr instanceof Error
            ? layoutErr.message
            : String(layoutErr);
        parserFindings = [
          ...parserFindings,
          {
            id: "layout-soft-fail",
            severity: "warning" as const,
            title: "Three-part layout soft-fail",
            detail: `analyzeStatementLayout failed — OEM will re-analyze at write: ${msg}`,
          },
        ];
        setLayoutProfile(null);
      }

      const layoutFindings: CompletenessFinding[] = frozenLayout
        ? [
            {
              id: "layout-three-part",
              severity: frozenLayout.score >= 70 ? "info" : "warning",
              title: "Three-part layout locked",
              detail: `score ${frozenLayout.score}/100 · class=${frozenLayout.documentClass} · bank=${frozenLayout.txnStructure.bankId} · static=${frozenLayout.part1.runs.length} vars=${frozenLayout.part2.runs.length} txnRows=${frozenLayout.part3.rows.length} · pitch≈${frozenLayout.part3.rowPitchMedian?.toFixed(1) ?? "?"}pt`,
            },
            ...frozenLayout.gates
              .filter((g) => !g.pass)
              .map((g) => ({
                id: `layout-gate-${g.id}`,
                severity: "warning" as const,
                title: `Layout gate: ${g.id}`,
                detail: g.detail,
              })),
          ]
        : [];

      let extraction = buildExtractionResult({
        fileName: file.name,
        pageCount: frozenLayout?.pageCount || pageCount,
        rawText,
        transactions: txns,
        hybrid: {
          lineParserCount: txns.length,
          recoveredContinuationLines: 0,
          aiValidated: false,
          enginesTried: [
            ...parserMeta.enginesTried,
            ...(frozenLayout ? ["statement-layout.three-part"] : []),
          ],
        },
        parser: parserMeta,
        findings: [
          ...parserFindings,
          ...layoutFindings,
          ...analyzeCompleteness(txns),
        ],
        layout: frozenLayout,
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
          pageCount: frozenLayout?.pageCount || pageCount,
          rawText,
          transactions: txns,
          hybrid: {
            lineParserCount: txns.length,
            recoveredContinuationLines: 0,
            aiValidated: ai.validated,
            enginesTried: [
              ...parserMeta.enginesTried,
              ...(frozenLayout ? ["statement-layout.three-part"] : []),
            ],
          },
          aiValidated: ai.validated,
          aiScoreHint: ai.scoreHint,
          findings: [...parserFindings, ...layoutFindings, ...ai.findings],
          parser: parserMeta,
          layout: frozenLayout,
        });
        next = setStep(next, "ai", "done");
      } catch {
        next = setStep(next, "ai", "skipped");
        toast.message("AI review unavailable", {
          description: "Showing heuristic categories and local completeness scoring.",
        });
        extraction = buildExtractionResult({
          fileName: file.name,
          pageCount: frozenLayout?.pageCount || pageCount,
          rawText,
          transactions: txns,
          hybrid: {
            lineParserCount: txns.length,
            recoveredContinuationLines: 0,
            aiValidated: false,
            enginesTried: [
              ...parserMeta.enginesTried,
              ...(frozenLayout ? ["statement-layout.three-part"] : []),
            ],
          },
          aiValidated: false,
          parser: parserMeta,
          findings: extraction.findings,
          layout: frozenLayout,
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
      const layoutNote = frozenLayout
        ? ` · layout ${frozenLayout.score}/100 (${frozenLayout.documentClass}/${frozenLayout.txnStructure.bankId})`
        : "";
      toast.success("Parse + layout + AI validate complete", {
        description: `${extraction.summary.transactionCount} txns${parserNote}${tpl}${layoutNote} · score ${extraction.completenessScore.overall.toFixed(0)}/100 (${extraction.completenessScore.grade})`,
      });
      setAuditLog((prev) =>
        appendAuditEvent(prev, "parse.complete", `Parsed ${extraction.summary.transactionCount} transactions via ${parserMeta.label}`, {
          actor: "system",
          payload: {
            parserId: parserMeta.id,
            count: extraction.summary.transactionCount,
            completeness: extraction.completenessScore.overall,
            layout: frozenLayout
              ? summarizeLayoutAnalysis(frozenLayout)
              : null,
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

  /**
   * Apply Additional tools / generator ledger into workspace so Balance Out
   * Preview, compare, and table all see the new values immediately.
   */
  const applyReplacedLedger = useCallback(
    (txns: Transaction[], label: string) => {
      setUndoState((s) =>
        pushSnapshot(s, label, transactions, workflowStep),
      );
      const baseline =
        sourceBaseline.length > 0
          ? sourceBaseline
          : transactions.map((t) => ({ ...t }));
      if (sourceBaseline.length === 0 && transactions.length > 0) {
        setSourceBaseline(transactions.map((t) => ({ ...t })));
      }

      // Pin originals to pre-replace / parse baseline so dirty + balance preview track replacements
      let next = withSourceOriginals(txns, baseline);

      // When amounts changed (full generator), re-sync running balances from opening
      const amountsChanged = next.some((t, i) => {
        const b = baseline[i];
        if (!b) return true;
        return (
          t.debit !== b.debit ||
          t.credit !== b.credit ||
          t.balance !== b.balance
        );
      });
      if (amountsChanged && next.length > 0) {
        // Prefer generator chain: derive opening from first row (balance − movement)
        let opening =
          inferOpeningBalance(next) ??
          inferOpeningBalance(baseline) ??
          0;
        const expected = recomputeBalances(next, opening);
        next = next.map((t, i) => ({
          ...t,
          balance: expected[i] ?? t.balance,
        }));
        setBalanceEngine("recompute");
      }

      setTransactions(next);
      setResult((r) =>
        r
          ? {
              ...r,
              transactions: next,
              summary: buildSummary(next),
            }
          : r,
      );
      setViewMode("compare");
      setRenderResult(null);
      setMathResult(null);
      setPixelReport(null);
      // Keep previous candidate until live rematerialize finishes (do not clear)
      setAuditLog((log) =>
        appendAuditEvent(log, "note", label, {
          actor: "user",
          payload: {
            count: next.length,
            dirty: next.filter((t) => t.flags.includes("replaced")).length,
          },
        }),
      );
      autosaveRef.current?.touch();
      toast.success(label, {
        description: `${next.length} transactions · balance + PDF preview update live`,
      });
    },
    [transactions, workflowStep, sourceBaseline],
  );

  /**
   * Rebuild regenerated PDF via OEM Perfect Replica (auto workflow):
   * three-part layout + bank structure fidelity + perfect replacement / layered fill.
   */
  const rebuildLiveCandidatePdf = useCallback(async () => {
    if (!pdfBytes || pdfBytes.byteLength < 50) {
      setEditedPdfBytes(null);
      setLiveMaterializeMode(null);
      setLiveMaterializeEdits(0);
      setLiveMaterializeNotes([]);
      return;
    }
    const seq = ++liveMaterializeSeq.current;
    setLiveMaterializing(true);
    try {
      const safeEdits = pdfEdits.filter(
        (e) => String(e.replacement ?? "").trim().length > 0,
      );
      const oem = await runOemPerfectReplica({
        sourcePdf: pdfBytes,
        sourceBaseline:
          sourceBaseline.length > 0 ? sourceBaseline : transactions,
        current: transactions,
        queuedEdits: safeEdits,
        rawText: result?.rawText,
        fileName: result?.fileName ?? activeFileName,
        maxPages: 40,
        minDescriptionCoverage: 0.4,
        preserveTxnStructure: true,
        strict: false,
        layout: layoutProfile ?? result?.layout ?? null,
      });
      if (seq !== liveMaterializeSeq.current) return;
      setEditedPdfBytes(oem.editCount === 0 ? null : oem.candidatePdf);
      setLiveMaterializeMode(
        `oem:${oem.path}:${oem.summary.documentClass}:score${oem.score}`,
      );
      setLiveMaterializeEdits(oem.editCount);
      setLiveMaterializeNotes([
        `OEM ${oem.path} · bank=${oem.summary.bankId ?? "?"} · ${oem.durationMs}ms`,
        ...oem.notes.slice(-3),
        ...oem.gates.map((g) => `${g.pass ? "✓" : "✗"} ${g.id}: ${g.detail}`),
      ]);
    } catch (err) {
      if (seq !== liveMaterializeSeq.current) return;
      // Soft fallback: perfect replacement alone, then classic materialize
      try {
        const perfect = await runPerfectReplacement({
          sourcePdf: pdfBytes,
          sourceBaseline:
            sourceBaseline.length > 0 ? sourceBaseline : transactions,
          current: transactions,
          queuedEdits: pdfEdits.filter(
            (e) => String(e.replacement ?? "").trim().length > 0,
          ),
          rawText: result?.rawText,
          maxPages: 40,
          minDescriptionCoverage: 0.4,
          strict: false,
        });
        if (seq !== liveMaterializeSeq.current) return;
        setEditedPdfBytes(
          perfect.editCount === 0 ? null : perfect.candidatePdf,
        );
        setLiveMaterializeMode(
          `fallback-pr:${perfect.strategy}:score${perfect.score}`,
        );
        setLiveMaterializeEdits(perfect.editCount);
        setLiveMaterializeNotes([
          `OEM failed → perfect replacement: ${err instanceof Error ? err.message : String(err)}`,
          ...perfect.notes.slice(-2),
        ]);
      } catch {
        try {
          const material = await materializeCandidatePdf({
            originalPdf: pdfBytes,
            pdfEdits: pdfEdits.filter(
              (e) => String(e.replacement ?? "").trim().length > 0,
            ),
            sourceBaseline:
              sourceBaseline.length > 0 ? sourceBaseline : transactions,
            current: transactions,
            maxPages: 40,
          });
          if (seq !== liveMaterializeSeq.current) return;
          setEditedPdfBytes(
            material.mode === "identity" ? null : material.candidatePdf,
          );
          setLiveMaterializeMode(`fallback:${material.mode}`);
          setLiveMaterializeEdits(material.editCount);
          setLiveMaterializeNotes([
            `OEM/PR failed → materialize: ${err instanceof Error ? err.message : String(err)}`,
            ...material.notes.slice(-2),
          ]);
        } catch (err2) {
          setLiveMaterializeNotes([
            `Live rematerialize failed: ${err2 instanceof Error ? err2.message : String(err2)}`,
          ]);
        }
      }
    } finally {
      if (seq === liveMaterializeSeq.current) {
        setLiveMaterializing(false);
      }
    }
  }, [
    pdfBytes,
    pdfEdits,
    sourceBaseline,
    transactions,
    result?.rawText,
    result?.fileName,
    result?.layout,
    layoutProfile,
    activeFileName,
  ]);

  // Fingerprint of inputs that should refresh the regenerated PDF preview.
  // Hash-style: length + head/mid/tail so mid-ledger edits still invalidate.
  const livePdfFingerprint = useMemo(() => {
    const ledger = transactions
      .map(
        (t) =>
          `${t.id}|${t.date}|${t.description}|${t.debit}|${t.credit}|${t.balance}`,
      )
      .join(";");
    const mid = Math.floor(ledger.length / 2);
    const ledgerKey = `${ledger.length}:${ledger.slice(0, 800)}|${ledger.slice(mid, mid + 400)}|${ledger.slice(-800)}`;
    const edits = pdfEdits
      .map((e) => `${e.page}:${e.runId}:${e.replacement.slice(0, 40)}`)
      .join(";");
    const editsKey = `${edits.length}:${edits.slice(0, 600)}|${edits.slice(-400)}`;
    return `${pdfBytes?.byteLength ?? 0}#${ledgerKey}#${editsKey}`;
  }, [pdfBytes, transactions, pdfEdits]);

  // Debounced live rematerialize after any step changes ledger / edits
  useEffect(() => {
    if (!pdfBytes) return;
    const hasWork =
      pdfEdits.some((e) => String(e.replacement ?? "").trim().length > 0) ||
      (sourceBaseline.length > 0 &&
        (transactions.length !== sourceBaseline.length ||
          transactions.some((t, i) => {
            const o = sourceBaseline[i];
            if (!o) return true;
            return (
              t.date !== o.date ||
              t.description !== o.description ||
              t.debit !== o.debit ||
              t.credit !== o.credit ||
              t.balance !== o.balance
            );
          })));
    if (!hasWork) {
      setEditedPdfBytes(null);
      setLiveMaterializeMode("identity");
      setLiveMaterializeEdits(0);
      setLiveMaterializeNotes([
        "No ledger/PDF delta yet — original shown until you edit or replace.",
      ]);
      return;
    }
    const t = window.setTimeout(() => {
      void rebuildLiveCandidatePdf();
    }, 450);
    return () => window.clearTimeout(t);
    // fingerprint captures ledger/edits/pdf; rebuild uses latest closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePdfFingerprint, pdfBytes, rebuildLiveCandidatePdf]);

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
      let candidate: Uint8Array;
      let injectionMeta: Partial<InjectionAuditSection> & {
        strategy?: string;
        documentClass?: string;
        score?: number;
        editCount?: number;
        notes?: string[];
        gates?: Array<{ id: string; pass: boolean; detail: string }>;
        coverage?: InjectionAuditSection["coverage"];
      };

      // Prefer already-built live candidate when available (avoids double write crash)
      if (
        editedPdfBytes &&
        editedPdfBytes.byteLength > 100 &&
        liveMaterializeMode &&
        liveMaterializeMode !== "identity" &&
        !liveMaterializing
      ) {
        candidate = editedPdfBytes;
        const modeParts = liveMaterializeMode.split(":");
        injectionMeta = {
          strategy: modeParts[0] ?? liveMaterializeMode,
          documentClass: modeParts[1] ?? null,
          score: (() => {
            const m = liveMaterializeMode.match(/score(\d+)/);
            return m ? Number(m[1]) : null;
          })(),
          editCount: liveMaterializeEdits,
          notes: liveMaterializeNotes,
          gates: [],
          coverage: null,
        };
      } else {
        // OEM Perfect Replica: frozen upload layout + structure + write engines
        const oem = await runOemPerfectReplica({
          sourcePdf: pdfBytes,
          sourceBaseline:
            sourceBaseline.length > 0 ? sourceBaseline : transactions,
          current: transactions,
          queuedEdits: pdfEdits.filter(
            (e) => String(e.replacement ?? "").trim().length > 0,
          ),
          rawText: result?.rawText,
          fileName: result?.fileName ?? activeFileName,
          maxPages: 40,
          minDescriptionCoverage: 0.35,
          preserveTxnStructure: true,
          strict: false,
          layout: layoutProfile ?? result?.layout ?? null,
        });
        if (oem.editCount === 0) {
          toast.message("Could not produce OEM replica injections", {
            description:
              oem.notes.slice(-3).join(" · ") ||
              "No geometry matched. Try bank-desc replace or St George template fill.",
          });
          return;
        }
        if (oem.appliedEdits.length > 0) {
          setPdfEdits(oem.appliedEdits);
        }
        setEditedPdfBytes(oem.candidatePdf);
        setLiveMaterializeMode(
          `oem:${oem.path}:${oem.summary.documentClass}:score${oem.score}`,
        );
        setLiveMaterializeEdits(oem.editCount);
        setLiveMaterializeNotes(oem.notes.slice(-4));
        candidate = oem.candidatePdf;
        const cov = oem.perfect?.coverage;
        injectionMeta = {
          strategy: `oem:${oem.path}`,
          documentClass: oem.summary.documentClass,
          score: oem.score,
          editCount: oem.editCount,
          notes: oem.notes,
          gates: oem.gates,
          coverage: cov
            ? {
                description: cov.description,
                balance: cov.balance,
                date: cov.date,
              }
            : null,
        };
      }

      // Hard gates: never export empty / non-PDF / identity when delta expected
      if (!candidate || candidate.byteLength < 100) {
        throw new Error("Replica PDF is empty or too small to export");
      }
      const head = String.fromCharCode(
        candidate[0] ?? 0,
        candidate[1] ?? 0,
        candidate[2] ?? 0,
        candidate[3] ?? 0,
      );
      if (head !== "%PDF") {
        throw new Error(
          `Replica bytes are not a PDF (header=${JSON.stringify(head)})`,
        );
      }
      if (
        hasGenerationDelta &&
        (injectionMeta.editCount ?? 0) === 0 &&
        candidate.byteLength === pdfBytes.byteLength
      ) {
        throw new Error(
          "Generation delta exists but 0 injections landed — refusing identity export",
        );
      }

      const report = buildMergedAuditReport({
        fileName: activeFileName || "statement.pdf",
        thresholds,
        auditLog,
        changeHistory,
        pixelReport,
        mathResult,
        transactionCount: transactions.length,
        dirtyCount,
        injection: injectionMeta,
      });

      const withAudit = await appendAuditPageToPdf(
        candidate,
        report,
        {
          strategy: injectionMeta.strategy ?? undefined,
          documentClass: injectionMeta.documentClass ?? undefined,
          score: injectionMeta.score ?? undefined,
          editCount: injectionMeta.editCount,
          notes: injectionMeta.notes,
          gates: injectionMeta.gates,
          coverage: injectionMeta.coverage
            ? {
                description: injectionMeta.coverage.description,
                balance: injectionMeta.coverage.balance,
              }
            : undefined,
        },
      );

      const base = activeFileName.replace(/\.pdf$/i, "") || "statement";
      downloadBytes(
        `${base}-regenerated.pdf`,
        withAudit.pdf,
        "application/pdf",
      );
      // Stagger JSON so browsers do not collapse the second download
      window.setTimeout(() => downloadMergedReport(report), 250);
      setExportedOnce(true);
      setAuditLog((log) =>
        appendAuditEvent(
          log,
          "export",
          `Final replica PDF + audit report (${injectionMeta.editCount ?? 0} edits; audit page ${withAudit.appended ? "on" : "off"})`,
          {
            actor: "user",
            payload: {
              editCount: injectionMeta.editCount,
              strategy: injectionMeta.strategy,
              score: injectionMeta.score,
              auditPage: withAudit.appended,
              auditNote: withAudit.note,
            },
          },
        ),
      );

      toast.success("OEM replica exported", {
        description:
          `${injectionMeta.editCount ?? 0} injection(s) · score ${injectionMeta.score ?? "—"}/100 · ` +
          `${withAudit.note} · JSON audit downloaded`,
      });
    } catch (err) {
      toast.error("PDF export failed", {
        description: safeErrorMessage(err),
      });
    }
  }, [
    pdfBytes,
    pdfEdits,
    sourceBaseline,
    transactions,
    activeFileName,
    hasGenerationDelta,
    editedPdfBytes,
    liveMaterializeMode,
    liveMaterializeEdits,
    liveMaterializeNotes,
    liveMaterializing,
    result?.rawText,
    result?.layout,
    layoutProfile,
    thresholds,
    auditLog,
    changeHistory,
    pixelReport,
    mathResult,
    dirtyCount,
  ]);

  const handleConfirmRender = useCallback(async () => {
    // Balance cascade first (hybrid/recompute/stated)
    const rendered = applyRenderWithFallbacks(transactions, renderEngine);

    // Prefer MuPDF for PDF probe (write-capable); fall back to Pdfium/PDF.js
    let pdfEngineMeta: RenderResult["pdfEngine"];
    if (pdfBytes) {
      try {
        const loaded = await loadPdfWithFallbacks(
          cloneUint8Array(pdfBytes),
          "pdfium",
        );
        pdfEngineMeta = {
          engineUsed: loaded.engineUsed,
          enginesTried: loaded.enginesTried,
          fallbackUsed: loaded.fallbackUsed,
          pageCount: loaded.document.pageCount,
        };
        loaded.document.destroy();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "PDF engine probe failed";
        toast.message("PDF engines unavailable", { description: message });
      }
    }

    const full: RenderResult = {
      ...rendered,
      pdfEngine: pdfEngineMeta,
      summary: pdfEngineMeta
        ? `${rendered.summary} PDF load probe: ${pdfEngineMeta.engineUsed}${
            pdfEngineMeta.fallbackUsed
              ? ` (fallback via ${pdfEngineMeta.enginesTried.join("→")})`
              : " (primary)"
          }. Export final PDF writes via PDFium (write engine of record).`
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

    // Kick live OEM rematerialize so balance changes hit the candidate PDF
    if (pdfBytes && full.rowsUpdated > 0) {
      window.setTimeout(() => {
        void rebuildLiveCandidatePdf();
      }, 100);
    }

    toast.success(
      full.rowsUpdated > 0
        ? `Render applied — ${full.rowsUpdated} balance(s) updated`
        : "Render applied — balances already consistent",
      { description: full.summary },
    );
    unlockThrough("render");
    return full;
  }, [
    transactions,
    renderEngine,
    unlockThrough,
    pdfBytes,
    rebuildLiveCandidatePdf,
  ]);

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
  const uiMode: UiMode = testLabMode ? "testlab" : "editor";

  const openBankDescTools = useCallback(() => {
    setRailOpen(true);
    setAdvancedOpen(true);
    setToolsTab("generator");
    toast.message("Additional tools · Generator", {
      description:
        "Replace original descriptions with bank generators + font link — step unchanged",
    });
  }, []);

  const testLabStages = useMemo(
    () =>
      buildTestStages({
        workflowStep,
        hasGenerated: hasGenerated || workflowStep === "generate",
        qualityOk: genQuality?.ok ?? null,
        qualityScore: genQuality?.score ?? null,
        applied: genApplied,
        pdfEdits: pdfEdits.length,
        hasPdf: Boolean(pdfBytes),
        mathOk: mathResult
          ? mathResult.status === "pass" || (mathResult.score ?? 0) >= 70
          : null,
        visualOk: pixelReport
          ? pixelReport.pixelStatus === "pass" || pixelReport.pixelScore >= 90
          : null,
        forensicsOk: forensicsReport
          ? forensicsReport.verdict === "pass"
          : null,
        exported: exportedOnce,
      }),
    [
      workflowStep,
      hasGenerated,
      genQuality,
      genApplied,
      pdfEdits.length,
      pdfBytes,
      mathResult,
      pixelReport,
      forensicsReport,
      exportedOnce,
    ],
  );

  const handleTestLabJump = useCallback(
    (id: TestStageId, step?: WorkflowStep) => {
      if (step) goToStep(step);
      if (id === "replace") openBankDescTools();
    },
    [goToStep, openBankDescTools],
  );

  const handleRunStress = useCallback(() => {
    setStressRunning(true);
    setStressSummary(null);
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
          toast.success("Stress suite perfect", { description: msg });
        } else {
          toast.error("Stress suite failures", { description: msg });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stress failed";
        setStressSummary(message);
        toast.error("Stress suite error", { description: message });
      } finally {
        setStressRunning(false);
      }
    }, 30);
  }, []);

  const stagePrimaryLabel = useMemo(() => {
    switch (workflowStep) {
      case "edit":
        return "Continue to Balance";
      case "balance":
        return "Continue to Render";
      case "render":
        return "Confirm & apply balances";
      case "visual":
        return pixelReport ? "Continue to Math" : "Run pixel check";
      case "math":
        return mathResult ? "Continue to Generate" : "Run math check";
      case "generate":
        return genApplied
          ? "Continue to Forensics"
          : "Apply generated statement";
      case "fidelity":
        return forensicsReport ? "Continue to Complete" : "Run forensics";
      case "complete":
        return canExportFinalPdf ? "Export final PDF" : "Export CSV";
      default:
        return "Continue";
    }
  }, [
    workflowStep,
    pixelReport,
    mathResult,
    forensicsReport,
    genApplied,
    canExportFinalPdf,
  ]);

  const handleStagePrimary = useCallback(() => {
    if (workflowStep === "complete") {
      if (canExportFinalPdf) {
        void handleExportPdf();
        setExportedOnce(true);
        return;
      }
      if (result) {
        exportCsv(
          { ...result, summary: liveSummary, transactions },
          transactions,
          includeNotes,
        );
        setExportedOnce(true);
        toast.success("CSV downloaded");
      }
      return;
    }
    if (workflowStep === "generate") {
      if (genApplied) {
        advance();
        return;
      }
      void generatorRef.current?.apply(false);
      return;
    }
    if (workflowStep === "visual" && !pixelReport) {
      void handlePixelCheck();
      return;
    }
    if (workflowStep === "math" && !mathResult) {
      handleMathCheck();
      return;
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
  }, [
    workflowStep,
    pixelReport,
    mathResult,
    renderResult,
    forensicsReport,
    genApplied,
    canExportFinalPdf,
    handleExportPdf,
    handlePixelCheck,
    handleMathCheck,
    handleConfirmRender,
    handleForensics,
    advance,
    result,
    liveSummary,
    transactions,
    includeNotes,
  ]);

  const gateChips = useMemo(() => {
    const chips: Partial<Record<WorkflowStep, string>> = {};
    if (dirtyCount > 0) chips.edit = `${dirtyCount} dirty`;
    if (balancePreview.mismatchCount > 0) {
      chips.balance = `${balancePreview.mismatchCount} mismatch`;
    }
    if (renderResult) chips.render = renderResult.engineUsed;
    if (pixelReport) {
      chips.visual = `${pixelReport.pixelStatus} ${pixelReport.pixelScore}`;
    }
    if (mathResult) chips.math = `${mathResult.status} ${mathResult.score}`;
    if (genApplied) chips.generate = "applied";
    else if (hasGenerated) chips.generate = "generated";
    if (forensicsReport) {
      chips.fidelity = `${forensicsReport.verdict} ${forensicsReport.overallScore}`;
    }
    if (exportedOnce) chips.complete = "exported";
    return chips;
  }, [
    dirtyCount,
    balancePreview.mismatchCount,
    renderResult,
    pixelReport,
    mathResult,
    genApplied,
    hasGenerated,
    forensicsReport,
    exportedOnce,
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader
        subtitle={
          result
            ? `${result.fileName} · ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} · ${workflowStep}`
            : undefined
        }
        apiStatus={apiStatus}
        showModeSwitch={phase === "workspace" && Boolean(result)}
        uiMode={uiMode}
        onUiModeChange={(mode) => {
          setTestLabMode(mode === "testlab");
          if (mode === "testlab") {
            toast.message("Test Lab mode", {
              description:
                "Checklist primary — jump stages or run stress suite in the rail",
            });
          }
        }}
        engineTag={activeEngine}
        engineMode={engineMode}
      />

      <main className="flex-1 mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6 sm:py-8">
        {phase === "upload" && (
          <div className="space-y-6">
            <div className="text-center space-y-2 max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Exact replica · logic generator injection · {AI_MODEL_ID}
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                Bank Statement Fidelity Editor
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Load a source statement, inject generated data via intelligent logic
                engines, and export a pixel-perfect visual and mathematical replica.
                Or start <strong>Test Lab</strong> for synthetic generation without a source file.
              </p>
            </div>

            {/* Test Lab entry — compact single row */}
            <div className="max-w-2xl mx-auto w-full flex flex-wrap items-center justify-between gap-2 rounded-full border border-primary/25 bg-primary/8 px-2 py-1.5 pl-3 shadow-sm">
              <div className="flex items-center gap-2 min-w-0 text-[11px] text-muted-foreground">
                <FlaskConical className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="font-semibold text-foreground text-xs">Test Lab</span>
                <span className="hidden sm:inline truncate">
                  generate · apply · replace · verify
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 shrink-0">
                <Button size="sm" className="rounded-full h-7 text-[11px] px-3" onClick={startTestLab}>
                  Start (no PDF)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full h-7 text-[11px] px-3"
                  onClick={() => {
                    setTestLabMode(true);
                    toast.message("Upload a PDF to begin Test Lab with geometry", {
                      description:
                        "After parse, jump to Generate for cfg + bank replace",
                    });
                  }}
                >
                  + PDF
                </Button>
              </div>
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

            <p className="max-w-2xl mx-auto text-center text-[11px] text-muted-foreground">
              Required parse: LlamaParse <strong>or</strong> Google Document AI · Write engine:{" "}
              <strong>PDFium</strong> · Pipeline: cloud parse → inject → balance → OEM rewrite →
              export final PDF + audit
            </p>
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
          <div className="space-y-4">
            {/* Pipeline status strip — always visible; Test Lab is a compact hover chip */}
            <div className="flex flex-wrap items-center gap-1.5 stage-shell px-3 py-2">
              <span className="pipeline-chip pipeline-chip-active max-w-[14rem] truncate" title={result.fileName}>
                <FileText className="h-3 w-3 shrink-0" />
                {result.fileName}
              </span>
              <span className="pipeline-chip">
                Step · <span className="font-semibold text-foreground">{currentStepMeta?.short ?? workflowStep}</span>
              </span>
              {(testLabMode ||
                workflowStep === "generate" ||
                hasGenerated ||
                genApplied) && (
                <TestWorkflowPanel
                  variant="compact"
                  expandOn="hover"
                  align="end"
                  stages={testLabStages}
                  onJump={handleTestLabJump}
                  stressRunning={stressRunning}
                  stressSummary={stressSummary}
                  onRunStress={handleRunStress}
                />
              )}
              {pdfBytes && (
                <span
                  className={cn(
                    "pipeline-chip",
                    pdfEdits.length > 0 && "pipeline-chip-active",
                  )}
                >
                  pdfEdits · <span className="font-mono font-semibold text-foreground">{pdfEdits.length}</span>
                </span>
              )}
              <span
                className={cn(
                  "pipeline-chip",
                  hasGenerationDelta ? "pipeline-chip-warn" : "pipeline-chip-pass",
                )}
                title={
                  hasGenerationDelta
                    ? "Working ledger differs from source — final PDF will rewrite matched text"
                    : "No ledger delta vs source baseline"
                }
              >
                {hasGenerationDelta ? "delta · yes" : "delta · identity"}
              </span>
              {renderResult && (
                <span className="pipeline-chip font-mono">
                  materialize · {renderResult.engineUsed}
                </span>
              )}
              {canExportFinalPdf ? (
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full h-7 text-[11px] ml-auto"
                  onClick={() => {
                    void handleExportPdf();
                    setExportedOnce(true);
                  }}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Export final PDF
                  {pdfEdits.length > 0
                    ? ` (${pdfEdits.length})`
                    : hasGenerationDelta
                      ? " (all data)"
                      : ""}
                </Button>
              ) : !pdfBytes ? (
                <span
                  className="pipeline-chip ml-auto"
                  title="Upload a source PDF to materialize and export a regenerated final PDF"
                >
                  Final PDF · needs source PDF
                </span>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-full h-7 text-[11px] text-muted-foreground"
                onClick={() => setRailOpen((v) => !v)}
                aria-pressed={railOpen}
                title={railOpen ? "Hide context rail" : "Show context rail"}
              >
                {railOpen ? (
                  <PanelRightClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelRight className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">{railOpen ? "Hide rail" : "Show rail"}</span>
              </Button>
            </div>

            {/* Stage nav — always stepper; Test Lab is compact chip in pipeline strip */}
            <div className="stage-shell p-3 sm:p-4 space-y-3">
              <WorkflowStepper
                current={workflowStep}
                unlocked={unlocked}
                gateChips={gateChips}
                onStepClick={(s) => {
                  if (
                    unlocked.includes(s) ||
                    STEP_ORDER.indexOf(s) <= STEP_ORDER.indexOf(workflowStep)
                  ) {
                    setWorkflowStep(s);
                  }
                }}
              />
              {currentStepMeta && (
                <div className="flex flex-wrap items-start justify-between gap-2 border-t border-border/50 pt-3 px-0.5">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold tracking-tight leading-tight">
                      {currentStepMeta.label}
                    </h2>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed max-w-2xl">
                      {currentStepMeta.description}
                    </p>
                  </div>
                  {gateChips[workflowStep] && (
                    <span className="pipeline-chip pipeline-chip-active shrink-0">
                      {gateChips[workflowStep]}
                    </span>
                  )}
                </div>
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

            <div
              className={cn(
                "grid gap-4",
                railOpen
                  ? "lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]"
                  : "grid-cols-1",
              )}
            >
              {/* MAIN: compare is hero; money strip is secondary */}
              <div className="stage-shell min-w-0 flex flex-col overflow-hidden">
                <div className="space-y-3 p-3 sm:p-4 flex-1 min-w-0">
                  {workflowStep !== "generate" && (
                    <SummaryCards
                      summary={liveSummary}
                      limited={result.limitedExtraction}
                      variant="compact"
                    />
                  )}

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
                      ref={generatorRef}
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
                        if (extras?.pdfEdits?.length) {
                          setPdfEdits((prev) => [
                            ...prev,
                            ...extras.pdfEdits!.filter(
                              (e) => e.replacement.trim().length > 0,
                            ),
                          ]);
                        }
                        setGenApplied(true);
                        setWorkspaceLedgerOpen(false);
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
                          } · open Workspace ledger below if needed`,
                        });
                        unlockThrough("generate");
                      }}
                      onAppliedAndContinue={() => {
                        setTestLabMode(true);
                        if (pdfBytes) {
                          openBankDescTools();
                        } else {
                          goToStep("math");
                          toast.message("Next: Final math check", {
                            description:
                              "Upload a PDF later for visual/pixel & bank-desc replace",
                          });
                        }
                      }}
                      onBankReplaceRequest={openBankDescTools}
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
                      <h3 className="text-sm font-semibold">Export hub</h3>
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

                  {/* Data surface: hidden on Generate until applied + expanded */}
                  {workflowStep === "generate" ? (
                    genApplied ? (
                      <Collapsible
                        open={workspaceLedgerOpen}
                        onOpenChange={setWorkspaceLedgerOpen}
                      >
                        <div className="rounded-xl border border-border/60 bg-muted/20">
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                            >
                              <span className="text-sm font-semibold">
                                Workspace ledger
                              </span>
                              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                {transactions.length} rows · compare after apply
                                <ChevronDown
                                  className={cn(
                                    "h-4 w-4 transition-transform",
                                    workspaceLedgerOpen && "rotate-180",
                                  )}
                                />
                              </span>
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="border-t border-border/50 p-3 space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  variant={
                                    viewMode === "table" ? "default" : "outline"
                                  }
                                  size="sm"
                                  className="rounded-full h-8"
                                  onClick={() => setViewMode("table")}
                                >
                                  <Table className="h-3.5 w-3.5" />
                                  Table
                                </Button>
                                <Button
                                  type="button"
                                  variant={
                                    viewMode === "compare"
                                      ? "default"
                                      : "outline"
                                  }
                                  size="sm"
                                  className="rounded-full h-8"
                                  onClick={() => setViewMode("compare")}
                                  disabled={sourceBaseline.length === 0}
                                >
                                  <ArrowLeftRight className="h-3.5 w-3.5" />
                                  Compare
                                </Button>
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
                              ) : (
                                <TransactionTable
                                  transactions={filtered}
                                  sortKey={sortKey}
                                  sortDir={sortDir}
                                  onSort={onSort}
                                  onCategoryChange={onCategoryChange}
                                  onTransactionChange={patchTransaction}
                                  highlightId={highlightId}
                                  editable={false}
                                  readOnly
                                />
                              )}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    ) : (
                      <p className="text-[11px] text-muted-foreground px-0.5">
                        Apply generated statement to update the workspace ledger.
                        Table / compare stay collapsed so this step stays one primary surface.
                      </p>
                    )
                  ) : (
                    <>
                      {/* View mode: Compare is primary; table/PDF secondary */}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant={
                            viewMode === "compare" ? "default" : "outline"
                          }
                          size="sm"
                          className="rounded-full h-8"
                          onClick={() => setViewMode("compare")}
                          disabled={sourceBaseline.length === 0}
                          title={
                            sourceBaseline.length === 0
                              ? "Parse a statement to freeze the original baseline"
                              : "Live original vs current generation"
                          }
                        >
                          <ArrowLeftRight className="h-3.5 w-3.5" />
                          Live compare
                          {sourceBaseline.length > 0 && (
                            <span className="ml-1 text-[10px] opacity-80">
                              primary
                            </span>
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant={viewMode === "table" ? "default" : "outline"}
                          size="sm"
                          className="rounded-full h-8"
                          onClick={() => setViewMode("table")}
                        >
                          <Table className="h-3.5 w-3.5" />
                          Table
                        </Button>
                        {pdfBytes && (
                          <Button
                            type="button"
                            variant={
                              viewMode === "pdf" ? "default" : "outline"
                            }
                            size="sm"
                            className="rounded-full h-8"
                            onClick={() => setViewMode("pdf")}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            PDF
                            {editedPdfBytes ? " · live regen" : ""}
                          </Button>
                        )}
                        {viewMode === "pdf" && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            Source + edit overlays · full regen panel below
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
                      ) : viewMode === "pdf" && pdfBytes ? (
                        <PdfDocumentViewer
                          /* Source + overlay queue for click-edit; full regen is in panel below */
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
                            workflowStep === "edit" ||
                            workflowStep === "balance"
                          }
                          readOnly={
                            workflowStep === "visual" ||
                            workflowStep === "math" ||
                            workflowStep === "fidelity" ||
                            workflowStep === "complete"
                          }
                          mismatchIds={
                            workflowStep === "balance" ||
                            workflowStep === "render"
                              ? mismatchIds
                              : undefined
                          }
                          expectedBalances={
                            workflowStep === "balance" ||
                            workflowStep === "render"
                              ? expectedBalances
                              : undefined
                          }
                        />
                      )}
                    </>
                  )}

                  {/* Live regenerated PDF — rebuilds after every step with updates */}
                  {pdfBytes && (
                    <RegeneratedPdfPreview
                      candidatePdf={editedPdfBytes}
                      originalPdf={pdfBytes}
                      pageCountHint={result.pageCount}
                      materializing={liveMaterializing}
                      materializeMode={liveMaterializeMode}
                      editCount={liveMaterializeEdits}
                      notes={liveMaterializeNotes}
                      onRefresh={() => void rebuildLiveCandidatePdf()}
                    />
                  )}
                </div>

                {/* Sticky stage action bar */}
                <div className="stage-action-bar">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={workflowStep === "edit"}
                    onClick={back}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Back
                  </Button>
                  <div className="flex flex-wrap items-center gap-2">
                    {workflowStep === "render" && !renderResult && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-full"
                        onClick={advance}
                      >
                        Skip ahead
                      </Button>
                    )}
                    {workflowStep === "math" && mathResult && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-full"
                        onClick={handleMathCheck}
                      >
                        Re-run math
                      </Button>
                    )}
                    {workflowStep === "visual" && pixelReport && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-full"
                        onClick={() => void handlePixelCheck()}
                      >
                        Re-run pixel
                      </Button>
                    )}
                    {workflowStep === "complete" && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="rounded-full"
                          onClick={() => {
                            exportJson(
                              {
                                ...result,
                                summary: liveSummary,
                                transactions,
                              },
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
                            variant="secondary"
                            size="sm"
                            className="rounded-full"
                            onClick={() => {
                              exportCsv(
                                {
                                  ...result,
                                  summary: liveSummary,
                                  transactions,
                                },
                                transactions,
                                includeNotes,
                              );
                              setExportedOnce(true);
                              toast.success("CSV downloaded");
                            }}
                          >
                            Export CSV
                          </Button>
                        )}
                      </>
                    )}
                    {workflowStep === "generate" && genApplied && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-full"
                        onClick={() => void generatorRef.current?.apply(false)}
                      >
                        Re-apply
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="rounded-full"
                      onClick={handleStagePrimary}
                    >
                      {stagePrimaryLabel}
                      {workflowStep !== "complete" &&
                        !(workflowStep === "generate" && !genApplied) && (
                          <ChevronRight className="ml-1 h-4 w-4" />
                        )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* CONTEXT RAIL — collapsible */}
              {railOpen && (
                <aside className="space-y-3 lg:sticky lg:top-16 lg:self-start max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
                  {/* Primary: Advanced tools */}
                  <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <div className="rounded-2xl border border-primary/25 bg-card shadow-md overflow-hidden ring-1 ring-primary/10">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left hover:bg-primary/5 transition-colors border-b border-border/40"
                        >
                          <div className="min-w-0">
                            <span className="text-sm font-semibold tracking-tight">
                              Advanced tools
                            </span>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Generator · bank-desc · dates · fonts · Doc AI · geometry · remote
                            </p>
                          </div>
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
                              advancedOpen && "rotate-180",
                            )}
                          />
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div>
                          {/* compact: outer "Advanced tools" header already shown — avoid double title */}
                          <AdditionalToolsPanel
                            compact
                            transactions={transactions}
                            pdfBytes={pdfBytes}
                            fileName={result.fileName}
                            rawText={result.rawText}
                            engineMode={engineMode}
                            activeTab={toolsTab}
                            onActiveTabChange={setToolsTab}
                            onEngineModeChange={(m) => {
                              setEngineMode(m);
                              saveEngineMode(m);
                            }}
                            onReplaceTransactions={(txns, label) => {
                              applyReplacedLedger(txns, label);
                            }}
                            onAddPdfEdits={(edits) => {
                              // NEVER REDACT: only queue edits with real replacement text
                              const safe = edits.filter(
                                (e) => String(e.replacement ?? "").trim().length > 0,
                              );
                              if (!safe.length) {
                                toast.message("No text replacements to queue", {
                                  description:
                                    "Empty inserts refused (never redact without text)",
                                });
                                return;
                              }
                              setPdfEdits((prev) => [...prev, ...safe]);
                              toast.message("Font-replicated edits queued", {
                                description: `${safe.length} replacement(s) · never blank redaction`,
                              });
                            }}
                            onCandidatePdf={(pdf, meta) => {
                              // St George template fill: show filled shell immediately
                              setEditedPdfBytes(pdf);
                              setLiveMaterializeMode(meta.mode);
                              setLiveMaterializeEdits(meta.edits.length);
                              setLiveMaterializeNotes(meta.notes);
                              // Replace edit queue with template-slot edits only
                              // (don't mix statement-run geometry with template tokens)
                              const safe = meta.edits.filter(
                                (e) =>
                                  String(e.replacement ?? "").trim().length > 0,
                              );
                              setPdfEdits(safe);
                              toast.success("Template PDF ready", {
                                description:
                                  "Regenerated preview = St George template + your variables/transactions",
                              });
                            }}
                            onAudit={(_type, message) => {
                              setAuditLog((log) =>
                                appendAuditEvent(log, "note", message, {
                                  actor: "user",
                                }),
                              );
                            }}
                          />
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>

                  {/* Secondary meta — click headers to expand (closed by default) */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-0.5">
                      More details
                    </p>

                    {/* Completeness — compact toggle */}
                    <Collapsible
                      open={completenessOpen}
                      onOpenChange={setCompletenessOpen}
                    >
                      <div className="rounded-lg border border-border/60 bg-card/70 overflow-hidden">
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                          >
                            <span className="text-xs font-semibold">
                              Completeness
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span className="text-[10px] tabular-nums text-muted-foreground">
                                {result.completenessScore.score}
                                /100
                              </span>
                              <ChevronDown
                                className={cn(
                                  "h-3.5 w-3.5 text-muted-foreground transition-transform",
                                  completenessOpen && "rotate-180",
                                )}
                              />
                            </span>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="border-t border-border/50 p-2">
                            <CompletenessScoreCard
                              score={result.completenessScore}
                              compact
                            />
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>

                    {/* Document parser */}
                    {result.parser && (
                      <Collapsible open={parserOpen} onOpenChange={setParserOpen}>
                        <div className="rounded-lg border border-border/60 bg-card/70 overflow-hidden">
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                            >
                              <div className="min-w-0">
                                <span className="text-xs font-semibold">
                                  Document parser
                                </span>
                                {!parserOpen && (
                                  <p className="text-[10px] text-muted-foreground truncate">
                                    {result.parser.label}
                                  </p>
                                )}
                              </div>
                              <ChevronDown
                                className={cn(
                                  "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform",
                                  parserOpen && "rotate-180",
                                )}
                              />
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="border-t border-border/50 px-3 py-2.5 space-y-1 text-xs">
                              <p className="text-sm font-semibold">
                                {result.parser.label}
                              </p>
                              <p className="text-muted-foreground leading-relaxed">
                                {result.parser.durationMs}ms
                                {result.parser.fallbackUsed
                                  ? " · fallback used"
                                  : ""}
                                {result.parser.structuredFromApi
                                  ? " · structured API"
                                  : ""}
                                {result.parser.bankTemplateName
                                  ? ` · ${result.parser.bankTemplateName}`
                                  : ""}
                              </p>
                              {result.parser.enginesTried.length > 0 && (
                                <p className="text-[10px] text-muted-foreground break-all font-mono">
                                  {result.parser.enginesTried.join(" → ")}
                                </p>
                              )}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    )}

                    {/* Insights */}
                    <Collapsible open={insightsOpen} onOpenChange={setInsightsOpen}>
                      <div className="rounded-lg border border-border/60 bg-card/70 overflow-hidden">
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                          >
                            <div className="min-w-0">
                              <span className="text-xs font-semibold">
                                Insights
                              </span>
                              {!insightsOpen && (
                                <p className="text-[10px] text-muted-foreground">
                                  Charts · findings
                                </p>
                              )}
                            </div>
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform",
                                insightsOpen && "rotate-180",
                              )}
                            />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="border-t border-border/50 p-3 space-y-3">
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
                        </CollapsibleContent>
                      </div>
                    </Collapsible>

                    {/* Verification & audit */}
                    <Collapsible open={auditOpen} onOpenChange={setAuditOpen}>
                      <div className="rounded-lg border border-border/60 bg-card/70 overflow-hidden">
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                          >
                            <div className="min-w-0">
                              <span className="text-xs font-semibold">
                                Verification &amp; audit
                              </span>
                              {!auditOpen && (
                                <p className="text-[10px] text-muted-foreground tabular-nums">
                                  {auditLog.length} events
                                  {lastDraftSavedAt
                                    ? " · draft saved"
                                    : ""}
                                </p>
                              )}
                            </div>
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform",
                                auditOpen && "rotate-180",
                              )}
                            />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="border-t border-border/50">
                            <AuditPanel
                              auditLog={auditLog}
                              changeHistory={changeHistory}
                              mergedReport={mergedReport}
                              onDownloadDraft={() => void handleDownloadDraft()}
                              onDownloadReport={handleDownloadReport}
                              lastDraftSavedAt={lastDraftSavedAt}
                            />
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  </div>

                  {dirtyCount > 0 && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-950 dark:text-amber-100">
                      <strong>{dirtyCount}</strong> row(s) differ from the original
                      parse. Per-row revert is available on the Edit step.
                    </div>
                  )}
                </aside>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-border/60 py-3 text-center text-[11px] text-muted-foreground">
        Bank Statement Fidelity Editor · exact replica via logic generator injection ·
        Pdfium · SSIM · tile · pHash · forensics · Eyes optional
      </footer>
    </div>
  );
};

export default Index;
