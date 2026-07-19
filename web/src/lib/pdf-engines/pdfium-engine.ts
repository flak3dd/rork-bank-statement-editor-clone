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

// Loose typing — @hyzyla/pdfium shapes vary by version.
type PdfiumDoc = {
  pageCount: number;
  getPage: (index: number) => PdfiumPage;
  save: () => Uint8Array | Promise<Uint8Array>;
  destroy: () => void;
};

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
  // Shared init supplies wasmUrl for browser (required by @hyzyla/pdfium).
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

class PdfiumDocument implements PdfEngineDocument {
  engine = "pdfium" as const;
  pageCount: number;
  private doc: PdfiumDoc;

  constructor(doc: PdfiumDoc) {
    this.doc = doc;
    this.pageCount = doc.pageCount;
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
      // PDFium text extraction can fail on some PDFs
    }
    return runs;
  }

  async applyReplacements(
    _replacements: Array<{
      page: number;
      bbox: { x: number; y: number; width: number; height: number };
      replacement: string;
      fontSpec: PdfFontSpec;
    }>,
  ): Promise<Uint8Array> {
    // PDFium WASM has limited redaction; return current bytes (overlay path handles visuals).
    return this.save();
  }

  async save(): Promise<Uint8Array> {
    return await this.doc.save();
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
    const doc = await pdfium.loadDocument(cloneUint8Array(data));
    return new PdfiumDocument(doc);
  },
};
