import type { Transaction } from "@/lib/types";

/** Document parser identifiers — Mindee Financial is the product default. */
export type DocumentParserId =
  | "mindee"
  | "llamaparse"
  | "google-docai"
  | "pymupdf"
  | "local-ocr"
  | "offline-heuristic";

export type ParserAvailability =
  | "ready"
  | "needs-config"
  | "browser-local"
  | "offline";

export interface DocumentParserInfo {
  id: DocumentParserId;
  label: string;
  shortLabel: string;
  description: string;
  availability: ParserAvailability;
  /** Requires network / API key. */
  cloud: boolean;
  default?: boolean;
  envHints: string[];
}

export interface ParserInput {
  file: File;
  bytes: Uint8Array;
  fileName: string;
  onProgress?: (ratio: number, message?: string) => void;
  signal?: AbortSignal;
}

export interface ParserRunMeta {
  parserId: DocumentParserId;
  parserLabel: string;
  durationMs: number;
  /** True when a cloud/local engine failed and offline heuristic ran. */
  fallbackUsed: boolean;
  fallbackFrom?: DocumentParserId;
  enginesTried: string[];
  /** Matched bank template id when offline/YAML path used. */
  bankTemplateId?: string | null;
  bankTemplateName?: string | null;
  warnings: string[];
  pageCount: number;
  rawTextLength: number;
  structuredFromApi: boolean;
}

export interface ParserResult {
  rawText: string;
  pageCount: number;
  pageTexts: string[];
  /** Pre-structured rows when the API returns line items; else empty → hybrid parse. */
  transactions: Transaction[];
  meta: ParserRunMeta;
}

export interface DocumentParser {
  info: DocumentParserInfo;
  /** Soft probe — does not throw. */
  isConfigured(): boolean;
  parse(input: ParserInput): Promise<ParserResult>;
}

/** Bank statement layout template (from YAML). */
export interface BankTemplate {
  id: string;
  name: string;
  /** Substrings that identify this bank in statement text. */
  match: string[];
  /** day-first (AU/EU) or month-first (US). */
  dateOrder: "dmy" | "mdy" | "ymd";
  columnOrder: Array<"date" | "description" | "debit" | "credit" | "balance" | "amount">;
  /** Extra noise line prefixes to ignore. */
  noise: string[];
  /** Optional description cleanup regexes (source → replace). */
  descriptionCleanup?: Array<{ pattern: string; replace: string }>;
  currency?: string;
  notes?: string;
}
