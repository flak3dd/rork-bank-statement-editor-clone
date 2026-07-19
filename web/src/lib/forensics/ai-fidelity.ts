import type { Transaction } from "@/lib/types";
import type { ForensicFinding, LayerScore } from "./types";

const MODEL = "openai/gpt-4.1-nano";

function toolkitBase(): string | null {
  const base =
    import.meta.env.VITE_TOOLKIT_URL || import.meta.env.EXPO_PUBLIC_TOOLKIT_URL;
  if (!base) return null;
  return String(base).replace(/\/$/, "");
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON in AI response");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

export interface AiFidelityResult {
  layer: LayerScore;
  summary: string;
  risks: string[];
  strengths: string[];
  score: number;
  ran: boolean;
  skipped: boolean;
}

function sampleRows(txns: Transaction[], n = 40) {
  return txns.slice(0, n).map((t) => ({
    date: t.date,
    description: t.description.slice(0, 100),
    debit: t.debit,
    credit: t.credit,
    balance: t.balance,
    flags: t.flags.slice(0, 6),
  }));
}

/**
 * AI forensic review: fidelity of working ledger vs source extract + authenticity risks.
 */
export async function aiFidelityAnalysis(params: {
  source: Transaction[];
  working: Transaction[];
  rawTextSnippet: string;
  localScores: Record<string, number>;
  signal?: AbortSignal;
}): Promise<AiFidelityResult> {
  const base = toolkitBase();
  if (!base) {
    return {
      ran: false,
      skipped: true,
      score: 0,
      summary: "AI fidelity skipped — toolkit URL not configured.",
      risks: [],
      strengths: [],
      layer: {
        layer: "ai-fidelity",
        label: "AI fidelity & authenticity",
        score: 0,
        weight: 0.05,
        status: "skipped",
        summary: "Configure VITE_TOOLKIT_URL for AI forensic review.",
        findings: [
          {
            id: "ai-skip",
            layer: "ai-fidelity",
            severity: "minor",
            title: "AI layer unavailable",
            detail: "Local forensic layers still ran without model review.",
          },
        ],
      },
    };
  }

  try {
    const res = await fetch(`${base}/v2/vercel/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: params.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.15,
        max_tokens: 1800,
        messages: [
          {
            role: "system",
            content: `You are a forensic document analyst for bank statement data fidelity.
Compare SOURCE extraction vs WORKING ledger (after edits/generation).
Return ONLY JSON:
{
  "score": 0-100,
  "verdict": "pass|warn|fail",
  "summary": "2-4 sentences",
  "strengths": ["..."],
  "risks": ["..."],
  "findings": [{"severity":"critical|material|minor|supporting","title":"...","detail":"..."}]
}
Assess: structural match to source, narrative realism, payment-rail vocabulary, balance logic, red flags for synthetic data, whether generation preserved period/totals intent.
Be strict. Do not claim court-grade authenticity. Max 8 findings.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              localScores: params.localScores,
              sourceCount: params.source.length,
              workingCount: params.working.length,
              sourceSample: sampleRows(params.source),
              workingSample: sampleRows(params.working),
              rawTextSnippet: params.rawTextSnippet.slice(0, 2500),
            }),
          },
        ],
        providerOptions: {
          gateway: {
            models: ["openai/gpt-4o-mini", "google/gemini-2.5-flash-lite"],
          },
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`AI HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty AI response");

    const parsed = extractJson(content) as {
      score?: number;
      summary?: string;
      strengths?: string[];
      risks?: string[];
      findings?: Array<{
        severity?: string;
        title?: string;
        detail?: string;
      }>;
    };

    const score = Math.min(
      100,
      Math.max(0, typeof parsed.score === "number" ? parsed.score : 70),
    );
    const findings: ForensicFinding[] = (parsed.findings ?? [])
      .filter((f) => f.title && f.detail)
      .slice(0, 8)
      .map((f, i) => ({
        id: `ai-${i}`,
        layer: "ai-fidelity" as const,
        severity:
          f.severity === "critical" ||
          f.severity === "material" ||
          f.severity === "minor" ||
          f.severity === "supporting"
            ? f.severity
            : "minor",
        title: String(f.title),
        detail: String(f.detail),
      }));

    return {
      ran: true,
      skipped: false,
      score,
      summary: parsed.summary ?? "AI forensic review complete.",
      risks: (parsed.risks ?? []).map(String).slice(0, 8),
      strengths: (parsed.strengths ?? []).map(String).slice(0, 8),
      layer: {
        layer: "ai-fidelity",
        label: "AI fidelity & authenticity",
        score,
        weight: 0.05,
        status: score >= 88 ? "pass" : score >= 70 ? "warn" : "fail",
        summary: parsed.summary?.slice(0, 160) ?? `AI score ${score}`,
        findings,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ran: false,
      skipped: true,
      score: 0,
      summary: `AI fidelity failed: ${msg}`,
      risks: [msg],
      strengths: [],
      layer: {
        layer: "ai-fidelity",
        label: "AI fidelity & authenticity",
        score: 0,
        weight: 0.05,
        status: "skipped",
        summary: msg,
        findings: [
          {
            id: "ai-error",
            layer: "ai-fidelity",
            severity: "minor",
            title: "AI review error",
            detail: msg,
          },
        ],
      },
    };
  }
}
