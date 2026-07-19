import type { DocumentParserId } from "@/lib/parsers";
import type { Transaction, WorkflowStep } from "@/lib/types";
import type { VerificationThresholds } from "@/lib/verification/thresholds";
import type {
  AuditLogEntry,
  ChangeHistoryEntry,
  WorkflowDraft,
} from "./types";

export const DRAFT_PATH = "audit/workflow.json";
const STORAGE_KEY = "statement-lens.audit.workflow.json";
const AUTOSAVE_MS = 4000;

export interface DraftBuildInput {
  fileName: string;
  parserId: DocumentParserId | null;
  workflowStep: WorkflowStep;
  transactions: Transaction[];
  auditLog: AuditLogEntry[];
  changeHistory: ChangeHistoryEntry[];
  thresholds: VerificationThresholds;
  pixelReportSummary: WorkflowDraft["pixelReportSummary"];
  mathSummary: WorkflowDraft["mathSummary"];
  meta: WorkflowDraft["meta"];
}

export function buildWorkflowDraft(input: DraftBuildInput): WorkflowDraft {
  return {
    version: 1,
    kind: "statement-lens.workflow",
    path: DRAFT_PATH,
    savedAt: new Date().toISOString(),
    fileName: input.fileName,
    parserId: input.parserId,
    workflowStep: input.workflowStep,
    transactions: input.transactions,
    auditLog: input.auditLog,
    changeHistory: input.changeHistory,
    thresholds: input.thresholds,
    pixelReportSummary: input.pixelReportSummary,
    mathSummary: input.mathSummary,
    meta: input.meta,
  };
}

/** Persist draft to localStorage (browser stand-in for audit/workflow.json). */
export function saveDraftToStorage(draft: WorkflowDraft): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // quota
  }
}

export function loadDraftFromStorage(): WorkflowDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkflowDraft;
    if (parsed?.kind !== "statement-lens.workflow" || parsed.version !== 1) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraftStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Download draft as audit/workflow.json */
export function downloadWorkflowJson(draft: WorkflowDraft): void {
  const blob = new Blob([JSON.stringify(draft, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "workflow.json";
  // Prefer nested path name where browsers allow it (usually flattens)
  a.setAttribute("download", "workflow.json");
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Try File System Access API to write audit/workflow.json under a user-picked folder.
 * Falls back to download.
 */
export async function writeWorkflowJsonFile(draft: WorkflowDraft): Promise<"fs" | "download"> {
  const json = JSON.stringify(draft, null, 2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (typeof w.showDirectoryPicker === "function") {
    try {
      const dir = await w.showDirectoryPicker({ mode: "readwrite" });
      let auditDir = dir;
      try {
        auditDir = await dir.getDirectoryHandle("audit", { create: true });
      } catch {
        auditDir = dir;
      }
      const file = await auditDir.getFileHandle("workflow.json", { create: true });
      const writable = await file.createWritable();
      await writable.write(json);
      await writable.close();
      return "fs";
    } catch {
      // user cancel or denial
    }
  }
  downloadWorkflowJson(draft);
  return "download";
}

export function createAutosaveController(
  getDraft: () => WorkflowDraft | null,
  onSaved?: (draft: WorkflowDraft) => void,
): { touch: () => void; flush: () => void; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const draft = getDraft();
    if (!draft) return;
    saveDraftToStorage(draft);
    onSaved?.(draft);
  };

  const touch = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, AUTOSAVE_MS);
  };

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return { touch, flush, stop };
}
