import { openPdfDocument, pdfjs, type PdfjsDocument } from "@/lib/pdfjs-api";
import { cloneUint8Array } from "@/lib/bytes";
import { matchFontSpec } from "@/lib/pdf-render";
import type { PdfFontSpec } from "@/lib/types";
import type {
  PdfEngine,
  PdfEngineDocument,
  RenderedPage,
  TextRun,
} from "./types";

class PdfJsDocument implements PdfEngineDocument {
  engine = "pdfjs" as const;
  pageCount: number;
  private data: Uint8Array;
  private doc: PdfjsDocument;

  constructor(data: Uint8Array, doc: PdfjsDocument) {
    this.data = data;
    this.doc = doc;
    this.pageCount = doc.numPages;
  }

  async renderPage(pageNumber: number, scale: number): Promise<RenderedPage> {
    const page = await this.doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const runs = await this.extractRuns(page, pageNumber, viewport);
    return {
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      scale,
      imageData,
      runs,
    };
  }

  async extractPageText(pageNumber: number): Promise<string> {
    const page = await this.doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str?: string; hasEOL?: boolean }>;
    let text = "";
    for (const item of items) {
      if (typeof item.str === "string") {
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
      }
    }
    return text.trim();
  }

  async extractPageRuns(pageNumber: number, scale: number): Promise<TextRun[]> {
    const page = await this.doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    return this.extractRuns(page, pageNumber, viewport);
  }

  private async extractRuns(
    page: Awaited<ReturnType<typeof this.doc.getPage>>,
    pageNumber: number,
    viewport: { width: number; height: number; scale: number; transform: number[] },
  ): Promise<TextRun[]> {
    const textContent = await page.getTextContent();
    const styles = (textContent.styles ?? {}) as Record<string, { fontFamily?: string }>;
    const items = textContent.items as Array<{
      str?: string;
      dir?: string;
      width?: number;
      height?: number;
      transform?: number[];
      fontName?: string;
    }>;
    const runs: TextRun[] = [];
    items.forEach((item, i) => {
      if (!item.str || !item.transform || item.transform.length < 6) return;
      const tx = pdfjs.Util.transform(viewport.transform, item.transform) as number[];
      const fontHeight = Math.hypot(tx[0], tx[1]) || 12;
      const width = (item.width ?? 0) * viewport.scale;
      const height = (item.height ?? 0) * viewport.scale || fontHeight;
      const angle = Math.atan2(tx[1], tx[0]) * (180 / Math.PI);
      const style = (item.fontName && styles[item.fontName]) || {};
      runs.push({
        id: `pdfjs-${pageNumber}-${i}`,
        page: pageNumber,
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

  async applyReplacements(
    _replacements: Array<{
      page: number;
      bbox: { x: number; y: number; width: number; height: number };
      replacement: string;
      fontSpec: PdfFontSpec;
    }>,
  ): Promise<Uint8Array> {
    // PDF.js is view-only for writes — return original bytes; overlays handle display.
    return new Uint8Array(this.data);
  }

  async save(): Promise<Uint8Array> {
    return new Uint8Array(this.data);
  }

  destroy(): void {
    void this.doc.loadingTask.destroy();
  }
}

export const pdfjsEngine: PdfEngine = {
  id: "pdfjs",

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async load(data: Uint8Array): Promise<PdfEngineDocument> {
    const copy = cloneUint8Array(data);
    const doc = await openPdfDocument(copy);
    return new PdfJsDocument(copy, doc);
  },
};
