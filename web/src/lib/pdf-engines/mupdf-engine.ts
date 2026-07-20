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
  setInteriorColor?(color: [number, number, number]): void;
  setBorderWidth?(w: number): void;
  update(): void;
  /**
   * Burn this redaction into the page content stream.
   * blackBoxes=0 removes text without leaving black bars.
   * After success the annotation is unbound (do not reuse).
   */
  applyRedaction?(
    blackBoxes?: number | boolean,
    imageMethod?: number,
    lineArtMethod?: number,
    textMethod?: number,
  ): void;
  getType?(): string;
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
  getAnnotations?(): unknown[];
  deleteAnnotation?(a: unknown): void;
  /** Page-level batch apply — prefer per-annot applyRedaction(0). */
  applyRedactions?(
    blackBoxes?: boolean | number,
    imageMethod?: number,
    lineArtMethod?: number,
    textMethod?: number,
  ): void;
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

/** Strip control/binary noise from WASM/native error objects. */
export function safeErrorMessage(err: unknown): string {
  let raw = "";
  if (err instanceof Error) raw = err.message || err.name || "";
  else if (typeof err === "string") raw = err;
  else if (err && typeof err === "object") {
    try {
      raw = JSON.stringify(err);
    } catch {
      raw = String(err);
    }
  } else {
    raw = String(err ?? "");
  }
  // Keep printable ASCII + common punctuation; drop binary dumps
  const printable = raw.replace(/[^\x20-\x7E\n\r\t]/g, "").trim();
  if (!printable || printable.length < 3) {
    return "PDF engine write failed (native error)";
  }
  return printable.slice(0, 280);
}

/**
 * Sanitize replacements: printable text only, finite bboxes, valid pages,
 * dedupe by geometry. Prevents WASM crashes and binary error messages.
 *
 * Bboxes are top-down (y=0 at page top) unless `coordSpace === "pdf"`.
 * When top-down, convert to PDF user space using per-page height from bounds.
 */
function sanitizeReplacements(
  replacements: Array<{
    page: number;
    bbox: { x: number; y: number; width: number; height: number };
    replacement: string;
  }>,
  pageCount: number,
  options?: {
    coordSpace?: "top-down" | "pdf";
    /** page number (1-based) → page height in PDF units */
    pageHeights?: Map<number, number>;
  },
): Array<{
  page: number;
  rect: { x0: number; y0: number; x1: number; y1: number };
  replacement: string;
  fontSize: number;
}> {
  const maxPage = Math.max(1, Math.floor(pageCount) || 1);
  const coordSpace = options?.coordSpace ?? "top-down";
  const pageHeights = options?.pageHeights;
  const out: Array<{
    page: number;
    rect: { x0: number; y0: number; x1: number; y1: number };
    replacement: string;
    fontSize: number;
  }> = [];
  const seen = new Set<string>();

  for (const r of replacements) {
    let text = String(r.replacement ?? "")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // Collapse exotic unicode that FreeText / Helvetica cannot encode well
    text = text.replace(/[^\x20-\x7E\u00A0-\u024F]/g, "?").slice(0, 200);
    if (!text) continue;

    const page = Math.min(
      maxPage,
      Math.max(1, Math.floor(Number(r.page) || 1)),
    );
    let x = Number(r.bbox?.x);
    let y = Number(r.bbox?.y);
    let w = Number(r.bbox?.width);
    let h = Number(r.bbox?.height);
    if (![x, y, w, h].every((n) => Number.isFinite(n))) continue;
    // Normalize inverted / zero-size boxes
    if (w < 0) {
      x += w;
      w = Math.abs(w);
    }
    if (h < 0) {
      y += h;
      h = Math.abs(h);
    }
    w = Math.min(800, Math.max(2, w));
    h = Math.min(200, Math.max(4, h));
    // Keep on a reasonable PDF page
    x = Math.min(2000, Math.max(-50, x));
    y = Math.min(3000, Math.max(-50, y));

    // Pad so redaction fully covers glyph ink (avoids ghost edges)
    const padX = 1.5;
    const padY = 1.0;
    x -= padX;
    y -= padY;
    w += padX * 2;
    h += padY * 2;

    // top-down (PDF.js / blueprint) → PDF user space for FreeText setRect
    let pdfY0 = y;
    let pdfY1 = y + h;
    if (coordSpace !== "pdf") {
      const pageH = pageHeights?.get(page) ?? 842;
      // y is distance from top; PDF y grows upward from bottom
      pdfY0 = pageH - y - h;
      pdfY1 = pageH - y;
    }

    const key = `${page}:${x.toFixed(1)},${pdfY0.toFixed(1)},${w.toFixed(1)},${h.toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fontSize = Math.max(6, Math.min(16, (h - padY * 2) * 0.85 || 9));
    out.push({
      page,
      rect: { x0: x, y0: pdfY0, x1: x + w, y1: pdfY1 },
      replacement: text,
      fontSize,
    });
  }
  return out;
}

class MuPdfDocument implements PdfEngineDocument {
  engine = "mupdf" as const;
  pageCount: number;
  private doc: MuPdfDoc;
  private mod: typeof import("mupdf");

  constructor(doc: MuPdfDoc, mod: typeof import("mupdf")) {
    this.doc = doc;
    this.mod = mod;
    // mupdf WASM may expose countPages() instead of numPages
    const d = doc as MuPdfDoc & { countPages?: () => number };
    const n =
      typeof d.countPages === "function"
        ? d.countPages()
        : Number(d.numPages);
    this.pageCount = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  }

  async renderPage(pageNumber: number, scale: number): Promise<RenderedPage> {
    const safeScale = Math.min(3, Math.max(0.25, scale || 1));
    const idx = Math.min(
      Math.max(0, Math.floor(pageNumber) - 1),
      Math.max(0, this.pageCount - 1),
    );
    const page = this.doc.loadPage(idx);
    try {
      const bounds = page.getBounds();
      const x0 = bounds[0] ?? 0;
      const y0 = bounds[1] ?? 0;
      const x1 = bounds[2] ?? 612;
      const y1 = bounds[3] ?? 792;
      const matrix = this.mod.Matrix.scale(safeScale, safeScale);
      const pixmap = page.toPixmap(
        matrix,
        this.mod.ColorSpace.DeviceRGB,
        false,
        true,
      );
      const pw = Math.max(1, Math.floor(pixmap.getWidth() || 1));
      const ph = Math.max(1, Math.floor(pixmap.getHeight() || 1));
      const pixels = pixmap.getPixels();
      const expected = pw * ph * 4;
      let data: Uint8ClampedArray;
      if (pixels instanceof Uint8ClampedArray && pixels.length === expected) {
        data = pixels;
      } else if (pixels && (pixels as ArrayLike<number>).length >= expected) {
        data = new Uint8ClampedArray(pixels as ArrayLike<number>).subarray(
          0,
          expected,
        );
        // subarray may not be accepted by ImageData in all engines — copy
        data = new Uint8ClampedArray(data);
      } else {
        // Fallback empty white buffer if pixmap size mismatches
        data = new Uint8ClampedArray(expected);
        data.fill(255);
      }
      const imageData = new ImageData(data, pw, ph);
      const runs = this.extractRunsFromPage(page, pageNumber, safeScale);
      pixmap.destroy();
      // Always return integer canvas dimensions matching ImageData
      return {
        pageNumber: idx + 1,
        width: pw,
        height: ph,
        scale: safeScale,
        imageData,
        runs,
      };
    } finally {
      page.destroy?.();
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
    options?: {
      burnOriginal?: boolean;
      coordSpace?: "top-down" | "pdf";
      minApplyRatio?: number;
    },
  ): Promise<Uint8Array> {
    /**
     * Multi-engine local write path (MuPDF WASM):
     * 1) Optional burn: Redact.applyRedaction(0) removes original glyphs
     *    (no black boxes). Skip on blank shells — empty redacts OOB WASM.
     * 2) FreeText insert (white fill, no border).
     * Bboxes default top-down (PDF.js / blueprints); flipped to PDF user space.
     * Callers should chunk large batches (see applyReplacementsWithFallbacks).
     */
    if (replacements.length === 0) {
      return this.save();
    }

    const burnOriginal = options?.burnOriginal !== false;
    const coordSpace = options?.coordSpace ?? "top-down";
    const minApplyRatio =
      typeof options?.minApplyRatio === "number"
        ? Math.min(1, Math.max(0, options.minApplyRatio))
        : 0.35;

    // Measure real page heights once for accurate Y conversion
    const pageHeights = new Map<number, number>();
    for (let p = 1; p <= this.pageCount; p++) {
      try {
        const page = this.doc.loadPage(p - 1) as MuPdfPage;
        try {
          const b = page.getBounds();
          const h = Math.abs((b[3] ?? 842) - (b[1] ?? 0));
          pageHeights.set(p, h > 10 ? h : 842);
        } finally {
          page.destroy?.();
        }
      } catch {
        pageHeights.set(p, 842);
      }
    }

    const sanitized = sanitizeReplacements(replacements, this.pageCount, {
      coordSpace,
      pageHeights,
    });
    if (sanitized.length === 0) {
      throw new Error(
        "mupdf applyReplacements: no valid replacements after sanitize (empty text or bad geometry)",
      );
    }

    const byPage = new Map<number, typeof sanitized>();
    for (const r of sanitized) {
      const arr = byPage.get(r.page) ?? [];
      arr.push(r);
      byPage.set(r.page, arr);
    }

    let applied = 0;
    let burned = 0;
    let freeTextFails = 0;

    const loadPage = (pageNum: number): MuPdfPage => {
      const pageIndex = Math.min(
        Math.max(0, Math.floor(pageNum) - 1),
        Math.max(0, this.pageCount - 1),
      );
      return this.doc.loadPage(pageIndex) as MuPdfPage;
    };

    for (const [pageNum, pageReplacements] of byPage) {
      // Pass 1: burn (optional) — one annot at a time, soft-fail each
      if (burnOriginal) {
        for (const r of pageReplacements) {
          try {
            const page = loadPage(pageNum);
            const { x0, y0, x1, y1 } = r.rect;
            const redact = page.createAnnotation("Redact");
            redact.setRect([x0, y0, x1, y1]);
            redact.update();
            if (typeof redact.applyRedaction === "function") {
              redact.applyRedaction(0);
              burned += 1;
            }
          } catch {
            /* single burn failure — continue */
          }
        }
      }

      // Pass 2: FreeText on fresh page handle (avoids stale pointer OOB)
      for (const r of pageReplacements) {
        try {
          const page = loadPage(pageNum);
          const text = r.replacement;
          const { x0, y0, x1, y1 } = r.rect;
          const size = r.fontSize;
          const textRect: [number, number, number, number] = [
            x0,
            y0,
            Math.max(x1, x0 + Math.max(text.length * size * 0.48, 20)),
            Math.max(y1, y0 + size * 1.15),
          ];
          const annot = page.createAnnotation("FreeText");
          annot.setRect(textRect);
          annot.setContents(text);
          try {
            annot.setDefaultAppearance?.("Helv", size, [0, 0, 0]);
          } catch {
            /* */
          }
          try {
            annot.setInteriorColor?.([1, 1, 1]);
          } catch {
            /* */
          }
          try {
            annot.setColor?.([1, 1, 1]);
          } catch {
            /* */
          }
          try {
            annot.setBorderWidth?.(0);
          } catch {
            /* */
          }
          annot.update();
          applied += 1;
        } catch {
          freeTextFails += 1;
        }
      }

      // Strip any leftover Redact annots (never leave Redact in final PDF)
      try {
        const page = loadPage(pageNum);
        const annots = page.getAnnotations?.() ?? [];
        for (const a of [...annots]) {
          let t = "";
          try {
            const ann = a as { getType?: () => string; type?: string };
            t = (
              typeof ann.getType === "function" ? ann.getType() : ann.type ?? ""
            )
              .toString()
              .toLowerCase();
          } catch {
            continue;
          }
          if (t.includes("redact")) {
            try {
              page.deleteAnnotation?.(a);
            } catch {
              /* */
            }
          }
        }
      } catch {
        /* optional */
      }
    }

    if (applied === 0) {
      throw new Error(
        `mupdf applyReplacements: 0 of ${sanitized.length} FreeText inserts succeeded (burned=${burned}, fails=${freeTextFails}, burnOriginal=${burnOriginal}, coord=${coordSpace})`,
      );
    }

    const ratio = applied / sanitized.length;
    if (ratio < minApplyRatio) {
      throw new Error(
        `mupdf applyReplacements: only ${applied}/${sanitized.length} (${Math.round(ratio * 100)}%) FreeText inserts succeeded — below min ${Math.round(minApplyRatio * 100)}% (fails=${freeTextFails})`,
      );
    }

    return this.save();
  }

  async save(): Promise<Uint8Array> {
    // Prefer uncompressed first — "compress" has triggered zlib errors under
    // multi-pass WASM stress (triple replica runs).
    const trySave = (opts?: string) => {
      const raw =
        opts === undefined
          ? this.doc.saveToBuffer()
          : this.doc.saveToBuffer(opts);
      const bytes = bufferToUint8Array(raw);
      if (
        bytes.byteLength < 5 ||
        bytes[0] !== 0x25 ||
        bytes[1] !== 0x50 ||
        bytes[2] !== 0x44 ||
        bytes[3] !== 0x46
      ) {
        throw new Error("mupdf save produced non-PDF bytes");
      }
      return bytes;
    };
    try {
      return trySave();
    } catch (e1) {
      try {
        return trySave("compress");
      } catch (e2) {
        throw new Error(
          `mupdf save failed: ${safeErrorMessage(e2) || safeErrorMessage(e1) || "unknown"}`,
        );
      }
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
    if (
      owned.byteLength < 5 ||
      owned[0] !== 0x25 ||
      owned[1] !== 0x50 ||
      owned[2] !== 0x44 ||
      owned[3] !== 0x46
    ) {
      throw new Error(
        `mupdf load: buffer is not a PDF (len=${owned.byteLength})`,
      );
    }
    // Prefer magic sniff; MIME can fail after multi-pass WASM churn
    let doc: MuPdfDoc;
    try {
      doc = mod.Document.openDocument(owned, "application/pdf") as unknown as MuPdfDoc;
    } catch {
      const owned2 = cloneUint8Array(data);
      try {
        doc = mod.Document.openDocument(owned2, "pdf") as unknown as MuPdfDoc;
      } catch {
        const owned3 = cloneUint8Array(data);
        doc = mod.Document.openDocument(owned3) as unknown as MuPdfDoc;
      }
    }
    return new MuPdfDocument(doc, mod);
  },
};
