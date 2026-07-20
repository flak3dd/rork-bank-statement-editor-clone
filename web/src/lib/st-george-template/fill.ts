/**
 * Fill St George Complete Freedom PDF with variables + transactions.
 *
 * Layer model (visual layout fidelity):
 * - TEMPLATE 2 = base layer (keep all static chrome as-is)
 * - TEMPLATE   = placement map ({TOKEN} geometry for injection)
 * - Final #726 = structure / density target
 *
 * Prefer `fillStGeorgeLayered` (base + blueprint geometry).
 * This module still supports pure token-template fill for the placement map PDF.
 */
import { cloneUint8Array } from "@/lib/bytes";
import { matchFontSpec } from "@/lib/pdf-render";
import { applyReplacementsWithFallbacks } from "@/lib/pdf-engines";
import {
  isVariableSet,
  type StatementVariableOverrides,
} from "@/lib/statement-gen/variables";
import type { PdfEdit, Transaction } from "@/lib/types";
import { getPageTextRunsFromBytes, type ExtractedRun } from "@/lib/tools/pdf-runs";
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
  DEFAULT_ST_GEORGE_BASE_PATH,
  DEFAULT_ST_GEORGE_PLACEMENT_PATH,
  DEFAULT_ST_GEORGE_TEMPLATE_PATH,
} from "./geometry-blueprint";

export {
  DEFAULT_ST_GEORGE_BASE_PATH,
  DEFAULT_ST_GEORGE_PLACEMENT_PATH,
  DEFAULT_ST_GEORGE_TEMPLATE_PATH,
};

export interface StGeorgeTemplateFillInput {
  /**
   * PDF to scan for `{TOKEN}` runs and/or write into.
   * For layered compose, pass the placement map here only if using
   * token-fill; prefer basePdf via fillStGeorgeLayered.
   */
  templatePdf: Uint8Array;
  /** Optional identity / period overrides. */
  variables?: StatementVariableOverrides | null;
  /** Working ledger to paint into txn slots. */
  transactions: Transaction[];
  /** Explicit period (ISO). Defaults from transactions. */
  periodStart?: string;
  periodEnd?: string;
  /** Account opened ISO date. */
  accountOpened?: string;
  /** Current / closing balance override. */
  currentBalance?: number | null;
  maxPages?: number;
}

export interface StGeorgeTemplateFillResult {
  edits: PdfEdit[];
  candidatePdf: Uint8Array;
  filledTokens: string[];
  unmatchedTokens: string[];
  transactionSlotsFilled: number;
  transactionSlotsAvailable: number;
  notes: string[];
  mode: "st-george-template-fill";
}

function runToEdit(
  run: ExtractedRun,
  replacement: string,
  tag: string,
): PdfEdit | null {
  const text = replacement.trim();
  if (!text) return null;
  return {
    id: `stgtpl-${tag}-${Math.random().toString(36).slice(2, 8)}`,
    page: run.page,
    runId: `p${run.page}-x${run.x.toFixed(0)}-y${run.y.toFixed(0)}-${run.text.slice(0, 12)}`,
    original: run.text,
    replacement: text,
    bbox: {
      x: run.x,
      y: run.y - (run.height || 10),
      width: Math.max(run.width, text.length * Math.max((run.fontSize || 9) * 0.45, 3)),
      height: Math.max(run.height || 10, 8),
    },
    fontSpec: run.fontSpec ?? matchFontSpec(run.fontName, run.fontName),
  };
}

/** Resolve chrome/header token values from variables + ledger. */
export function resolveStGeorgeTokenValues(
  input: StGeorgeTemplateFillInput,
): Record<string, string> {
  const v = input.variables ?? {};
  const txns = input.transactions ?? [];
  const dates = txns.map((t) => t.date).filter(Boolean).sort();
  const periodStart =
    input.periodStart || dates[0] || new Date().toISOString().slice(0, 10);
  const periodEnd =
    input.periodEnd || dates[dates.length - 1] || periodStart;
  const days = periodDayCount(periodStart, periodEnd);

  const holder =
    (isVariableSet(v.holderName) ? String(v.holderName) : "") ||
    "STATEMENT CUSTOMER";
  const addr1 =
    (isVariableSet(v.addressLine1) ? String(v.addressLine1) : "") ||
    "1 SAMPLE STREET";
  const addr2 =
    (isVariableSet(v.addressLine2) ? String(v.addressLine2) : "") ||
    "SYDNEY NSW 2000";
  const bsb =
    (isVariableSet(v.bsb) ? String(v.bsb) : "") ||
    (isVariableSet(v.bsbCode) ? String(v.bsbCode) : "") ||
    "000-000";
  const account =
    (isVariableSet(v.accountNumber) ? String(v.accountNumber) : "") ||
    "000 000 000";

  let currentBal = input.currentBalance;
  if (currentBal == null) {
    for (let i = txns.length - 1; i >= 0; i--) {
      if (txns[i].balance != null) {
        currentBal = txns[i].balance;
        break;
      }
    }
  }
  if (currentBal == null) currentBal = 0;

  const opened = input.accountOpened
    ? formatStGeorgeLongDate(input.accountOpened)
    : "01-Jan-2020";
  const created = formatNowStGeorgeCreated();

  return {
    "{FIRSTNAME LASTNAME}": holder.toUpperCase(),
    "{ADDRESS LINE 1}": addr1.toUpperCase(),
    "{ADDRESS LINE 2}": addr2.toUpperCase(),
    "{BSB}": bsb,
    "{ACCOUNT}": account,
    "{DATE}": opened,
    "{NUMBER OF DAYS)": String(days),
    "{NUMBER OF DAYS}": String(days),
    "{FROM DATE}": formatStGeorgeLongDate(periodStart),
    "{TO DATE}": formatStGeorgeLongDate(periodEnd),
    "{CURRENT BALANCE}": formatStGeorgeBalance(currentBal),
    "{DATE CREATE": created.dateCreate,
    "{DATE CREATE {TIME}": `${created.dateCreate} ${created.time}`,
    "{TIME}": created.time,
    "{X}": "", // page numbers handled specially
  };
}

/**
 * Detect whether PDF text looks like the St George Complete Freedom template.
 */
export function isStGeorgeTemplateText(text: string): boolean {
  const t = text.toUpperCase();
  return (
    t.includes("COMPLETE FREEDOM") &&
    (t.includes("{FIRSTNAME") ||
      t.includes("{BSB}") ||
      t.includes("STGEORGE TRANSACTION") ||
      t.includes("{CURRENT BALANCE}"))
  );
}

interface TxnRowSlot {
  page: number;
  y: number;
  dateRun?: ExtractedRun;
  descRun?: ExtractedRun;
  amountRuns: ExtractedRun[];
}

/** Cluster template txn placeholder runs into rows by Y. */
function detectTransactionSlots(runs: ExtractedRun[]): TxnRowSlot[] {
  const slots: TxnRowSlot[] = [];
  const used = new Set<number>();

  for (let i = 0; i < runs.length; i++) {
    if (used.has(i)) continue;
    const r = runs[i];
    const text = r.text.replace(/\s+/g, " ").trim();
    // Row anchor: date or combined date+txn placeholder
    const isDateSlot =
      /\{dd\s*mmm\}/i.test(text) ||
      /\{dd mmm\}/i.test(text) ||
      (text.includes("{") && /dd\s*mmm/i.test(text));
    const isTxnCombined =
      /STGEORGE\s*TRANSACTION/i.test(text) && /\{/.test(text);

    if (!isDateSlot && !isTxnCombined) continue;

    const yTol = Math.max(3, r.height * 0.6);
    const rowRuns: ExtractedRun[] = [];
    for (let j = 0; j < runs.length; j++) {
      if (runs[j].page !== r.page) continue;
      if (Math.abs(runs[j].y - r.y) <= yTol) {
        rowRuns.push(runs[j]);
        used.add(j);
      }
    }
    rowRuns.sort((a, b) => a.x - b.x);

    const amountRuns = rowRuns.filter(
      (x) =>
        /\{amount\}/i.test(x.text) ||
        /^\$[\d,]+(\.\d{2})?$/.test(x.text.trim()) ||
        /^-?\$[\d,]+/.test(x.text.trim()),
    );
    const dateRun =
      rowRuns.find((x) => /\{dd/i.test(x.text) || /dd\s*mmm/i.test(x.text)) ??
      rowRuns[0];
    const descRun =
      rowRuns.find((x) => /STGEORGE\s*TRANSACTION/i.test(x.text)) ??
      rowRuns.find((x) => x !== dateRun && !amountRuns.includes(x));

    // Skip header-only rows without amount slots and without txn token
    if (!descRun && amountRuns.length === 0 && !isTxnCombined) continue;

    slots.push({
      page: r.page,
      y: r.y,
      dateRun,
      descRun: descRun === dateRun ? undefined : descRun,
      amountRuns,
    });
  }

  // Sort by page then top-to-bottom (PDF.js y often increases downward after transform — use as extracted)
  slots.sort((a, b) =>
    a.page !== b.page ? a.page - b.page : a.y - b.y,
  );
  return slots;
}

/**
 * Build PdfEdits that fill template placeholders + transaction row slots.
 */
export async function buildStGeorgeTemplateEdits(
  input: StGeorgeTemplateFillInput,
): Promise<Omit<StGeorgeTemplateFillResult, "candidatePdf">> {
  const notes: string[] = [];
  const filledTokens: string[] = [];
  const unmatchedTokens: string[] = [];
  const edits: PdfEdit[] = [];
  const maxPages = input.maxPages ?? 8;

  const runs = await getPageTextRunsFromBytes(
    cloneUint8Array(input.templatePdf),
    maxPages,
  );
  notes.push(`Scanned ${runs.length} template text runs (maxPages=${maxPages}).`);

  const tokens = resolveStGeorgeTokenValues(input);
  const usedRun = new Set<number>();

  // ── Chrome / header tokens ─────────────────────────────────────
  for (let i = 0; i < runs.length; i++) {
    if (usedRun.has(i)) continue;
    const run = runs[i];
    const raw = run.text;
    if (!raw.includes("{")) continue;

    // Skip pure transaction row anchors here (handled in slots)
    if (/STGEORGE\s*TRANSACTION/i.test(raw) || /\{dd\s*mmm\}/i.test(raw)) {
      continue;
    }
    if (/^\{amount\}$/i.test(raw.trim())) continue;

    let replacement: string | null = null;
    let tokenKey = "";

    // Exact / contained token match (longest first)
    const keys = Object.keys(tokens).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (!key || key === "{X}") continue;
      if (raw.includes(key) || normToken(raw) === normToken(key)) {
        replacement = tokens[key];
        tokenKey = key;
        break;
      }
    }

    // Partial broken tokens e.g. "{DATE CREATE" without closing brace
    if (replacement == null) {
      if (/DATE\s*CREATE/i.test(raw)) {
        replacement = tokens["{DATE CREATE"] || tokens["{DATE CREATE {TIME}"];
        tokenKey = "{DATE CREATE";
      } else if (/^\{TIME\}?$/i.test(raw.trim()) || raw.trim() === "{TIME}") {
        replacement = tokens["{TIME}"];
        tokenKey = "{TIME}";
      } else if (/NUMBER OF DAYS/i.test(raw)) {
        // may be whole phrase run
        replacement = raw
          .replace(/\{NUMBER OF DAYS\)?/gi, tokens["{NUMBER OF DAYS)"])
          .replace(/\{FROM DATE\}/gi, tokens["{FROM DATE}"])
          .replace(/\{TO DATE\}/gi, tokens["{TO DATE}"]);
        tokenKey = "period-phrase";
      } else if (/^\{X\}$/i.test(raw.trim())) {
        // page number: page of pageCount — fill with page index
        replacement = String(run.page);
        tokenKey = "{X}";
      }
    }

    if (replacement == null || replacement === "") {
      if (raw.includes("{")) unmatchedTokens.push(raw.slice(0, 40));
      continue;
    }

    // If token is only part of a larger fixed string, replace token substring
    let finalText = replacement;
    if (tokenKey && raw.includes(tokenKey) && raw !== tokenKey) {
      finalText = raw.split(tokenKey).join(replacement);
    } else if (tokenKey === "period-phrase") {
      finalText = replacement;
    }

    const edit = runToEdit(run, finalText, `tok-${tokenKey || i}`);
    if (edit) {
      edits.push(edit);
      usedRun.add(i);
      filledTokens.push(tokenKey || raw.slice(0, 24));
    }
  }

  // ── Transaction row slots ──────────────────────────────────────
  const slots = detectTransactionSlots(runs);
  notes.push(`Detected ${slots.length} transaction row slot(s) on template.`);
  const txns = input.transactions.filter(
    (t) => t.description && !/^OPENING|^CLOSING/i.test(t.description),
  );
  let filled = 0;
  for (let s = 0; s < slots.length; s++) {
    const slot = slots[s];
    const txn = txns[s];
    if (!txn) break;

    if (slot.dateRun) {
      // Combined "{dd mmm}{STGEORGE TRANSACTION}" → "18 Nov Visa Purchase …"
      if (
        /STGEORGE\s*TRANSACTION/i.test(slot.dateRun.text) ||
        (/\{dd/i.test(slot.dateRun.text) &&
          /TRANSACTION/i.test(slot.dateRun.text))
      ) {
        const line = `${formatStGeorgeDayMonth(txn.date)} ${formatStGeorgeTransactionLine(txn)}`;
        const e = runToEdit(slot.dateRun, line, `txn-date-desc-${s}`);
        if (e) edits.push(e);
      } else {
        const e = runToEdit(
          slot.dateRun,
          formatStGeorgeDayMonth(txn.date),
          `txn-date-${s}`,
        );
        if (e) edits.push(e);
        if (slot.descRun) {
          const e2 = runToEdit(
            slot.descRun,
            formatStGeorgeTransactionLine(txn),
            `txn-desc-${s}`,
          );
          if (e2) edits.push(e2);
        }
      }
    } else if (slot.descRun) {
      const e = runToEdit(
        slot.descRun,
        formatStGeorgeTransactionLine(txn),
        `txn-desc-${s}`,
      );
      if (e) edits.push(e);
    }

    // Amount + balance columns (left amount, right balance typically)
    const amt = formatStGeorgeAmount(txn.debit, txn.credit);
    const bal = formatStGeorgeBalance(txn.balance);
    const amounts = slot.amountRuns;
    if (amounts.length >= 2) {
      // sort by x: amount then balance
      const sorted = [...amounts].sort((a, b) => a.x - b.x);
      const eA = runToEdit(sorted[0], amt, `txn-amt-${s}`);
      const eB = runToEdit(sorted[sorted.length - 1], bal, `txn-bal-${s}`);
      if (eA) edits.push(eA);
      if (eB) edits.push(eB);
    } else if (amounts.length === 1) {
      const eA = runToEdit(amounts[0], amt, `txn-amt-${s}`);
      if (eA) edits.push(eA);
    }
    filled += 1;
  }

  if (txns.length > slots.length) {
    notes.push(
      `Template has ${slots.length} txn row slot(s); ${txns.length - slots.length} transaction(s) not painted (need more template rows / multi-page slots).`,
    );
  }

  notes.push(
    `Filled ${filledTokens.length} chrome token run(s), ${filled} txn slot(s), ${edits.length} PdfEdit(s) total.`,
  );

  return {
    edits,
    filledTokens: [...new Set(filledTokens)],
    unmatchedTokens: [...new Set(unmatchedTokens)],
    transactionSlotsFilled: filled,
    transactionSlotsAvailable: slots.length,
    notes,
    mode: "st-george-template-fill",
  };
}

function normToken(s: string): string {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Fill template and produce candidate PDF (no redactions — cover + FreeText).
 */
export async function fillStGeorgeTemplate(
  input: StGeorgeTemplateFillInput,
): Promise<StGeorgeTemplateFillResult> {
  const built = await buildStGeorgeTemplateEdits(input);
  if (built.edits.length === 0) {
    return {
      ...built,
      candidatePdf: cloneUint8Array(input.templatePdf),
      notes: [
        ...built.notes,
        "No edits produced — returning template bytes unchanged.",
      ],
    };
  }

  const safe = built.edits.filter((e) => String(e.replacement ?? "").trim());
  const candidatePdf = await applyReplacementsWithFallbacks(
    cloneUint8Array(input.templatePdf),
    safe.map((e) => ({
      page: e.page,
      bbox: e.bbox,
      replacement: e.replacement,
      fontSpec: e.fontSpec,
    })),
    undefined,
    {
      // Token shells still have placeholder text to burn
      burnOriginal: true,
      chunkSize: 48,
      engines: ["pdfium", "mupdf", "remote"],
    },
  );

  return {
    ...built,
    edits: safe,
    candidatePdf: cloneUint8Array(candidatePdf),
  };
}
