import {
  deepStringifyUseful,
  envFirst,
  lineItemsToTransactions,
  toolkitBase,
} from "./normalize";
import type { RawLineItem } from "./normalize";
import { runOfflineHeuristicParse } from "./offline-heuristic";
import { parseTransactionsHybrid } from "@/lib/parse-transactions";
import { attachOriginals } from "@/lib/edit-utils";
import type { DocumentParser, ParserInput, ParserResult } from "./types";

function docAiConfig() {
  return {
    project: envFirst("VITE_GOOGLE_DOCAI_PROJECT", "EXPO_PUBLIC_GOOGLE_DOCAI_PROJECT"),
    location: envFirst(
      "VITE_GOOGLE_DOCAI_LOCATION",
      "EXPO_PUBLIC_GOOGLE_DOCAI_LOCATION",
    ) ?? "us",
    processor: envFirst(
      "VITE_GOOGLE_DOCAI_PROCESSOR",
      "EXPO_PUBLIC_GOOGLE_DOCAI_PROCESSOR",
    ),
    token: envFirst(
      "VITE_GOOGLE_DOCAI_TOKEN",
      "VITE_GOOGLE_ACCESS_TOKEN",
      "EXPO_PUBLIC_GOOGLE_DOCAI_TOKEN",
    ),
  };
}

function isConfigured(): boolean {
  const c = docAiConfig();
  return Boolean(c.project && c.processor && c.token);
}

type DocAiEntity = {
  type?: string;
  mentionText?: string;
  confidence?: number;
  normalizedValue?: { text?: string; moneyValue?: { units?: string; nanos?: number } };
  properties?: DocAiEntity[];
};

function entityText(e: DocAiEntity | undefined | null): string | null {
  if (!e) return null;
  return (
    e.normalizedValue?.text ??
    e.mentionText ??
    null
  );
}

function entityMoney(e: DocAiEntity | undefined | null): string | null {
  if (!e) return null;
  if (e.normalizedValue?.moneyValue) {
    const u = Number(e.normalizedValue.moneyValue.units ?? 0);
    const n = Number(e.normalizedValue.moneyValue.nanos ?? 0) / 1e9;
    return String(u + n);
  }
  return entityText(e);
}

/**
 * Map Document AI entities → line items.
 * Supports Form Parser table rows and Bank Statement processor transaction entities.
 */
function entitiesToItems(payload: unknown): RawLineItem[] {
  const items: RawLineItem[] = [];
  const doc = payload as {
    document?: {
      entities?: DocAiEntity[];
      text?: string;
    };
  };
  const entities = doc.document?.entities ?? [];

  const propGet = (props: DocAiEntity[], ...types: string[]) => {
    for (const t of types) {
      const p = props.find((x) =>
        (x.type ?? "").toLowerCase().includes(t.toLowerCase()),
      );
      if (p) return p;
    }
    return null;
  };

  for (const ent of entities) {
    const type = ent.type ?? "";

    // Bank Statement processor: transaction / table_item style entities
    const isTxn =
      /line_item|transaction|table_item|table_row|record|deposit|withdrawal/i.test(
        type,
      ) ||
      // nested bank statement rows often use "transaction"
      type === "transaction";

    if (!isTxn) continue;

    const props = ent.properties ?? [];
    const dateE = propGet(
      props,
      "transaction_date",
      "date",
      "posting_date",
      "effective_date",
    );
    const descE = propGet(
      props,
      "description",
      "narrative",
      "merchant",
      "supplier",
      "payee",
      "transaction_description",
    );
    const debitE = propGet(props, "debit", "withdrawal", "money_out", "amount_debit");
    const creditE = propGet(props, "credit", "deposit", "money_in", "amount_credit");
    const balE = propGet(props, "balance", "running_balance", "account_balance");
    const amountE = propGet(props, "amount", "transaction_amount");

    items.push({
      date: entityText(dateE),
      description: entityText(descE) ?? ent.mentionText,
      debit: entityMoney(debitE),
      credit: entityMoney(creditE),
      balance: entityMoney(balE),
      amount: entityMoney(amountE),
    });
  }

  // Fallback: some bank statement versions emit flat amount entities without nesting
  if (items.length === 0) {
    for (const ent of entities) {
      if (!/amount|debit|credit/i.test(ent.type ?? "")) continue;
      items.push({
        description: ent.type ?? "line",
        amount: entityMoney(ent),
      });
    }
  }

  return items;
}

async function callDocAi(input: ParserInput): Promise<{
  rawText: string;
  items: RawLineItem[];
  pageCount: number;
}> {
  const c = docAiConfig();
  if (!c.project || !c.processor || !c.token) {
    throw new Error("Google Document AI is not configured");
  }

  const toolkit = toolkitBase();
  const name = `projects/${c.project}/locations/${c.location}/processors/${c.processor}`;
  // Browser: Vite proxy /api/docai → *.googleapis.com (avoids CORS)
  const url = toolkit
    ? `${toolkit}/v2/google/documentai/v1/${name}:process`
    : typeof window !== "undefined"
      ? `/api/docai/v1/${name}:process`
      : `https://${c.location}-documentai.googleapis.com/v1/${name}:process`;

  // base64 content
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < input.bytes.length; i += chunk) {
    binary += String.fromCharCode(...input.bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);

  input.onProgress?.(0.35, "Calling Google Document AI…");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rawDocument: {
          content: b64,
          mimeType: "application/pdf",
        },
      }),
      signal: input.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/NetworkError|Failed to fetch|Load failed|network/i.test(msg)) {
      throw new Error(
        `Document AI network/CORS error. Restart Vite (proxy /api/docai). Original: ${msg}`,
      );
    }
    throw err;
  }

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 401) {
      throw new Error(
        `Document AI 401 — OAuth token expired/invalid. Run: cd web && ./scripts/refresh-docai-token.sh && restart Vite. Detail: ${t.slice(0, 120)}`,
      );
    }
    if (res.status === 403) {
      throw new Error(
        `Document AI 403 — enable billing on GCP project ${c.project} ` +
          `(console.cloud.google.com/billing) and ensure Document AI API is enabled. Detail: ${t.slice(0, 120)}`,
      );
    }
    throw new Error(`Document AI HTTP ${res.status}: ${t.slice(0, 180)}`);
  }

  const json = await res.json();
  const items = entitiesToItems(json);
  const rawText =
    (json as { document?: { text?: string } })?.document?.text ??
    deepStringifyUseful(json).slice(0, 200_000);
  const pages =
    (json as { document?: { pages?: unknown[] } })?.document?.pages?.length ?? 1;

  return { rawText, items, pageCount: pages || 1 };
}

export const googleDocAiParser: DocumentParser = {
  info: {
    id: "google-docai",
    label: "Google Document AI",
    shortLabel: "Document AI",
    description:
      "Google Document AI processor for structured entity extraction. Requires project, processor id, and access token.",
    availability: isConfigured() ? "ready" : "needs-config",
    cloud: true,
    envHints: [
      "VITE_GOOGLE_DOCAI_PROJECT",
      "VITE_GOOGLE_DOCAI_PROCESSOR",
      "VITE_GOOGLE_DOCAI_TOKEN",
      "VITE_GOOGLE_DOCAI_LOCATION",
    ],
  },

  isConfigured,

  async parse(input: ParserInput): Promise<ParserResult> {
    const started = performance.now();
    const enginesTried = ["google-docai"];

    if (!this.isConfigured()) {
      const offline = await runOfflineHeuristicParse(input, {
        enginesTried,
        fallbackFrom: "google-docai",
      });
      offline.meta.warnings.push("Google Document AI not configured — offline fallback.");
      return offline;
    }

    try {
      const { rawText, items, pageCount } = await callDocAi(input);
      let transactions = lineItemsToTransactions(items);
      if (transactions.length === 0 && rawText) {
        enginesTried.push("hybrid-structure");
        transactions = attachOriginals(parseTransactionsHybrid(rawText).transactions);
      }
      input.onProgress?.(1, "Document AI complete");
      return {
        rawText,
        pageCount,
        pageTexts: [rawText],
        transactions,
        meta: {
          parserId: "google-docai",
          parserLabel: this.info.label,
          durationMs: Math.round(performance.now() - started),
          fallbackUsed: false,
          enginesTried,
          warnings: [],
          pageCount,
          rawTextLength: rawText.length,
          structuredFromApi: items.length > 0,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const offline = await runOfflineHeuristicParse(input, {
        enginesTried,
        fallbackFrom: "google-docai",
      });
      offline.meta.durationMs = Math.round(performance.now() - started);
      offline.meta.warnings.push(`Document AI error: ${message}`);
      return offline;
    }
  },
};
