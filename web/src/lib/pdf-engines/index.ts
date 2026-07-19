import { cloneUint8Array } from "@/lib/bytes";
import { mupdfEngine } from "./mupdf-engine";
import { pdfiumEngine } from "./pdfium-engine";
import { pdfjsEngine } from "./pdfjs-engine";
import type { EngineId, PdfEngine, PdfEngineDocument } from "./types";
import { ENGINE_CHAIN } from "./types";

export * from "./types";
export { mupdfEngine } from "./mupdf-engine";
export { pdfiumEngine } from "./pdfium-engine";
export { pdfjsEngine } from "./pdfjs-engine";

const ENGINES: Record<EngineId, PdfEngine> = {
  mupdf: mupdfEngine,
  pdfium: pdfiumEngine,
  pdfjs: pdfjsEngine,
};

export interface EngineLoadResult {
  document: PdfEngineDocument;
  engineUsed: EngineId;
  enginesTried: EngineId[];
  fallbackUsed: boolean;
}

/**
 * Load a PDF with engine fallbacks: MuPDF → PDFium → PDF.js.
 * Always ends with PDF.js if earlier engines fail.
 */
export async function loadPdfWithFallbacks(
  data: Uint8Array,
  preferred?: EngineId,
): Promise<EngineLoadResult> {
  const order: EngineId[] = [];
  if (preferred) order.push(preferred);
  for (const info of ENGINE_CHAIN) {
    if (!order.includes(info.id)) order.push(info.id);
  }

  const enginesTried: EngineId[] = [];
  let lastError: unknown;

  for (const id of order) {
    enginesTried.push(id);
    const engine = ENGINES[id];
    try {
      const available = await engine.isAvailable();
      if (!available) continue;
      // Each engine gets its own copy so transfer can't detach React state
      // or poison the next fallback attempt.
      const document = await engine.load(cloneUint8Array(data));
      return {
        document,
        engineUsed: id,
        enginesTried,
        fallbackUsed: enginesTried.length > 1 || (preferred != null && id !== preferred),
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `All PDF engines failed. Tried: ${enginesTried.join(" → ")}. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export async function probeEngines(): Promise<
  Array<{ id: EngineId; available: boolean }>
> {
  const out: Array<{ id: EngineId; available: boolean }> = [];
  for (const info of ENGINE_CHAIN) {
    try {
      const available = await ENGINES[info.id].isAvailable();
      out.push({ id: info.id, available });
    } catch {
      out.push({ id: info.id, available: false });
    }
  }
  return out;
}

/**
 * Apply redaction-based replacements using the best write-capable engine.
 * MuPDF is the only engine that supports true redaction; falls back to
 * returning original bytes if MuPDF is unavailable.
 */
export async function applyReplacementsWithFallbacks(
  data: Uint8Array,
  replacements: Array<{
    page: number;
    bbox: { x: number; y: number; width: number; height: number };
    replacement: string;
    fontSpec: import("@/lib/types").PdfFontSpec;
  }>,
  preferredDoc?: PdfEngineDocument,
): Promise<Uint8Array> {
  if (preferredDoc && preferredDoc.engine === "mupdf") {
    return preferredDoc.applyReplacements(replacements);
  }

  try {
    const available = await mupdfEngine.isAvailable();
    if (available) {
      const doc = await mupdfEngine.load(cloneUint8Array(data));
      try {
        return await doc.applyReplacements(replacements);
      } finally {
        doc.destroy();
      }
    }
  } catch {
    // Fall through
  }

  return cloneUint8Array(data);
}
