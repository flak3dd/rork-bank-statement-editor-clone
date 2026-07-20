/**
 * Align working ledger to bank OEM transaction structure before PDF write.
 */
import type { Transaction } from "@/lib/types";
import {
  formatDescriptionToStructure,
  joinStructuredDescription,
  type BankTransactionStructureProfile,
  type StatementLayoutAnalysis,
} from "@/lib/statement-layout";
import {
  formatDateLikeOriginal,
  formatMoneyLikeOriginal,
} from "@/lib/money";

/**
 * Light structure tagging only.
 *
 * Full re-split of already bank-native lines was scrambling OEM text
 * (e.g. secondary/primary reverse). For filled OEM rewrite we keep the
 * description string as the user/generator produced it, and only flag
 * that the bank profile is active for downstream formatters.
 */
export function applyStructureToLedger(
  current: Transaction[],
  profile: BankTransactionStructureProfile | null | undefined,
): { ledger: Transaction[]; notes: string[] } {
  const notes: string[] = [];
  if (!profile || !current.length) {
    return { ledger: current, notes: ["structure: skipped (no profile)"] };
  }

  // Only reformat when description clearly lacks bank-native shape AND
  // is a single blob that looks generated (very long single line, no spaces
  // matching secondary patterns). Otherwise leave intact — prevents ghost
  // visual from wrong FreeText strings.
  let changed = 0;
  const ledger = current.map((t) => {
    if (/^OPENING|^CLOSING/i.test(t.description)) return t;
    const d = t.description.trim();
    const looksNative =
      /\n/.test(d) ||
      /visa purchase|eftpos|osko|interbank|sct deposit|bpay/i.test(d) ||
      d.length < 80;
    if (looksNative) {
      return {
        ...t,
        flags: [...new Set([...(t.flags ?? []), "oem-struct-keep"])],
      };
    }
    const parts = formatDescriptionToStructure(profile, d);
    const next = joinStructuredDescription(parts);
    if (next && next !== d) {
      changed += 1;
      return {
        ...t,
        description: next,
        flags: [...new Set([...(t.flags ?? []), "oem-struct"])],
      };
    }
    return {
      ...t,
      flags: [...new Set([...(t.flags ?? []), "oem-struct-keep"])],
    };
  });

  notes.push(
    `structure: bank=${profile.bankId} reformatted ${changed}/${current.length} (native lines kept) · ${profile.recipe.slice(0, 100)}`,
  );
  return { ledger, notes };
}

/**
 * Prefer layout-mapped baseline dates for format mirroring when rewriting.
 */
export function mirrorFormatsFromBaseline(
  baseline: Transaction[],
  current: Transaction[],
): Transaction[] {
  const n = Math.min(baseline.length, current.length);
  return current.map((t, i) => {
    if (i >= n) return t;
    const b = baseline[i];
    // Keep structured description; amounts stay numeric on ledger
    // (geometry writers use formatMoneyLikeOriginal against PDF originals)
    void formatDateLikeOriginal;
    void formatMoneyLikeOriginal;
    void b;
    return t;
  });
}

/** Extract structure profile from layout analysis safely. */
export function profileFromLayout(
  layout: StatementLayoutAnalysis | null,
): BankTransactionStructureProfile | null {
  return layout?.txnStructure ?? null;
}
