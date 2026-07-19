import { categorizeDescription } from "@/lib/categorize";
import { attachOriginals } from "@/lib/edit-utils";
import { parseAmount, round2 } from "@/lib/money";
import { normalizeDate } from "@/lib/parse-transactions";
import { detectBankTemplate } from "@/lib/parsers";
import type { BankTemplate } from "@/lib/parsers/types";
import type { Transaction } from "@/lib/types";

export interface GeometryRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  fontName?: string;
}

export interface GeometryExtractResult {
  transactions: Transaction[];
  template: BankTemplate;
  rowCount: number;
  method: "hybrid-geometry";
  notes: string[];
}

interface ClusterRow {
  y: number;
  page: number;
  runs: GeometryRun[];
}

const MONTH = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

/** Slash / ISO / month-name dates (incl. St George "18 Nov"). */
function datePatterns(dateOrder: BankTemplate["dateOrder"]): RegExp[] {
  const slash =
    dateOrder === "ymd"
      ? /\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/
      : /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/;
  return [
    slash,
    /\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/,
    new RegExp(
      String.raw`\b(\d{1,2}\s+(?:${MONTH})[a-z]*\.?\s+\d{2,4})\b`,
      "i",
    ),
    // 18 Nov (year from statement period / hint)
    new RegExp(String.raw`\b(\d{1,2}\s+(?:${MONTH})[a-z]*)\b`, "i"),
    new RegExp(
      String.raw`\b((?:${MONTH})[a-z]*\.?\s+\d{1,2},?\s+\d{2,4})\b`,
      "i",
    ),
  ];
}

function matchRowDate(
  text: string,
  dateOrder: BankTemplate["dateOrder"],
): { raw: string; full: string } | null {
  for (const re of datePatterns(dateOrder)) {
    const m = text.match(re);
    if (m?.[1]) return { raw: m[1], full: m[0] };
  }
  return null;
}

function isDateToken(
  text: string,
  dateOrder: BankTemplate["dateOrder"],
): boolean {
  return matchRowDate(text.trim(), dateOrder) != null;
}

/** Infer statement year for bare "18 Nov" dates from surrounding PDF text. */
function inferYearFromHint(text: string): number {
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((x) => Number(x[1]));
  if (years.length) return years[years.length - 1];
  return new Date().getUTCFullYear();
}

function clusterRows(runs: GeometryRun[], yTol = 3): ClusterRow[] {
  const sorted = [...runs].sort((a, b) =>
    a.page !== b.page ? a.page - b.page : a.y - b.y || a.x - b.x,
  );
  const rows: ClusterRow[] = [];
  for (const r of sorted) {
    const last = rows[rows.length - 1];
    if (
      last &&
      last.page === r.page &&
      Math.abs(last.y - r.y) <= Math.max(yTol, r.height * 0.4)
    ) {
      last.runs.push(r);
      last.y = (last.y * (last.runs.length - 1) + r.y) / last.runs.length;
    } else {
      rows.push({ y: r.y, page: r.page, runs: [r] });
    }
  }
  for (const row of rows) {
    row.runs.sort((a, b) => a.x - b.x);
  }
  return rows;
}

function rowText(row: ClusterRow): string {
  return row.runs.map((r) => r.text).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Hybrid geometry extraction:
 * 1. Cluster text runs into rows by Y
 * 2. Detect bank YAML template
 * 3. Split columns by X gaps / amount tokens using template columnOrder
 * 4. Heuristic debit/credit classification
 *
 * Date forms: dd/mm/yyyy, yyyy-mm-dd, "12 Mar 2024", and St George "18 Nov".
 */
export function extractWithHybridGeometry(
  runs: GeometryRun[],
  rawTextHint?: string,
): GeometryExtractResult {
  const notes: string[] = [];
  const hint = rawTextHint || runs.map((r) => r.text).join(" ");
  const template = detectBankTemplate(hint);
  notes.push(`Template: ${template.name} (${template.id})`);

  const rows = clusterRows(runs);
  notes.push(`Clustered ${runs.length} runs → ${rows.length} geometry rows`);

  const yearHint = inferYearFromHint(hint);
  const txns: Transaction[] = [];

  for (const row of rows) {
    const text = rowText(row);
    if (text.length < 6) continue;
    if (template.noise.some((n) => text.toLowerCase().includes(n))) continue;

    const dm = matchRowDate(text, template.dateOrder);
    if (!dm) continue;

    let date = normalizeDate(dm.raw, yearHint);
    if (template.dateOrder === "mdy") {
      const slash = dm.raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (slash) {
        let y = slash[3];
        if (y.length === 2) y = Number(y) > 70 ? `19${y}` : `20${y}`;
        date = `${y}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
      }
    }

    // Split runs into text vs amount columns by X
    const amountRuns: GeometryRun[] = [];
    const textRuns: GeometryRun[] = [];
    for (const r of row.runs) {
      const n = parseAmount(r.text);
      if (
        n != null &&
        /[\d]/.test(r.text) &&
        r.text.replace(/[^\d]/g, "").length >= 2 &&
        Math.abs(n) >= 0.01 &&
        r.text.length < 16
      ) {
        amountRuns.push(r);
      } else if (!isDateToken(r.text, template.dateOrder)) {
        textRuns.push(r);
      }
    }

    const description =
      textRuns
        .map((r) => r.text)
        .join(" ")
        .replace(dm.full, "")
        .replace(/\s+/g, " ")
        .trim() || "Transaction";

    const amounts = amountRuns
      .map((r) => parseAmount(r.text))
      .filter((n): n is number => n != null)
      .map((n) => round2(Math.abs(n)));

    if (amounts.length === 0) continue;

    let debit: number | null = null;
    let credit: number | null = null;
    let balance: number | null = null;
    const order = template.columnOrder;
    const hasAmount = order.includes("amount") && !order.includes("debit");

    if (hasAmount) {
      if (amounts.length === 1) {
        const signed = parseAmount(amountRuns[0]?.text ?? "") ?? amounts[0];
        if (signed < 0 || /\b(debit|withdrawal|purchase)\b/i.test(description)) {
          debit = amounts[0];
        } else if (/\b(credit|deposit|salary)\b/i.test(description)) {
          credit = amounts[0];
        } else {
          debit = amounts[0];
        }
      } else {
        debit = amounts[0];
        balance = amounts[amounts.length - 1];
      }
    } else if (amounts.length >= 3) {
      debit = amounts[0] || null;
      credit = amounts[1] || null;
      balance = amounts[2];
      if (debit === 0) debit = null;
      if (credit === 0) credit = null;
    } else if (amounts.length === 2) {
      debit = amounts[0];
      balance = amounts[1];
    } else {
      debit = amounts[0];
    }

    const { category, confidence } = categorizeDescription(
      description,
      credit,
      debit,
    );

    txns.push({
      id: `geo-${txns.length}-${Math.random().toString(36).slice(2, 7)}`,
      date,
      description,
      debit,
      credit,
      balance,
      category,
      categorySource: "heuristic",
      categoryConfidence: confidence,
      flags: ["hybrid-geometry", `tpl:${template.id}`],
    });
  }

  notes.push(`Extracted ${txns.length} transactions via hybrid geometry`);

  return {
    transactions: attachOriginals(txns),
    template,
    rowCount: rows.length,
    method: "hybrid-geometry",
    notes,
  };
}
