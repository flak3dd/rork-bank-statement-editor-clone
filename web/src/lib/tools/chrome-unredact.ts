/**
 * Unredacter — inject optional statement variables onto the original PDF.
 *
 * Policy: NEVER REDACT without replacement text. Every PdfEdit carries the
 * new value; MuPDF path redacts-then-inserts FreeText so fields stay readable.
 *
 * Only *set* overrides produce edits. Chrome fields (holder, BSB, address, …)
 * are geometry-linked to PDF text runs when originals can be found.
 */
import { cloneUint8Array } from "@/lib/bytes";
import { matchFontSpec } from "@/lib/pdf-render";
import {
  isVariableSet,
  setVariableKeys,
  type StatementVariableKey,
  type StatementVariableOverrides,
} from "@/lib/statement-gen/variables";
import type { PdfEdit } from "@/lib/types";
import { getPageTextRunsFromBytes, type ExtractedRun } from "./pdf-runs";

export interface UnredactResult {
  edits: PdfEdit[];
  /** Keys that were set and successfully linked to geometry. */
  appliedKeys: StatementVariableKey[];
  /** Keys that were set but no PDF run matched. */
  unmatchedKeys: StatementVariableKey[];
  notes: string[];
  mode: "unredact";
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function scoreTextMatch(runText: string, target: string): number {
  const a = norm(runText);
  const b = norm(target);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return 0.55 + ratio * 0.4;
  }
  // digit-only equality (BSB / account)
  const da = digitsOnly(runText);
  const db = digitsOnly(target);
  if (da.length >= 4 && da === db) return 0.95;
  return 0;
}

function findBestRun(
  runs: ExtractedRun[],
  used: Set<number>,
  target: string,
  opts?: { pageMax?: number; minScore?: number },
): { run: ExtractedRun; index: number; score: number } | null {
  const minScore = opts?.minScore ?? 0.55;
  const pageMax = opts?.pageMax ?? 2;
  let best: { run: ExtractedRun; index: number; score: number } | null = null;
  for (let i = 0; i < runs.length; i++) {
    if (used.has(i)) continue;
    const r = runs[i];
    if (r.page > pageMax) continue;
    const score = scoreTextMatch(r.text, target);
    if (score < minScore) continue;
    if (!best || score > best.score) best = { run: r, index: i, score };
  }
  return best;
}

/** Heuristic BSB on AU statements: 000-000 or 6 digits. */
function findBsbRun(
  runs: ExtractedRun[],
  used: Set<number>,
): { run: ExtractedRun; index: number } | null {
  for (let i = 0; i < runs.length; i++) {
    if (used.has(i)) continue;
    const r = runs[i];
    if (r.page > 2) continue;
    const t = r.text.trim();
    if (/^\d{3}[-\s]?\d{3}$/.test(t)) return { run: r, index: i };
    if (/^bsb[:\s]*\d{3}/i.test(t) && digitsOnly(t).length >= 6)
      return { run: r, index: i };
  }
  return null;
}

/** Heuristic account number (6–12 digits, optional spaces). */
function findAccountNumberRun(
  runs: ExtractedRun[],
  used: Set<number>,
  preferredDigits?: string,
): { run: ExtractedRun; index: number } | null {
  if (preferredDigits && preferredDigits.length >= 4) {
    const hit = findBestRun(runs, used, preferredDigits, { minScore: 0.7 });
    if (hit) return hit;
  }
  for (let i = 0; i < runs.length; i++) {
    if (used.has(i)) continue;
    const r = runs[i];
    if (r.page > 2) continue;
    const d = digitsOnly(r.text);
    if (d.length >= 6 && d.length <= 12 && /[\d\s]{6,}/.test(r.text.trim())) {
      // avoid pure BSB-looking 6-digit with dash already taken
      if (/^\d{3}-\d{3}$/.test(r.text.trim())) continue;
      return { run: r, index: i };
    }
  }
  return null;
}

function runToEdit(
  run: ExtractedRun,
  replacement: string,
  key: StatementVariableKey,
): PdfEdit | null {
  const text = replacement.trim();
  if (!text) return null; // NEVER create redaction-only / empty insert
  return {
    id: `unredact-${key}-${Math.random().toString(36).slice(2, 8)}`,
    page: run.page,
    runId: `chrome-${run.page}-${run.x.toFixed(0)}-${run.y.toFixed(0)}`,
    original: run.text,
    replacement: text,
    bbox: {
      x: run.x,
      y: run.y - run.height,
      width: Math.max(run.width, text.length * Math.max(run.fontSize * 0.45, 4)),
      height: Math.max(run.height, 8),
    },
    fontSpec: run.fontSpec ?? matchFontSpec(run.fontName, run.fontName),
    linkedTransactionId: undefined,
    linkedField: undefined,
  };
}

/**
 * Build Unredacter PdfEdits for set statement variables.
 * Always pairs geometry with non-empty replacement text (NEVER REDACT blank).
 */
export async function unredactStatementVariables(params: {
  pdfBytes: Uint8Array;
  overrides: StatementVariableOverrides;
  /** Optional: known original chrome values still drawn on the PDF. */
  originalHints?: Partial<
    Record<
      "holderName" | "accountName" | "accountNumber" | "bsb" | "addressLine1" | "addressLine2",
      string
    >
  >;
  maxPages?: number;
}): Promise<UnredactResult> {
  const notes: string[] = [];
  const appliedKeys: StatementVariableKey[] = [];
  const unmatchedKeys: StatementVariableKey[] = [];
  const edits: PdfEdit[] = [];
  const setKeys = setVariableKeys(params.overrides);

  if (setKeys.length === 0) {
    return {
      edits: [],
      appliedKeys: [],
      unmatchedKeys: [],
      notes: ["No optional variables set — Unredacter skipped."],
      mode: "unredact",
    };
  }

  const runs = await getPageTextRunsFromBytes(
    cloneUint8Array(params.pdfBytes),
    params.maxPages ?? 3,
  );
  notes.push(`Unredacter scanned ${runs.length} runs for ${setKeys.length} set variable(s).`);

  const used = new Set<number>();
  const o = params.overrides;
  const hints = params.originalHints ?? {};

  const tryApply = (
    key: StatementVariableKey,
    replacement: string,
    finder: () => { run: ExtractedRun; index: number } | null,
  ) => {
    if (!isVariableSet(replacement)) return;
    const hit = finder();
    if (!hit) {
      unmatchedKeys.push(key);
      notes.push(`Unmatched chrome key: ${key} → "${replacement.slice(0, 40)}"`);
      return;
    }
    const edit = runToEdit(hit.run, replacement, key);
    if (!edit) {
      unmatchedKeys.push(key);
      notes.push(`Refused empty unredact for ${key} (NEVER REDACT blank).`);
      return;
    }
    used.add(hit.index);
    edits.push(edit);
    appliedKeys.push(key);
  };

  // ── Account / identity ─────────────────────────────────────────
  if (isVariableSet(o.holderName)) {
    const next = String(o.holderName).trim();
    tryApply("holderName", next, () => {
      if (hints.holderName) {
        const h = findBestRun(runs, used, hints.holderName, { minScore: 0.5 });
        if (h) return h;
      }
      // Prefer longer name-like runs on page 1 (title case / multi-word)
      let best: { run: ExtractedRun; index: number; score: number } | null =
        null;
      for (let i = 0; i < runs.length; i++) {
        if (used.has(i)) continue;
        const r = runs[i];
        if (r.page > 1) continue;
        const t = r.text.trim();
        if (t.length < 5 || t.length > 48) continue;
        if (/\d{3}/.test(t)) continue;
        if (/^(account|statement|page|bsb|debit|credit|balance)/i.test(t))
          continue;
        const words = t.split(/\s+/);
        if (words.length < 2) continue;
        const score = 0.5 + Math.min(0.4, t.length / 80);
        if (!best || score > best.score) best = { run: r, index: i, score };
      }
      return best;
    });
  }

  if (isVariableSet(o.accountName)) {
    const next = String(o.accountName).trim();
    tryApply("accountName", next, () => {
      if (hints.accountName) {
        const h = findBestRun(runs, used, hints.accountName, { minScore: 0.5 });
        if (h) return h;
      }
      for (let i = 0; i < runs.length; i++) {
        if (used.has(i)) continue;
        const r = runs[i];
        if (r.page > 1) continue;
        if (/account/i.test(r.text) && r.text.length > 8 && r.text.length < 60)
          return { run: r, index: i };
      }
      return null;
    });
  }

  if (isVariableSet(o.bsb) || isVariableSet(o.bsbCode)) {
    const next = String(o.bsb ?? o.bsbCode).trim();
    tryApply(isVariableSet(o.bsb) ? "bsb" : "bsbCode", next, () => {
      if (hints.bsb) {
        const h = findBestRun(runs, used, hints.bsb, { minScore: 0.7 });
        if (h) return h;
      }
      return findBsbRun(runs, used);
    });
  }

  if (isVariableSet(o.accountNumber)) {
    const next = String(o.accountNumber).trim();
    tryApply("accountNumber", next, () => {
      if (hints.accountNumber) {
        const h = findBestRun(runs, used, hints.accountNumber, {
          minScore: 0.6,
        });
        if (h) return h;
      }
      return findAccountNumberRun(runs, used, digitsOnly(next));
    });
  }

  // ── Address ────────────────────────────────────────────────────
  if (isVariableSet(o.addressLine1)) {
    const next = String(o.addressLine1).trim();
    tryApply("addressLine1", next, () => {
      if (hints.addressLine1) {
        const h = findBestRun(runs, used, hints.addressLine1, {
          minScore: 0.45,
        });
        if (h) return h;
      }
      for (let i = 0; i < runs.length; i++) {
        if (used.has(i)) continue;
        const r = runs[i];
        if (r.page > 1) continue;
        if (/\d+\s+\w+/.test(r.text) && /st|street|rd|road|ave|drive|dr|way|place|pl|court|ct/i.test(r.text))
          return { run: r, index: i };
      }
      return null;
    });
  }

  if (isVariableSet(o.addressLine2)) {
    const next = String(o.addressLine2).trim();
    tryApply("addressLine2", next, () => {
      if (hints.addressLine2) {
        const h = findBestRun(runs, used, hints.addressLine2, {
          minScore: 0.45,
        });
        if (h) return h;
      }
      for (let i = 0; i < runs.length; i++) {
        if (used.has(i)) continue;
        const r = runs[i];
        if (r.page > 1) continue;
        if (/\b(nsw|vic|qld|sa|wa|tas|act|nt)\b/i.test(r.text) && /\d{4}/.test(r.text))
          return { run: r, index: i };
      }
      return null;
    });
  }

  // Narrative schedule variables (salary/savings/mortgage) affect the ledger
  // via generateStatement — they are not chrome geometry. Record as "applied"
  // for audit when set so callers know they feed the generator only.
  const narrativeKeys: StatementVariableKey[] = [
    "salaryDescription",
    "salaryAmount",
    "salaryFrequency",
    "salaryAccount",
    "rentalDescription",
    "rentalAmount",
    "hasRentalIncome",
    "savingsDescription",
    "savingsAmount",
    "savingsFrequency",
    "savingsAccount",
    "mortgageDescription",
    "mortgageLender",
    "mortgageAmount",
    "mortgageFrequency",
    "loanReference",
  ];
  for (const k of narrativeKeys) {
    if (setKeys.includes(k) && !appliedKeys.includes(k) && !unmatchedKeys.includes(k)) {
      notes.push(
        `Variable ${k} is set — applied via generation ledger (not PDF chrome).`,
      );
    }
  }

  notes.push(
    `Unredacter: ${edits.length} PDF edit(s) · applied=${appliedKeys.join(",") || "—"} · unmatched=${unmatchedKeys.join(",") || "—"}`,
  );

  // Safety: drop any edit that somehow has empty replacement
  const safe = edits.filter((e) => e.replacement.trim().length > 0);
  if (safe.length !== edits.length) {
    notes.push(
      `Stripped ${edits.length - safe.length} empty replacement(s) — NEVER REDACT blank.`,
    );
  }

  return {
    edits: safe,
    appliedKeys,
    unmatchedKeys,
    notes,
    mode: "unredact",
  };
}

/**
 * Guard for write path: reject replacements that would leave blank holes.
 */
export function assertNoBlankRedactions(
  replacements: Array<{ replacement: string }>,
): void {
  const blanks = replacements.filter((r) => !String(r.replacement ?? "").trim());
  if (blanks.length > 0) {
    throw new Error(
      `Unredacter policy: ${blanks.length} blank replacement(s) refused (NEVER REDACT without text).`,
    );
  }
}
