import * as pdfjs from "pdfjs-dist";
import { ensurePdfWorker } from "@/lib/pdf-worker";
import { cloneUint8Array } from "./bytes";
import { parseAmount } from "./money";
import { normalizeDate } from "./parse-transactions";
import type { PdfEdit, PdfFontSpec, Transaction } from "./types";

function makeFamilyStack(fontFamily?: string, fontName?: string): string {
  const raw = fontFamily?.trim() ?? fontName?.trim();
  if (!raw) return "sans-serif";
  const clean = raw.replace(/g_d0_/gi, "").replace(/[^a-z0-9\- ,]/gi, "");
  const lower = clean.toLowerCase();
  if (/courier|mono|consolas/.test(lower)) {
    return `"${clean}", "Courier New", Consolas, monospace`;
  }
  if (/times|georgia|serif/.test(lower)) {
    return `"${clean}", "Times New Roman", Georgia, serif`;
  }
  if (/arial|helvetica|verdana|tahoma|trebuchet/.test(lower)) {
    return `"${clean}", "Helvetica Neue", Arial, sans-serif`;
  }
  return `"${clean}", sans-serif`;
}

/** Match a PDF embedded/detected font to a web-safe donor stack by weight and width. */
export function matchFontSpec(fontFamily?: string, fontName?: string): PdfFontSpec {
  const raw = `${fontFamily ?? ""} ${fontName ?? ""}`.toLowerCase();
  let weight = 400;
  if (/bold|heavy|black/.test(raw)) weight = 700;
  else if (/light|thin/.test(raw)) weight = 300;

  let style: PdfFontSpec["style"] = "normal";
  if (/italic/.test(raw)) style = "italic";
  else if (/oblique/.test(raw)) style = "oblique";

  let stretch = "normal";
  if (/condensed|narrow/.test(raw)) stretch = "condensed";
  else if (/wide|expanded|extended/.test(raw)) stretch = "expanded";

  return {
    family: makeFamilyStack(fontFamily, fontName),
    weight,
    style,
    stretch,
  };
}

export interface PdfTextRun {
  id: string;
  page: number;
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  angle: number;
  dir: string;
  fontName: string;
  fontSpec: PdfFontSpec;
}

export interface PageInfo {
  pageNumber: number;
  viewport: { width: number; height: number; scale: number; transform: number[] };
  runs: PdfTextRun[];
}

export async function renderPageToCanvas(
  data: Uint8Array,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.4,
): Promise<PageInfo> {
  await ensurePdfWorker();
  // Clone — PDF.js worker may transfer/detach the buffer
  const owned = cloneUint8Array(data);
  const doc = await pdfjs.getDocument({ data: owned }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const runs = await getPageTextRuns(page, viewport);
  return {
    pageNumber,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      scale,
      transform: Array.from(viewport.transform) as number[],
    },
    runs,
  };
}

async function getPageTextRuns(page: any, viewport: any): Promise<PdfTextRun[]> {
  const textContent = await page.getTextContent();
  const styles = (textContent.styles ?? {}) as Record<string, { fontFamily?: string }>;
  const items = textContent.items as Array<{
    str?: string;
    dir?: string;
    width?: number;
    height?: number;
    transform?: number[];
    fontName?: string;
    hasEOL?: boolean;
  }>;
  const runs: PdfTextRun[] = [];

  items.forEach((item, i) => {
    if (!item.str || typeof item.str !== "string") return;
    if (!item.transform || item.transform.length < 6) return;
    const tx = pdfjs.Util.transform(viewport.transform, item.transform) as number[];
    const fontHeight = Math.hypot(tx[0], tx[1]) || 12;
    const width = (item.width ?? 0) * viewport.scale;
    const height = (item.height ?? 0) * viewport.scale || fontHeight;
    const angle = Math.atan2(tx[1], tx[0]) * (180 / Math.PI);
    const style = (item.fontName && styles[item.fontName]) || {};

    runs.push({
      id: `${page.pageNumber}-${i}-${item.str.length}`,
      page: page.pageNumber,
      index: i,
      text: item.str,
      x: tx[4],
      y: tx[5],
      width,
      height,
      fontSize: fontHeight,
      angle,
      dir: item.dir ?? "ltr",
      fontName: item.fontName ?? "unknown",
      fontSpec: matchFontSpec(style.fontFamily, item.fontName),
    });
  });

  return runs;
}

function parseEditValue(field: keyof Transaction, replacement: string): string | number | null {
  if (field === "date") return normalizeDate(replacement);
  if (field === "description") return replacement.trim();
  return parseAmount(replacement);
}

export function findTransactionIdByValue(
  transactions: Transaction[],
  original: string,
): string | null {
  const amount = parseAmount(original);
  const date = normalizeDate(original);
  for (const t of transactions) {
    if (amount != null && (t.debit === amount || t.credit === amount || t.balance === amount)) {
      return t.id;
    }
    if (date && t.date === date) return t.id;
    if (original.trim().toLowerCase() === (t.description ?? "").trim().toLowerCase()) {
      return t.id;
    }
  }
  return null;
}

export function inferField(transaction: Transaction, original: string): keyof Transaction {
  const amount = parseAmount(original);
  const date = normalizeDate(original);
  if (date && transaction.date === date) return "date";
  if (amount != null) {
    if (transaction.debit === amount) return "debit";
    if (transaction.credit === amount) return "credit";
    if (transaction.balance === amount) return "balance";
    return "debit";
  }
  return "description";
}

export function applyEditToTransaction(
  transactions: Transaction[],
  edit: { original: string; replacement: string; linkedTransactionId?: string },
): { id: string; field: keyof Transaction; value: string | number | null } | null {
  let id = edit.linkedTransactionId;
  let field: keyof Transaction = "description";
  if (id) {
    const t = transactions.find((x) => x.id === id);
    if (t) field = inferField(t, edit.original);
  } else {
    id = findTransactionIdByValue(transactions, edit.original);
    if (id) {
      const t = transactions.find((x) => x.id === id);
      if (t) field = inferField(t, edit.original);
    }
  }
  if (!id) return null;
  const value = parseEditValue(field, edit.replacement);
  if (value == null) return null;
  return { id, field, value };
}
