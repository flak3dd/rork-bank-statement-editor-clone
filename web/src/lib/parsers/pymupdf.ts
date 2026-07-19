import { attachOriginals } from "@/lib/edit-utils";
import { parseTransactionsHybrid } from "@/lib/parse-transactions";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { runOfflineHeuristicParse } from "./offline-heuristic";
import type { DocumentParser, ParserInput, ParserResult } from "./types";

async function extractWithMuPdf(bytes: Uint8Array, onProgress?: ParserInput["onProgress"]) {
  const mod = await import("mupdf");
  const doc = mod.Document.openDocument(bytes, "application/pdf") as {
    numPages: number;
    loadPage: (i: number) => { toText: (fmt: string) => string; destroy: () => void };
    destroy: () => void;
  };
  try {
    const pageCount = doc.numPages;
    const pageTexts: string[] = [];
    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      try {
        pageTexts.push(page.toText("text") || "");
      } finally {
        page.destroy();
      }
      onProgress?.((i + 1) / pageCount, `PyMuPDF page ${i + 1}/${pageCount}`);
    }
    return { text: pageTexts.join("\n\n"), pageCount, pageTexts };
  } finally {
    doc.destroy();
  }
}

export const pyMuPdfParser: DocumentParser = {
  info: {
    id: "pymupdf",
    label: "PyMuPDF built-in",
    shortLabel: "PyMuPDF",
    description:
      "MuPDF WASM text extraction (PyMuPDF-compatible engine) with hybrid transaction structuring and bank YAML detection fallback.",
    availability: "browser-local",
    cloud: false,
    envHints: [],
  },

  isConfigured() {
    return true;
  },

  async parse(input: ParserInput): Promise<ParserResult> {
    const started = performance.now();
    const enginesTried = ["pymupdf"];

    try {
      input.onProgress?.(0.05, "Loading MuPDF…");
      let text: string;
      let pageCount: number;
      let pageTexts: string[];

      try {
        const result = await extractWithMuPdf(input.bytes, (r, msg) =>
          input.onProgress?.(0.05 + r * 0.6, msg),
        );
        text = result.text;
        pageCount = result.pageCount;
        pageTexts = result.pageTexts;
      } catch {
        enginesTried.push("pdfjs-fallback");
        input.onProgress?.(0.2, "MuPDF unavailable — PDF.js text…");
        const pdf = await extractTextFromPdf(input.bytes, (r) =>
          input.onProgress?.(0.2 + r * 0.5),
        );
        text = pdf.text;
        pageCount = pdf.pageCount;
        pageTexts = pdf.pageTexts;
      }

      // Enrich with offline template detection on the extracted text
      enginesTried.push("offline-heuristic-structure");
      const structured = await runOfflineHeuristicParse(
        {
          ...input,
          // Re-use bytes but prefer our text path: inject via offline after hybrid
        },
        { enginesTried },
      );

      // Prefer structured rows from offline template pass, but keep MuPDF text
      const hybrid = parseTransactionsHybrid(text);
      const transactions =
        structured.transactions.length >= hybrid.transactions.length
          ? structured.transactions
          : attachOriginals(hybrid.transactions);

      input.onProgress?.(1, "PyMuPDF parse complete");
      return {
        rawText: text || structured.rawText,
        pageCount: pageCount || structured.pageCount,
        pageTexts: pageTexts.length ? pageTexts : structured.pageTexts,
        transactions,
        meta: {
          parserId: "pymupdf",
          parserLabel: this.info.label,
          durationMs: Math.round(performance.now() - started),
          fallbackUsed: enginesTried.includes("pdfjs-fallback"),
          enginesTried,
          bankTemplateId: structured.meta.bankTemplateId,
          bankTemplateName: structured.meta.bankTemplateName,
          warnings: structured.meta.warnings,
          pageCount: pageCount || structured.pageCount,
          rawTextLength: (text || structured.rawText).length,
          structuredFromApi: false,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const offline = await runOfflineHeuristicParse(input, {
        enginesTried,
        fallbackFrom: "pymupdf",
      });
      offline.meta.durationMs = Math.round(performance.now() - started);
      offline.meta.warnings.push(`PyMuPDF error: ${message}`);
      return offline;
    }
  },
};
