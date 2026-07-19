import { openPdfDocument } from "@/lib/pdfjs-api";
import { cloneUint8Array } from "@/lib/bytes";

export interface PdfTextResult {
  text: string;
  pageCount: number;
  pageTexts: string[];
}

/** Extract plain text from a PDF File or bytes in the browser via PDF.js. */
export async function extractTextFromPdf(
  source: File | Uint8Array,
  onProgress?: (ratio: number) => void,
): Promise<PdfTextResult> {
  // Always use a private copy — PDF.js may transfer/detach the buffer.
  const data =
    source instanceof Uint8Array
      ? cloneUint8Array(source)
      : new Uint8Array(await source.arrayBuffer());
  const doc = await openPdfDocument(data);
  const pageCount = doc.numPages;
  const pageTexts: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str?: string; hasEOL?: boolean }>;
    let pageText = "";
    for (const item of items) {
      if (typeof item.str === "string") {
        pageText += item.str;
        pageText += item.hasEOL ? "\n" : " ";
      }
    }
    pageTexts.push(pageText.trim());
    onProgress?.(i / pageCount);
  }

  const text = pageTexts.join("\n\n");
  return { text, pageCount, pageTexts };
}
