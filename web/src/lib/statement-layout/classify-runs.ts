/**
 * Classify each text run into Part 1 / 2 / 3 with a fine-grained role.
 */
import type { LayoutPartId, LayoutRun, RunRole } from "./types";

const MONTH =
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

const STATIC_LABELS =
  /^(complete freedom|transaction listing|transactions|transaction listing continued|account\/?card number|account opened:?|current balance:?|opening balance:?|closing balance:?|date|transaction|description|amount|balance|debit|credit|particulars|details|australia|page|of|date created:?)$/i;

const LEGAL =
  /\b(abn|afsl|australian credit licence|division of|banking corporation|bsb\s*guide|privacy|please note)\b/i;

const BRAND =
  /\b(st\.?\s*george|westpac|anz|commbank|commonwealth|nab|ing bank|macquarie|chase|bank of america)\b/i;

const TABLE_HEADER =
  /^(date|transaction|description|amount|balance|debit|credit|particulars|withdrawal|deposit)$/i;

const BSB = /\b\d{3}[-\s]?\d{3}\b/;
const ACCOUNT = /\b\d{2,4}(?:[\s-]?\d{3}){1,4}\b/;
const MONEY = /^-?\$?\s*[\d,]+\.\d{2}$/;
const DATE_DMY =
  /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/;
const DATE_MMM = new RegExp(
  String.raw`^\d{1,2}\s+(?:${MONTH})[a-z]*(?:\s+\d{2,4})?$`,
  "i",
);
const DATE_LONG = new RegExp(
  String.raw`\b\d{1,2}[-\s](?:${MONTH})[a-z]*[-\s]\d{2,4}\b`,
  "i",
);
const PAGE_OF = /\bpage\b|\bof\b/i;
const PERIOD_HINT =
  /statement covers|days of transactions|period|from\s+\d|to\s+\d/i;

export interface ClassifyContext {
  /** Approximate table header Y per page (if known). */
  tableHeaderYByPage: Map<number, number>;
  /** Y below which footer vars live. */
  footerYThreshold: number;
  pageHeight: number;
}

function moneySign(text: string): "debit" | "credit" | "amount" {
  const t = text.trim();
  if (/^-/.test(t) || t.includes("-$")) return "debit";
  if (MONEY.test(t)) return "amount";
  return "amount";
}

/**
 * Assign part + role for a single run given page geometry context.
 */
export function classifyRun(
  run: Omit<LayoutRun, "part" | "role" | "confidence" | "id"> & {
    id?: string;
  },
  ctx: ClassifyContext,
): Pick<LayoutRun, "part" | "role" | "confidence"> {
  const text = run.text.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const y = run.y;
  const page = run.page;
  const headerY = ctx.tableHeaderYByPage.get(page);
  const inFooter = y >= ctx.footerYThreshold;
  const inHeaderZone = y < (headerY ?? ctx.pageHeight * 0.35);

  // Empty / whitespace
  if (!text || text.length === 0) {
    return { part: "static", role: "static_label", confidence: 0.2 };
  }

  // Legal / brand static
  if (LEGAL.test(text) || (BRAND.test(text) && text.length > 20)) {
    return { part: "static", role: "static_legal", confidence: 0.92 };
  }
  if (BRAND.test(text) && text.length <= 40 && !MONEY.test(text)) {
    return { part: "static", role: "static_brand", confidence: 0.85 };
  }

  // Table headers
  if (TABLE_HEADER.test(text) || STATIC_LABELS.test(text)) {
    if (TABLE_HEADER.test(text)) {
      return { part: "static", role: "table_header", confidence: 0.9 };
    }
    return { part: "static", role: "static_label", confidence: 0.88 };
  }

  // Token templates
  if (/\{[A-Z0-9 _/-]+\}?/i.test(text)) {
    if (/BSB|ACCOUNT|FIRSTNAME|ADDRESS|DATE|BALANCE|FROM|TO|TIME|X|dd|STGEORGE|AMOUNT|NUMBER/i.test(text)) {
      return {
        part: "header_footer_vars",
        role: /AMOUNT|dd|STGEORGE/i.test(text)
          ? "txn_description_primary"
          : "var_other",
        confidence: 0.9,
      };
    }
  }

  // Money tokens
  if (MONEY.test(text.replace(/\s/g, ""))) {
    const sign = moneySign(text);
    // Summary balance in header (above table)
    if (inHeaderZone && headerY != null && y < headerY - 8) {
      return {
        part: "header_footer_vars",
        role: "var_balance_summary",
        confidence: 0.8,
      };
    }
    // Table body amounts
    if (headerY != null && y > headerY) {
      if (sign === "debit") {
        return { part: "transaction_table", role: "txn_debit", confidence: 0.75 };
      }
      // Rightmost-ish → balance heuristic via x later; default amount
      if (run.x > 450) {
        return {
          part: "transaction_table",
          role: "txn_balance",
          confidence: 0.7,
        };
      }
      if (run.x > 350) {
        return {
          part: "transaction_table",
          role: sign === "debit" ? "txn_debit" : "txn_amount",
          confidence: 0.72,
        };
      }
      return {
        part: "transaction_table",
        role: "txn_amount",
        confidence: 0.65,
      };
    }
    return {
      part: "header_footer_vars",
      role: "var_balance_summary",
      confidence: 0.55,
    };
  }

  // Dates
  if (DATE_MMM.test(text) || DATE_DMY.test(text) || DATE_LONG.test(text)) {
    if (headerY != null && y > headerY) {
      return { part: "transaction_table", role: "txn_date", confidence: 0.88 };
    }
    if (inHeaderZone) {
      if (/opened|open/i.test(lower)) {
        return { part: "header_footer_vars", role: "var_opened", confidence: 0.7 };
      }
      return { part: "header_footer_vars", role: "var_period", confidence: 0.7 };
    }
    if (inFooter) {
      return { part: "header_footer_vars", role: "var_created", confidence: 0.75 };
    }
    return { part: "header_footer_vars", role: "var_period", confidence: 0.55 };
  }

  // Period phrase
  if (PERIOD_HINT.test(text)) {
    return { part: "header_footer_vars", role: "var_period", confidence: 0.85 };
  }

  // Page chrome
  if (inFooter && (PAGE_OF.test(text) || /^\d+$/.test(text))) {
    return { part: "header_footer_vars", role: "var_page", confidence: 0.7 };
  }
  if (inFooter && /date created|created:/i.test(text)) {
    return { part: "static", role: "static_label", confidence: 0.8 };
  }

  // BSB / account in header
  if (inHeaderZone && BSB.test(text) && text.length < 20) {
    return { part: "header_footer_vars", role: "var_bsb", confidence: 0.8 };
  }
  if (
    inHeaderZone &&
    ACCOUNT.test(text) &&
    text.length < 30 &&
    !/australia/i.test(text)
  ) {
    // Combined "116-879   453 657 726"
    if (BSB.test(text) && /\d{3}\s+\d{3}/.test(text)) {
      return {
        part: "header_footer_vars",
        role: "var_account",
        confidence: 0.82,
      };
    }
    return {
      part: "header_footer_vars",
      role: "var_account",
      confidence: 0.65,
    };
  }

  // Identity / address in left header
  if (inHeaderZone && run.x < 250 && text.length >= 3 && text.length < 60) {
    if (/^[A-Z][A-Z\s'.-]{2,}$/.test(text) && !STATIC_LABELS.test(text)) {
      return {
        part: "header_footer_vars",
        role: "var_identity",
        confidence: 0.75,
      };
    }
    if (
      /\d/.test(text) ||
      /\b(st|street|rd|road|ave|nsw|vic|qld|wa|sa|tas|act|nt)\b/i.test(text)
    ) {
      return {
        part: "header_footer_vars",
        role: "var_address",
        confidence: 0.78,
      };
    }
  }

  // Pure reference in table body
  if (
    headerY != null &&
    y > headerY &&
    /^[\d*]{6,}$/.test(text.replace(/\s/g, ""))
  ) {
    return {
      part: "transaction_table",
      role: "txn_reference",
      confidence: 0.8,
    };
  }

  // Description-like in table body
  if (headerY != null && y > headerY && !inFooter) {
    if (run.x < 360 && text.length > 2) {
      // Slightly lower lines under a date row → secondary
      return {
        part: "transaction_table",
        role: "txn_description_primary",
        confidence: 0.6,
      };
    }
  }

  // Footer remaining
  if (inFooter) {
    return { part: "header_footer_vars", role: "var_other", confidence: 0.4 };
  }

  // Default: static if looks like label, else unknown static
  if (text.length < 40 && !/\d/.test(text)) {
    return { part: "static", role: "static_label", confidence: 0.45 };
  }

  return { part: "static", role: "unknown", confidence: 0.3 };
}

export function partForRole(role: RunRole): LayoutPartId {
  if (
    role.startsWith("txn_") ||
    role === "table_header" // header labels are static; table data is separate
  ) {
    if (role === "table_header") return "static";
    return "transaction_table";
  }
  if (role.startsWith("var_")) return "header_footer_vars";
  return "static";
}
