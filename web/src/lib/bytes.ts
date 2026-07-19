/**
 * Safe PDF byte helpers.
 *
 * PDF.js, MuPDF, and PDFium may *transfer* ArrayBuffers into WASM/workers,
 * which detaches the underlying buffer. React state holding that buffer then
 * throws: "attempting to access detached ArrayBuffer".
 *
 * Always clone before handing bytes to an engine, and store a master copy
 * that is never transferred.
 */

/** True if this view's underlying ArrayBuffer is no longer usable. */
export function isDetachedUint8Array(bytes: Uint8Array): boolean {
  try {
    // Accessing byteLength on a view of a detached buffer throws in some engines;
    // reading a single element is the portable probe.
    void bytes[0];
    void bytes.byteLength;
    return false;
  } catch {
    return true;
  }
}

/**
 * Allocate a brand-new ArrayBuffer and copy bytes into it.
 * Never returns a view of the source buffer (so transfer can't detach the source).
 */
export function cloneUint8Array(source: Uint8Array): Uint8Array {
  if (!source) {
    throw new Error("PDF bytes are missing");
  }
  try {
    const out = new Uint8Array(source.byteLength);
    out.set(source);
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/detached|neutered/i.test(msg) || isDetachedUint8Array(source)) {
      throw new Error(
        "PDF bytes were detached by a previous engine (PDF.js/MuPDF/Pdfium). " +
          "Re-upload the PDF, or reload the page, then try again.",
        { cause: err instanceof Error ? err : undefined },
      );
    }
    throw err;
  }
}

/** Clone only if non-null; returns null otherwise. */
export function cloneUint8ArrayOrNull(
  source: Uint8Array | null | undefined,
): Uint8Array | null {
  if (!source) return null;
  return cloneUint8Array(source);
}
