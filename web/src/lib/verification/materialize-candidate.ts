/**
 * Build a candidate PDF for pixel verification: original bytes + generator/table edits.
 */
import { cloneUint8Array } from "@/lib/bytes";
import { applyReplacementsWithFallbacks } from "@/lib/pdf-engines";
import type { PdfEdit, Transaction } from "@/lib/types";
import {
  buildFontReplicatedReplacements,
  type FontRunMatch,
} from "@/lib/tools/advanced-generator";
import { getPageTextRunsFromBytes } from "@/lib/tools/pdf-runs";
import {
  linkRunMatches,
  pairGeneratedToMatches,
} from "@/lib/tools/run-match";

export type CandidateMaterializeMode =
  | "identity"
  | "queued-edits"
  | "auto-linked";

export interface MaterializeCandidateResult {
  baselinePdf: Uint8Array;
  candidatePdf: Uint8Array;
  mode: CandidateMaterializeMode;
  editCount: number;
  linkedFields: number;
  notes: string[];
}

function fieldChanged(a: Transaction, b: Transaction): boolean {
  return (
    a.date !== b.date ||
    a.description !== b.description ||
    a.debit !== b.debit ||
    a.credit !== b.credit ||
    a.balance !== b.balance
  );
}

function ledgersDiffer(
  original: Transaction[],
  current: Transaction[],
): boolean {
  if (original.length !== current.length) return true;
  const byId = new Map(current.map((t) => [t.id, t]));
  for (const o of original) {
    const c = byId.get(o.id);
    if (!c || fieldChanged(o, c)) return true;
  }
  // index-wise fallback when ids diverge after generate
  for (let i = 0; i < Math.min(original.length, current.length); i++) {
    if (fieldChanged(original[i], current[i])) return true;
  }
  return original.length !== current.length;
}

/**
 * Produce baseline (original) + candidate (re-rendered with updated data).
 *
 * Priority:
 * 1. Queued PdfEdits from bank-desc replace / click-to-edit
 * 2. Auto-link sourceBaseline field values still on PDF → current transactions
 * 3. Identity (no table/PDF delta)
 */
export async function materializeCandidatePdf(params: {
  originalPdf: Uint8Array;
  pdfEdits: PdfEdit[];
  /** Parse-time frozen ledger (values still drawn on original PDF). */
  sourceBaseline: Transaction[];
  /** Working set after generator / edits. */
  current: Transaction[];
  maxPages?: number;
  onProgress?: (message: string) => void;
}): Promise<MaterializeCandidateResult> {
  const notes: string[] = [];
  const baselinePdf = cloneUint8Array(params.originalPdf);
  const maxPages = params.maxPages ?? 8;

  // 1) Explicit edit queue
  if (params.pdfEdits.length > 0) {
    params.onProgress?.(
      `Materializing candidate PDF from ${params.pdfEdits.length} queued edit(s)…`,
    );
    const replacements = params.pdfEdits.map((e) => ({
      page: e.page,
      bbox: e.bbox,
      replacement: e.replacement,
      fontSpec: e.fontSpec,
    }));
    const candidatePdf = await applyReplacementsWithFallbacks(
      cloneUint8Array(params.originalPdf),
      replacements,
    );
    notes.push(
      `Candidate built from ${params.pdfEdits.length} queued PdfEdit(s) (generator / bank-desc / click-edit).`,
    );
    return {
      baselinePdf,
      candidatePdf: cloneUint8Array(candidatePdf),
      mode: "queued-edits",
      editCount: params.pdfEdits.length,
      linkedFields: params.pdfEdits.length,
      notes,
    };
  }

  // 2) Auto-link baseline (on PDF) → current values
  const baselineRows =
    params.sourceBaseline.length > 0
      ? params.sourceBaseline
      : params.current;
  const currentRows = params.current;

  if (
    baselineRows.length > 0 &&
    currentRows.length > 0 &&
    ledgersDiffer(baselineRows, currentRows)
  ) {
    params.onProgress?.("Auto-linking baseline PDF runs to generated values…");
    try {
      const runs = await getPageTextRunsFromBytes(
        cloneUint8Array(params.originalPdf),
        maxPages,
      );
      // Link using values still on the original PDF (prefer original snapshots / baseline rows)
      const linkTxns = baselineRows.map((t) => ({
        ...t,
        original: t.original ?? {
          date: t.date,
          description: t.description,
          debit: t.debit,
          credit: t.credit,
          balance: t.balance,
        },
      }));
      const { matches, stats } = linkRunMatches({
        transactions: linkTxns,
        runs,
        preferOriginal: true,
      });

      // Pair baseline ids → current rows (same index when generate replaced ids)
      const previous = linkTxns;
      let generated = currentRows;
      if (previous.length !== generated.length) {
        // Align by index for materialize
        const n = Math.min(previous.length, generated.length);
        generated = generated.slice(0, n);
      }
      // Ensure generated has same length as previous for pairGeneratedToMatches
      if (generated.length < previous.length) {
        generated = [
          ...generated,
          ...previous.slice(generated.length).map((t) => ({ ...t })),
        ];
      }

      const paired: FontRunMatch[] = pairGeneratedToMatches({
        previous,
        generated: generated.slice(0, previous.length),
        matches,
      });

      // Only keep fields that actually changed
      const changedPaired = paired.filter((m) => {
        const prev = previous.find((t) => t.id === m.transactionId);
        const genIdx = previous.findIndex((t) => t.id === m.transactionId);
        const gen =
          genIdx >= 0
            ? generated[genIdx]
            : generated.find((t) => t.id === m.transactionId);
        if (!prev || !gen) return false;
        if (m.field === "date") return prev.date !== gen.date;
        if (m.field === "description")
          return prev.description !== gen.description;
        if (m.field === "debit") return prev.debit !== gen.debit;
        if (m.field === "credit") return prev.credit !== gen.credit;
        if (m.field === "balance") return prev.balance !== gen.balance;
        return true;
      });

      const edits = buildFontReplicatedReplacements({
        transactions: generated.slice(0, previous.length),
        runMatches: changedPaired,
      });

      if (edits.length > 0) {
        params.onProgress?.(
          `Rendering candidate with ${edits.length} auto-linked replacement(s)…`,
        );
        const replacements = edits.map((e) => ({
          page: e.page,
          bbox: e.bbox,
          replacement: e.replacement,
          fontSpec: e.fontSpec,
        }));
        const candidatePdf = await applyReplacementsWithFallbacks(
          cloneUint8Array(params.originalPdf),
          replacements,
        );
        notes.push(
          `Auto-linked ${stats.linked}/${stats.fields} fields from baseline PDF · ${edits.length} changed replacements applied to candidate.`,
        );
        return {
          baselinePdf,
          candidatePdf: cloneUint8Array(candidatePdf),
          mode: "auto-linked",
          editCount: edits.length,
          linkedFields: stats.linked,
          notes,
        };
      }
      notes.push(
        `Ledger differs but auto-link produced 0 geometry matches (${stats.linked}/${stats.fields} field links). Falling back to identity render.`,
      );
    } catch (err) {
      notes.push(
        `Auto-link materialize failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 3) Identity
  notes.push(
    "No queued PdfEdits and no auto-linked changes — candidate equals original (identity check).",
  );
  return {
    baselinePdf,
    candidatePdf: cloneUint8Array(params.originalPdf),
    mode: "identity",
    editCount: 0,
    linkedFields: 0,
    notes,
  };
}
