import { cloneUint8Array } from "@/lib/bytes";
import { matchFontSpec } from "@/lib/pdf-render";
import type {
  PdfEngine,
  PdfEngineDocument,
  RenderedPage,
  TextRun,
} from "./types";

let mupdfModule: typeof import("mupdf") | null = null;

async function loadMupdf(): Promise<typeof import("mupdf")> {
  if (mupdfModule) return mupdfModule;
  const mod = await import("mupdf");
  mupdfModule = mod;
  return mod;
}

interface MuPdfPage {
  getBounds(): [number, number, number, number];
  toPixmap(
    matrix: unknown,
    cs: unknown,
    alpha?: boolean,
    includeAnnotations?: boolean,
  ): {
    getPixels(): Uint8Array;
    getWidth(): number;
    getHeight(): number;
    destroy(): void;
  };
  toStructuredText(format: string): string;
  toText(format: string): string;
  addRedaction(rect: [number, number, number, number], opts?: unknown): void;
  applyRedactions(): void;
  destroy(): void;
}

interface MuPdfDoc {
  numPages: number;
  loadPage(index: number): MuPdfPage;
  saveToBuffer(format: string): Uint8Array;
  destroy(): void;
}

class MuPdfDocument implements PdfEngineDocument {
  engine = "mupdf" as const;
  pageCount: number;
  private doc: MuPdfDoc;
  private mod: typeof import("mupdf");

  constructor(doc: MuPdfDoc, mod: typeof import("mupdf")) {
    this.doc = doc;
    this.mod = mod;
    this.pageCount = doc.numPages;
  }

  async renderPage(pageNumber: number, scale: number): Promise<RenderedPage> {
    const page = this.doc.loadPage(pageNumber - 1);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      const width = (x1 - x0) * scale;
      const height = (y1 - y0) * scale;
      const matrix = this.mod.Matrix.scale(scale, scale);
      const pixmap = page.toPixmap(matrix, this.mod.ColorSpace.DeviceRGB, false, true);
      const pixels = pixmap.getPixels();
      const imageData = new ImageData(
        new Uint8ClampedArray(pixels),
        pixmap.getWidth(),
        pixmap.getHeight(),
      );
      const runs = this.extractRunsFromPage(page, pageNumber, scale);
      pixmap.destroy();
      return { pageNumber, width, height, scale, imageData, runs };
    } finally {
      page.destroy();
    }
  }

  async extractPageText(pageNumber: number): Promise<string> {
    const page = this.doc.loadPage(pageNumber - 1);
    try {
      return page.toText("text");
    } finally {
      page.destroy();
    }
  }

  async extractPageRuns(pageNumber: number, scale: number): Promise<TextRun[]> {
    const page = this.doc.loadPage(pageNumber - 1);
    try {
      return this.extractRunsFromPage(page, pageNumber, scale);
    } finally {
      page.destroy();
    }
  }

  private extractRunsFromPage(page: MuPdfPage, pageNumber: number, scale: number): TextRun[] {
    let structured: { blocks?: Array<{ lines?: Array<{ spans?: Array<{ text?: string; bbox?: number[]; font?: string; size?: number; dir?: string }> }> }> } = {};
    try {
      const json = page.toStructuredText("json");
      structured = JSON.parse(json);
    } catch {
      return [];
    }

    const runs: TextRun[] = [];
    let idx = 0;
    for (const block of structured.blocks ?? []) {
      for (const line of block.lines ?? []) {
        for (const span of line.spans ?? []) {
          const text = span.text ?? "";
          if (!text) continue;
          const bbox = span.bbox ?? [0, 0, 0, 0];
          const x = bbox[0] * scale;
          const y = bbox[1] * scale;
          const w = (bbox[2] - bbox[0]) * scale;
          const h = (bbox[3] - bbox[1]) * scale;
          const fontSize = (span.size ?? 12) * scale;
          runs.push({
            id: `mupdf-${pageNumber}-${idx}`,
            page: pageNumber,
            index: idx,
            text,
            x,
            y,
            width: w,
            height: h,
            fontSize,
            angle: 0,
            dir: span.dir ?? "ltr",
            fontName: span.font ?? "unknown",
            fontSpec: matchFontSpec(span.font, span.font),
          });
          idx++;
        }
      }
    }
    return runs;
  }

  async applyReplacements(
    replacements: Array<{
      page: number;
      bbox: { x: number; y: number; width: number; height: number };
      replacement: string;
      fontSpec: import("@/lib/types").PdfFontSpec;
    }>,
  ): Promise<Uint8Array> {
    /**
     * High-fidelity path (browser mupdf WASM stand-in for PyMuPDF):
     * 1) White-out original glyphs via redaction
     * 2) Re-insert replacement text at the same origin with approx font size
     *
     * Note: embedded font reuse is limited in WASM; Helvetica/simple font is
     * used when donor glyphs are unavailable. For native Pro fidelity run
     * tools/pymupdf_pipeline/replace_statement.py.
     */
    const byPage = new Map<number, typeof replacements>();
    for (const r of replacements) {
      const arr = byPage.get(r.page) ?? [];
      arr.push(r);
      byPage.set(r.page, arr);
    }

    type AnnotPage = MuPdfPage & {
      createAnnotation?: (type: string) => {
        setRect?: (r: number[]) => void;
        setContents?: (s: string) => void;
        setDefaultAppearance?: (s: string) => void;
        update?: () => void;
      };
    };

    for (const [pageNum, pageReplacements] of byPage) {
      const page = this.doc.loadPage(pageNum - 1) as AnnotPage;
      try {
        const inserts: Array<{
          x: number;
          y: number;
          text: string;
          size: number;
        }> = [];

        for (const r of pageReplacements) {
          const rect: [number, number, number, number] = [
            r.bbox.x,
            r.bbox.y,
            r.bbox.x + r.bbox.width,
            r.bbox.y + r.bbox.height,
          ];
          page.addRedaction(rect, { fillColor: [1, 1, 1] });
          const size = Math.max(
            6,
            Math.min(18, r.bbox.height > 0 ? r.bbox.height * 0.85 : 9),
          );
          inserts.push({
            x: r.bbox.x,
            // baseline near bottom of bbox
            y: r.bbox.y + r.bbox.height * 0.85,
            text: r.replacement,
            size,
          });
        }
        page.applyRedactions();

        // Re-insert text after redaction (FreeText annotation fallback)
        for (const ins of inserts) {
          try {
            if (typeof page.createAnnotation === "function") {
              const annot = page.createAnnotation("FreeText");
              const h = ins.size * 1.35;
              const w = Math.max(ins.text.length * ins.size * 0.5, 24);
              annot.setRect?.([ins.x, ins.y - h, ins.x + w, ins.y + 2]);
              annot.setContents?.(ins.text);
              annot.setDefaultAppearance?.(
                `/Helv ${ins.size.toFixed(1)} Tf 0 0 0 rg`,
              );
              annot.update?.();
            }
          } catch {
            // Annotation API unavailable — leave redaction white-out only
          }
        }
      } finally {
        page.destroy();
      }
    }

    return this.doc.saveToBuffer("application/pdf");
  }

  async save(): Promise<Uint8Array> {
    return this.doc.saveToBuffer("application/pdf");
  }

  destroy(): void {
    this.doc.destroy();
  }
}

export const mupdfEngine: PdfEngine = {
  id: "mupdf",

  async isAvailable(): Promise<boolean> {
    try {
      await loadMupdf();
      return true;
    } catch {
      return false;
    }
  },

  async load(data: Uint8Array): Promise<PdfEngineDocument> {
    const mod = await loadMupdf();
    // MuPDF may transfer the buffer into WASM — never pass shared state.
    const owned = cloneUint8Array(data);
    const doc = mod.Document.openDocument(
      owned,
      "application/pdf",
    ) as unknown as MuPdfDoc;
    return new MuPdfDocument(doc, mod);
  },
};
