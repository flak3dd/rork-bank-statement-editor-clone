/**
 * Single entry for PDF.js — configures worker + standard fonts and opens docs.
 * Vitest aliases `pdfjs-dist` → legacy build (Node-safe). Browser uses modern build.
 */
import * as pdfjs from "pdfjs-dist";
import { cloneUint8Array } from "@/lib/bytes";
import { ensurePdfWorker, getStandardFontDataUrl } from "@/lib/pdf-worker";

export { pdfjs };

export type PdfjsDocument = Awaited<
  ReturnType<typeof pdfjs.getDocument>["promise"]
>;

/** Open a PDF document with Node-safe options (standard fonts, private buffer). */
export async function openPdfDocument(
  source: Uint8Array | ArrayBuffer,
): Promise<PdfjsDocument> {
  await ensurePdfWorker();
  const data =
    source instanceof Uint8Array
      ? cloneUint8Array(source)
      : cloneUint8Array(new Uint8Array(source));

  const opts: Record<string, unknown> = {
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: typeof window === "undefined",
  };

  const fontUrl = getStandardFontDataUrl();
  if (fontUrl) {
    opts.standardFontDataUrl = fontUrl;
  }

  return pdfjs.getDocument(opts as Parameters<typeof pdfjs.getDocument>[0])
    .promise;
}
