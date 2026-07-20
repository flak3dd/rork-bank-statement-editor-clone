import { isStGeorgeTemplateText } from "@/lib/st-george-template";
import type { DocumentClass } from "./types";

/**
 * Classify uploaded PDF text so the pipeline picks the right replacement strategy.
 */
export function classifyDocument(rawText: string): DocumentClass {
  const t = (rawText || "").trim();
  if (!t) return "unknown";
  if (isStGeorgeTemplateText(t) || /\{[A-Z][A-Z0-9 _)]{2,}\}/.test(t)) {
    return "token-template";
  }
  // Heuristic: looks like a filled statement if we see date-like + money tokens
  const hasMoney = /\$\s*[\d,]+(\.\d{2})?|-\$\s*[\d,]+/.test(t);
  const hasDates =
    /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(
      t,
    ) || /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(t);
  if (hasMoney && hasDates) return "filled-statement";
  if (hasMoney || hasDates) return "filled-statement";
  return "unknown";
}
