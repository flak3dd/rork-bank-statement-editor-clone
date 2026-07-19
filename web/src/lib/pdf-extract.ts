import * as pdfjs from "pdfjs-dist";
// Vite worker URL
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface PdfTextResult {
  text: string;
  pageCount: number;
  pageTexts: string[];
}

/** Extract plain text from a PDF File in the browser via PDF.js. */
export async function extractTextFromPdf(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<PdfTextResult> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
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
