import {
  lineItemsToTransactions,
  envFirst,
  toolkitBase,
  deepStringifyUseful,
  type RawLineItem,
} from "./normalize";
import { runOfflineHeuristicParse } from "./offline-heuristic";
import type { DocumentParser, ParserInput, ParserResult } from "./types";

function mindeeKey(): string | undefined {
  return envFirst("VITE_MINDEE_API_KEY", "EXPO_PUBLIC_MINDEE_API_KEY", "VITE_MINDEE_TOKEN");
}

function extractLineItems(payload: unknown): RawLineItem[] {
  const items: RawLineItem[] = [];
  const root = payload as Record<string, unknown>;
  const doc = (root?.document ?? root) as Record<string, unknown>;
  const inference = (doc?.inference ?? doc) as Record<string, unknown>;
  const prediction = (inference?.prediction ?? inference?.fields ?? inference) as Record<
    string,
    unknown
  >;

  const candidates =
    (prediction?.line_items as unknown) ??
    (prediction?.lineItems as unknown) ??
    (prediction?.transactions as unknown) ??
    [];

  const list = Array.isArray(candidates)
    ? candidates
    : Array.isArray((candidates as { value?: unknown })?.value)
      ? (candidates as { value: unknown[] }).value
      : [];

  for (const raw of list) {
    const row = raw as Record<string, unknown>;
    const pick = (keys: string[]) => {
      for (const k of keys) {
        const v = row[k];
        if (v == null) continue;
        if (typeof v === "object" && v !== null && "value" in (v as object)) {
          return (v as { value: unknown }).value as string | number | null;
        }
        return v as string | number | null;
      }
      return null;
    };

    items.push({
      date: pick(["date", "transaction_date", "value_date"]) as string | null,
      description: pick([
        "description",
        "narrative",
        "label",
        "supplier",
        "merchant",
      ]) as string | null,
      debit: pick(["debit", "withdrawal", "expense"]),
      credit: pick(["credit", "deposit", "income"]),
      balance: pick(["balance", "running_balance"]),
      amount: pick(["amount", "total", "value"]),
      type: pick(["type", "direction"]) as string | null,
    });
  }

  return items;
}

async function callMindee(input: ParserInput): Promise<{
  rawText: string;
  items: RawLineItem[];
  pageCount: number;
}> {
  const key = mindeeKey();
  if (!key) throw new Error("Mindee API key not configured");

  const form = new FormData();
  form.append("document", new Blob([input.bytes]), input.fileName || "statement.pdf");

  const toolkit = toolkitBase();
  const urls = [
    toolkit ? `${toolkit}/v2/mindee/v1/products/mindee/financial_document/v1/predict` : null,
    "https://api.mindee.net/v1/products/mindee/financial_document/v1/predict",
  ].filter(Boolean) as string[];

  let lastErr: Error | null = null;
  for (const url of urls) {
    input.onProgress?.(0.3, "Calling Mindee Financial…");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${key}`,
        },
        body: form,
        signal: input.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Mindee HTTP ${res.status}: ${t.slice(0, 180)}`);
      }
      const json = await res.json();
      const items = extractLineItems(json);
      const rawText =
        deepStringifyUseful(json).slice(0, 200_000) ||
        items
          .map(
            (i) =>
              `${i.date ?? ""} ${i.description ?? ""} ${i.amount ?? i.debit ?? i.credit ?? ""}`,
          )
          .join("\n");
      const pageCount =
        Number(
          (json as { document?: { n_pages?: number } })?.document?.n_pages ??
            (json as { document?: { inference?: { pages?: unknown[] } } })?.document?.inference
              ?.pages?.length,
        ) || 1;
      return { rawText, items, pageCount: pageCount || 1 };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error("Mindee request failed");
}

export const mindeeParser: DocumentParser = {
  info: {
    id: "mindee",
    label: "Mindee Financial (default)",
    shortLabel: "Mindee",
    description:
      "Mindee financial_document API — structured line items for bank statements and invoices. Falls back to offline heuristic if unconfigured or request fails.",
    availability: mindeeKey() ? "ready" : "needs-config",
    cloud: true,
    default: true,
    envHints: ["VITE_MINDEE_API_KEY", "EXPO_PUBLIC_MINDEE_API_KEY"],
  },

  isConfigured() {
    return Boolean(mindeeKey());
  },

  async parse(input: ParserInput): Promise<ParserResult> {
    const started = performance.now();
    const enginesTried = ["mindee"];

    if (!this.isConfigured()) {
      input.onProgress?.(0.2, "Mindee not configured — offline fallback…");
      const offline = await runOfflineHeuristicParse(input, {
        enginesTried,
        fallbackFrom: "mindee",
      });
      offline.meta.parserId = "mindee";
      offline.meta.parserLabel = this.info.label;
      offline.meta.durationMs = Math.round(performance.now() - started);
      offline.meta.fallbackUsed = true;
      offline.meta.warnings = [
        ...offline.meta.warnings,
        "Mindee API key missing — used offline heuristic + bank YAML.",
      ];
      return offline;
    }

    try {
      input.onProgress?.(0.15, "Uploading to Mindee Financial…");
      const { rawText, items, pageCount } = await callMindee(input);
      const transactions = lineItemsToTransactions(items);

      if (transactions.length === 0) {
        enginesTried.push("offline-heuristic");
        const offline = await runOfflineHeuristicParse(input, {
          enginesTried,
          fallbackFrom: "mindee",
        });
        offline.meta.parserId = "mindee";
        offline.meta.parserLabel = this.info.label;
        offline.meta.durationMs = Math.round(performance.now() - started);
        offline.meta.fallbackUsed = true;
        offline.meta.warnings = [
          ...offline.meta.warnings,
          "Mindee returned no line items — offline heuristic used.",
        ];
        offline.meta.structuredFromApi = false;
        return offline;
      }

      input.onProgress?.(1, "Mindee parse complete");
      return {
        rawText,
        pageCount,
        pageTexts: [rawText],
        transactions,
        meta: {
          parserId: "mindee",
          parserLabel: this.info.label,
          durationMs: Math.round(performance.now() - started),
          fallbackUsed: false,
          enginesTried,
          bankTemplateId: null,
          bankTemplateName: null,
          warnings: [],
          pageCount,
          rawTextLength: rawText.length,
          structuredFromApi: true,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      input.onProgress?.(0.5, "Mindee failed — offline fallback…");
      const offline = await runOfflineHeuristicParse(input, {
        enginesTried,
        fallbackFrom: "mindee",
      });
      offline.meta.parserId = "mindee";
      offline.meta.parserLabel = this.info.label;
      offline.meta.durationMs = Math.round(performance.now() - started);
      offline.meta.fallbackUsed = true;
      offline.meta.warnings = [...offline.meta.warnings, `Mindee error: ${message}`];
      return offline;
    }
  },
};
