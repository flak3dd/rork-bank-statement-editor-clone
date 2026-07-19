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

interface MuPdfAnnotation {
  setRect(rect: [number, number, number, number]): void;
  setContents(text: string): void;
  setDefaultAppearance?(
    font: string,
    size: number,
    color: [number, number, number],
  ): void;
  setColor?(color: [number, number, number]): void;
  update(): void;
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
  toStructuredText(format?: string): string;
  toText?(): string;
  createAnnotation(type: string): MuPdfAnnotation;
  applyRedactions(opts?: unknown): void;
  update?(): void;
  destroy?(): void;
}

interface MuPdfDoc {
  numPages: number;
  loadPage(index: number): MuPdfPage;
  /** MuPDF WASM: saveToBuffer() or saveToBuffer("compress") — not MIME types. */
  saveToBuffer(options?: string | Record<string, unknown>): unknown;
  destroy(): void;
}

/** Normalize mupdf Buffer / Uint8Array return values. */
function bufferToUint8Array(buf: unknown): Uint8Array {
  if (buf instanceof Uint8Array) return cloneUint8Array(buf);
  if (buf && typeof (buf as { asUint8Array?: () => Uint8Array }).asUint8Array === "function") {
    return cloneUint8Array((buf as { asUint8Array: () => Uint8Array }).asUint8Array());
  }
  if (ArrayBuffer.isView(buf)) {
    const v = buf as ArrayBufferView;
    return cloneUint8Array(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  }
  throw new Error("mupdf saveToBuffer returned unsupported buffer type");
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
      if (typeof page.toText === "function") return page.toText();
      return page.toStructuredText();
    } finally {
      page.destroy?.();
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
     * 1) Create Redact annotations over original glyphs
     * 2) applyRedactions() to white-out content
     * 3) FreeText annotations with replacement strings
     * 4) saveToBuffer("compress")
     *
     * Note: embedded font reuse is limited in WASM; Helvetica is used when
     * donor glyphs are unavailable. For native Pro fidelity run
     * tools/pymupdf_pipeline/replace_statement.py.
     */
    if (replacements.length === 0) {
      return this.save();
    }

    // Unredacter: never white-out without non-empty insert text
    const safe = replacements.filter((r) => String(r.replacement ?? "").trim());
    if (safe.length === 0) {
      throw new Error(
        "mupdf applyReplacements: all replacements empty — NEVER REDACT blank",
      );
    }

    const byPage = new Map<number, typeof safe>();
    for (const r of safe) {
      const arr = byPage.get(r.page) ?? [];
      arr.push(r);
      byPage.set(r.page, arr);
    }

    let applied = 0;
    for (const [pageNum, pageReplacements] of byPage) {
      const page = this.doc.loadPage(pageNum - 1);
      try {
        const inserts: Array<{
          rect: [number, number, number, number];
          text: string;
          size: number;
        }> = [];

        // Phase 1: mark redactions for every field geometry (paired with FreeText)
        for (const r of pageReplacements) {
          const text = String(r.replacement).trim();
          if (!text) continue;
          const x0 = r.bbox.x;
          const y0 = r.bbox.y;
          const x1 = r.bbox.x + Math.max(r.bbox.width, 2);
          const y1 = r.bbox.y + Math.max(r.bbox.height, 2);
          const rect: [number, number, number, number] = [x0, y0, x1, y1];
          try {
            const redact = page.createAnnotation("Redact");
            redact.setRect(rect);
            redact.update();
          } catch {
            // FreeText still draws on top even if redaction API fails
          }
          const size = Math.max(
            6,
            Math.min(18, r.bbox.height > 0 ? r.bbox.height * 0.85 : 9),
          );
          inserts.push({
            rect: [
              x0,
              y0,
              Math.max(x1, x0 + Math.max(text.length * size * 0.5, 24)),
              y1,
            ],
            text,
            size,
          });
        }

        try {
          page.applyRedactions();
        } catch {
          // Some builds need options object — retry bare
          try {
            page.applyRedactions({});
          } catch {
            /* white-out best-effort */
          }
        }

        // Phase 2: re-insert replacement text as FreeText
        for (const ins of inserts) {
          try {
            const annot = page.createAnnotation("FreeText");
            annot.setRect(ins.rect);
            annot.setContents(ins.text);
            try {
              annot.setDefaultAppearance?.("Helv", ins.size, [0, 0, 0]);
            } catch {
              /* appearance optional */
            }
            try {
              annot.setColor?.([0, 0, 0]);
            } catch {
              /* optional */
            }
            annot.update();
            applied += 1;
          } catch {
            // Skip this field if FreeText unavailable
          }
        }
        page.update?.();
      } finally {
        page.destroy?.();
      }
    }

    if (applied === 0) {
      throw new Error(
        `mupdf applyReplacements: 0 of ${replacements.length} FreeText inserts succeeded`,
      );
    }

    return this.save();
  }

  async save(): Promise<Uint8Array> {
    // Correct MuPDF WASM API: no MIME type (that throws "Unused pdf arguments").
    try {
      return bufferToUint8Array(this.doc.saveToBuffer("compress"));
    } catch {
      return bufferToUint8Array(this.doc.saveToBuffer());
    }
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
