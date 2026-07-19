import { categorizeDescription } from "@/lib/categorize";
import { attachOriginals } from "@/lib/edit-utils";
import { parseAmount, round2 } from "@/lib/money";
import { normalizeDate } from "@/lib/parse-transactions";
import type { Transaction } from "@/lib/types";

export interface RawLineItem {
  date?: string | null;
  description?: string | null;
  debit?: string | number | null;
  credit?: string | number | null;
  balance?: string | number | null;
  amount?: string | number | null;
  /** When amount is signed, negative → debit. */
  type?: "debit" | "credit" | string | null;
}

function toMoney(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? round2(Math.abs(v)) : null;
  const n = parseAmount(String(v));
  return n != null ? round2(Math.abs(n)) : null;
}

function uid(i: number): string {
  return `txn-${i}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalize heterogeneous API / OCR line items into Transaction rows. */
export function lineItemsToTransactions(items: RawLineItem[]): Transaction[] {
  const txns: Transaction[] = [];

  items.forEach((item, i) => {
    const description = String(item.description ?? "").trim() || "Transaction";
    let debit = toMoney(item.debit);
    let credit = toMoney(item.credit);
    const balance = toMoney(item.balance);

    if (debit == null && credit == null && item.amount != null) {
      const raw =
        typeof item.amount === "number" ? item.amount : parseAmount(String(item.amount));
      if (raw != null) {
        const type = String(item.type ?? "").toLowerCase();
        if (type.includes("credit") || type.includes("deposit") || raw > 0 && type.includes("in")) {
          credit = round2(Math.abs(raw));
        } else if (type.includes("debit") || type.includes("withdraw") || raw < 0) {
          debit = round2(Math.abs(raw));
        } else if (raw < 0) {
          debit = round2(Math.abs(raw));
        } else {
          // Ambiguous positive amount without type — prefer debit (outflow-heavy statements)
          debit = round2(Math.abs(raw));
        }
      }
    }

    if (debit == null && credit == null && balance == null) return;

    const dateRaw = item.date ? String(item.date) : "";
    const date = dateRaw ? normalizeDate(dateRaw) : "";

    const { category, confidence } = categorizeDescription(description, credit, debit);

    txns.push({
      id: uid(i),
      date: date || "unknown",
      description,
      debit,
      credit,
      balance,
      category,
      categorySource: "heuristic",
      categoryConfidence: confidence,
      flags: date === "unknown" || !date ? ["missing-date"] : [],
    });
  });

  return attachOriginals(txns);
}

/** Flatten nested objects for text recovery. */
export function deepStringifyUseful(value: unknown, depth = 0): string {
  if (depth > 6) return "";
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => deepStringifyUseful(v, depth + 1)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((v) => deepStringifyUseful(v, depth + 1))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function envFirst(...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = (import.meta.env as Record<string, string | undefined>)[key];
    if (v && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

export function toolkitBase(): string | undefined {
  const base = envFirst("VITE_TOOLKIT_URL", "EXPO_PUBLIC_TOOLKIT_URL");
  return base ? base.replace(/\/$/, "") : undefined;
}
