/**
 * Build a candidate / final PDF: original bytes + ALL replacement transactions
 * and field data (queued PdfEdits merged with full ledger auto-link).
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
  | "auto-linked"
  | "full-ledger";

export interface MaterializeCandidateResult {
  baselinePdf: Uint8Array;
  candidatePdf: Uint8Array;
  mode: CandidateMaterializeMode;
  editCount: number;
  linkedFields: number;
  /** Deduped PdfEdits actually applied (all fields / all rows possible). */
  appliedEdits: PdfEdit[];
  notes: string[];
  coverage: {
    baselineRows: number;
    currentRows: number;
    rowsPaired: number;
    fieldsLinked: number;
    fieldsChanged: number;
    fieldsApplied: number;
    byField: Record<string, number>;
  };
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
  for (let i = 0; i < original.length; i++) {
    if (fieldChanged(original[i], current[i])) return true;
  }
  const byId = new Map(current.map((t) => [t.id, t]));
  for (const o of original) {
    const c = byId.get(o.id);
    if (c && fieldChanged(o, c)) return true;
  }
  return false;
}

function editKey(e: Pick<PdfEdit, "page" | "bbox" | "runId">): string {
  if (e.runId) return `run:${e.runId}`;
  const b = e.bbox;
  return `p${e.page}:${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)},${b.height.toFixed(1)}`;
}

/**
 * Merge edit lists. Later entries win on the same geometry/run.
 * Prefer richer (non-empty) replacements.
 */
export function mergePdfEdits(...lists: PdfEdit[][]): PdfEdit[] {
  const map = new Map<string, PdfEdit>();
  for (const list of lists) {
    for (const e of list) {
      const k = editKey(e);
      const prev = map.get(k);
      if (!prev || (e.replacement && e.replacement !== prev.replacement)) {
        map.set(k, e);
      }
    }
  }
  return [...map.values()];
}

function countByField(edits: PdfEdit[]): Record<string, number> {
  const out: Record<string, number> = {
    date: 0,
    description: 0,
    debit: 0,
    credit: 0,
    balance: 0,
    other: 0,
  };
  for (const e of edits) {
    const f = e.linkedField ?? "other";
    if (f in out) out[f] += 1;
    else out.other += 1;
  }
  return out;
}

/**
 * Build PdfEdits for every changed field on every paired row by linking
 * baseline (on-PDF) values → current replacement values.
 */
export async function buildCompleteLedgerEdits(params: {
  originalPdf: Uint8Array;
  sourceBaseline: Transaction[];
  current: Transaction[];
  maxPages?: number;
  /** When set, only these fields; default all. */
  fields?: Array<"date" | "description" | "debit" | "credit" | "balance">;
}): Promise<{
  edits: PdfEdit[];
  linkedFields: number;
  fieldsTotal: number;
  rowsPaired: number;
  notes: string[];
}> {
  const notes: string[] = [];
  const maxPages = params.maxPages ?? 40;
  const fieldFilter = params.fields
    ? new Set(params.fields)
    : null;

  const baselineRows = params.sourceBaseline;
  const currentRows = params.current;
  if (!baselineRows.length || !currentRows.length) {
    return {
      edits: [],
      linkedFields: 0,
      fieldsTotal: 0,
      rowsPaired: 0,
      notes: ["No baseline/current rows for ledger link."],
    };
  }

  const runs = await getPageTextRunsFromBytes(
    cloneUint8Array(params.originalPdf),
    maxPages,
  );
  notes.push(`Scanned ${runs.length} text runs (maxPages=${maxPages}).`);

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

  const n = Math.min(linkTxns.length, currentRows.length);
  const previous = linkTxns.slice(0, n);
  let generated = currentRows.slice(0, n);
  // Pad generated if shorter so pairGeneratedToMatches keeps all baseline links
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

  // After pairGeneratedToMatches, match.transactionId is the *generated* id.
  // Resolve previous row by the same index so every changed field is kept.
  const genIndex = new Map(generated.map((t, i) => [t.id, i]));
  const changedPaired = paired.filter((m) => {
    if (fieldFilter && !fieldFilter.has(m.field)) return false;
    const idx = genIndex.get(m.transactionId);
    if (idx == null) return false;
    const p = previous[idx];
    const g = generated[idx];
    if (!p || !g) return false;
    if (m.field === "date") return p.date !== g.date;
    if (m.field === "description") return p.description !== g.description;
    if (m.field === "debit") return p.debit !== g.debit;
    if (m.field === "credit") return p.credit !== g.credit;
    if (m.field === "balance") return p.balance !== g.balance;
    return true;
  });

  const edits = buildFontReplicatedReplacements({
    transactions: generated.slice(0, previous.length),
    runMatches: changedPaired,
    matchOriginalStyle: true,
  });

  notes.push(
    `Linked ${stats.linked}/${stats.fields} field geometries · ${edits.length} changed replacements for ${n} row(s).`,
  );

  return {
    edits,
    linkedFields: stats.linked,
    fieldsTotal: stats.fields,
    rowsPaired: n,
    notes,
  };
}

/**
 * Produce baseline (original) + candidate (re-rendered with updated data).
 *
 * Always merges:
 * 1. Explicit queued PdfEdits (bank-desc / click-to-edit / generator)
 * 2. Full ledger auto-link for every changed date/description/money field
 *
 * So the final PDF includes ALL replacement transactions and data that can
 * be geometry-linked — not only the partial edit queue.
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
  const maxPages = params.maxPages ?? 40;

  const baselineRows =
    params.sourceBaseline.length > 0
      ? params.sourceBaseline
      : params.current;
  const currentRows = params.current;

  const coverageBase = {
    baselineRows: baselineRows.length,
    currentRows: currentRows.length,
    rowsPaired: 0,
    fieldsLinked: 0,
    fieldsChanged: 0,
    fieldsApplied: 0,
    byField: {
      date: 0,
      description: 0,
      debit: 0,
      credit: 0,
      balance: 0,
      other: 0,
    } as Record<string, number>,
  };

  let ledgerEdits: PdfEdit[] = [];
  let linkedFields = 0;

  const needsLedger =
    baselineRows.length > 0 &&
    currentRows.length > 0 &&
    ledgersDiffer(baselineRows, currentRows);

  if (needsLedger) {
    params.onProgress?.(
      "Building complete ledger replacements (all rows · all changed fields)…",
    );
    try {
      const built = await buildCompleteLedgerEdits({
        originalPdf: params.originalPdf,
        sourceBaseline: baselineRows,
        current: currentRows,
        maxPages,
      });
      ledgerEdits = built.edits;
      linkedFields = built.linkedFields;
      coverageBase.rowsPaired = built.rowsPaired;
      coverageBase.fieldsLinked = built.linkedFields;
      coverageBase.fieldsChanged = built.edits.length;
      notes.push(...built.notes);
    } catch (err) {
      notes.push(
        `Full ledger link failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (params.pdfEdits.length === 0) {
    notes.push(
      "No ledger delta and no queued PdfEdits — candidate equals original (identity).",
    );
    return {
      baselinePdf,
      candidatePdf: cloneUint8Array(params.originalPdf),
      mode: "identity",
      editCount: 0,
      linkedFields: 0,
      appliedEdits: [],
      notes,
      coverage: coverageBase,
    };
  }

  // Merge queued edits with full ledger so nothing is dropped.
  // Ledger edits win on same geometry when they carry current values;
  // queued edits that cover unique geometry are kept.
  const merged = mergePdfEdits(params.pdfEdits, ledgerEdits);
  coverageBase.fieldsApplied = merged.length;
  coverageBase.byField = countByField(merged);

  if (merged.length === 0) {
    notes.push(
      needsLedger
        ? "Ledger differs but no geometry matches produced replacements — identity fallback."
        : "No replacements to apply.",
    );
    return {
      baselinePdf,
      candidatePdf: cloneUint8Array(params.originalPdf),
      mode: "identity",
      editCount: 0,
      linkedFields,
      appliedEdits: [],
      notes,
      coverage: coverageBase,
    };
  }

  const mode: CandidateMaterializeMode =
    ledgerEdits.length > 0 && params.pdfEdits.length > 0
      ? "full-ledger"
      : params.pdfEdits.length > 0 && ledgerEdits.length === 0
        ? "queued-edits"
        : ledgerEdits.length > 0
          ? "auto-linked"
          : "queued-edits";

  params.onProgress?.(
    `Rendering final PDF with ${merged.length} replacement(s) (all linked fields)…`,
  );

  const replacements = merged.map((e) => ({
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
    `Final PDF: ${merged.length} replacement(s) applied · mode=${mode} · ` +
      `queued=${params.pdfEdits.length} · ledger=${ledgerEdits.length} · ` +
      `byField=${JSON.stringify(coverageBase.byField)}.`,
  );

  return {
    baselinePdf,
    candidatePdf: cloneUint8Array(candidatePdf),
    mode,
    editCount: merged.length,
    linkedFields: Math.max(linkedFields, merged.length),
    appliedEdits: merged,
    notes,
    coverage: coverageBase,
  };
}
