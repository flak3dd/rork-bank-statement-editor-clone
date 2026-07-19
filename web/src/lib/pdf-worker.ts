import * as pdfjs from "pdfjs-dist";

/**
 * Configure PDF.js worker for browser (Vite asset URL) and Node (vitest file URL).
 */
export async function ensurePdfWorker(): Promise<void> {
  if (pdfjs.GlobalWorkerOptions.workerSrc) return;

  if (typeof window !== "undefined") {
    const mod = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = mod.default;
    return;
  }

  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const require = createRequire(import.meta.url);
  const workerPath = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
}

// Eager configure (best-effort). Callers that need guarantees can await ensurePdfWorker().
void ensurePdfWorker().catch(() => {
  /* ignore — ensurePdfWorker will be retried on extract */
});
