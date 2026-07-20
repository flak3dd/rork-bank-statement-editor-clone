/**
 * Layered St George fill:
 *   output = TEMPLATE_2 (base, kept as-is)
 *          + FreeText at TEMPLATE placement geometry
 *          + cloned txn rows using #726 pitch (36.6pt)
 *
 * No redactions. Static chrome on the base is never stripped.
 */
import { cloneUint8Array } from "@/lib/bytes";
import { matchFontSpec } from "@/lib/pdf-render";
import { applyReplacementsWithFallbacks } from "@/lib/pdf-engines";
import type { PdfEdit, Transaction } from "@/lib/types";
import {
  formatNowStGeorgeCreated,
  formatStGeorgeAmount,
  formatStGeorgeBalance,
  formatStGeorgeDayMonth,
  formatStGeorgeLongDate,
  formatStGeorgeTransactionLine,
  periodDayCount,
} from "./format";
import {
  resolveStGeorgeTokenValues,
  type StGeorgeTemplateFillInput,
  type StGeorgeTemplateFillResult,
} from "./fill";
import {
  ST_GEORGE_CHROME_SLOTS,
  ST_GEORGE_ROW_PITCH,
  ST_GEORGE_TXN_COLUMNS,
  ST_GEORGE_TXN_GRID,
} from "./geometry-blueprint";

/**
 * Blueprint Y is top-down (0 at page top). Keep top-down in PdfEdit bboxes;
 * MuPDF write boundary converts once to PDF user space (see mupdf-engine).
 */
function topDownBBox(
  x: number,
  yTop: number,
  w: number,
  h: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x,
    y: yTop,
    width: Math.max(w, 8),
    height: Math.max(h, 8),
  };
}

export interface LayeredStGeorgeFillInput
  extends Omit<StGeorgeTemplateFillInput, "templatePdf"> {
  /**
   * TEMPLATE 2 base PDF — all static items kept.
   * If omitted, falls back to `placementMapPdf` / `templatePdf`.
   */
  basePdf: Uint8Array;
  /**
   * Optional placement-map PDF (token template). Currently geometry comes
   * from the measured blueprint; map bytes reserved for future run-sync.
   */
  placementMapPdf?: Uint8Array | null;
  /** Alias for older call sites. */
  templatePdf?: Uint8Array;
  /**
   * When true (default), clone txn rows beyond the 2 sample slots using
   * #726 row pitch so dense ledgers fill like the final statement.
   */
  expandRows?: boolean;
}

function slotEdit(
  page: number,
  x: number,
  yTop: number,
  w: number,
  h: number,
  text: string,
  tag: string,
  fontSize = 10,
  bold = false,
): PdfEdit {
  const boxH = Math.max(h, fontSize + 2);
  const boxW = Math.max(w, text.length * fontSize * 0.48);
  const bbox = topDownBBox(x, yTop, boxW, boxH);
  return {
    id: `stglayer-${tag}-${Math.random().toString(36).slice(2, 8)}`,
    page,
    runId: `layer-p${page}-${tag}`,
    original: "",
    replacement: text,
    bbox,
    fontSpec: matchFontSpec(
      bold ? "Helvetica-Bold" : "Helvetica",
      bold ? "Helvetica-Bold" : "Helvetica",
    ),
  };
}

function splitDescription(txn: Transaction): { primary: string; secondary: string | null } {
  const line = formatStGeorgeTransactionLine(txn);
  // Prefer natural multi-line: first line primary, rest secondary (like #726)
  const parts = line.split(/\n|\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { primary: parts[0].slice(0, 42), secondary: parts.slice(1).join(" ").slice(0, 48) };
  }
  // Heuristic: long card lines often have merchant after first 3 tokens
  const words = line.split(/\s+/);
  if (words.length > 4) {
    return {
      primary: words.slice(0, 3).join(" ").slice(0, 42),
      secondary: words.slice(3).join(" ").slice(0, 48),
    };
  }
  return { primary: line.slice(0, 48), secondary: null };
}

function pageCountForTxns(txnCount: number): number {
  const p1 = ST_GEORGE_TXN_GRID.page1.maxRows;
  if (txnCount <= p1) return 1;
  const rest = txnCount - p1;
  const p2 = ST_GEORGE_TXN_GRID.page2plus.maxRows;
  return 1 + Math.ceil(rest / p2);
}

/**
 * Build geometry-driven edits for chrome + expanded transaction grid.
 * Coordinates are absolute on the base page (same 595×842 as placement map).
 */
export function buildLayeredStGeorgeEdits(
  input: LayeredStGeorgeFillInput,
): Omit<StGeorgeTemplateFillResult, "candidatePdf"> {
  const notes: string[] = [];
  const edits: PdfEdit[] = [];
  const filledTokens: string[] = [];
  const expandRows = input.expandRows !== false;

  const tokenInput: StGeorgeTemplateFillInput = {
    templatePdf: input.basePdf,
    variables: input.variables,
    transactions: input.transactions,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    accountOpened: input.accountOpened,
    currentBalance: input.currentBalance,
  };
  const tokens = resolveStGeorgeTokenValues(tokenInput);
  const created = formatNowStGeorgeCreated();

  const txns = (input.transactions ?? []).filter(
    (t) => t.description && !/^OPENING|^CLOSING/i.test(t.description),
  );
  // Base PDF is typically 2 pages — never plan FreeText beyond real capacity
  // (clamping page 3→2 floods page 2 and blows WASM annotation tables).
  const totalPages = Math.min(
    2,
    Math.max(1, Math.min(input.maxPages ?? 2, pageCountForTxns(txns.length))),
  );

  // ── Chrome from blueprint slots ────────────────────────────────
  for (const slot of ST_GEORGE_CHROME_SLOTS) {
    if (slot.page > totalPages) continue;
    let text = "";
    switch (slot.token) {
      case "{FIRSTNAME LASTNAME}":
        text = tokens["{FIRSTNAME LASTNAME}"];
        break;
      case "{ADDRESS LINE 1}":
        text = tokens["{ADDRESS LINE 1}"];
        break;
      case "{ADDRESS LINE 2}":
        text = tokens["{ADDRESS LINE 2}"];
        break;
      case "{BSB}":
        text = tokens["{BSB}"];
        break;
      case "{ACCOUNT}":
        text = tokens["{ACCOUNT}"];
        break;
      case "{DATE}":
        text = tokens["{DATE}"];
        break;
      case "{NUMBER OF DAYS}":
        text = tokens["{NUMBER OF DAYS}"] || tokens["{NUMBER OF DAYS)"];
        break;
      case "{FROM DATE}":
        text = tokens["{FROM DATE}"];
        break;
      case "{TO DATE}":
        text = tokens["{TO DATE}"];
        break;
      case "{CURRENT BALANCE}":
        text = tokens["{CURRENT BALANCE}"];
        break;
      case "{DATE CREATE}":
        text = created.dateCreate;
        break;
      case "{TIME}":
        text = created.time;
        break;
      case "{PAGE}":
        text = String(slot.page);
        break;
      case "{PAGE_TOTAL}":
        text = String(totalPages);
        break;
      default:
        text = tokens[slot.token] ?? "";
    }
    if (!text?.trim()) continue;
    edits.push(
      slotEdit(
        slot.page,
        slot.x,
        slot.y,
        slot.w,
        slot.h,
        text,
        slot.token.replace(/[{}]/g, ""),
        10,
        /FIRSTNAME|ADDRESS|BSB|ACCOUNT/i.test(slot.token),
      ),
    );
    filledTokens.push(slot.token);
  }

  // ── Transaction grid (#726 pitch) ──────────────────────────────
  const col = ST_GEORGE_TXN_COLUMNS;
  let filled = 0;
  let txnIndex = 0;

  const paintPage = (
    page: number,
    firstY: number,
    maxRows: number,
    yMax: number,
  ) => {
    for (let row = 0; row < maxRows && txnIndex < txns.length; row++) {
      const y = firstY + row * ST_GEORGE_ROW_PITCH;
      if (y > yMax) break;
      const txn = txns[txnIndex++];
      const { primary, secondary } = splitDescription(txn);
      const date = formatStGeorgeDayMonth(txn.date);
      const amt = formatStGeorgeAmount(txn.debit, txn.credit);
      const bal = formatStGeorgeBalance(txn.balance);

      edits.push(
        slotEdit(page, col.dateX, y, col.dateW, col.rowH, date, `d${txnIndex}`),
      );
      edits.push(
        slotEdit(
          page,
          col.descX,
          y,
          col.descW,
          col.rowH,
          primary,
          `p${txnIndex}`,
        ),
      );
      if (secondary) {
        edits.push(
          slotEdit(
            page,
            col.descX,
            y + col.secondaryOffset,
            col.descW,
            col.rowH - 2,
            secondary,
            `s${txnIndex}`,
          ),
        );
      }
      edits.push(
        slotEdit(
          page,
          col.amountX,
          y,
          col.amountW,
          col.rowH,
          amt,
          `a${txnIndex}`,
        ),
      );
      edits.push(
        slotEdit(
          page,
          col.balanceX,
          y,
          col.balanceW,
          col.rowH,
          bal,
          `b${txnIndex}`,
        ),
      );
      filled += 1;
    }
  };

  if (expandRows) {
    paintPage(
      1,
      ST_GEORGE_TXN_GRID.page1.firstRowY,
      ST_GEORGE_TXN_GRID.page1.maxRows,
      ST_GEORGE_TXN_GRID.page1.yMax,
    );
    let page = 2;
    while (txnIndex < txns.length && page <= totalPages) {
      paintPage(
        page,
        ST_GEORGE_TXN_GRID.page2plus.firstRowY,
        ST_GEORGE_TXN_GRID.page2plus.maxRows,
        ST_GEORGE_TXN_GRID.page2plus.yMax,
      );
      page += 1;
    }
    notes.push(
      `Layered grid: pitch=${ST_GEORGE_ROW_PITCH}pt · filled ${filled}/${txns.length} txn rows · pages planned ${totalPages}.`,
    );
  } else {
    // Only first two sample slots like bare token template
    paintPage(1, ST_GEORGE_TXN_GRID.page1.firstRowY, 2, ST_GEORGE_TXN_GRID.page1.yMax);
    notes.push(`Layered sample slots only (expandRows=false): ${filled} rows.`);
  }

  if (txnIndex < txns.length) {
    notes.push(
      `${txns.length - txnIndex} transaction(s) beyond page capacity (base is 2 pages; clone pages not yet grafted).`,
    );
  }

  notes.push(
    `Chrome slots filled: ${filledTokens.length}. Write target: TEMPLATE 2 base (static kept). Geometry from placement blueprint.`,
  );

  return {
    edits,
    filledTokens: [...new Set(filledTokens)],
    unmatchedTokens: [],
    transactionSlotsFilled: filled,
    transactionSlotsAvailable: filled + (txns.length - txnIndex),
    notes,
    mode: "st-george-template-fill",
  };
}

/**
 * Paint generated data onto TEMPLATE 2 base using placement-map geometry.
 */
export async function fillStGeorgeLayered(
  input: LayeredStGeorgeFillInput,
): Promise<StGeorgeTemplateFillResult & { compose: string }> {
  const base = input.basePdf ?? input.templatePdf;
  if (!base || base.byteLength < 50) {
    throw new Error("fillStGeorgeLayered requires basePdf (TEMPLATE 2)");
  }

  const built = buildLayeredStGeorgeEdits({ ...input, basePdf: base });
  const safe = built.edits.filter((e) => String(e.replacement ?? "").trim());

  if (safe.length === 0) {
    return {
      ...built,
      candidatePdf: cloneUint8Array(base),
      compose: "base-only",
      notes: [...built.notes, "No edits — returning base unchanged."],
    };
  }

  // Blank shell: FreeText-only (burnOriginal=false). Redacting empty regions
  // at 150+ scale triggers MuPDF WASM "table index out of bounds".
  const candidatePdf = await applyReplacementsWithFallbacks(
    cloneUint8Array(base),
    safe.map((e) => ({
      page: e.page,
      bbox: e.bbox,
      replacement: e.replacement,
      fontSpec: e.fontSpec,
    })),
    undefined,
    {
      burnOriginal: false,
      chunkSize: 48,
      engines: ["pdfium", "mupdf", "remote"],
    },
  );

  return {
    ...built,
    edits: safe,
    candidatePdf: cloneUint8Array(candidatePdf),
    compose: "template2-base + placement-geometry + freeText (multi-engine)",
    notes: [
      ...built.notes,
      `Applied ${safe.length} FreeText injection(s) onto TEMPLATE 2 base via engine chain (burn=off).`,
    ],
  };
}

/** Detect Complete Freedom shell (base or placement map). */
export function isStGeorgeCompleteFreedomShell(text: string): boolean {
  const t = text.toUpperCase();
  return (
    t.includes("COMPLETE FREEDOM") &&
    t.includes("TRANSACTION LISTING") &&
    (t.includes("CURRENT BALANCE") || t.includes("{CURRENT BALANCE}"))
  );
}
