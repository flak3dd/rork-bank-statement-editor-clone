/**
 * Shared @hyzyla/pdfium browser init.
 *
 * Browser builds require wasmUrl or wasmBinary — bare PDFiumLibrary.init()
 * throws. Resolve package WASM via Vite `?url`, load bytes, pass wasmBinary.
 */

import type { PDFiumLibrary } from "@hyzyla/pdfium";
import pdfiumWasmUrl from "@hyzyla/pdfium/dist/pdfium.wasm?url";

let libraryPromise: Promise<PDFiumLibrary> | null = null;

async function loadWasmBinary(): Promise<ArrayBuffer> {
  // 1) Browser / Vite: fetch the asset URL from `?url`
  if (typeof window !== "undefined" && typeof fetch === "function") {
    const res = await fetch(pdfiumWasmUrl);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch PDFium WASM (${res.status}): ${pdfiumWasmUrl}`,
      );
    }
    return res.arrayBuffer();
  }

  // 2) Node / vitest: read from node_modules (several candidate paths)
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const candidates: string[] = [];

  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    // package.json is not in exports; resolve main entry → sibling pdfium.wasm
    const main = require.resolve("@hyzyla/pdfium");
    candidates.push(path.join(path.dirname(main), "pdfium.wasm"));
  } catch {
    /* ignore */
  }

  if (typeof process !== "undefined" && process.cwd) {
    candidates.push(
      path.join(
        process.cwd(),
        "node_modules",
        "@hyzyla",
        "pdfium",
        "dist",
        "pdfium.wasm",
      ),
    );
  }

  for (const p of candidates) {
    try {
      const buf = await fs.readFile(p);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch {
      /* try next */
    }
  }

  throw new Error(
    `PDFium WASM not found. Tried fetch(${pdfiumWasmUrl}) and: ${candidates.join(", ")}`,
  );
}

/**
 * Initialize (or reuse) the PDFium WASM library with explicit wasmBinary.
 */
export async function initPdfiumLibrary(): Promise<PDFiumLibrary> {
  if (!libraryPromise) {
    libraryPromise = (async () => {
      const mod = await import("@hyzyla/pdfium");
      const wasmBinary = await loadWasmBinary();
      return mod.PDFiumLibrary.init({ wasmBinary });
    })().catch((err) => {
      libraryPromise = null;
      throw err;
    });
  }
  return libraryPromise;
}

/** Soft probe — returns false if WASM cannot load. */
export async function isPdfiumLibraryAvailable(): Promise<boolean> {
  try {
    const lib = await initPdfiumLibrary();
    return Boolean(lib);
  } catch {
    return false;
  }
}

/** Reset cached library (tests / HMR recovery). */
export function resetPdfiumLibrary(): void {
  libraryPromise = null;
}
