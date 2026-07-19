/**
 * Verification Renderer — always Local Pdfium (WASM).
 * Used for pixel-level visual validation baselines and candidates.
 */

import { cloneUint8Array } from "@/lib/bytes";
import {
  initPdfiumLibrary,
  isPdfiumLibraryAvailable,
} from "@/lib/pdfium-init";

export interface VerificationPageRender {
  pageNumber: number;
  width: number;
  height: number;
  scale: number;
  /** RGBA buffer */
  data: Uint8ClampedArray;
  imageData: ImageData;
}

export interface VerificationRenderResult {
  engine: "pdfium";
  pageCount: number;
  pages: VerificationPageRender[];
  durationMs: number;
  scale: number;
}

async function getLibrary() {
  return initPdfiumLibrary();
}

/** Probe whether local Pdfium WASM loads. */
export async function isPdfiumAvailable(): Promise<boolean> {
  return isPdfiumLibraryAvailable();
}

function toImageData(raw: Uint8Array, width: number, height: number): ImageData {
  const expected = width * height * 4;
  const rgba = new Uint8ClampedArray(expected);
  const copyLen = Math.min(raw.length, expected);
  for (let i = 0; i < copyLen; i++) rgba[i] = raw[i];
  // @hyzyla/pdfium default is often BGRA — convert to RGBA for canvas
  for (let i = 0; i < expected; i += 4) {
    const b = rgba[i];
    const g = rgba[i + 1];
    const r = rgba[i + 2];
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
  }
  return new ImageData(rgba, width, height);
}

/**
 * Render every page of a PDF with local Pdfium.
 * @param scale render scale (1 = 72 DPI)
 * @param maxPages cap pages for performance (default 12)
 */
export async function renderPdfWithPdfium(
  bytes: Uint8Array,
  options?: {
    scale?: number;
    maxPages?: number;
    onProgress?: (ratio: number, page: number, total: number) => void;
  },
): Promise<VerificationRenderResult> {
  const scale = options?.scale ?? 1.5;
  const maxPages = options?.maxPages ?? 12;
  const started = performance.now();

  const library = await getLibrary();
  const copy = cloneUint8Array(bytes);
  const document = await library.loadDocument(copy);

  try {
    const pageCount = document.getPageCount();
    const total = Math.min(pageCount, maxPages);
    const pages: VerificationPageRender[] = [];
    let index = 0;

    for (const page of document.pages()) {
      if (index >= maxPages) break;
      const pageNumber = page.number + 1; // library uses 0-based

      const rendered = await page.render({
        scale,
        // Pass through raw bitmap; convertBitmap path uses this callback
        render: async (opts) => opts.data,
      });

      const width = rendered.width;
      const height = rendered.height;
      const imageData = toImageData(rendered.data, width, height);

      pages.push({
        pageNumber,
        width,
        height,
        scale,
        data: imageData.data,
        imageData,
      });

      index += 1;
      options?.onProgress?.(index / total, pageNumber, total);
    }

    return {
      engine: "pdfium",
      pageCount: pages.length,
      pages,
      durationMs: Math.round(performance.now() - started),
      scale,
    };
  } finally {
    document.destroy();
  }
}

/** Thumbnail data URL for UI previews. */
export function pageToDataUrl(page: VerificationPageRender, maxWidth = 280): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, maxWidth / Math.max(page.width, 1));
  canvas.width = Math.max(1, Math.round(page.width * scale));
  canvas.height = Math.max(1, Math.round(page.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const src = document.createElement("canvas");
  src.width = page.width;
  src.height = page.height;
  const sctx = src.getContext("2d");
  if (!sctx) return "";
  sctx.putImageData(page.imageData, 0, 0);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
