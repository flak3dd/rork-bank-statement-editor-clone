/**
 * Step 2 — Bank-specific transaction structure profiles.
 *
 * Each bank identifies transactions differently (refs, embedded dates,
 * multi-line merchants, Osko/Visa prefixes, etc.). When generating or
 * replacing descriptions, output must follow the source statement’s structure.
 */
import type {
  BankTransactionStructureProfile,
  TransactionTableRow,
} from "./types";

const MONTH =
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

export interface StructureSignals {
  multiLineRate: number;
  embedDateRate: number;
  refRate: number;
  signedAmountRate: number;
  separateDebitCreditRate: number;
  samplePrimaries: string[];
  sampleSecondaries: string[];
  descriptionPatterns: string[];
}

/** Infer structural signals from extracted table rows. */
export function measureStructureSignals(
  rows: TransactionTableRow[],
): StructureSignals {
  if (rows.length === 0) {
    return {
      multiLineRate: 0,
      embedDateRate: 0,
      refRate: 0,
      signedAmountRate: 0,
      separateDebitCreditRate: 0,
      samplePrimaries: [],
      sampleSecondaries: [],
      descriptionPatterns: [],
    };
  }

  let multi = 0;
  let embed = 0;
  let ref = 0;
  let signed = 0;
  let split = 0;
  const patterns = new Set<string>();
  const primaries: string[] = [];
  const secondaries: string[] = [];

  const embedDateRe = new RegExp(
    String.raw`\b\d{1,2}\s*(?:${MONTH})|\b\d{1,2}[\/\-]\d{1,2}|\b\d{2}:\d{2}\b`,
    "i",
  );
  const refRe = /^(?:\d{6,}|\*?\d{4,}|\d{3,}[A-Za-z]+\d*|[A-Z]{2,}\d{4,})/;

  for (const r of rows) {
    if (r.secondaryLines.length > 0 || r.referenceLines.length > 0) multi += 1;
    if (embedDateRe.test(r.primaryLine)) {
      embed += 1;
      patterns.add("embedded-date-in-primary");
    }
    if (r.referenceLines.length > 0 || refRe.test(r.secondaryLines[0] ?? "")) {
      ref += 1;
      patterns.add("standalone-or-secondary-reference");
    }
    if (r.amount != null && r.debit == null && r.credit == null) {
      signed += 1;
      patterns.add("signed-amount-column");
    }
    if (r.debit != null || r.credit != null) {
      if (r.debit != null && r.credit != null) {
        /* rare both */
      } else {
        split += 1;
      }
    }
    // Prefix families
    if (/^visa\b/i.test(r.primaryLine)) patterns.add("prefix:Visa Purchase");
    if (/^eftpos\b/i.test(r.primaryLine)) patterns.add("prefix:Eftpos");
    if (/^osko\b/i.test(r.primaryLine)) patterns.add("prefix:Osko");
    if (/interbank/i.test(r.description)) patterns.add("type:Interbank Trans");
    if (/^sct\b/i.test(r.primaryLine)) patterns.add("prefix:Sct Deposit");
    if (/bpay/i.test(r.primaryLine)) patterns.add("prefix:BPAY");
    if (/direct\s*debit/i.test(r.primaryLine)) patterns.add("prefix:Direct Debit");
    if (/salary|wages|payg/i.test(r.primaryLine)) patterns.add("prefix:Salary");

    if (primaries.length < 12 && r.primaryLine) primaries.push(r.primaryLine);
    for (const s of r.secondaryLines) {
      if (secondaries.length < 12 && s) secondaries.push(s);
    }
  }

  const n = rows.length;
  return {
    multiLineRate: multi / n,
    embedDateRate: embed / n,
    refRate: ref / n,
    signedAmountRate: signed / n,
    separateDebitCreditRate: split / n,
    samplePrimaries: primaries,
    sampleSecondaries: secondaries,
    descriptionPatterns: [...patterns],
  };
}

function detectBankId(text: string, hint?: string | null): {
  id: string;
  name: string;
} {
  const h = (hint || "").toLowerCase();
  const t = text.toLowerCase();
  if (h.includes("st george") || h.includes("stgeorge") || t.includes("st.george") || t.includes("st george") || t.includes("complete freedom")) {
    return { id: "st-george", name: "St.George / Westpac Complete Freedom" };
  }
  if (h.includes("anz") || /\banz\b/.test(t)) return { id: "anz", name: "ANZ" };
  if (h.includes("cba") || h.includes("commbank") || t.includes("commonwealth") || t.includes("commbank")) {
    return { id: "cba", name: "Commonwealth Bank" };
  }
  if (h.includes("nab") || /\bnab\b/.test(t) || t.includes("national australia")) {
    return { id: "nab", name: "NAB" };
  }
  if (h.includes("westpac") || t.includes("westpac")) return { id: "westpac", name: "Westpac" };
  if (h.includes("ing") || /\bing\b/.test(t)) return { id: "ing", name: "ING" };
  if (h.includes("macquarie") || t.includes("macquarie")) return { id: "macquarie", name: "Macquarie" };
  if (h.includes("chase") || t.includes("chase")) return { id: "chase", name: "Chase" };
  if (h.includes("bank of america") || t.includes("bank of america")) {
    return { id: "bofa", name: "Bank of America" };
  }
  return { id: "generic", name: "Generic / unknown bank" };
}

/** Known structure recipes per bank (overridden by measured signals when strong). */
const BANK_RECIPES: Record<
  string,
  Partial<BankTransactionStructureProfile>
> = {
  "st-george": {
    dateFormat: "dd mmm",
    amountLayout: "signed_amount_balance",
    multiLineDescription: true,
    secondaryLineRole: "mixed",
    embedsDateInDescription: true,
    hasStandaloneReference: true,
    recipe:
      "Date (dd mmm) | Primary type line (often embeds process date e.g. 'Visa Purchase 14Nov') | optional secondary merchant/type ('Oz Lotteries Melbourne', 'Interbank Trans') | optional pure reference digits | signed Amount | Balance",
  },
  anz: {
    dateFormat: "dd/mm/yyyy",
    amountLayout: "debit_credit_balance",
    multiLineDescription: true,
    secondaryLineRole: "merchant",
    embedsDateInDescription: false,
    hasStandaloneReference: true,
    recipe:
      "Date | Description (ANZ channel codes / merchant) | Debit | Credit | Balance; refs often trailing",
  },
  cba: {
    dateFormat: "dd/mm/yyyy",
    amountLayout: "debit_credit_balance",
    multiLineDescription: true,
    secondaryLineRole: "mixed",
    embedsDateInDescription: false,
    hasStandaloneReference: true,
    recipe:
      "Date | CommBank description (Transfer, Card xx…) | Debit | Credit | Balance",
  },
  westpac: {
    dateFormat: "dd mmm yyyy",
    amountLayout: "debit_credit_balance",
    multiLineDescription: true,
    secondaryLineRole: "merchant",
    embedsDateInDescription: true,
    hasStandaloneReference: false,
    recipe:
      "Date | Westpac narrative (may include card/date tokens) | Debit | Credit | Balance",
  },
  nab: {
    dateFormat: "dd Mmm yyyy",
    amountLayout: "debit_credit_balance",
    multiLineDescription: true,
    secondaryLineRole: "reference",
    embedsDateInDescription: false,
    hasStandaloneReference: true,
    recipe:
      "Date | NAB description | optional ref | Debit | Credit | Balance",
  },
  generic: {
    dateFormat: "auto",
    amountLayout: "unknown",
    multiLineDescription: true,
    secondaryLineRole: "mixed",
    embedsDateInDescription: false,
    hasStandaloneReference: false,
    recipe:
      "Infer from samples: keep primary/secondary split, amount columns, and any ref pattern seen on source rows",
  },
};

/**
 * Build a structure profile from measured table rows + text bank hint.
 * Measured signals override weak defaults so each uploaded PDF trains the style.
 */
export function buildTxnStructureProfile(params: {
  rows: TransactionTableRow[];
  rawText: string;
  bankHint?: string | null;
}): BankTransactionStructureProfile {
  const bank = detectBankId(params.rawText, params.bankHint);
  const signals = measureStructureSignals(params.rows);
  const base = BANK_RECIPES[bank.id] ?? BANK_RECIPES.generic;
  const n = params.rows.length;
  const conf = Math.min(
    0.95,
    0.35 +
      (n >= 5 ? 0.25 : n * 0.05) +
      (signals.multiLineRate > 0.3 ? 0.1 : 0) +
      (signals.descriptionPatterns.length >= 2 ? 0.1 : 0) +
      (bank.id !== "generic" ? 0.15 : 0),
  );

  let amountLayout = base.amountLayout ?? "unknown";
  if (signals.signedAmountRate > 0.5) amountLayout = "signed_amount_balance";
  else if (signals.separateDebitCreditRate > 0.5) {
    amountLayout = "debit_credit_balance";
  }

  const notes: string[] = [
    `Measured from ${n} table row(s).`,
    `multiLine=${(signals.multiLineRate * 100).toFixed(0)}% embedDate=${(signals.embedDateRate * 100).toFixed(0)}% ref=${(signals.refRate * 100).toFixed(0)}%`,
  ];
  if (signals.descriptionPatterns.length) {
    notes.push(`Patterns: ${signals.descriptionPatterns.join(", ")}`);
  }

  return {
    bankId: bank.id,
    bankName: bank.name,
    confidence: conf,
    dateFormat: base.dateFormat ?? "auto",
    amountLayout,
    multiLineDescription:
      signals.multiLineRate > 0.15 || Boolean(base.multiLineDescription),
    secondaryLineRole: (base.secondaryLineRole as BankTransactionStructureProfile["secondaryLineRole"]) ?? "mixed",
    embedsDateInDescription:
      signals.embedDateRate > 0.15 || Boolean(base.embedsDateInDescription),
    hasStandaloneReference:
      signals.refRate > 0.08 || Boolean(base.hasStandaloneReference),
    descriptionPatterns: signals.descriptionPatterns,
    samplePrimaries: signals.samplePrimaries,
    sampleSecondaries: signals.sampleSecondaries,
    recipe: base.recipe ?? BANK_RECIPES.generic.recipe!,
    notes,
  };
}

/**
 * Format a synthetic description so it respects the bank structure profile.
 * Does not invent foreign bank styles — reshapes free text into primary/secondary.
 */
export function formatDescriptionToStructure(
  profile: BankTransactionStructureProfile,
  rawDescription: string,
  options?: { processDateHint?: string | null },
): { primary: string; secondary: string | null; reference: string | null } {
  const cleaned = rawDescription.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return { primary: "Transaction", secondary: null, reference: null };
  }

  // Pull trailing pure reference
  let reference: string | null = null;
  let body = cleaned;
  const refTail = body.match(/\s(\d{8,}|\d{6,}[A-Za-z0-9]*)$/);
  if (refTail && profile.hasStandaloneReference) {
    reference = refTail[1];
    body = body.slice(0, refTail.index).trim();
  }

  // Split multi-line style
  let primary = body;
  let secondary: string | null = null;

  if (profile.multiLineDescription) {
    // Prefer explicit separators
    if (body.includes(" | ")) {
      const [a, ...rest] = body.split(" | ");
      primary = a.trim();
      secondary = rest.join(" ").trim() || null;
    } else {
      const words = body.split(" ");
      if (words.length > 4) {
        // St George-ish: first 2–4 tokens primary (type + optional date)
        if (profile.bankId === "st-george" || profile.embedsDateInDescription) {
          const dateTok = body.match(
            new RegExp(
              String.raw`^((?:Visa|Eftpos|Osko|Sct|Direct|BPAY|ATM)\b[^]*?\d{1,2}\s*(?:${MONTH})?[a-z]*)`,
              "i",
            ),
          );
          if (dateTok) {
            primary = dateTok[1].trim();
            secondary = body.slice(dateTok[0].length).trim() || null;
          } else {
            primary = words.slice(0, Math.min(4, words.length)).join(" ");
            secondary = words.slice(Math.min(4, words.length)).join(" ") || null;
          }
        } else {
          primary = words.slice(0, 5).join(" ");
          secondary = words.slice(5).join(" ") || null;
        }
      }
    }
  }

  // Optionally re-embed process date for banks that do so
  if (
    profile.embedsDateInDescription &&
    options?.processDateHint &&
    !/\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(
      primary,
    )
  ) {
    primary = `${primary} ${options.processDateHint}`.trim();
  }

  return {
    primary: primary.slice(0, 64),
    secondary: secondary ? secondary.slice(0, 64) : null,
    reference,
  };
}

/** Join structure parts back into a single description field for the ledger. */
export function joinStructuredDescription(parts: {
  primary: string;
  secondary: string | null;
  reference: string | null;
}): string {
  return [parts.primary, parts.secondary, parts.reference]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
