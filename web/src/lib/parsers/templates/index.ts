import type { BankTemplate } from "../types";
import { parseSimpleYaml } from "../yaml-mini";

import genericYaml from "./generic.yaml?raw";
import commonwealthYaml from "./commonwealth.yaml?raw";
import anzYaml from "./anz.yaml?raw";
import westpacYaml from "./westpac.yaml?raw";
import nabYaml from "./nab.yaml?raw";
import chaseYaml from "./chase.yaml?raw";
import bofaYaml from "./bankofamerica.yaml?raw";

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}

function asColumnOrder(
  v: unknown,
): BankTemplate["columnOrder"] {
  const allowed = new Set([
    "date",
    "description",
    "debit",
    "credit",
    "balance",
    "amount",
  ]);
  if (!Array.isArray(v)) {
    return ["date", "description", "debit", "credit", "balance"];
  }
  return v
    .map((x) => String(x).toLowerCase().replace(/\s+/g, "_"))
    .map((x) => (x === "running_balance" ? "balance" : x))
    .filter((x): x is BankTemplate["columnOrder"][number] => allowed.has(x));
}

function loadTemplate(raw: string): BankTemplate {
  const obj = parseSimpleYaml(raw);
  const dateOrder = String(obj.dateOrder ?? "dmy").toLowerCase();
  const cleanupRaw = Array.isArray(obj.descriptionCleanup)
    ? obj.descriptionCleanup
    : [];
  const descriptionCleanup = cleanupRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const rec = item as Record<string, unknown>;
      if (!rec.pattern) return null;
      return {
        pattern: String(rec.pattern),
        replace: String(rec.replace ?? ""),
      };
    })
    .filter(Boolean) as BankTemplate["descriptionCleanup"];

  return {
    id: String(obj.id ?? "unknown"),
    name: String(obj.name ?? "Unknown"),
    match: asStringArray(obj.match),
    dateOrder:
      dateOrder === "mdy" || dateOrder === "ymd" || dateOrder === "dmy"
        ? dateOrder
        : "dmy",
    columnOrder: asColumnOrder(obj.columnOrder),
    noise: asStringArray(obj.noise).map((n) => n.toLowerCase()),
    descriptionCleanup,
    currency: obj.currency ? String(obj.currency) : undefined,
    notes: obj.notes ? String(obj.notes) : undefined,
  };
}

export const BANK_TEMPLATES: BankTemplate[] = [
  loadTemplate(genericYaml),
  loadTemplate(commonwealthYaml),
  loadTemplate(anzYaml),
  loadTemplate(westpacYaml),
  loadTemplate(nabYaml),
  loadTemplate(chaseYaml),
  loadTemplate(bofaYaml),
];

export function getTemplateById(id: string): BankTemplate | undefined {
  return BANK_TEMPLATES.find((t) => t.id === id);
}

/** Score bank templates against raw statement text; returns best non-generic match or generic. */
export function detectBankTemplate(rawText: string): BankTemplate {
  const hay = rawText.slice(0, 8000).toLowerCase();
  let best: BankTemplate | null = null;
  let bestScore = 0;

  for (const t of BANK_TEMPLATES) {
    if (t.id === "generic" || t.match.length === 0) continue;
    let score = 0;
    for (const m of t.match) {
      if (hay.includes(m.toLowerCase())) score += m.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }

  return best ?? getTemplateById("generic")!;
}
