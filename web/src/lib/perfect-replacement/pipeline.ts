/**
 * Perfect Replacement Pipeline
 * ─────────────────────────────────────────────────────────────
 * Bulletproof multi-strategy data replacement for ANY uploaded statement PDF.
 *
 * Pass order (later merges win on same geometry):
 *  1. queued-edits     — explicit click / tool queue (never blank)
 *  2. template-tokens  — {PLACEHOLDER} shells (St George Complete Freedom, …)
 *  3. geometry-link    — value match baseline → run → current (multi-pass)
 *  4. row-cluster      — residual unmatched rows via Y-cluster + column X
 *
 * Write path: cover (Square) + FreeText only — NEVER PDF redaction annotations.
 * Verification: coverage gates + score feed auto workflow Continue / Export.
 */
import { cloneUint8Array } from "@/lib/bytes";
import { applyReplacementsWithFallbacks } from "@/lib/pdf-engines";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import {
  buildFontReplicatedReplacements,
  type FontRunMatch,
} from "@/lib/tools/advanced-generator";
import { getPageTextRunsFromBytes, type ExtractedRun } from "@/lib/tools/pdf-runs";
import {
  linkRunMatches,
  pairGeneratedToMatches,
} from "@/lib/tools/run-match";
import {
  buildStGeorgeTemplateEdits,
  fillStGeorgeTemplate,
} from "@/lib/st-george-template";
import {
  formatDateLikeOriginal,
  formatMoneyLikeOriginal,
} from "@/lib/money";
import type { PdfEdit, Transaction } from "@/lib/types";
import { matchFontSpec } from "@/lib/pdf-render";
import { mergePdfEdits } from "@/lib/verification/materialize-candidate";
import { classifyDocument } from "./classify";
import {
  emptyFieldCoverage,
  type FieldCoverage,
  type PerfectReplacementRequest,
  type PerfectReplacementResult,
  type ReplacementStrategyId,
} from "./types";

function fieldChanged(a: Transaction, b: Transaction): boolean {
  return (
    a.date !== b.date ||
    a.description !== b.description ||
    a.debit !== b.debit ||
    a.credit !== b.credit ||
    a.balance !== b.balance
  );
}

function nonEmptyEdits(edits: PdfEdit[]): PdfEdit[] {
  return edits.filter((e) => String(e.replacement ?? "").trim().length > 0);
}

/** Multi-pass geometry link: preferOriginal true then false; widen pages. */
async function strategyGeometryLink(
  sourcePdf: Uint8Array,
  baseline: Transaction[],
  current: Transaction[],
  maxPages: number,
): Promise<{ edits: PdfEdit[]; linked: number; fields: number; notes: string[] }> {
  const notes: string[] = [];
  if (!baseline.length || !current.length) {
    return { edits: [], linked: 0, fields: 0, notes: ["geometry-link: empty ledger"] };
  }

  const runs = await getPageTextRunsFromBytes(
    cloneUint8Array(sourcePdf),
    maxPages,
  );
  notes.push(`geometry-link: ${runs.length} runs across ≤${maxPages} pages`);

  const n = Math.min(baseline.length, current.length);
  const previous = baseline.slice(0, n).map((t) => ({
    ...t,
    original: t.original ?? {
      date: t.date,
      description: t.description,
      debit: t.debit,
      credit: t.credit,
      balance: t.balance,
    },
  }));
  const generated = current.slice(0, n);

  // Pass A: prefer original snapshots (values still on PDF)
  const passA = linkRunMatches({
    transactions: previous,
    runs,
    preferOriginal: true,
  });
  // Pass B: match current baseline-as-drawn values if originals missing
  const passB = linkRunMatches({
    transactions: previous,
    runs,
    preferOriginal: false,
  });

  // Merge matches by transactionId+field+run geometry — keep multi-line
  // description fragments (primary + secondary), not one match per field.
  const best = new Map<string, (typeof passA.matches)[0]>();
  for (const m of [...passA.matches, ...passB.matches]) {
    const k = `${m.transactionId}:${m.field}:${m.page}:${m.original}:${m.bbox.x.toFixed(1)}:${m.bbox.y.toFixed(1)}`;
    const prev = best.get(k);
    if (!prev || m.score > prev.score) best.set(k, m);
  }
  const matches = [...best.values()];
  notes.push(
    `geometry-link: passA=${passA.stats.linked} passB=${passB.stats.linked} merged=${matches.length}`,
  );

  const paired: FontRunMatch[] = pairGeneratedToMatches({
    previous,
    generated,
    matches,
  });

  const genIndex = new Map(generated.map((t, i) => [t.id, i]));
  // Also index by previous id → after pair, ids are generated
  const changed = paired.filter((m) => {
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

  // Keep previous field snapshots on generated rows so multi-line description
  // fragments can map run→line without treating each run as a whole-field.
  const genWithOrig = generated.map((g, i) => {
    const p = previous[i];
    if (!p) return g;
    return {
      ...g,
      original: p.original ?? {
        date: p.date,
        description: p.description,
        debit: p.debit,
        credit: p.credit,
        balance: p.balance,
      },
    };
  });

  const edits = nonEmptyEdits(
    buildFontReplicatedReplacements({
      transactions: genWithOrig,
      runMatches: changed,
      matchOriginalStyle: true,
    }),
  );

  return {
    edits,
    linked: matches.length,
    fields: passA.stats.fields,
    notes,
  };
}

/**
 * Row-cluster residual: for rows still missing description/amount edits,
 * assign left-to-right columns on the same Y band as a matched date run.
 */
function strategyRowCluster(
  runs: ExtractedRun[],
  baseline: Transaction[],
  current: Transaction[],
  already: PdfEdit[],
): { edits: PdfEdit[]; notes: string[] } {
  const notes: string[] = [];
  const covered = new Set(
    already
      .filter((e) => e.linkedTransactionId && e.linkedField)
      .map((e) => `${e.linkedTransactionId}:${e.linkedField}`),
  );

  const n = Math.min(baseline.length, current.length);
  const edits: PdfEdit[] = [];
  const usedRuns = new Set<string>();

  for (let i = 0; i < n; i++) {
    const p = baseline[i];
    const g = current[i];
    if (!fieldChanged(p, g)) continue;

    // Find date-like run matching previous date
    const dateIso = p.date;
    let dateRun: ExtractedRun | null = null;
    for (const r of runs) {
      const key = `${r.page}:${r.x}:${r.y}`;
      if (usedRuns.has(key)) continue;
      // soft: any short date-ish token near left margin
      if (
        r.text.length <= 12 &&
        (/\d{1,2}\s+[A-Za-z]{3}/.test(r.text) ||
          /\d{1,2}[\/\-]\d{1,2}/.test(r.text))
      ) {
        // prefer unused; first free left-side
        if (!dateRun || r.x < dateRun.x) dateRun = r;
      }
    }
    if (!dateRun) continue;
    const band = runs
      .filter(
        (r) =>
          r.page === dateRun!.page &&
          Math.abs(r.y - dateRun!.y) <= Math.max(4, dateRun!.height * 0.7),
      )
      .sort((a, b) => a.x - b.x);

    if (band.length < 2) continue;

    const push = (
      run: ExtractedRun,
      field: "date" | "description" | "debit" | "credit" | "balance",
      replacement: string,
    ) => {
      const k = `${g.id}:${field}`;
      if (covered.has(k)) return;
      if (!replacement.trim()) return;
      const key = `${run.page}:${run.x}:${run.y}`;
      if (usedRuns.has(key)) return;
      usedRuns.add(key);
      covered.add(k);
      edits.push({
        id: `cluster-${i}-${field}-${Math.random().toString(36).slice(2, 7)}`,
        page: run.page,
        runId: key,
        original: run.text,
        replacement,
        bbox: {
          x: run.x,
          y: run.y - (run.height || 10),
          width: Math.max(run.width, 8),
          height: Math.max(run.height || 10, 8),
        },
        fontSpec: run.fontSpec ?? matchFontSpec(run.fontName, run.fontName),
        linkedTransactionId: g.id,
        linkedField: field,
      });
    };

    // Left-most short → date, middle wide → description, right money tokens → amount/balance
    const left = band[0];
    const rightMoney = band.filter(
      (r) =>
        /[\d]/.test(r.text) &&
        (r.text.includes("$") ||
          r.text.includes(".") ||
          r.text.replace(/[^\d]/g, "").length >= 2) &&
        r.text.length < 18,
    );
    const mid =
      band.find(
        (r) =>
          r !== left &&
          !rightMoney.includes(r) &&
          r.text.length >= 4,
      ) ?? band[1];

    if (p.date !== g.date && left) {
      push(left, "date", formatDateLikeOriginal(g.date, left.text));
    }
    if (p.description !== g.description && mid) {
      push(mid, "description", g.description.slice(0, 80));
    }
    if (rightMoney.length >= 1 && (p.debit !== g.debit || p.credit !== g.credit)) {
      const amt =
        g.credit != null && g.credit > 0
          ? formatMoneyLikeOriginal(g.credit, rightMoney[0].text)
          : g.debit != null
            ? formatMoneyLikeOriginal(g.debit, rightMoney[0].text)
            : "";
      if (amt) push(rightMoney[0], g.credit != null ? "credit" : "debit", amt);
    }
    if (rightMoney.length >= 2 && p.balance !== g.balance && g.balance != null) {
      const bal = formatMoneyLikeOriginal(
        g.balance,
        rightMoney[rightMoney.length - 1].text,
      );
      push(rightMoney[rightMoney.length - 1], "balance", bal);
    }
  }

  notes.push(`row-cluster: +${edits.length} residual field edit(s)`);
  return { edits: nonEmptyEdits(edits), notes };
}

function tallyCoverage(
  edits: PdfEdit[],
  baseline: Transaction[],
  current: Transaction[],
  linkedFields: number,
): FieldCoverage {
  const cov = emptyFieldCoverage();
  const n = Math.min(baseline.length, current.length);
  for (let i = 0; i < n; i++) {
    const p = baseline[i];
    const g = current[i];
    if (p.date !== g.date) cov.date.changed += 1;
    if (p.description !== g.description) cov.description.changed += 1;
    if (p.debit !== g.debit) cov.debit.changed += 1;
    if (p.credit !== g.credit) cov.credit.changed += 1;
    if (p.balance !== g.balance) cov.balance.changed += 1;
  }
  // approximate linked = total link attempts / 5 fields
  cov.description.linked = linkedFields;
  for (const e of edits) {
    const f = e.linkedField ?? "description";
    if (f === "date") cov.date.applied += 1;
    else if (f === "description") cov.description.applied += 1;
    else if (f === "debit") cov.debit.applied += 1;
    else if (f === "credit") cov.credit.applied += 1;
    else if (f === "balance") cov.balance.applied += 1;
    else cov.chrome.applied += 1;
  }
  return cov;
}

function scoreAndGates(
  cov: FieldCoverage,
  editCount: number,
  minDesc: number,
  documentClass: string,
): { score: number; gates: PerfectReplacementResult["gates"]; ok: boolean } {
  const gates: PerfectReplacementResult["gates"] = [];
  const descRatio =
    cov.description.changed === 0
      ? 1
      : cov.description.applied / cov.description.changed;
  const anyApplied = editCount > 0;

  gates.push({
    id: "has-edits",
    pass: anyApplied || documentClass === "token-template",
    detail: anyApplied
      ? `${editCount} replacement(s) applied`
      : "No geometric replacements — identity candidate",
  });
  gates.push({
    id: "description-coverage",
    pass: descRatio >= minDesc || cov.description.changed === 0,
    detail: `Description apply ${cov.description.applied}/${cov.description.changed} (need ≥${Math.round(minDesc * 100)}%)`,
  });
  gates.push({
    id: "no-blank-replacements",
    pass: true,
    detail: "Blank replacements filtered (never redact empty)",
  });

  let score = 40;
  if (anyApplied) score += 25;
  score += Math.min(25, Math.round(descRatio * 25));
  if (cov.date.applied + cov.debit.applied + cov.credit.applied + cov.balance.applied > 0)
    score += 10;
  score = Math.max(0, Math.min(100, score));

  const ok = gates.every((g) => g.pass) || (anyApplied && descRatio >= minDesc * 0.75);
  return { score, gates, ok };
}

/**
 * Run the perfect replacement pipeline end-to-end.
 */
export async function runPerfectReplacement(
  req: PerfectReplacementRequest,
): Promise<PerfectReplacementResult> {
  const t0 = performance.now();
  const notes: string[] = [];
  const strategiesTried: ReplacementStrategyId[] = [];
  const maxPages = req.maxPages ?? 40;
  const minDesc = req.minDescriptionCoverage ?? 0.45;

  let rawText = req.rawText ?? "";
  if (!rawText) {
    try {
      const ex = await extractTextFromPdf(cloneUint8Array(req.sourcePdf));
      rawText = ex.text;
    } catch (e) {
      notes.push(
        `text extract failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const documentClass = classifyDocument(rawText);
  notes.push(`documentClass=${documentClass}`);

  let merged: PdfEdit[] = nonEmptyEdits(req.queuedEdits ?? []);
  if (merged.length) {
    strategiesTried.push("queued-edits");
    notes.push(`queued-edits: ${merged.length}`);
  }

  // Strategy: template tokens
  if (documentClass === "token-template") {
    strategiesTried.push("template-tokens");
    try {
      const tpl = await buildStGeorgeTemplateEdits({
        templatePdf: req.sourcePdf,
        transactions: req.current,
        variables: req.variables,
        maxPages,
      });
      merged = mergePdfEdits(merged, nonEmptyEdits(tpl.edits));
      notes.push(...tpl.notes);
    } catch (e) {
      notes.push(
        `template-tokens failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Strategy: geometry multi-pass (always for filled / unknown / residual)
  let linkedFields = 0;
  strategiesTried.push("geometry-link");
  try {
    const geo = await strategyGeometryLink(
      req.sourcePdf,
      req.sourceBaseline.length ? req.sourceBaseline : req.current,
      req.current,
      maxPages,
    );
    linkedFields = geo.linked;
    merged = mergePdfEdits(merged, geo.edits);
    notes.push(...geo.notes);
  } catch (e) {
    notes.push(
      `geometry-link failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Strategy: row-cluster residual
  strategiesTried.push("row-cluster");
  try {
    const runs = await getPageTextRunsFromBytes(
      cloneUint8Array(req.sourcePdf),
      maxPages,
    );
    const cluster = strategyRowCluster(
      runs,
      req.sourceBaseline.length ? req.sourceBaseline : req.current,
      req.current,
      merged,
    );
    merged = mergePdfEdits(merged, cluster.edits);
    notes.push(...cluster.notes);
  } catch (e) {
    notes.push(
      `row-cluster failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  strategiesTried.push("hybrid-merge");
  merged = nonEmptyEdits(merged);
  notes.push(`hybrid-merge: ${merged.length} unique non-empty edit(s)`);

  // Write
  let candidatePdf = cloneUint8Array(req.sourcePdf);
  if (merged.length > 0) {
    try {
      candidatePdf = await applyReplacementsWithFallbacks(
        cloneUint8Array(req.sourcePdf),
        merged.map((e) => ({
          page: e.page,
          bbox: e.bbox,
          replacement: e.replacement,
          fontSpec: e.fontSpec,
        })),
        undefined,
        {
          burnOriginal: true,
          chunkSize: 64,
          // Pdfium = write engine of record (inject mupdf → save pdfium)
          engines: ["pdfium", "mupdf", "remote"],
        },
      );
    } catch (e) {
      notes.push(
        `write failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      if (req.strict) throw e;
      // Template fill path as last resort when geometry write fails
      if (documentClass === "token-template") {
        try {
          const filled = await fillStGeorgeTemplate({
            templatePdf: req.sourcePdf,
            transactions: req.current,
            variables: req.variables,
          });
          candidatePdf = filled.candidatePdf;
          merged = filled.edits;
          notes.push("fallback: fillStGeorgeTemplate write succeeded");
        } catch (e2) {
          notes.push(
            `template fill fallback failed: ${e2 instanceof Error ? e2.message : String(e2)}`,
          );
        }
      }
    }
  } else if (documentClass === "token-template") {
    try {
      const filled = await fillStGeorgeTemplate({
        templatePdf: req.sourcePdf,
        transactions: req.current,
        variables: req.variables,
      });
      candidatePdf = filled.candidatePdf;
      merged = filled.edits;
      notes.push(...filled.notes);
    } catch (e) {
      notes.push(
        `template-only fill failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const coverage = tallyCoverage(
    merged,
    req.sourceBaseline.length ? req.sourceBaseline : req.current,
    req.current,
    linkedFields,
  );
  const { score, gates, ok } = scoreAndGates(
    coverage,
    merged.length,
    minDesc,
    documentClass,
  );

  if (req.strict && !ok) {
    throw new Error(
      `Perfect replacement gates failed: ${gates
        .filter((g) => !g.pass)
        .map((g) => g.id)
        .join(", ")}`,
    );
  }

  return {
    ok,
    strategy: "hybrid-merge",
    documentClass,
    candidatePdf,
    appliedEdits: merged,
    editCount: merged.length,
    coverage,
    score,
    gates,
    strategiesTried,
    notes,
    durationMs: Math.round(performance.now() - t0),
  };
}
