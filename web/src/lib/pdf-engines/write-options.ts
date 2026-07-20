/**
 * Shared write options for multi-engine PDF replacement.
 */
import type { PdfFontSpec } from "@/lib/types";
import type { EngineId } from "./types";

export interface PdfReplacement {
  page: number;
  bbox: { x: number; y: number; width: number; height: number };
  replacement: string;
  fontSpec: PdfFontSpec;
  /** When false, skip content-stream burn (blank shells / FreeText-only). */
  burn?: boolean;
}

export interface ApplyReplacementsOptions {
  /**
   * When true (default for filled statements), burn original glyphs via
   * MuPDF applyRedaction(0) before FreeText. Set false for blank shells
   * (TEMPLATE 2) — redacting empty regions stresses WASM and causes OOB.
   */
  burnOriginal?: boolean;
  /** Max replacements per MuPDF pass (default 64). Large batches OOB. */
  chunkSize?: number;
  /** Prefer remote native PyMuPDF when configured. */
  preferRemote?: boolean;
  /** Engines to try in order. Default **pdfium** (write engine of record) → mupdf → remote. */
  engines?: Array<"pdfium" | "mupdf" | "remote">;
  /**
   * Coordinate space of incoming bboxes.
   * - `top-down` (default): y=0 at page top (PDF.js viewport, blueprints).
   *   Converted to PDF user space at the MuPDF write boundary.
   * - `pdf`: already PDF user space (y=0 at page bottom) — no Y flip.
   */
  coordSpace?: "top-down" | "pdf";
  /**
   * Minimum fraction of FreeText inserts that must succeed (0–1).
   * Default 0.35 — throw if the write is mostly empty (ghost replica).
   */
  minApplyRatio?: number;
}

export interface ApplyReplacementsResult {
  pdf: Uint8Array;
  engineUsed: string;
  enginesTried: string[];
  chunks: number;
  applied: number;
  burned: number;
  notes: string[];
}

export const DEFAULT_WRITE_CHUNK = 64;
