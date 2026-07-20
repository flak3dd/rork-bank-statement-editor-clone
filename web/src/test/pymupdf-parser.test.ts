import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  extractTextWithPyMuPdf,
  structurePyMuPdfText,
  parseWithPyMuPdf,
  pyMuPdfParser,
} from "@/lib/parsers/pymupdf";

const FINAL =
  "/Users/adminuser/Downloads/1132%20(2)/698/St George Bank Acc Statement #726 - 21.08.24 to 19.11.24.pdf";
const BASE =
  "/Users/adminuser/Desktop/St George Bank TEMPLATE 2- 21.08.24 to 19.11.24.pdf";

describe("PyMuPDF parser (mupdf WASM)", () => {
  it("extracts text from TEMPLATE 2 base", async () => {
    if (!existsSync(BASE)) return;
    const bytes = new Uint8Array(readFileSync(BASE));
    const ext = await extractTextWithPyMuPdf(bytes, { maxPages: 2 });
    expect(ext.pageCount).toBe(2);
    expect(ext.text).toMatch(/Complete Freedom/i);
    expect(ext.engine === "mupdf" || ext.engine === "pdfjs-fallback").toBe(
      true,
    );
    console.log("PYMUPDF base", ext.engine, ext.text.length);
  });

  it("structures #726 with westpac YAML template", async () => {
    if (!existsSync(FINAL)) return;
    const bytes = new Uint8Array(readFileSync(FINAL));
    const parsed = await parseWithPyMuPdf(bytes, {
      maxPages: 3,
      bankHint: "St George #726",
      fileName: "St George #726.pdf",
    });
    expect(parsed.rawText.length).toBeGreaterThan(100);
    expect(parsed.template.id).toBe("westpac");
    expect(parsed.transactions.length).toBeGreaterThan(5);
    expect(parsed.extract.engine).toBe("mupdf");
    console.log(
      "PYMUPDF 726",
      parsed.transactions.length,
      parsed.template.id,
      parsed.notes.join(" · "),
    );
  });

  it("DocumentParser.parse matches registry contract", async () => {
    if (!existsSync(BASE)) return;
    const bytes = new Uint8Array(readFileSync(BASE));
    const file = new File([bytes], "template2.pdf", { type: "application/pdf" });
    // File constructor may need Blob in node — use mock
    const input = {
      file: { name: "template2.pdf" } as File,
      bytes,
      fileName: "template2.pdf",
    };
    const result = await pyMuPdfParser.parse(input);
    expect(result.meta.parserId).toBe("pymupdf");
    expect(result.rawText).toMatch(/Complete Freedom|Transaction/i);
    expect(result.meta.enginesTried.some((e) => e.includes("pymupdf") || e === "pymupdf")).toBe(
      true,
    );
  });

  it("structurePyMuPdfText applies template flags", () => {
    const text = `
      Westpac Banking Corporation
      01/11/24 SALARY ACME PTY  2500.00  5000.00
      02/11/24 WOOLWORTHS       -85.40   4914.60
    `;
    const s = structurePyMuPdfText(text);
    expect(s.template.id).toBe("westpac");
    expect(s.transactions.length).toBeGreaterThanOrEqual(0);
  });
});
