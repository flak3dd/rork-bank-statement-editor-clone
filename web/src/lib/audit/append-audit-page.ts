/**
 * Append a human-readable audit trail page to a regenerated statement PDF.
 * Uses MuPDF WASM: blank A4 page + FreeText lines (no redactions).
 */
import { cloneUint8Array } from "@/lib/bytes";
import type { MergedAuditReport } from "./types";

export interface InjectionAuditSummary {
  strategy?: string;
  documentClass?: string;
  score?: number;
  editCount?: number;
  notes?: string[];
  gates?: Array<{ id: string; pass: boolean; detail: string }>;
  coverage?: {
    description?: { applied: number; changed: number };
    balance?: { applied: number; changed: number };
  };
}

function sanitizeLine(s: string, max = 96): string {
  return s
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Build plain-text lines for the audit page. */
export function buildAuditPageLines(
  report: MergedAuditReport,
  injection?: InjectionAuditSummary | null,
): string[] {
  const lines: string[] = [
    "BANK STATEMENT FIDELITY EDITOR — AUDIT TRAIL",
    `Generated: ${report.generatedAt}`,
    `Source file: ${report.fileName}`,
    "",
    "— REPLICA / DATA INJECTION —",
  ];

  if (injection) {
    lines.push(
      `Strategy: ${injection.strategy ?? "n/a"} · Class: ${injection.documentClass ?? "n/a"}`,
      `Score: ${injection.score ?? "n/a"}/100 · Edits applied: ${injection.editCount ?? 0}`,
    );
    const d = injection.coverage?.description;
    const b = injection.coverage?.balance;
    if (d) lines.push(`Description coverage: ${d.applied}/${d.changed} applied`);
    if (b) lines.push(`Balance coverage: ${b.applied}/${b.changed} applied`);
    if (injection.gates?.length) {
      lines.push("Gates:");
      for (const g of injection.gates.slice(0, 8)) {
        lines.push(`  ${g.pass ? "PASS" : "FAIL"} ${g.id}: ${sanitizeLine(g.detail, 72)}`);
      }
    }
    if (injection.notes?.length) {
      lines.push("Injection notes:");
      for (const n of injection.notes.slice(-6)) {
        lines.push(`  · ${sanitizeLine(n, 80)}`);
      }
    }
  } else {
    lines.push("No injection pipeline summary attached.");
  }

  lines.push(
    "",
    "— VERIFICATION —",
    report.verification
      ? `Pixel: ${report.verification.pixelStatus} score=${report.verification.pixelScore} · DPI ${report.verification.dpi} · attempts ${report.verification.attempts}`
      : "Pixel: not run",
    report.math
      ? `Math: ${report.math.status} score=${report.math.score}`
      : "Math: not run",
    "",
    "— SUMMARY —",
    `Transactions: ${report.summary.transactionCount} · Dirty rows: ${report.summary.dirtyCount}`,
    `Audit events: ${report.summary.auditEvents} · Field changes: ${report.summary.changes}`,
    "",
    "— RECENT AUDIT EVENTS —",
  );

  const recent = report.auditLog.slice(-12);
  if (recent.length === 0) {
    lines.push("(none)");
  } else {
    for (const e of recent) {
      lines.push(
        sanitizeLine(
          `${e.ts.slice(11, 19)} [${e.type}] ${e.message}`,
          100,
        ),
      );
    }
  }

  lines.push(
    "",
    "Policy: Square cover + FreeText only — redactions never written to output.",
    "Companion JSON audit report is available from the Audit panel / export.",
  );

  return lines.map((l) => sanitizeLine(l, 110));
}

/**
 * Append one A4 audit page to the PDF. Soft-fails: returns original bytes on error.
 */
export async function appendAuditPageToPdf(
  pdfBytes: Uint8Array,
  report: MergedAuditReport,
  injection?: InjectionAuditSummary | null,
): Promise<{ pdf: Uint8Array; appended: boolean; note: string }> {
  const lines = buildAuditPageLines(report, injection);
  try {
    const mupdf = await import("mupdf");
    const doc = new mupdf.PDFDocument(cloneUint8Array(pdfBytes));
    try {
      // A4 points
      const mediabox: [number, number, number, number] = [0, 0, 595, 842];
      const pageObj = doc.addPage(mediabox, 0, {}, "");
      // addPage already attaches; ensure it's at end (mupdf adds to tree)
      void pageObj;

      const pageIndex = doc.countPages() - 1;
      const page = doc.loadPage(pageIndex);

      // Header band
      try {
        const band = page.createAnnotation("Square") as {
          setRect(r: [number, number, number, number]): void;
          setColor?(c: [number, number, number]): void;
          setInteriorColor?(c: [number, number, number]): void;
          setBorderWidth?(w: number): void;
          update(): void;
        };
        band.setRect([36, 790, 559, 830]);
        band.setColor?.([0.12, 0.22, 0.4]);
        band.setInteriorColor?.([0.12, 0.22, 0.4]);
        band.setBorderWidth?.(0);
        band.update();
      } catch {
        /* optional */
      }

      const lineHeight = 11;
      let yTop = 818;
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i] || " ";
        const isTitle = i === 0;
        const fontSize = isTitle ? 10 : 8;
        const h = isTitle ? 14 : lineHeight;
        // PDF coords: bottom-left origin; FreeText rect [x0,y0,x1,y1]
        const y1 = yTop;
        const y0 = yTop - h;
        if (y0 < 40) break;
        try {
          const annot = page.createAnnotation("FreeText") as {
            setRect(r: [number, number, number, number]): void;
            setContents(t: string): void;
            setDefaultAppearance?(
              font: string,
              size: number,
              color: [number, number, number],
            ): void;
            setColor?(c: [number, number, number]): void;
            setInteriorColor?(c: [number, number, number]): void;
            setBorderWidth?(w: number): void;
            update(): void;
          };
          annot.setRect([40, y0, 555, y1]);
          annot.setContents(text);
          const color: [number, number, number] = isTitle
            ? [1, 1, 1]
            : [0.08, 0.1, 0.14];
          annot.setDefaultAppearance?.("Helv", fontSize, color);
          if (!isTitle) {
            annot.setInteriorColor?.([1, 1, 1]);
            annot.setColor?.([1, 1, 1]);
          }
          annot.setBorderWidth?.(0);
          annot.update();
        } catch {
          /* skip line */
        }
        yTop = y0 - 2;
      }

      try {
        (page as { update?: () => void }).update?.();
      } catch {
        /* optional */
      }
      const buf = doc.saveToBuffer();
      const out = bufferToUint8(buf);
      return {
        pdf: out,
        appended: true,
        note: `Audit page appended (${lines.length} lines)`,
      };
    } finally {
      doc.destroy();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      pdf: cloneUint8Array(pdfBytes),
      appended: false,
      note: `Audit page skipped: ${msg.slice(0, 120)}`,
    };
  }
}

function bufferToUint8(buf: unknown): Uint8Array {
  if (buf instanceof Uint8Array) return cloneUint8Array(buf);
  if (
    buf &&
    typeof (buf as { asUint8Array?: () => Uint8Array }).asUint8Array ===
      "function"
  ) {
    return cloneUint8Array(
      (buf as { asUint8Array: () => Uint8Array }).asUint8Array(),
    );
  }
  if (ArrayBuffer.isView(buf)) {
    const v = buf as ArrayBufferView;
    return cloneUint8Array(
      new Uint8Array(v.buffer, v.byteOffset, v.byteLength),
    );
  }
  throw new Error("mupdf saveToBuffer returned unsupported buffer type");
}
