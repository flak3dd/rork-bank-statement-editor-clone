/**
 * PyMuPDF-compatible browser parser (MuPDF WASM).
 *
 * Exports:
 *  - extractTextWithPyMuPdf — page text via mupdf (correct countPages / structured text)
 *  - structurePyMuPdfText — hybrid + bank YAML templates
 *  - pyMuPdfParser — DocumentParser registry entry
 *
 * Used by parse UI, generation assist, and OEM pipeline when local high-quality
 * text is needed without cloud APIs.
 */
import { attachOriginals } from "@/lib/edit-utils";
import { parseTransactionsHybrid } from "@/lib/parse-transactions";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { cloneUint8Array } from "@/lib/bytes";
import { detectBankTemplate } from "./templates";
import type { BankTemplate } from "./types";
import type { DocumentParser, ParserInput, ParserResult } from "./types";
import type { Transaction } from "@/lib/types";

export interface PyMuPdfExtractResult {
  text: string;
  pageCount: number;
  pageTexts: string[];
  engine: "mupdf" | "pdfjs-fallback";
  durationMs: number;
}

function applyTemplateNoise(text: string, template: BankTemplate): string {
  const lines = text.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const lower = line.toLowerCase().trim();
    if (!lower) return false;
    return !template.noise.some(
      (n) => lower.startsWith(n) || lower.includes(n),
    );
  });
  return filtered.join("\n");
}

function applyDescriptionCleanup(
  desc: string,
  template: BankTemplate,
): string {
  let out = desc;
  for (const rule of template.descriptionCleanup ?? []) {
    try {
      const pat = rule.pattern.replace(/\\\\/g, "\\");
      out = out.replace(new RegExp(pat, "gi"), rule.replace ?? "");
    } catch {
      /* ignore */
    }
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Extract full-document text with MuPDF WASM (PyMuPDF-compatible).
 * Falls back to PDF.js if mupdf fails to load.
 */
export async function extractTextWithPyMuPdf(
  bytes: Uint8Array,
  options?: {
    onProgress?: (ratio: number, message?: string) => void;
    maxPages?: number;
  },
): Promise<PyMuPdfExtractResult> {
  const started = performance.now();
  const data = cloneUint8Array(bytes);
  const onProgress = options?.onProgress;
  const maxPages = options?.maxPages ?? 200;

  try {
    onProgress?.(0.05, "Loading MuPDF (PyMuPDF)…");
    const mod = await import("mupdf");
    const doc = mod.Document.openDocument(data, "application/pdf");
    try {
      const pageCount = Math.min(
        typeof doc.countPages === "function" ? doc.countPages() : 0,
        maxPages,
      );
      if (pageCount <= 0) {
        throw new Error("mupdf: empty document");
      }
      const pageTexts: string[] = [];
      for (let i = 0; i < pageCount; i++) {
        const page = doc.loadPage(i);
        try {
          let pageText = "";
          // Preferred: structured text (stable across mupdf versions)
          try {
            const stext = page.toStructuredText?.("preserve-spans");
            if (stext && typeof stext.asText === "function") {
              pageText = stext.asText() || "";
            }
          } catch {
            /* try other APIs */
          }
          if (!pageText && typeof page.toText === "function") {
            try {
              pageText = page.toText() || page.toText("text") || "";
            } catch {
              /* */
            }
          }
          pageTexts.push(pageText);
        } finally {
          try {
            page.destroy?.();
          } catch {
            /* */
          }
        }
        onProgress?.(
          0.05 + ((i + 1) / pageCount) * 0.9,
          `PyMuPDF page ${i + 1}/${pageCount}`,
        );
      }
      const text = pageTexts.join("\n\n");
      if (!text.trim()) {
        throw new Error("mupdf: no extractable text");
      }
      return {
        text,
        pageCount,
        pageTexts,
        engine: "mupdf",
        durationMs: Math.round(performance.now() - started),
      };
    } finally {
      try {
        doc.destroy?.();
      } catch {
        /* */
      }
    }
  } catch (err) {
    onProgress?.(0.2, "MuPDF unavailable — PDF.js text…");
    const pdf = await extractTextFromPdf(data, (r) =>
      onProgress?.(0.2 + r * 0.7, "PDF.js pages…"),
    );
    return {
      text: pdf.text,
      pageCount: pdf.pageCount,
      pageTexts: pdf.pageTexts,
      engine: "pdfjs-fallback",
      durationMs: Math.round(performance.now() - started),
    };
  }
}

const MONTH =
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const DATE_LINE = new RegExp(
  String.raw`^(\d{1,2}\s+(?:${MONTH})[a-z]*(?:\s+\d{2,4})?|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})$`,
  "i",
);
const MONEY_LINE = /^-?\$?\s*[\d,]+\.\d{2}$/;

/**
 * Coalesce MuPDF structured-text lines (date / desc / amount on separate lines)
 * into hybrid-friendly single-line rows — critical for St George style PDFs.
 */
export function coalesceMultilineStatementText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (DATE_LINE.test(line)) {
      const date = line;
      const descParts: string[] = [];
      const monies: string[] = [];
      i += 1;
      while (i < lines.length && !DATE_LINE.test(lines[i])) {
        const L = lines[i];
        if (MONEY_LINE.test(L.replace(/\s/g, "")) || MONEY_LINE.test(L)) {
          monies.push(L);
        } else if (
          !/^(date|transaction|amount|balance|debit|credit|page|of)$/i.test(L) &&
          !/st\.?\s*george|westpac banking|complete freedom|current balance/i.test(
            L,
          )
        ) {
          descParts.push(L);
        }
        i += 1;
        // stop after we collected 2 money tokens (amount + balance)
        if (monies.length >= 2) break;
      }
      // also peek one more if only one money so far
      while (monies.length < 2 && i < lines.length && MONEY_LINE.test(lines[i])) {
        monies.push(lines[i]);
        i += 1;
      }
      if (descParts.length || monies.length) {
        out.push([date, ...descParts, ...monies].join(" "));
      } else {
        out.push(date);
      }
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n");
}

/**
 * Structure PyMuPDF text with hybrid line parser + bank YAML templates.
 */
export function structurePyMuPdfText(
  text: string,
  options?: { bankHint?: string | null },
): {
  transactions: Transaction[];
  template: BankTemplate;
  cleanedText: string;
  notes: string[];
} {
  const notes: string[] = [];
  const template = detectBankTemplate(
    [text, options?.bankHint ?? ""].filter(Boolean).join("\n"),
  );
  notes.push(`bank template: ${template.id} (${template.name})`);

  const cleaned = applyTemplateNoise(text, template);
  // MuPDF often emits one field per line — coalesce before hybrid parse
  const coalesced = coalesceMultilineStatementText(cleaned);
  notes.push(
    cleaned.split("\n").length !== coalesced.split("\n").length
      ? "coalesced multi-line structured text for hybrid parse"
      : "line layout unchanged",
  );

  let hybrid = parseTransactionsHybrid(coalesced);
  if (hybrid.transactions.length < 3) {
    // try raw cleaned as well
    const alt = parseTransactionsHybrid(cleaned);
    if (alt.transactions.length > hybrid.transactions.length) {
      hybrid = alt;
      notes.push("used non-coalesced hybrid (more rows)");
    }
  }

  let transactions = hybrid.transactions.map((t) => ({
    ...t,
    description: applyDescriptionCleanup(t.description, template),
    flags: [
      ...new Set([...(t.flags ?? []), "pymupdf", `tpl:${template.id}`]),
    ],
  }));
  transactions = attachOriginals(transactions);
  notes.push(
    `structured ${transactions.length} transaction(s) from PyMuPDF text`,
  );

  return {
    transactions,
    template,
    cleanedText: coalesced || cleaned || text,
    notes,
  };
}

/**
 * Full extract + structure convenience for generation / OEM.
 */
export async function parseWithPyMuPdf(
  bytes: Uint8Array,
  options?: {
    onProgress?: (ratio: number, message?: string) => void;
    maxPages?: number;
    bankHint?: string | null;
    fileName?: string;
  },
): Promise<{
  extract: PyMuPdfExtractResult;
  transactions: Transaction[];
  template: BankTemplate;
  rawText: string;
  notes: string[];
}> {
  const extract = await extractTextWithPyMuPdf(bytes, {
    onProgress: options?.onProgress,
    maxPages: options?.maxPages,
  });
  const structured = structurePyMuPdfText(extract.text, {
    bankHint: options?.bankHint ?? options?.fileName,
  });
  return {
    extract,
    transactions: structured.transactions,
    template: structured.template,
    rawText: structured.cleanedText,
    notes: [
      `engine=${extract.engine}`,
      `pages=${extract.pageCount}`,
      ...structured.notes,
    ],
  };
}

export const pyMuPdfParser: DocumentParser = {
  info: {
    id: "pymupdf",
    label: "PyMuPDF (MuPDF WASM)",
    shortLabel: "PyMuPDF",
    description:
      "MuPDF WASM text extraction (PyMuPDF-compatible) + hybrid transaction structuring + bank YAML templates. Preferred local parser when cloud keys are unavailable.",
    availability: "browser-local",
    cloud: false,
    envHints: [],
  },

  isConfigured() {
    return true;
  },

  async parse(input: ParserInput): Promise<ParserResult> {
    const started = performance.now();
    const enginesTried: string[] = ["pymupdf"];

    try {
      input.onProgress?.(0.02, "PyMuPDF extract…");
      const parsed = await parseWithPyMuPdf(input.bytes, {
        onProgress: input.onProgress,
        bankHint: input.file.name,
        fileName: input.file.name,
      });
      if (parsed.extract.engine === "pdfjs-fallback") {
        enginesTried.push("pdfjs-fallback");
      }
      enginesTried.push("hybrid-structure", `yaml:${parsed.template.id}`);

      input.onProgress?.(1, "PyMuPDF parse complete");
      return {
        rawText: parsed.rawText,
        pageCount: parsed.extract.pageCount,
        pageTexts: parsed.extract.pageTexts,
        transactions: parsed.transactions,
        meta: {
          parserId: "pymupdf",
          parserLabel: this.info.label,
          durationMs: Math.round(performance.now() - started),
          fallbackUsed: parsed.extract.engine === "pdfjs-fallback",
          enginesTried,
          bankTemplateId: parsed.template.id,
          bankTemplateName: parsed.template.name,
          warnings:
            parsed.transactions.length === 0
              ? [
                  "No transactions detected — PDF may be image-only; try Local OCR or Mindee.",
                ]
              : parsed.notes,
          pageCount: parsed.extract.pageCount,
          rawTextLength: parsed.rawText.length,
          structuredFromApi: false,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Last resort: offline heuristic (PDF.js + YAML)
      const { runOfflineHeuristicParse } = await import("./offline-heuristic");
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
