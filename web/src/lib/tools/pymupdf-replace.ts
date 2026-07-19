/**
 * Client-side orchestration for "PyMuPDF-style" statement data replacement.
 *
 * Browser path: bank description generators + text-run matching + mupdf/pdfium
 * engine chain (WASM). For native PyMuPDF Pro fidelity, use the Python CLI:
 *
 *   python tools/pymupdf_pipeline/replace_statement.py \
 *     --pdf statement.pdf --bank anz --seed 42 --out out.pdf
 *
 * This module rewrites table descriptions with bank-authentic generation logic
 * and builds PdfEdit queues so Export PDF applies redaction + reinsertion.
 */

import { cloneUint8Array } from "@/lib/bytes";
import { attachOriginals, snapshotOf } from "@/lib/edit-utils";
import type { PdfEdit, Transaction } from "@/lib/types";
import {
  BANK_IDS,
  BANK_LABELS,
  generateBankDescription,
  normalizeBankId,
  type BankId,
} from "./bank-descriptions";
import {
  buildFontReplicatedReplacements,
  type FontRunMatch,
} from "./advanced-generator";
import { getPageTextRunsFromBytes } from "./pdf-runs";
import { linkRunMatches, pairGeneratedToMatches } from "./run-match";

export { BANK_IDS, BANK_LABELS, type BankId };

export interface PymupdfReplaceOptions {
  /** Working-set transactions (current PDF table values). */
  transactions: Transaction[];
  /** PDF bytes for geometry linking (optional — table-only without it). */
  pdfBytes?: Uint8Array | null;
  /** Bank generator id (anz, cba, westpac, …). */
  bank: string;
  /** Which fields to regenerate. Default descriptions only. */
  replace?: Array<"description" | "debit" | "credit" | "balance">;
  /** Max pages to scan for text runs. */
  maxPages?: number;
  /**
   * When true, only rewrite descriptions that currently match a PDF run
   * (safer for exact-replica geometry). Default false = rewrite all rows.
   */
  onlyLinked?: boolean;
}

export interface PymupdfReplaceResult {
  transactions: Transaction[];
  edits: PdfEdit[];
  bank: BankId;
  linkStats: {
    linked: number;
    fields: number;
    runs: number;
    descriptionEdits: number;
  };
  mode: "table+geometry" | "table-only";
  note: string;
}

/**
 * Replace original statement descriptions (and optionally money fields)
 * using bank generation logic, and queue font-linked PdfEdits for the
 * mupdf write path (browser stand-in for PyMuPDF).
 */
export async function replaceStatementDataWithGeneration(
  options: PymupdfReplaceOptions,
): Promise<PymupdfReplaceResult> {
  const bank = normalizeBankId(options.bank);
  const fields = new Set(options.replace ?? ["description"]);
  const previous = options.transactions;
  const maxPages = options.maxPages ?? 8;

  const next: Transaction[] = previous.map((t) => {
    const row: Transaction = {
      ...t,
      original: t.original ?? snapshotOf(t),
      flags: [...new Set([...t.flags, "bank-desc", bank, "pymupdf-replace"])],
    };
    if (fields.has("description")) {
      row.description = generateBankDescription(bank);
    }
    // Money field regeneration is optional and conservative — leave values
    // unless explicitly requested (balance chain integrity is caller's job).
    if (fields.has("debit") && row.debit != null) {
      const jitter = 0.85 + Math.random() * 0.3;
      row.debit = Math.round(row.debit * jitter * 100) / 100;
    }
    if (fields.has("credit") && row.credit != null) {
      const jitter = 0.85 + Math.random() * 0.3;
      row.credit = Math.round(row.credit * jitter * 100) / 100;
    }
    return row;
  });

  const generated = attachOriginals(next);

  if (!options.pdfBytes || previous.length === 0) {
    return {
      transactions: generated,
      edits: [],
      bank,
      linkStats: {
        linked: 0,
        fields: 0,
        runs: 0,
        descriptionEdits: 0,
      },
      mode: "table-only",
      note:
        "No PDF bytes — table replaced with bank generators only. " +
        "Use Python PyMuPDF CLI for native PDF rewrite: " +
        "tools/pymupdf_pipeline/replace_statement.py",
    };
  }

  // Clone so PDF.js cannot detach the caller's pdfBytes state
  const pdfCopy = cloneUint8Array(options.pdfBytes);
  const runs = await getPageTextRunsFromBytes(pdfCopy, maxPages);
  const { matches, stats } = linkRunMatches({
    transactions: previous,
    runs,
    preferOriginal: true,
  });

  let paired: FontRunMatch[] = pairGeneratedToMatches({
    previous,
    generated,
    matches,
  });

  // Only keep fields we intend to replace
  paired = paired.filter((m) =>
    fields.has(m.field as "description" | "debit" | "credit" | "balance"),
  );

  if (options.onlyLinked) {
    const linkedIds = new Set(paired.map((m) => m.transactionId));
    for (let i = 0; i < generated.length; i++) {
      if (!linkedIds.has(generated[i].id)) {
        // restore description if not linked
        generated[i] = {
          ...generated[i],
          description: previous[i]?.description ?? generated[i].description,
        };
      }
    }
  }

  const edits = buildFontReplicatedReplacements({
    transactions: generated,
    runMatches: paired,
  });

  return {
    transactions: generated,
    edits,
    bank,
    linkStats: {
      linked: stats.linked,
      fields: stats.fields,
      runs: stats.runs,
      descriptionEdits: edits.filter((e) => e.linkedField === "description")
        .length,
    },
    mode: "table+geometry",
    note: `Bank ${bank}: ${edits.length} geometry-linked PdfEdit(s). Export PDF applies mupdf redaction+insert (WASM). Native Pro: python tools/pymupdf_pipeline/replace_statement.py`,
  };
}

/** Shell command helper text for the UI / docs. */
export function pymupdfCliHint(
  bank: string,
  seed = 42,
): string {
  const b = normalizeBankId(bank);
  return `python tools/pymupdf_pipeline/replace_statement.py --pdf statement.pdf --bank ${b} --seed ${seed} --replace descriptions --out statement-${b}-replaced.pdf`;
}
