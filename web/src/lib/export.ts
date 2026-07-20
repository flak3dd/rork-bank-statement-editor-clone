import type { ExtractionResult, Transaction } from "./types";
import { formatMoney } from "./money";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function transactionsToCsv(
  transactions: Transaction[],
  options?: { includeNotes?: boolean },
): string {
  const includeNotes = options?.includeNotes ?? true;
  const headers = [
    "date",
    "description",
    "debit",
    "credit",
    "balance",
    "category",
    "category_source",
    "category_confidence",
    "flags",
  ];
  if (includeNotes) headers.push("notes");

  const lines = [headers.join(",")];
  for (const t of transactions) {
    const row = [
      t.date,
      csvEscape(t.description),
      t.debit != null ? t.debit.toFixed(2) : "",
      t.credit != null ? t.credit.toFixed(2) : "",
      t.balance != null ? t.balance.toFixed(2) : "",
      t.category,
      t.categorySource,
      t.categoryConfidence.toFixed(2),
      csvEscape(t.flags.join("|")),
    ];
    if (includeNotes) row.push(csvEscape(t.notes ?? ""));
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

export function buildExportPayload(
  result: ExtractionResult,
  transactions: Transaction[],
  options?: { includeNotes?: boolean },
): Record<string, unknown> {
  return {
    meta: {
      fileName: result.fileName,
      pageCount: result.pageCount,
      extractedAt: result.extractedAt,
      limitedExtraction: result.limitedExtraction,
      exportedAt: new Date().toISOString(),
      tool: "Bank Statement Fidelity Editor",
      disclaimer:
        "Structured ledger export from the Bank Statement Fidelity Editor. Source PDF is the visual baseline; Export final PDF materializes logic-generator injection (perfect replacement) into a regenerated replica PDF with audit trail.",
      completenessScore: result.completenessScore,
      hybrid: result.hybrid ?? null,
      parser: result.parser ?? null,
    },
    summary: result.summary,
    findings: result.findings,
    completenessScore: result.completenessScore,
    transactions: transactions.map((t) => ({
      date: t.date,
      description: t.description,
      debit: t.debit,
      credit: t.credit,
      balance: t.balance,
      category: t.category,
      categorySource: t.categorySource,
      categoryConfidence: t.categoryConfidence,
      flags: t.flags,
      edited: Boolean(
        t.original &&
          (t.date !== t.original.date ||
            t.description !== t.original.description ||
            t.debit !== t.original.debit ||
            t.credit !== t.original.credit ||
            t.balance !== t.original.balance),
      ),
      ...(options?.includeNotes !== false ? { notes: t.notes ?? null } : {}),
    })),
  };
}

export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(
  result: ExtractionResult,
  transactions: Transaction[],
  includeNotes: boolean,
): void {
  const base = result.fileName.replace(/\.pdf$/i, "") || "statement";
  const csv = transactionsToCsv(transactions, { includeNotes });
  downloadText(`${base}-transactions.csv`, csv, "text/csv;charset=utf-8");
}

export function exportJson(
  result: ExtractionResult,
  transactions: Transaction[],
  includeNotes: boolean,
): void {
  const base = result.fileName.replace(/\.pdf$/i, "") || "statement";
  const payload = buildExportPayload(result, transactions, { includeNotes });
  downloadText(
    `${base}-transactions.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8",
  );
}

export function summaryLine(result: ExtractionResult): string {
  const s = result.summary;
  return `${s.transactionCount} txns · in ${formatMoney(s.totalIn)} · out ${formatMoney(s.totalOut)}`;
}

export function downloadBytes(filename: string, data: Uint8Array, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
