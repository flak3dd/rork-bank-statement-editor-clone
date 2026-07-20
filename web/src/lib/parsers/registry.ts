import { googleDocAiParser } from "./google-docai";
import { llamaParseParser } from "./llamaparse";
import { localOcrParser } from "./local-ocr";
import { mindeeParser } from "./mindee";
import { offlineHeuristicParser } from "./offline-heuristic";
import { pyMuPdfParser } from "./pymupdf";
import type {
  DocumentParser,
  DocumentParserId,
  DocumentParserInfo,
  ParserInput,
  ParserResult,
} from "./types";

const PARSERS: Record<DocumentParserId, DocumentParser> = {
  mindee: mindeeParser,
  llamaparse: llamaParseParser,
  "google-docai": googleDocAiParser,
  pymupdf: pyMuPdfParser,
  "local-ocr": localOcrParser,
  "offline-heuristic": offlineHeuristicParser,
};

/**
 * Display order — LlamaParse / Google Doc AI required for production parse.
 * Local engines remain for structure enrichment and offline emergencies.
 */
export const DOCUMENT_PARSER_ORDER: DocumentParserId[] = [
  "llamaparse",
  "google-docai",
  "pymupdf",
  "mindee",
  "local-ocr",
  "offline-heuristic",
];

/** Prefer LlamaParse; upload still requires LlamaParse OR Doc AI. */
export const DEFAULT_DOCUMENT_PARSER: DocumentParserId = "llamaparse";

export function listDocumentParsers(): DocumentParserInfo[] {
  return DOCUMENT_PARSER_ORDER.map((id) => {
    const p = PARSERS[id];
    return {
      ...p.info,
      availability: p.isConfigured()
        ? p.info.cloud
          ? "ready"
          : p.info.availability
        : p.info.cloud
          ? "needs-config"
          : p.info.availability,
    };
  });
}

export function getDocumentParser(id: DocumentParserId): DocumentParser {
  return PARSERS[id] ?? PARSERS[DEFAULT_DOCUMENT_PARSER];
}

export function isDocumentParserId(v: string): v is DocumentParserId {
  return v in PARSERS;
}

/**
 * Run the selected document parser.
 * Cloud parsers already soft-fallback to offline heuristic internally.
 */
export async function runDocumentParser(
  id: DocumentParserId,
  input: ParserInput,
): Promise<ParserResult> {
  const parser = getDocumentParser(id);
  return parser.parse(input);
}

export function loadParserPreference(): DocumentParserId {
  try {
    const raw = localStorage.getItem("statement-lens.parser");
    if (raw && isDocumentParserId(raw)) return raw;
  } catch {
    // ignore
  }
  return DEFAULT_DOCUMENT_PARSER;
}

export function saveParserPreference(id: DocumentParserId): void {
  try {
    localStorage.setItem("statement-lens.parser", id);
  } catch {
    // ignore
  }
}
