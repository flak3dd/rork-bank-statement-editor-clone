import * as pdfjs from "pdfjs-dist";
import "@/lib/pdf-worker";
import { attachOriginals } from "@/lib/edit-utils";
import { parseTransactionsHybrid } from "@/lib/parse-transactions";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { runOfflineHeuristicParse } from "./offline-heuristic";
import type { DocumentParser, ParserInput, ParserResult } from "./types";

async function renderPageToCanvas(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>["getPage"]>>,
  scale: number,
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

/**
 * Optional Tesseract OCR when the package is installed.
 * Uses Function + dynamic specifier so Vite does not fail the whole app when
 * tesseract.js is not a dependency.
 */
async function ocrCanvas(canvas: HTMLCanvasElement): Promise<string> {
  try {
    // Avoid static analysis of "tesseract.js" (package is optional).
    const load = new Function(
      "return import('tesser' + 'act.js')",
    ) as () => Promise<{
      recognize: (
        el: HTMLCanvasElement,
        lang: string,
        opts?: { logger?: () => void },
      ) => Promise<{ data?: { text?: string } }>;
    }>;
    const Tess = await load().catch(() => null);
    if (!Tess?.recognize) return "";
    const { data } = await Tess.recognize(canvas, "eng", {
      logger: () => undefined,
    });
    return data?.text ?? "";
  } catch {
    return "";
  }
}

export const localOcrParser: DocumentParser = {
  info: {
    id: "local-ocr",
    label: "Local OCR",
    shortLabel: "Local OCR",
    description:
      "Browser-side OCR: render PDF pages to canvas and run Tesseract when installed; always falls back to embedded PDF text + bank YAML heuristics (offline).",
    availability: "browser-local",
    cloud: false,
    envHints: [],
  },

  isConfigured() {
    return true;
  },

  async parse(input: ParserInput): Promise<ParserResult> {
    const started = performance.now();
    const enginesTried = ["local-ocr"];
    const warnings: string[] = [];

    try {
      input.onProgress?.(0.05, "Loading PDF for OCR…");
      const data = new Uint8Array(input.bytes);
      const doc = await pdfjs.getDocument({ data }).promise;
      const pageCount = doc.numPages;
      const pageTexts: string[] = [];
      let ocrUsed = false;

      // Prefer embedded text first (fast path)
      const embedded = await extractTextFromPdf(input.bytes);
      const embeddedDense = embedded.text.replace(/\s+/g, " ").trim().length;

      if (embeddedDense >= 80) {
        enginesTried.push("pdf-embedded-text");
        input.onProgress?.(0.5, "Using embedded PDF text (skip full OCR)…");
        pageTexts.push(...embedded.pageTexts);
      } else {
        enginesTried.push("tesseract-or-canvas");
        for (let i = 1; i <= pageCount; i++) {
          input.onProgress?.(i / pageCount * 0.7, `OCR page ${i}/${pageCount}…`);
          const page = await doc.getPage(i);
          const canvas = await renderPageToCanvas(page, 2);
          let text = await ocrCanvas(canvas);
          if (text.trim()) {
            ocrUsed = true;
          } else {
            // last resort: PDF.js text for this page
            const content = await page.getTextContent();
            text = (content.items as Array<{ str?: string }>)
              .map((it) => it.str ?? "")
              .join(" ");
          }
          pageTexts.push(text.trim());
        }
        if (!ocrUsed) {
          warnings.push(
            "tesseract.js not available — used canvas/PDF.js text. Install tesseract.js for true OCR on scans.",
          );
        }
      }

      const rawText = pageTexts.join("\n\n");
      enginesTried.push("offline-heuristic-structure");

      // Run template-aware structuring on OCR text without re-extracting PDF if we have text
      const hybrid = parseTransactionsHybrid(rawText);
      let transactions = attachOriginals(hybrid.transactions);

      // If sparse, also try full offline path (re-extract + templates)
      if (transactions.length < 2) {
        const offline = await runOfflineHeuristicParse(input, { enginesTried });
        if (offline.transactions.length > transactions.length) {
          transactions = offline.transactions;
        }
        warnings.push(...offline.meta.warnings);
        input.onProgress?.(1, "Local OCR complete");
        return {
          rawText: rawText || offline.rawText,
          pageCount,
          pageTexts: pageTexts.length ? pageTexts : offline.pageTexts,
          transactions,
          meta: {
            parserId: "local-ocr",
            parserLabel: this.info.label,
            durationMs: Math.round(performance.now() - started),
            fallbackUsed: !ocrUsed,
            enginesTried: [...enginesTried, ...offline.meta.enginesTried],
            bankTemplateId: offline.meta.bankTemplateId,
            bankTemplateName: offline.meta.bankTemplateName,
            warnings: [...new Set(warnings)],
            pageCount,
            rawTextLength: (rawText || offline.rawText).length,
            structuredFromApi: false,
          },
        };
      }

      // Detect bank template name for meta via offline detect on text
      const offlineMeta = await runOfflineHeuristicParse(
        {
          ...input,
          onProgress: undefined,
        },
        { enginesTried: ["template-detect"] },
      );

      input.onProgress?.(1, "Local OCR complete");
      return {
        rawText,
        pageCount,
        pageTexts,
        transactions:
          offlineMeta.transactions.length > transactions.length
            ? offlineMeta.transactions
            : transactions,
        meta: {
          parserId: "local-ocr",
          parserLabel: this.info.label,
          durationMs: Math.round(performance.now() - started),
          fallbackUsed: !ocrUsed,
          enginesTried,
          bankTemplateId: offlineMeta.meta.bankTemplateId,
          bankTemplateName: offlineMeta.meta.bankTemplateName,
          warnings: [...new Set(warnings)],
          pageCount,
          rawTextLength: rawText.length,
          structuredFromApi: false,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const offline = await runOfflineHeuristicParse(input, {
        enginesTried,
        fallbackFrom: "local-ocr",
      });
      offline.meta.durationMs = Math.round(performance.now() - started);
      offline.meta.warnings.push(`Local OCR error: ${message}`);
      return offline;
    }
  },
};
