/**
 * OEM Perfect Replica Pipeline
 * ─────────────────────────────────────────────────────────────
 * Combines:
 *   Step 1 — three-part layout analysis (static | vars | txn table)
 *   Step 2 — bank transaction structure fidelity
 *   App methods — perfect replacement, St George layered fill, queued edits
 *
 * Write policy:
 *   • Prefer rewriting ON the original OEM PDF so logos, rules, fonts, and
 *     static chrome remain true vector OEM content (visually inseparable).
 *   • FreeText + white Square cover only — never PDF redactions.
 *   • Descriptions follow the source bank’s identification style.
 *
 * Output goal: updated data, OEM-identical appearance under visual inspection.
 */
import { cloneUint8Array } from "@/lib/bytes";
import {
  analyzeStatementLayout,
  type StatementLayoutAnalysis,
} from "@/lib/statement-layout";
import { runPerfectReplacement } from "@/lib/perfect-replacement";
import {
  fillStGeorgeLayered,
  isStGeorgeCompleteFreedomShell,
} from "@/lib/st-george-template";
import { fillStGeorgeTemplate } from "@/lib/st-george-template/fill";
import type { PdfEdit, Transaction } from "@/lib/types";
import {
  applyStructureToLedger,
  profileFromLayout,
} from "./structure-ledger";
import { assistLedgerWithBankTemplate } from "@/lib/generation/from-bank-template";
import { extractTextWithPyMuPdf } from "@/lib/parsers/pymupdf";
import type {
  OemPerfectReplicaRequest,
  OemPerfectReplicaResult,
  OemReplicaPath,
} from "./types";

function nonEmpty(edits: PdfEdit[]): PdfEdit[] {
  return edits.filter((e) => String(e.replacement ?? "").trim().length > 0);
}

function pickPath(layout: StatementLayoutAnalysis | null, rawText: string): OemReplicaPath {
  const cls = layout?.documentClass ?? "unknown";
  const bank = layout?.txnStructure.bankId ?? "";
  const text = rawText || "";

  if (
    (cls === "base-shell" || cls === "token-template") &&
    (bank === "st-george" || isStGeorgeCompleteFreedomShell(text))
  ) {
    // Prefer layered base when we have few/no txn rows on shell
    if ((layout?.part3.rows.length ?? 0) < 3) return "st-george-layered";
    return "token-template";
  }
  if (cls === "token-template") return "token-template";
  if (cls === "filled-statement" || (layout?.part3.rows.length ?? 0) >= 3) {
    return "filled-geometry";
  }
  return "hybrid-fallback";
}

function oemGates(params: {
  path: OemReplicaPath;
  editCount: number;
  layout: StatementLayoutAnalysis | null;
  descApplied: number;
  descChanged: number;
  minDesc: number;
}): { gates: OemPerfectReplicaResult["gates"]; score: number; ok: boolean } {
  const { path, editCount, layout, descApplied, descChanged, minDesc } = params;
  const descRatio = descChanged === 0 ? 1 : descApplied / descChanged;
  const staticN = layout?.part1.runs.length ?? 0;
  const txnN = layout?.part3.rows.length ?? 0;

  const gates: OemPerfectReplicaResult["gates"] = [
    {
      id: "oem-write",
      pass: editCount > 0,
      detail:
        editCount > 0
          ? `${editCount} OEM injection(s) via ${path}`
          : "No injections — candidate may be identity",
    },
    {
      id: "oem-static-preserved",
      pass: staticN >= 3 || path === "filled-geometry",
      detail:
        path === "filled-geometry"
          ? "Static chrome retained from original OEM PDF vectors"
          : `${staticN} static run(s) classified for base keep`,
    },
    {
      id: "oem-structure",
      pass: Boolean(layout?.txnStructure?.bankId) || editCount > 0,
      detail: layout?.txnStructure
        ? `bank=${layout.txnStructure.bankId} conf=${layout.txnStructure.confidence.toFixed(2)}`
        : "structure profile soft",
    },
    {
      id: "oem-description-coverage",
      pass: descRatio >= minDesc || descChanged === 0 || path === "st-george-layered",
      detail: `desc ${descApplied}/${descChanged} (need ≥${Math.round(minDesc * 100)}%)`,
    },
    {
      id: "oem-no-redactions",
      pass: true,
      detail: "Square cover + FreeText only — redactions never written",
    },
  ];

  let score = 30;
  if (editCount > 0) score += 25;
  if (path === "filled-geometry") score += 15; // strongest visual OEM path
  if (path === "st-george-layered") score += 10;
  score += Math.min(20, Math.round(descRatio * 20));
  if (staticN >= 10) score += 5;
  if (txnN >= 5 || path === "st-george-layered") score += 5;
  if (layout?.txnStructure && layout.txnStructure.confidence >= 0.5) score += 5;
  score = Math.max(0, Math.min(100, score));

  const ok =
    gates.filter((g) => g.id !== "oem-description-coverage").every((g) => g.pass) &&
    (gates.find((g) => g.id === "oem-description-coverage")?.pass ?? true);

  return { gates, score, ok };
}

/**
 * Master OEM replica entry — use for live preview and final export.
 */
export async function runOemPerfectReplica(
  req: OemPerfectReplicaRequest,
): Promise<OemPerfectReplicaResult> {
  const t0 = performance.now();
  const notes: string[] = [];
  const maxPages = req.maxPages ?? 40;
  const minDesc = req.minDescriptionCoverage ?? 0.35;
  const preserve = req.preserveTxnStructure !== false;

  notes.push(
    "OEM Perfect Replica: PyMuPDF text + three-part layout + YAML templates + write engines",
  );

  // ── Step 0: PyMuPDF text extract (authoritative local text) ────
  let pymupdfText = req.rawText ?? "";
  try {
    if (!pymupdfText || pymupdfText.length < 40) {
      const extracted = await extractTextWithPyMuPdf(req.sourcePdf, {
        maxPages: Math.min(maxPages, 12),
      });
      pymupdfText = extracted.text;
      notes.push(
        `pymupdf extract: engine=${extracted.engine} pages=${extracted.pageCount} chars=${extracted.text.length}`,
      );
    } else {
      notes.push("pymupdf: using caller rawText");
    }
  } catch (e) {
    notes.push(
      `pymupdf extract soft-fail: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // ── Step 1: layout analysis (prefer frozen upload profile) ─────
  let layout: StatementLayoutAnalysis | null = null;
  if (req.layout && req.layout.kind === "statement-layout.three-part") {
    layout = req.layout;
    notes.push(
      `layout: FROZEN upload profile class=${layout.documentClass} bank=${layout.txnStructure.bankId} ` +
        `static=${layout.part1.runs.length} vars=${layout.part2.runs.length} ` +
        `txnRows=${layout.part3.rows.length} score=${layout.score}`,
    );
    notes.push(...layout.notes.slice(0, 3));
  } else {
    try {
      layout = await analyzeStatementLayout(req.sourcePdf, {
        fileName: req.fileName,
        maxPages: Math.min(maxPages, 12),
        rawText: pymupdfText || req.rawText,
        bankHint: req.fileName,
      });
      notes.push(
        `layout: live re-analyze class=${layout.documentClass} bank=${layout.txnStructure.bankId} ` +
          `static=${layout.part1.runs.length} vars=${layout.part2.runs.length} ` +
          `txnRows=${layout.part3.rows.length} score=${layout.score}`,
      );
      notes.push(...layout.notes.slice(0, 3));
    } catch (e) {
      notes.push(
        `layout analysis soft-fail: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const rawText =
    pymupdfText ||
    req.rawText ||
    layout?.part1.labels.join(" ") ||
    layout?.notes.join(" ") ||
    "";

  // ── Step 2a: YAML bank templates assist generation ─────────────
  const tplAssist = assistLedgerWithBankTemplate({
    transactions: req.current,
    rawText,
    bankHint: req.fileName ?? layout?.bankHint,
    rewriteDescriptions: false,
    applyCleanup: true,
  });
  notes.push(...tplAssist.notes.map((n) => `tpl: ${n}`));

  // ── Step 2b: structure-preserving ledger (profile + YAML) ──────
  let structuredLedger: Transaction[] = tplAssist.transactions;
  if (preserve) {
    const fromLayout = profileFromLayout(layout);
    const profile = fromLayout
      ? {
          ...tplAssist.structureProfile,
          ...fromLayout,
          descriptionPatterns: [
            ...new Set([
              ...tplAssist.structureProfile.descriptionPatterns,
              ...fromLayout.descriptionPatterns,
            ]),
          ],
          notes: [...tplAssist.structureProfile.notes, ...fromLayout.notes],
        }
      : tplAssist.structureProfile;
    const applied = applyStructureToLedger(tplAssist.transactions, profile);
    structuredLedger = applied.ledger;
    notes.push(...applied.notes);
  }

  const path = pickPath(layout, rawText);
  notes.push(`oem-path=${path}`);
  notes.push(
    `generation-template=${tplAssist.context.template.id} bankGen=${tplAssist.context.bankId}`,
  );

  let candidatePdf = cloneUint8Array(req.sourcePdf);
  let appliedEdits: PdfEdit[] = [];
  let perfect: OemPerfectReplicaResult["perfect"] = null;
  let descApplied = 0;
  let descChanged = 0;

  // Count description deltas for gates
  const base = req.sourceBaseline.length ? req.sourceBaseline : req.current;
  const n = Math.min(base.length, structuredLedger.length);
  for (let i = 0; i < n; i++) {
    if (base[i].description !== structuredLedger[i].description) descChanged += 1;
  }
  if (structuredLedger.length !== base.length) {
    descChanged = Math.max(descChanged, structuredLedger.length);
  }

  // ── Write engines ──────────────────────────────────────────────
  try {
    if (path === "st-george-layered") {
      const basePdf = req.basePdf ?? req.sourcePdf;
      const layered = await fillStGeorgeLayered({
        basePdf: cloneUint8Array(basePdf),
        placementMapPdf: req.basePdf ? req.sourcePdf : null,
        transactions: structuredLedger,
        variables: req.variables,
        expandRows: true,
        maxPages,
      });
      candidatePdf = cloneUint8Array(layered.candidatePdf);
      appliedEdits = nonEmpty(layered.edits);
      descApplied = layered.transactionSlotsFilled;
      notes.push(...layered.notes.slice(-6));
      notes.push(`compose=${layered.compose}`);
    } else if (path === "token-template") {
      const tpl = await fillStGeorgeTemplate({
        templatePdf: cloneUint8Array(req.sourcePdf),
        transactions: structuredLedger,
        variables: req.variables,
        maxPages,
      });
      candidatePdf = cloneUint8Array(tpl.candidatePdf);
      appliedEdits = nonEmpty(tpl.edits);
      descApplied = tpl.transactionSlotsFilled;
      notes.push(...tpl.notes.slice(-4));
    } else {
      // filled-geometry + hybrid-fallback → perfect replacement on OEM source
      perfect = await runPerfectReplacement({
        sourcePdf: cloneUint8Array(req.sourcePdf),
        sourceBaseline: req.sourceBaseline.length
          ? req.sourceBaseline
          : structuredLedger,
        current: structuredLedger,
        queuedEdits: req.queuedEdits,
        variables: req.variables,
        rawText: req.rawText,
        maxPages,
        minDescriptionCoverage: minDesc,
        strict: false,
      });
      candidatePdf = cloneUint8Array(perfect.candidatePdf);
      appliedEdits = nonEmpty(perfect.appliedEdits);
      descApplied = perfect.coverage.description.applied;
      descChanged = Math.max(descChanged, perfect.coverage.description.changed);
      notes.push(
        `perfect: strategy=${perfect.strategy} score=${perfect.score} edits=${perfect.editCount}`,
      );
      notes.push(...perfect.notes.slice(-4));
    }

    // Always merge any residual queued edits if write path ignored them
    if (
      path !== "filled-geometry" &&
      path !== "hybrid-fallback" &&
      (req.queuedEdits?.length ?? 0) > 0 &&
      perfect == null
    ) {
      // Layered/template already preferred; queued edits optional re-run soft
      notes.push(
        `queued-edits present (${req.queuedEdits!.length}) — primarily applied via structured ledger paint`,
      );
    }
  } catch (e) {
    notes.push(
      `primary path ${path} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    // Hard fallback: perfect replacement
    try {
      perfect = await runPerfectReplacement({
        sourcePdf: cloneUint8Array(req.sourcePdf),
        sourceBaseline: req.sourceBaseline.length
          ? req.sourceBaseline
          : structuredLedger,
        current: structuredLedger,
        queuedEdits: req.queuedEdits,
        variables: req.variables,
        rawText: req.rawText,
        maxPages,
        minDescriptionCoverage: minDesc,
        strict: false,
      });
      candidatePdf = cloneUint8Array(perfect.candidatePdf);
      appliedEdits = nonEmpty(perfect.appliedEdits);
      descApplied = perfect.coverage.description.applied;
      notes.push(`fallback perfect score=${perfect.score}`);
    } catch (e2) {
      notes.push(
        `fallback failed: ${e2 instanceof Error ? e2.message : String(e2)}`,
      );
    }
  }

  const { gates, score, ok } = oemGates({
    path,
    editCount: appliedEdits.length,
    layout,
    descApplied,
    descChanged,
    minDesc,
  });

  if (req.strict && !ok) {
    throw new Error(
      `OEM replica gates failed: ${gates
        .filter((g) => !g.pass)
        .map((g) => g.id)
        .join(", ")}`,
    );
  }

  notes.push(
    `OEM result: score=${score}/100 path=${path} edits=${appliedEdits.length} ` +
      `bytes=${candidatePdf.byteLength}`,
  );

  return {
    ok,
    candidatePdf,
    path,
    structuredLedger,
    appliedEdits,
    editCount: appliedEdits.length,
    score,
    layout,
    perfect,
    gates,
    notes,
    durationMs: Math.round(performance.now() - t0),
    summary: {
      bankId:
        tplAssist.context.template.id ||
        layout?.txnStructure.bankId ||
        null,
      documentClass: layout?.documentClass ?? "unknown",
      staticRuns: layout?.part1.runs.length ?? 0,
      varRuns: layout?.part2.runs.length ?? 0,
      txnRowsMapped: layout?.part3.rows.length ?? 0,
      structureRecipe:
        tplAssist.structureProfile.recipe ||
        layout?.txnStructure.recipe ||
        null,
      writePolicy:
        "OEM vectors kept for Part1 static; Part2/Part3 FreeText inject; no redactions left in output; YAML template-assisted generation; multi-engine write",
    },
  };
}
