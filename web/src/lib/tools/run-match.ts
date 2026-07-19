import { parseAmount } from "@/lib/money";
import { normalizeDate } from "@/lib/parse-transactions";
import type { Transaction } from "@/lib/types";
import type { ExtractedRun } from "./pdf-runs";

export type MatchableField = "date" | "description" | "debit" | "credit" | "balance";

export interface RunMatch {
  transactionId: string;
  field: MatchableField;
  runId: string;
  page: number;
  original: string;
  bbox: { x: number; y: number; width: number; height: number };
  fontName?: string;
  fontFamily?: string;
  /** Match quality 0..1 */
  score: number;
}

function moneyText(n: number | null): string | null {
  if (n == null) return null;
  return n.toFixed(2);
}

function normMoney(s: string): number | null {
  return parseAmount(s);
}

function textsEqualMoney(a: string, b: number): boolean {
  const n = normMoney(a);
  return n != null && Math.abs(n - b) < 0.005;
}

function dateLike(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  try {
    const n = normalizeDate(t);
    return /^\d{4}-\d{2}-\d{2}$/.test(n) ? n : null;
  } catch {
    return null;
  }
}

function descScore(runText: string, description: string): number {
  const a = runText.trim().toLowerCase();
  const b = description.trim().toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) && a.length >= 4) return 0.75 + Math.min(0.2, a.length / 100);
  if (a.includes(b.slice(0, Math.min(12, b.length))) && b.length >= 6) return 0.55;
  // token overlap
  const ta = new Set(a.split(/\s+/).filter((x) => x.length > 2));
  const tb = b.split(/\s+/).filter((x) => x.length > 2);
  if (!tb.length) return 0;
  let hit = 0;
  for (const t of tb) if (ta.has(t)) hit += 1;
  const ratio = hit / tb.length;
  return ratio >= 0.5 ? 0.4 + ratio * 0.4 : 0;
}

/**
 * Link current (or original) transaction field values to PDF text runs by
 * value + geometry, producing runMatches for font-replicated replace.
 *
 * Strategy:
 * 1. Prefer matching against transaction.original (parse-time values still on PDF)
 * 2. Fall back to current field values
 * 3. One run consumed per match (greedy highest score)
 */
export function linkRunMatches(params: {
  transactions: Transaction[];
  runs: ExtractedRun[];
  /** Prefer original snapshot values (still on PDF after table edits). */
  preferOriginal?: boolean;
}): { matches: RunMatch[]; stats: { linked: number; fields: number; runs: number } } {
  const preferOriginal = params.preferOriginal !== false;
  const available = params.runs.map((r, i) => ({
    ...r,
    runId: `p${r.page}-r${i}-${r.text.slice(0, 8)}`,
    used: false,
  }));

  const matches: RunMatch[] = [];
  let fields = 0;

  for (const t of params.transactions) {
    const src = preferOriginal && t.original ? t.original : t;
    const candidates: Array<{
      field: MatchableField;
      target: string;
      kind: "date" | "money" | "text";
      money?: number;
    }> = [];

    if (src.date) {
      candidates.push({ field: "date", target: src.date, kind: "date" });
      fields += 1;
    }
    if (src.description) {
      candidates.push({
        field: "description",
        target: src.description,
        kind: "text",
      });
      fields += 1;
    }
    const debitS = moneyText(src.debit);
    if (debitS && src.debit != null) {
      candidates.push({
        field: "debit",
        target: debitS,
        kind: "money",
        money: src.debit,
      });
      fields += 1;
    }
    const creditS = moneyText(src.credit);
    if (creditS && src.credit != null) {
      candidates.push({
        field: "credit",
        target: creditS,
        kind: "money",
        money: src.credit,
      });
      fields += 1;
    }
    const balS = moneyText(src.balance);
    if (balS && src.balance != null) {
      candidates.push({
        field: "balance",
        target: balS,
        kind: "money",
        money: src.balance,
      });
      fields += 1;
    }

    for (const c of candidates) {
      let bestIdx = -1;
      let bestScore = 0;

      for (let i = 0; i < available.length; i++) {
        const r = available[i];
        if (r.used) continue;
        let score = 0;
        if (c.kind === "money" && c.money != null) {
          if (textsEqualMoney(r.text, c.money)) score = 1;
          else {
            // partial like "1,200.00" vs 1200
            const n = normMoney(r.text);
            if (n != null && Math.abs(n - c.money) < 0.005) score = 0.95;
          }
        } else if (c.kind === "date") {
          const rd = dateLike(r.text);
          if (rd && (rd === c.target || rd === normalizeDate(c.target))) score = 1;
          else if (r.text.replace(/\s/g, "") === c.target.replace(/-/g, "/"))
            score = 0.9;
        } else {
          score = descScore(r.text, c.target);
        }

        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0 && bestScore >= 0.5) {
        const r = available[bestIdx];
        r.used = true;
        matches.push({
          transactionId: t.id,
          field: c.field,
          runId: r.runId,
          page: r.page,
          original: r.text,
          bbox: {
            x: r.x,
            y: r.y - r.height,
            width: Math.max(r.width, 2),
            height: Math.max(r.height, 2),
          },
          fontName: r.fontName,
          fontFamily: r.fontSpec.family,
          score: bestScore,
        });
      }
    }
  }

  return {
    matches,
    stats: {
      linked: matches.length,
      fields,
      runs: params.runs.length,
    },
  };
}

/**
 * After generator replace: remap matches from old transaction ids to new ones
 * by row order / original value when generating replacements for NEW values
 * onto OLD run geometry.
 *
 * For generator flow we typically:
 * - link runs to *existing* (pre-replace) transactions via original values
 * - then build edits with *new* transaction field values as replacement text
 *   using the same row index pairing.
 */
export function pairGeneratedToMatches(params: {
  previous: Transaction[];
  generated: Transaction[];
  matches: RunMatch[];
}): RunMatch[] {
  // Map previous id → index
  const prevIndex = new Map(params.previous.map((t, i) => [t.id, i]));
  const out: RunMatch[] = [];

  for (const m of params.matches) {
    const idx = prevIndex.get(m.transactionId);
    if (idx == null) continue;
    const gen = params.generated[idx];
    if (!gen) continue;
    out.push({
      ...m,
      transactionId: gen.id,
    });
  }

  // If lengths differ, also try sequential pairing for unmatched generated rows
  // against leftover matches already handled above.

  return out;
}
