import { cloneUint8Array } from "@/lib/bytes";
import { mupdfEngine, safeErrorMessage } from "./mupdf-engine";
import { pdfiumEngine } from "./pdfium-engine";
import { pdfjsEngine } from "./pdfjs-engine";
import type { EngineId, PdfEngine, PdfEngineDocument } from "./types";
import { ENGINE_CHAIN } from "./types";
import {
  DEFAULT_WRITE_CHUNK,
  type ApplyReplacementsOptions,
  type ApplyReplacementsResult,
  type PdfReplacement,
} from "./write-options";

export * from "./types";
export * from "./write-options";
export { mupdfEngine, safeErrorMessage } from "./mupdf-engine";
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
      const document = await engine.load(cloneUint8Array(data));
      return {
        document,
        engineUsed: id,
        enginesTried,
        fallbackUsed:
          enginesTried.length > 1 || (preferred != null && id !== preferred),
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

function isOobError(err: unknown): boolean {
  const m = safeErrorMessage(err).toLowerCase();
  return (
    m.includes("out of bounds") ||
    m.includes("index out of bounds") ||
    m.includes("table index") ||
    m.includes("memory access")
  );
}

/** Fast change probe: length + head + mid + tail samples (avoids full scan). */
function pdfChanged(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return true;
  const len = a.byteLength;
  if (len === 0) return false;
  const head = Math.min(len, 4096);
  for (let i = 0; i < head; i++) {
    if (a[i] !== b[i]) return true;
  }
  if (len > 8192) {
    const mid = Math.floor(len / 2);
    for (let i = mid; i < mid + 256 && i < len; i++) {
      if (a[i] !== b[i]) return true;
    }
  }
  if (len > 4096) {
    for (let i = len - 256; i < len; i++) {
      if (a[i] !== b[i]) return true;
    }
  }
  return false;
}

/**
 * Apply replacements with MuPDF in safe chunks.
 * Large single-pass FreeText/redact batches hit WASM "table index out of bounds".
 */
async function applyMupdfChunked(
  data: Uint8Array,
  replacements: PdfReplacement[],
  options: ApplyReplacementsOptions,
): Promise<ApplyReplacementsResult> {
  const notes: string[] = [];
  let chunkSize = Math.max(
    8,
    Math.min(120, options.chunkSize ?? DEFAULT_WRITE_CHUNK),
  );
  const burnOriginal = options.burnOriginal !== false;
  notes.push(
    `mupdf write: ${replacements.length} replacement(s), chunk=${chunkSize}, burn=${burnOriginal}`,
  );

  let current = cloneUint8Array(data);
  let applied = 0;
  let burned = 0;
  let chunks = 0;
  let offset = 0;

  while (offset < replacements.length) {
    let slice = replacements.slice(offset, offset + chunkSize);
    let success = false;
    let attempts = 0;

    while (!success && attempts < 4) {
      attempts += 1;
      try {
        const doc = await mupdfEngine.load(cloneUint8Array(current));
        try {
          const out = await doc.applyReplacements(slice, {
            burnOriginal,
            coordSpace: options.coordSpace ?? "top-down",
            minApplyRatio: options.minApplyRatio,
          });
          if (!pdfChanged(current, out) && slice.length > 0) {
            throw new Error("mupdf chunk produced identical PDF");
          }
          if (
            out.byteLength < 5 ||
            out[0] !== 0x25 ||
            out[1] !== 0x50 ||
            out[2] !== 0x44 ||
            out[3] !== 0x46
          ) {
            throw new Error("mupdf chunk produced non-PDF output");
          }
          current = cloneUint8Array(out);
          applied += slice.length;
          if (burnOriginal) burned += slice.length;
          chunks += 1;
          offset += slice.length;
          success = true;
        } finally {
          doc.destroy();
        }
      } catch (err) {
        if (
          (isOobError(err) || /min \d+%|FreeText inserts/i.test(safeErrorMessage(err))) &&
          slice.length > 1
        ) {
          chunkSize = Math.max(1, Math.floor(slice.length / 2));
          slice = replacements.slice(offset, offset + chunkSize);
          notes.push(
            `mupdf chunk fail — reducing chunkSize to ${chunkSize} and retrying`,
          );
          continue;
        }
        throw err;
      }
    }

    if (!success) {
      throw new Error(
        `mupdf failed after chunk retries near offset ${offset}/${replacements.length}`,
      );
    }
  }

  notes.push(
    `mupdf complete: ${chunks} chunk(s), applied=${applied}, burned≈${burned}`,
  );
  return {
    pdf: current,
    engineUsed: "mupdf",
    enginesTried: ["mupdf"],
    chunks,
    applied,
    burned,
    notes,
  };
}

async function applyRemote(
  data: Uint8Array,
  replacements: PdfReplacement[],
  options: ApplyReplacementsOptions,
): Promise<ApplyReplacementsResult> {
  const { remoteReplacePdf, isRemoteEngineConfigured } = await import(
    "@/lib/tools/remote-engine"
  );
  if (!isRemoteEngineConfigured()) {
    throw new Error("Remote engine URL not configured");
  }
  const burnOriginal = options.burnOriginal !== false;
  const result = await remoteReplacePdf({
    bytes: data,
    replacements: replacements.map((r) => ({
      page: r.page,
      bbox: r.bbox,
      replacement: r.replacement,
      burn: r.burn ?? burnOriginal,
    })),
  });
  // Finalize remote result through Pdfium when available (write engine of record)
  try {
    const { finalizePdfWithPdfium } = await import("./pdfium-engine");
    const finalized = await finalizePdfWithPdfium(result.pdf);
    return {
      pdf: finalized,
      engineUsed: "pdfium",
      enginesTried: ["remote", "pdfium"],
      chunks: 1,
      applied: replacements.length,
      burned: burnOriginal ? replacements.length : 0,
      notes: [
        ...result.notes,
        "Final PDF bytes saved via PDFium (write engine of record)",
      ],
    };
  } catch {
    return {
      pdf: result.pdf,
      engineUsed: result.engine,
      enginesTried: ["remote"],
      chunks: 1,
      applied: replacements.length,
      burned: burnOriginal ? replacements.length : 0,
      notes: result.notes,
    };
  }
}

/** Product write path: Pdfium is write engine of record (inject via MuPDF, save via PDFium). */
async function applyPdfiumWrite(
  data: Uint8Array,
  replacements: PdfReplacement[],
  options: ApplyReplacementsOptions,
): Promise<ApplyReplacementsResult> {
  const available = await pdfiumEngine.isAvailable();
  if (!available) throw new Error("pdfium: WASM not available");

  const doc = await pdfiumEngine.load(cloneUint8Array(data));
  try {
    const out = await doc.applyReplacements(replacements, {
      burnOriginal: options.burnOriginal,
      coordSpace: options.coordSpace ?? "top-down",
      minApplyRatio: options.minApplyRatio,
    });
    return {
      pdf: out,
      engineUsed: "pdfium",
      enginesTried: ["pdfium"],
      chunks: Math.ceil(
        replacements.length / Math.max(1, options.chunkSize ?? DEFAULT_WRITE_CHUNK),
      ),
      applied: replacements.length,
      burned: options.burnOriginal !== false ? replacements.length : 0,
      notes: [
        `pdfium write engine: ${replacements.length} replacement(s); inject=mupdf(coord=${options.coordSpace ?? "top-down"}); final save=pdfium`,
      ],
    };
  } finally {
    doc.destroy();
  }
}

/**
 * Multi-engine PDF write path (product rules):
 *   1. **pdfium** — write engine of record (required when available)
 *   2. mupdf chunked — inject-only fallback, then pdfium finalize if possible
 *   3. remote — optional native PyMuPDF, then pdfium finalize
 */
export async function applyReplacementsWithFallbacks(
  data: Uint8Array,
  replacements: Array<{
    page: number;
    bbox: { x: number; y: number; width: number; height: number };
    replacement: string;
    fontSpec: import("@/lib/types").PdfFontSpec;
    burn?: boolean;
  }>,
  preferredDoc?: PdfEngineDocument,
  options: ApplyReplacementsOptions = {},
): Promise<Uint8Array> {
  const result = await applyReplacementsWithMeta(
    data,
    replacements,
    preferredDoc,
    options,
  );
  return result.pdf;
}

/**
 * Same as applyReplacementsWithFallbacks but returns engine metadata.
 */
export async function applyReplacementsWithMeta(
  data: Uint8Array,
  replacements: PdfReplacement[],
  preferredDoc?: PdfEngineDocument,
  options: ApplyReplacementsOptions = {},
): Promise<ApplyReplacementsResult> {
  if (replacements.length === 0) {
    return {
      pdf: cloneUint8Array(data),
      engineUsed: "none",
      enginesTried: [],
      chunks: 0,
      applied: 0,
      burned: 0,
      notes: ["No replacements"],
    };
  }

  const blanks = replacements.filter((r) => !String(r.replacement ?? "").trim());
  if (blanks.length > 0) {
    throw new Error(
      `Refused ${blanks.length} blank PDF replacement(s) — NEVER REDACT without insert text.`,
    );
  }

  const enginesTried: string[] = [];
  const errors: string[] = [];
  // Product default: Pdfium write engine of record first
  const order =
    options.engines ??
    (options.preferRemote
      ? (["remote", "pdfium", "mupdf"] as const)
      : (["pdfium", "mupdf", "remote"] as const));

  // Preferred open document if it is already pdfium
  if (
    preferredDoc &&
    preferredDoc.engine === "pdfium" &&
    replacements.length > 0
  ) {
    try {
      enginesTried.push("pdfium-preferred");
      const out = await preferredDoc.applyReplacements(replacements, {
        burnOriginal: options.burnOriginal,
        coordSpace: options.coordSpace ?? "top-down",
        minApplyRatio: options.minApplyRatio,
      });
      return {
        pdf: out,
        engineUsed: "pdfium",
        enginesTried,
        chunks: 1,
        applied: replacements.length,
        burned: options.burnOriginal !== false ? replacements.length : 0,
        notes: ["Used preferred pdfium document (write engine of record)"],
      };
    } catch (err) {
      errors.push(`pdfium-preferred: ${safeErrorMessage(err)}`);
    }
  }

  for (const eng of order) {
    try {
      if (eng === "pdfium") {
        enginesTried.push("pdfium");
        return await applyPdfiumWrite(data, replacements, options);
      }
      if (eng === "mupdf") {
        enginesTried.push("mupdf");
        const available = await mupdfEngine.isAvailable();
        if (!available) {
          errors.push("mupdf: not available");
          continue;
        }
        // Inject with mupdf, then finalize with pdfium when possible
        const injected = await applyMupdfChunked(data, replacements, options);
        try {
          const { finalizePdfWithPdfium } = await import("./pdfium-engine");
          const finalized = await finalizePdfWithPdfium(injected.pdf);
          const usedPdfiumSave =
            finalized.byteLength !== injected.pdf.byteLength ||
            finalized !== injected.pdf;
          return {
            ...injected,
            pdf: finalized,
            // Product: Pdfium is preferred finalizer when save API exists;
            // otherwise MuPDF inject bytes are the durable output.
            engineUsed: usedPdfiumSave ? "pdfium" : "mupdf",
            enginesTried: [...enginesTried, "pdfium-finalize"],
            notes: [
              ...injected.notes,
              usedPdfiumSave
                ? "Final PDF bytes re-saved via PDFium"
                : "PDFium finalize pass-through (binding has no save) — MuPDF inject bytes kept",
            ],
          };
        } catch {
          return injected;
        }
      }
      if (eng === "remote") {
        enginesTried.push("remote");
        return await applyRemote(data, replacements, options);
      }
    } catch (err) {
      errors.push(`${eng}: ${safeErrorMessage(err)}`);
    }
  }

  throw new Error(
    `Could not write final statement PDF (${replacements.length} replacement(s)) via engines [${enginesTried.join(", ")}]: ${errors.join(" · ") || "unknown"}`,
  );
}
