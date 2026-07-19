import { attachOriginals } from "@/lib/edit-utils";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import {
  normalizeDate,
  parseTransactionsHybrid,
} from "@/lib/parse-transactions";
import { parseAmount, round2 } from "@/lib/money";
import { categorizeDescription } from "@/lib/categorize";
import type { Transaction } from "@/lib/types";
import { detectBankTemplate } from "./templates";
import type { BankTemplate, DocumentParser, ParserInput, ParserResult } from "./types";

function applyTemplateNoise(text: string, template: BankTemplate): string {
  const lines = text.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const lower = line.toLowerCase().trim();
    if (!lower) return false;
    return !template.noise.some((n) => lower.startsWith(n) || lower.includes(n));
  });
  return filtered.join("\n");
}

function applyDescriptionCleanup(desc: string, template: BankTemplate): string {
  let out = desc;
  for (const rule of template.descriptionCleanup ?? []) {
    try {
      out = out.replace(new RegExp(rule.pattern, "gi"), rule.replace);
    } catch {
      // ignore invalid patterns
    }
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Re-parse with bank template column semantics when hybrid under-extracts
 * or amount-only columns need CR/DR handling.
 */
function templateColumnPass(
  text: string,
  template: BankTemplate,
  existing: Transaction[],
): Transaction[] {
  if (existing.length >= 5) {
    return existing.map((t) => ({
      ...t,
      description: applyDescriptionCleanup(t.description, template),
    }));
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const dateRe =
    template.dateOrder === "ymd"
      ? /\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/
      : /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/;

  const found: Transaction[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const dm = line.match(dateRe);
    if (!dm) continue;
    let date = normalizeDate(dm[1]);
    // Force US month-first when template says mdy and ambiguous
    if (template.dateOrder === "mdy") {
      const slash = dm[1].match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (slash) {
        let y = slash[3];
        if (y.length === 2) y = Number(y) > 70 ? `19${y}` : `20${y}`;
        const m = slash[1].padStart(2, "0");
        const d = slash[2].padStart(2, "0");
        date = `${y}-${m}-${d}`;
      }
    }

    const rest = line.replace(dm[0], " ").trim();
    const amountMatches = [
      ...rest.matchAll(
        /[($£€]?\s*-?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s*\)?|\(\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})\s*\)|-?\d+(?:[.,]\d{2})/g,
      ),
    ];
    const amounts: number[] = [];
    let cut = rest.length;
    for (const m of amountMatches.slice(-4)) {
      const v = parseAmount(m[0]);
      if (v != null && Math.abs(v) >= 0.01) {
        amounts.push(v);
        if (m.index != null && m.index < cut) cut = m.index;
      }
    }
    if (amounts.length === 0) continue;

    let description = applyDescriptionCleanup(rest.slice(0, cut).trim() || "Transaction", template);
    const abs = amounts.map((a) => round2(Math.abs(a)));

    let debit: number | null = null;
    let credit: number | null = null;
    let balance: number | null = null;

    const order = template.columnOrder;
    const hasAmount = order.includes("amount");
    const hasDebitCredit = order.includes("debit") || order.includes("credit");

    if (hasAmount && !hasDebitCredit) {
      // amount + optional balance
      if (abs.length === 1) {
        const signed = amounts[0];
        if (signed < 0 || /\b(debit|withdrawal|purchase|pos)\b/i.test(description)) {
          debit = abs[0];
        } else if (/\b(credit|deposit|salary|payroll)\b/i.test(description)) {
          credit = abs[0];
        } else {
          debit = abs[0];
        }
      } else {
        const signed = amounts[0];
        if (signed < 0) debit = abs[0];
        else if (/\bcr\b/i.test(description)) credit = abs[0];
        else debit = abs[0];
        balance = abs[abs.length - 1];
      }
    } else if (abs.length >= 3) {
      debit = abs[0] || null;
      credit = abs[1] || null;
      balance = abs[2];
      if (debit === 0) debit = null;
      if (credit === 0) credit = null;
    } else if (abs.length === 2) {
      debit = abs[0];
      balance = abs[1];
    } else {
      debit = abs[0];
    }

    const key = `${date}|${description.slice(0, 32)}|${debit}|${credit}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { category, confidence } = categorizeDescription(description, credit, debit);
    found.push({
      id: `txn-tpl-${found.length}-${Math.random().toString(36).slice(2, 7)}`,
      date,
      description,
      debit,
      credit,
      balance,
      category,
      categorySource: "heuristic",
      categoryConfidence: confidence,
      flags: ["bank-template"],
    });
  }

  if (found.length > existing.length) return attachOriginals(found);

  return existing.map((t) => ({
    ...t,
    description: applyDescriptionCleanup(t.description, template),
  }));
}

export async function runOfflineHeuristicParse(
  input: ParserInput,
  opts?: {
    enginesTried?: string[];
    fallbackFrom?: import("./types").DocumentParserId;
  },
): Promise<ParserResult> {
  const started = performance.now();
  const enginesTried = [...(opts?.enginesTried ?? []), "offline-heuristic"];

  input.onProgress?.(0.1, "Extracting PDF text…");
  const pdf = await extractTextFromPdf(input.bytes, (r) => {
    input.onProgress?.(0.1 + r * 0.45, "Reading pages…");
  });

  input.onProgress?.(0.6, "Detecting bank template…");
  const template = detectBankTemplate(pdf.text);
  const cleaned = applyTemplateNoise(pdf.text, template);

  input.onProgress?.(0.75, `Parsing with ${template.name}…`);
  const hybrid = parseTransactionsHybrid(cleaned);
  let transactions = templateColumnPass(cleaned, template, hybrid.transactions);
  transactions = attachOriginals(transactions);

  input.onProgress?.(1, "Offline parse complete");

  return {
    rawText: cleaned || pdf.text,
    pageCount: pdf.pageCount,
    pageTexts: pdf.pageTexts,
    transactions,
    meta: {
      parserId: "offline-heuristic",
      parserLabel: offlineHeuristicParser.info.label,
      durationMs: Math.round(performance.now() - started),
      fallbackUsed: Boolean(opts?.fallbackFrom),
      fallbackFrom: opts?.fallbackFrom,
      enginesTried,
      bankTemplateId: template.id,
      bankTemplateName: template.name,
      warnings:
        transactions.length === 0
          ? ["No transactions detected — PDF may be image-only; try Local OCR or Mindee."]
          : [],
      pageCount: pdf.pageCount,
      rawTextLength: (cleaned || pdf.text).length,
      structuredFromApi: false,
    },
  };
}

export const offlineHeuristicParser: DocumentParser = {
  info: {
    id: "offline-heuristic",
    label: "Offline heuristic + bank YAML",
    shortLabel: "Offline + YAML",
    description:
      "Fully offline hybrid line parser with bank-specific YAML templates (CBA, ANZ, Westpac, NAB, Chase, BofA, generic).",
    availability: "offline",
    cloud: false,
    envHints: [],
  },

  isConfigured() {
    return true;
  },

  parse(input) {
    return runOfflineHeuristicParse(input);
  },
};
