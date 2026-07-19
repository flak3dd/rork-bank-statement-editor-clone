import { openPdfDocument, pdfjs } from "@/lib/pdfjs-api";
import { cloneUint8Array } from "@/lib/bytes";
import { matchFontSpec } from "@/lib/pdf-render";

export interface ExtractedRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  fontName: string;
  fontSize: number;
  fontSpec: ReturnType<typeof matchFontSpec>;
}

/**
 * Extract positioned text runs from PDF bytes (first maxPages) via PDF.js.
 * Always clones bytes first — PDF.js may transfer/detach the ArrayBuffer.
 */
export async function getPageTextRunsFromBytes(
  bytes: Uint8Array,
  maxPages = 3,
  scale = 1,
): Promise<ExtractedRun[]> {
  // Fresh buffer: never hand React-owned state to the PDF.js worker.
  const data = cloneUint8Array(bytes);
  const doc = await openPdfDocument(data);
  const limit = Math.min(doc.numPages, maxPages);
  const out: ExtractedRun[] = [];

  for (let p = 1; p <= limit; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale });
    const textContent = await page.getTextContent();
    const styles = (textContent.styles ?? {}) as Record<
      string,
      { fontFamily?: string }
    >;
    const items = textContent.items as Array<{
      str?: string;
      width?: number;
      height?: number;
      transform?: number[];
      fontName?: string;
    }>;

    items.forEach((item) => {
      if (!item.str || !item.transform || item.transform.length < 6) return;
      const tx = pdfjs.Util.transform(
        viewport.transform,
        item.transform,
      ) as number[];
      const fontHeight = Math.hypot(tx[0], tx[1]) || 12;
      const width = (item.width ?? 0) * viewport.scale;
      const height = (item.height ?? 0) * viewport.scale || fontHeight;
      const style = (item.fontName && styles[item.fontName]) || {};
      out.push({
        text: item.str,
        x: tx[4],
        y: tx[5],
        width,
        height,
        page: p,
        fontName: item.fontName ?? "unknown",
        fontSize: fontHeight,
        fontSpec: matchFontSpec(style.fontFamily, item.fontName),
      });
    });
  }

  return out;
}
