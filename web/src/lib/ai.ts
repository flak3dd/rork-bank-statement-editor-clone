import type { CompletenessFinding, Transaction, TransactionCategory } from "./types";
import { CATEGORIES } from "./types";

const MODEL = "openai/gpt-4.1-nano";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

function toolkitBase(): string {
  const base = import.meta.env.VITE_TOOLKIT_URL || import.meta.env.EXPO_PUBLIC_TOOLKIT_URL;
  if (!base) {
    throw new Error("Toolkit URL is not configured");
  }
  return String(base).replace(/\/$/, "");
}

async function chatCompletion(
  messages: ChatMessage[],
  options?: { temperature?: number; max_tokens?: number },
): Promise<string> {
  const url = `${toolkitBase()}/v2/vercel/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.max_tokens ?? 4096,
      providerOptions: {
        gateway: {
          models: ["openai/gpt-4o-mini", "google/gemini-2.5-flash-lite"],
        },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as ChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(data.error?.message || "Empty AI response");
  }
  return content;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object in AI response");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function isCategory(v: string): v is TransactionCategory {
  return (CATEGORIES as string[]).includes(v);
}

/**
 * Ask the model to categorize transactions. Falls back silently to input on failure.
 * Model: openai/gpt-4.1-nano — fast/cheap classification with JSON output.
 */
export async function aiCategorizeTransactions(
  transactions: Transaction[],
): Promise<Transaction[]> {
  if (transactions.length === 0) return transactions;

  // Batch to keep prompts small
  const batchSize = 40;
  const out = [...transactions];

  for (let offset = 0; offset < transactions.length; offset += batchSize) {
    const batch = transactions.slice(offset, offset + batchSize);
    const payload = batch.map((t, i) => ({
      i,
      date: t.date,
      description: t.description,
      debit: t.debit,
      credit: t.credit,
      hint: t.category,
    }));

    try {
      const content = await chatCompletion(
        [
          {
            role: "system",
            content: `You categorize bank transactions for a personal finance viewer.
Return ONLY valid JSON: {"items":[{"i":0,"category":"Groceries","confidence":0.0,"notes":""}]}
Categories must be one of: ${CATEGORIES.join(", ")}.
confidence is 0..1. notes optional short string. Do not invent transactions.`,
          },
          {
            role: "user",
            content: `Categorize these transactions:\n${JSON.stringify(payload)}`,
          },
        ],
        { temperature: 0.1, max_tokens: 3000 },
      );

      const parsed = extractJson(content) as {
        items?: Array<{ i?: number; category?: string; confidence?: number; notes?: string }>;
      };

      for (const item of parsed.items ?? []) {
        if (typeof item.i !== "number") continue;
        const idx = offset + item.i;
        if (idx < 0 || idx >= out.length) continue;
        if (out[idx].categorySource === "manual") continue;
        const cat = item.category && isCategory(item.category) ? item.category : out[idx].category;
        const conf =
          typeof item.confidence === "number" && Number.isFinite(item.confidence)
            ? Math.min(1, Math.max(0, item.confidence))
            : 0.7;
        out[idx] = {
          ...out[idx],
          category: cat,
          categoryConfidence: conf,
          categorySource: "ai",
          notes: item.notes?.trim() ? item.notes.trim() : out[idx].notes,
        };
      }
    } catch {
      // keep heuristic categories for this batch
    }
  }

  return out;
}

/** AI completeness review — report only, never suggests PDF edits. */
export async function aiCompletenessCheck(
  transactions: Transaction[],
  localFindings: CompletenessFinding[],
): Promise<CompletenessFinding[]> {
  if (transactions.length === 0) return localFindings;

  const sample = transactions.slice(0, 60).map((t) => ({
    id: t.id,
    date: t.date,
    description: t.description.slice(0, 80),
    debit: t.debit,
    credit: t.credit,
    balance: t.balance,
  }));

  try {
    const content = await chatCompletion(
      [
        {
          role: "system",
          content: `You review extracted bank statement transactions for a READ-ONLY analyzer.
Return ONLY JSON: {"findings":[{"severity":"info|warning|error","title":"...","detail":"...","transactionId":"optional"}]}
Look for: possible missing rows, odd duplicates, inconsistent balances, suspicious gaps.
Do NOT suggest rewriting, forging, or editing the PDF. Max 8 findings. Be concise.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            count: transactions.length,
            sample,
            localFindings: localFindings.slice(0, 10),
          }),
        },
      ],
      { temperature: 0.2, max_tokens: 1500 },
    );

    const parsed = extractJson(content) as {
      findings?: Array<{
        severity?: string;
        title?: string;
        detail?: string;
        transactionId?: string;
      }>;
    };

    const extra: CompletenessFinding[] = (parsed.findings ?? [])
      .filter((f) => f.title && f.detail)
      .slice(0, 8)
      .map((f, i) => ({
        id: `ai-${i}-${Math.random().toString(36).slice(2, 7)}`,
        severity:
          f.severity === "error" || f.severity === "warning" || f.severity === "info"
            ? f.severity
            : "info",
        title: String(f.title),
        detail: String(f.detail),
        transactionId: f.transactionId,
      }));

    return [...localFindings, ...extra];
  } catch {
    return localFindings;
  }
}

export const AI_MODEL_ID = MODEL;
