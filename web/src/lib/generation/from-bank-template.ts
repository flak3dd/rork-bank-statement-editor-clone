/**
 * Generation assist from parser YAML bank templates
 * (`src/lib/parsers/templates/*.yaml`).
 *
 * Detects the bank layout, maps to description generators, and formats
 * dates / amounts / cleanup rules so synthetic data matches the source brand.
 */
import {
  BANK_TEMPLATES,
  detectBankTemplate,
  getTemplateById,
} from "@/lib/parsers/templates";
import type { BankTemplate } from "@/lib/parsers/types";
import {
  normalizeBankId,
  generateBankDescription,
  type BankId,
} from "@/lib/tools/bank-descriptions";
import {
  formatDateLikeOriginal,
  formatMoneyLikeOriginal,
} from "@/lib/money";
import type { Transaction } from "@/lib/types";
import type { BankTransactionStructureProfile } from "@/lib/statement-layout/types";

export type TemplateAmountLayout =
  | "signed_amount_balance"
  | "debit_credit_balance"
  | "credit_debit_balance";

export interface GenerationAssistContext {
  template: BankTemplate;
  /** Description-generator bank id (anz, cba, westpac, …). */
  bankId: BankId;
  dateOrder: BankTemplate["dateOrder"];
  columnOrder: BankTemplate["columnOrder"];
  currency: string;
  amountLayout: TemplateAmountLayout;
  notes: string[];
}

/** Map parser template id → bank-desc generator id. */
const TEMPLATE_TO_BANK: Record<string, BankId> = {
  anz: "anz",
  commonwealth: "cba",
  westpac: "westpac", // includes St.George / Bank of Melbourne matches
  nab: "other",
  chase: "other",
  bankofamerica: "other",
  generic: "other",
};

/**
 * Resolve YAML template + generation bank id from statement text / hint.
 */
export function resolveGenerationAssist(
  rawText: string,
  options?: { templateId?: string | null; bankHint?: string | null },
): GenerationAssistContext {
  const notes: string[] = [];
  let template: BankTemplate | undefined;

  if (options?.templateId) {
    template = getTemplateById(options.templateId);
    if (template) notes.push(`template forced id=${template.id}`);
  }

  const norm = (s: string) =>
    s.toLowerCase().replace(/[.\-_]+/g, " ").replace(/\s+/g, " ").trim();

  if (!template && options?.bankHint) {
    const hint = norm(options.bankHint);
    template = BANK_TEMPLATES.find((t) => {
      if (t.id === options.bankHint?.toLowerCase()) return true;
      if (norm(t.name).includes(hint) || hint.includes(norm(t.name))) return true;
      return t.match.some((m) => {
        const mm = norm(m);
        return hint.includes(mm) || mm.includes(hint);
      });
    });
    if (template) notes.push(`template from bankHint=${template.id}`);
  }

  if (!template) {
    // Prefer file-name / hint + body text for detectBankTemplate
    const haystack = [rawText || "", options?.bankHint || ""].join("\n");
    template = detectBankTemplate(haystack);
    notes.push(`template detected id=${template.id} (${template.name})`);
  }

  const bankId =
    TEMPLATE_TO_BANK[template.id] ??
    normalizeBankId(template.id) ??
    "other";

  // St.George / Westpac family → westpac generator pack
  const hay = norm([rawText || "", options?.bankHint || ""].join(" "));
  let resolvedBank = bankId;
  if (
    /st\s*george|complete freedom|bank of melbourne/.test(hay) ||
    template.id === "westpac"
  ) {
    resolvedBank = "westpac";
    if (template.id !== "westpac") {
      const wp = getTemplateById("westpac");
      if (wp) template = wp;
    }
    notes.push("st-george/westpac family → westpac generator + westpac yaml");
  }

  const amountLayout = inferAmountLayout(template);
  notes.push(
    `columns=[${template.columnOrder.join(",")}] dateOrder=${template.dateOrder} currency=${template.currency ?? "?"} layout=${amountLayout}`,
  );

  return {
    template,
    bankId: resolvedBank,
    dateOrder: template.dateOrder,
    columnOrder: template.columnOrder,
    currency: template.currency ?? "AUD",
    amountLayout,
    notes,
  };
}

function inferAmountLayout(template: BankTemplate): TemplateAmountLayout {
  const cols = template.columnOrder;
  if (cols.includes("amount") && !cols.includes("debit") && !cols.includes("credit")) {
    return "signed_amount_balance";
  }
  const di = cols.indexOf("debit");
  const ci = cols.indexOf("credit");
  if (di >= 0 && ci >= 0 && ci < di) return "credit_debit_balance";
  return "debit_credit_balance";
}

/** Apply YAML descriptionCleanup regexes. */
export function applyTemplateDescriptionCleanup(
  description: string,
  template: BankTemplate,
): string {
  let d = description;
  for (const rule of template.descriptionCleanup ?? []) {
    try {
      // YAML may double-escape backslashes ("\\s" → "\\s" string); normalize once.
      const pat = rule.pattern.replace(/\\\\/g, "\\");
      d = d.replace(new RegExp(pat, "gi"), rule.replace ?? "");
    } catch {
      /* bad pattern in yaml — skip */
    }
  }
  return d.replace(/\s+/g, " ").trim();
}

/**
 * Format ISO date using template dateOrder when no original glyph sample.
 */
export function formatDateForTemplate(
  iso: string,
  ctx: GenerationAssistContext,
  originalSample?: string | null,
): string {
  if (originalSample?.trim()) {
    return formatDateLikeOriginal(iso, originalSample);
  }
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, y, mon, day] = m;
  if (ctx.dateOrder === "mdy") return `${mon}/${day}/${y.slice(2)}`;
  if (ctx.dateOrder === "ymd") return `${y}-${mon}-${day}`;
  // dmy
  return `${day}/${mon}/${y.slice(2)}`;
}

/**
 * Format money using original glyphs when present, else template currency.
 */
export function formatAmountForTemplate(
  value: number,
  ctx: GenerationAssistContext,
  originalSample?: string | null,
  signed = false,
): string {
  if (originalSample?.trim()) {
    return formatMoneyLikeOriginal(value, originalSample);
  }
  const abs = Math.abs(value).toFixed(2);
  const withCommas = abs.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol =
    ctx.currency === "AUD" || ctx.currency === "USD"
      ? "$"
      : ctx.currency === "EUR"
        ? "€"
        : ctx.currency === "GBP"
          ? "£"
          : "$";
  if (signed && value < 0) return `-${symbol}${withCommas}`;
  return `${symbol}${withCommas}`;
}

/**
 * Enrich a structure profile with YAML template rules.
 */
export function structureProfileFromTemplate(
  ctx: GenerationAssistContext,
  base?: Partial<BankTransactionStructureProfile> | null,
): BankTransactionStructureProfile {
  const dateFormat =
    ctx.dateOrder === "mdy"
      ? "mm/dd/yyyy"
      : ctx.dateOrder === "ymd"
        ? "yyyy-mm-dd"
        : ctx.template.id === "westpac"
          ? "dd mmm"
          : "dd/mm/yyyy";

  return {
    bankId: base?.bankId ?? ctx.template.id,
    bankName: base?.bankName ?? ctx.template.name,
    confidence: Math.max(base?.confidence ?? 0.55, 0.55),
    dateFormat: base?.dateFormat ?? dateFormat,
    amountLayout: base?.amountLayout ?? ctx.amountLayout,
    multiLineDescription: base?.multiLineDescription ?? true,
    secondaryLineRole: base?.secondaryLineRole ?? "mixed",
    embedsDateInDescription:
      base?.embedsDateInDescription ??
      (ctx.template.id === "westpac" || ctx.bankId === "westpac"),
    hasStandaloneReference: base?.hasStandaloneReference ?? false,
    descriptionPatterns: [
      ...(base?.descriptionPatterns ?? []),
      `yaml-template:${ctx.template.id}`,
      `columns:${ctx.columnOrder.join("|")}`,
    ],
    samplePrimaries: base?.samplePrimaries ?? [],
    sampleSecondaries: base?.sampleSecondaries ?? [],
    recipe:
      base?.recipe ??
      `${ctx.template.name}: date(${dateFormat}) · ${ctx.columnOrder.join(" · ")} · ${ctx.currency}`,
    notes: [
      ...(base?.notes ?? []),
      ...ctx.notes,
      ctx.template.notes ?? "",
    ].filter(Boolean),
  };
}

export interface AssistLedgerOptions {
  transactions: Transaction[];
  /** Source PDF text for detectBankTemplate. */
  rawText?: string;
  templateId?: string | null;
  bankHint?: string | null;
  /** Rewrite descriptions with bank-desc generators. Default false. */
  rewriteDescriptions?: boolean;
  /** Apply YAML descriptionCleanup. Default true. */
  applyCleanup?: boolean;
  /** Pre-resolved assist context (skip detect). */
  context?: GenerationAssistContext | null;
}

export interface AssistLedgerResult {
  transactions: Transaction[];
  context: GenerationAssistContext;
  structureProfile: BankTransactionStructureProfile;
  notes: string[];
  rewritten: number;
  cleaned: number;
}

/**
 * Assist generation using YAML bank templates:
 * - detect bank layout
 * - optional bank-authentic description rewrite
 * - apply descriptionCleanup
 * - tag rows with template/bank flags
 */
export function assistLedgerWithBankTemplate(
  options: AssistLedgerOptions,
): AssistLedgerResult {
  const ctx =
    options.context ??
    resolveGenerationAssist(options.rawText ?? "", {
      templateId: options.templateId,
      bankHint: options.bankHint,
    });
  const notes = [...ctx.notes];
  const rewrite = options.rewriteDescriptions === true;
  const cleanup = options.applyCleanup !== false;
  let rewritten = 0;
  let cleaned = 0;

  const transactions = options.transactions.map((t) => {
    let description = t.description;
    const flags = new Set([...(t.flags ?? []), `tpl:${ctx.template.id}`, `bank:${ctx.bankId}`]);

    if (rewrite && !/^OPENING|^CLOSING/i.test(description)) {
      description = generateBankDescription(ctx.bankId);
      rewritten += 1;
      flags.add("bank-desc");
      flags.add("tpl-assist");
    }

    if (cleanup && (ctx.template.descriptionCleanup?.length ?? 0) > 0) {
      const next = applyTemplateDescriptionCleanup(description, ctx.template);
      if (next !== description) {
        description = next;
        cleaned += 1;
        flags.add("tpl-cleanup");
      }
    }

    return {
      ...t,
      description,
      flags: [...flags],
    };
  });

  if (rewrite) {
    notes.push(
      `rewrote ${rewritten} description(s) with ${ctx.bankId} generator (template ${ctx.template.id})`,
    );
  }
  if (cleaned) notes.push(`descriptionCleanup applied on ${cleaned} row(s)`);

  const structureProfile = structureProfileFromTemplate(ctx);

  return {
    transactions,
    context: ctx,
    structureProfile,
    notes,
    rewritten,
    cleaned,
  };
}

/** List available YAML templates for UI. */
export function listBankTemplatesForGeneration(): Array<{
  id: string;
  name: string;
  bankId: BankId;
  currency?: string;
  dateOrder: string;
  columnOrder: string[];
}> {
  return BANK_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    bankId: TEMPLATE_TO_BANK[t.id] ?? "other",
    currency: t.currency,
    dateOrder: t.dateOrder,
    columnOrder: [...t.columnOrder],
  }));
}
