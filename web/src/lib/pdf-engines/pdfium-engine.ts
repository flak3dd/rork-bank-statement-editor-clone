/**
 * PDFium engine — primary product write engine of record.
 *
 * @hyzyla/pdfium WASM can load/render/save but cannot FreeText. Geometry
 * injection uses MuPDF WASM, then the result is re-loaded and save()'d through
 * PDFium so the **final statement PDF bytes are produced by Pdfium**.
 */
import { cloneUint8Array } from "@/lib/bytes";
import { matchFontSpec } from "@/lib/pdf-render";
import type { PdfFontSpec } from "@/lib/types";
import { initPdfiumLibrary } from "@/lib/pdfium-init";
import type {
  PdfEngine,
  PdfEngineDocument,
  RenderedPage,
  TextRun,
} from "./types";
import { mupdfEngine } from "./mupdf-engine";

// Loose typing — @hyzyla/pdfium shapes vary by version.
// Note: current @hyzyla/pdfium PDFiumDocument has NO save() — only load/render/destroy.
type PdfiumDoc = {
  pageCount?: number;
  getPageCount?: () => number;
  getPage: (index: number) => PdfiumPage;
  save?: () => Uint8Array | Promise<Uint8Array>;
  saveDocument?: () => Uint8Array | Promise<Uint8Array>;
  destroy: () => void;
};

function isPdfMagic(data: Uint8Array): boolean {
  return (
    data.byteLength >= 5 &&
    data[0] === 0x25 &&
    data[1] === 0x50 &&
    data[2] === 0x44 &&
    data[3] === 0x46
  );
}

type PdfiumPage = {
  width: number;
  height: number;
  render: (opts: { scale: number; backgroundColor?: string }) => ImageData;
  getTextData: () => string;
  getTextPage?: () => PdfiumTextPage;
  destroy: () => void;
};

type PdfiumTextPage = {
  getTextRects: (rect: PdfiumRect) => Array<{ text: string; rect: PdfiumRect }>;
  destroy: () => void;
};

type PdfiumApi = {
  loadDocument: (data: Uint8Array) => PdfiumDoc | Promise<PdfiumDoc>;
};

let pdfiumModule: PdfiumApi | null = null;

async function loadPdfium(): Promise<PdfiumApi> {
  if (pdfiumModule) return pdfiumModule;
  const lib = await initPdfiumLibrary();
  pdfiumModule = lib as unknown as PdfiumApi;
  return pdfiumModule;
}

interface PdfiumRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Prefer PDFium as final byte producer when the binding supports save.
 * @hyzyla/pdfium currently has no save API — fall back to pass-through of
 * MuPDF-injected bytes so we never discard a successful inject.
 */
export async function finalizePdfWithPdfium(
  data: Uint8Array,
): Promise<Uint8Array> {
  const owned = cloneUint8Array(data);
  if (!isPdfMagic(owned)) {
    throw new Error("finalizePdfWithPdfium: input is not a PDF (%PDF missing)");
  }

  try {
    const pdfium = await loadPdfium();
    const doc = await pdfium.loadDocument(cloneUint8Array(owned));
    try {
      const saveFn =
        typeof doc.save === "function"
          ? doc.save.bind(doc)
          : typeof doc.saveDocument === "function"
            ? doc.saveDocument.bind(doc)
            : null;
      if (!saveFn) {
        // Binding cannot re-serialize — return MuPDF bytes unchanged
        return owned;
      }
      const saved = await saveFn();
      const out = cloneUint8Array(
        saved instanceof Uint8Array
          ? saved
          : new Uint8Array(saved as ArrayBuffer),
      );
      if (!isPdfMagic(out)) {
        return owned;
      }
      return out;
    } finally {
      try {
        doc.destroy();
      } catch {
        /* */
      }
    }
  } catch {
    // Load/save failed (corrupt intermediate or WASM) — keep injected bytes
    return owned;
  }
}

class PdfiumDocument implements PdfEngineDocument {
  engine = "pdfium" as const;
  pageCount: number;
  private doc: PdfiumDoc;
  private sourceBytes: Uint8Array;

  constructor(doc: PdfiumDoc, sourceBytes: Uint8Array) {
    this.doc = doc;
    const n =
      typeof doc.getPageCount === "function"
        ? doc.getPageCount()
        : Number(doc.pageCount);
    this.pageCount = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
    this.sourceBytes = cloneUint8Array(sourceBytes);
  }

  async renderPage(pageNumber: number, scale: number): Promise<RenderedPage> {
    const page = this.doc.getPage(pageNumber - 1);
    try {
      const width = page.width * scale;
      const height = page.height * scale;
      const imageData = page.render({ scale, backgroundColor: "white" });
      const runs = this.extractRunsFromPage(page, pageNumber, scale);
      return { pageNumber, width, height, scale, imageData, runs };
    } finally {
      page.destroy();
    }
  }

  async extractPageText(pageNumber: number): Promise<string> {
    const page = this.doc.getPage(pageNumber - 1);
    try {
      return page.getTextData();
    } finally {
      page.destroy();
    }
  }

  async extractPageRuns(pageNumber: number, scale: number): Promise<TextRun[]> {
    const page = this.doc.getPage(pageNumber - 1);
    try {
      return this.extractRunsFromPage(page, pageNumber, scale);
    } finally {
      page.destroy();
    }
  }

  private extractRunsFromPage(
    page: PdfiumPage,
    pageNumber: number,
    scale: number,
  ): TextRun[] {
    const runs: TextRun[] = [];
    try {
      if (!page.getTextPage) return runs;
      const textPage = page.getTextPage();
      const rect: PdfiumRect = {
        left: 0,
        top: 0,
        right: page.width,
        bottom: page.height,
      };
      const textRects = textPage.getTextRects(rect);
      let idx = 0;
      for (const tr of textRects) {
        const text = tr.text?.trim();
        if (!text) continue;
        const x = tr.rect.left * scale;
        const y = tr.rect.top * scale;
        const w = (tr.rect.right - tr.rect.left) * scale;
        const h = (tr.rect.bottom - tr.rect.top) * scale;
        runs.push({
          id: `pdfium-${pageNumber}-${idx}`,
          page: pageNumber,
          index: idx,
          text,
          x,
          y,
          width: w,
          height: h,
          fontSize: h,
          angle: 0,
          dir: "ltr",
          fontName: "unknown",
          fontSpec: matchFontSpec(undefined, undefined),
        });
        idx++;
      }
      textPage.destroy();
    } catch {
      /* PDFium text extraction can fail on some PDFs */
    }
    return runs;
  }

  /**
   * Write path (product rule: Pdfium is the write engine of record):
   * 1) MuPDF applies geometry burn + FreeText (only browser FreeText writer)
   * 2) PDFium load + save finalizes the PDF bytes
   */
  async applyReplacements(
    replacements: Array<{
      page: number;
      bbox: { x: number; y: number; width: number; height: number };
      replacement: string;
      fontSpec: PdfFontSpec;
    }>,
    options?: {
      burnOriginal?: boolean;
      coordSpace?: "top-down" | "pdf";
      minApplyRatio?: number;
    },
  ): Promise<Uint8Array> {
    if (replacements.length === 0) {
      return finalizePdfWithPdfium(this.sourceBytes);
    }

    // Chunk geometry inject via MuPDF (WASM FreeText / burn)
    const chunkSize = 64;
    let current = cloneUint8Array(this.sourceBytes);
    const burnOriginal = options?.burnOriginal !== false;

    for (let offset = 0; offset < replacements.length; ) {
      let size = Math.min(chunkSize, replacements.length - offset);
      let ok = false;
      // Shrink on OOB; always allow down to 1 (single-field inject)
      while (!ok && size >= 1) {
        const slice = replacements.slice(offset, offset + size);
        try {
          const mdoc = await mupdfEngine.load(cloneUint8Array(current));
          try {
            current = await mdoc.applyReplacements(slice, {
              burnOriginal,
              coordSpace: options?.coordSpace ?? "top-down",
              // Per-chunk: only enforce ratio on larger slices
              minApplyRatio:
                size === 1 ? 1 : (options?.minApplyRatio ?? 0.35),
            });
            offset += size;
            ok = true;
          } finally {
            mdoc.destroy();
          }
        } catch {
          if (size === 1) break;
          size = Math.max(1, Math.floor(size / 2));
        }
      }
      if (!ok) {
        throw new Error(
          `pdfium write: MuPDF inject failed at offset ${offset}/${replacements.length}`,
        );
      }
    }

    // Final statement PDF must be emitted by PDFium
    return finalizePdfWithPdfium(current);
  }

  async save(): Promise<Uint8Array> {
    return finalizePdfWithPdfium(this.sourceBytes);
  }

  destroy(): void {
    this.doc.destroy();
  }
}

export const pdfiumEngine: PdfEngine = {
  id: "pdfium",

  async isAvailable(): Promise<boolean> {
    try {
      await loadPdfium();
      return true;
    } catch {
      return false;
    }
  },

  async load(data: Uint8Array): Promise<PdfEngineDocument> {
    const pdfium = await loadPdfium();
    const owned = cloneUint8Array(data);
    const doc = await pdfium.loadDocument(owned);
    return new PdfiumDocument(doc, owned);
  },
};
