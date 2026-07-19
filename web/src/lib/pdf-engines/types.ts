import type { PdfFontSpec } from "@/lib/types";

export type EngineId = "mupdf" | "pdfium" | "pdfjs";

export interface EngineInfo {
  id: EngineId;
  label: string;
  description: string;
}

export const ENGINE_CHAIN: EngineInfo[] = [
  {
    id: "mupdf",
    label: "MuPDF (PyMuPDF Pro)",
    description: "High-fidelity rendering, redaction, and font replication via MuPDF WASM",
  },
  {
    id: "pdfium",
    label: "PDFium",
    description: "Google's PDF engine — fast rendering fallback via PDFium WASM",
  },
  {
    id: "pdfjs",
    label: "PDF.js",
    description: "Mozilla's pure-JS engine — final safety-net fallback",
  },
];

export interface TextRun {
  id: string;
  page: number;
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  angle: number;
  dir: string;
  fontName: string;
  fontSpec: PdfFontSpec;
}

export interface RenderedPage {
  pageNumber: number;
  width: number;
  height: number;
  scale: number;
  imageData: ImageData;
  runs: TextRun[];
}

export interface PdfEngineDocument {
  engine: EngineId;
  pageCount: number;
  /** Render a page to pixel data + extract text runs with bounding boxes. */
  renderPage(pageNumber: number, scale: number): Promise<RenderedPage>;
  /** Extract plain text from a page (1-indexed). */
  extractPageText(pageNumber: number): Promise<string>;
  /** Extract all text runs from a page without rendering pixels. */
  extractPageRuns(pageNumber: number, scale: number): Promise<TextRun[]>;
  /** Apply redaction-based replacements and return new PDF bytes. */
  applyReplacements(
    replacements: Array<{
      page: number;
      bbox: { x: number; y: number; width: number; height: number };
      replacement: string;
      fontSpec: PdfFontSpec;
    }>,
  ): Promise<Uint8Array>;
  /** Save the current document state to PDF bytes. */
  save(): Promise<Uint8Array>;
  /** Release all resources. */
  destroy(): void;
}

export interface PdfEngine {
  id: EngineId;
  /** Load a PDF from bytes. Throws if the engine cannot handle the data. */
  load(data: Uint8Array): Promise<PdfEngineDocument>;
  /** Check if the engine is available (WASM loaded, etc). */
  isAvailable(): Promise<boolean>;
}
