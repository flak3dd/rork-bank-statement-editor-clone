import * as pdfjs from "pdfjs-dist";

let configured = false;
let standardFontDataUrl: string | null = null;
let configurePromise: Promise<void> | null = null;

/**
 * Configure PDF.js worker for browser (Vite asset URL) and Node (legacy file URL).
 * Also resolves standard_fonts/ for Node so UnknownErrorException warnings stop.
 */
export async function ensurePdfWorker(): Promise<void> {
  if (configured && pdfjs.GlobalWorkerOptions.workerSrc) return;
  if (configurePromise) return configurePromise;

  configurePromise = (async () => {
    if (typeof window !== "undefined") {
      const mod = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = mod.default;
      configured = true;
      return;
    }

    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const require = createRequire(import.meta.url);

    let workerPath: string;
    try {
      workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    } catch {
      try {
        workerPath = require.resolve(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        );
      } catch {
        workerPath = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
      }
    }
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

    try {
      const pkgJson = require.resolve("pdfjs-dist/package.json");
      const fontsDir = join(dirname(pkgJson), "standard_fonts");
      standardFontDataUrl = pathToFileURL(fontsDir + "/").href;
    } catch {
      standardFontDataUrl = null;
    }

    configured = true;
  })();

  return configurePromise;
}

/** file://…/standard_fonts/ for getDocument (Node). Browser returns null. */
export function getStandardFontDataUrl(): string | null {
  if (typeof window !== "undefined") return null;
  return standardFontDataUrl;
}

// Eager configure (best-effort).
void ensurePdfWorker().catch(() => {
  /* ignore — ensurePdfWorker will be retried on extract */
});
