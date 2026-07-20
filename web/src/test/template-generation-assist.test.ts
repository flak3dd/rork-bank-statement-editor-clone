import { describe, expect, it } from "vitest";
import {
  assistLedgerWithBankTemplate,
  resolveGenerationAssist,
  applyTemplateDescriptionCleanup,
  listBankTemplatesForGeneration,
  formatDateForTemplate,
} from "@/lib/generation/from-bank-template";
import { getTemplateById } from "@/lib/parsers/templates";
import type { Transaction } from "@/lib/types";

const sample: Transaction[] = [
  {
    id: "1",
    date: "2024-11-18",
    description: "Purchase ABC Value Date: 19/11/2024 extra",
    debit: 10,
    credit: null,
    balance: 100,
    category: "Other",
    categorySource: "heuristic",
    categoryConfidence: 0.5,
    flags: [],
  },
];

describe("YAML bank template generation assist", () => {
  it("lists templates from parsers/templates", () => {
    const list = listBankTemplatesForGeneration();
    expect(list.map((t) => t.id)).toEqual(
      expect.arrayContaining([
        "generic",
        "commonwealth",
        "anz",
        "westpac",
        "nab",
      ]),
    );
  });

  it("detects westpac/st.george and maps to westpac generator", () => {
    const ctx = resolveGenerationAssist(
      "St.George Bank - Complete Freedom Transaction Listing\nWestpac Banking Corporation",
    );
    expect(ctx.template.id).toBe("westpac");
    expect(ctx.bankId).toBe("westpac");
    expect(ctx.currency).toBe("AUD");
    expect(ctx.dateOrder).toBe("dmy");
  });

  it("detects commonwealth and applies descriptionCleanup", () => {
    const cba = getTemplateById("commonwealth")!;
    const cleaned = applyTemplateDescriptionCleanup(
      "WOOLWORTHS 123 Value Date: 01/02/2024",
      cba,
    );
    expect(cleaned).not.toMatch(/Value Date/i);
    expect(cleaned).toMatch(/WOOLWORTHS/i);

    const assisted = assistLedgerWithBankTemplate({
      transactions: sample,
      rawText: "Commonwealth Bank NetBank statement",
      rewriteDescriptions: false,
      applyCleanup: true,
    });
    expect(assisted.context.template.id).toBe("commonwealth");
    expect(assisted.context.bankId).toBe("cba");
    expect(assisted.cleaned).toBeGreaterThanOrEqual(1);
    expect(assisted.transactions[0].flags).toEqual(
      expect.arrayContaining(["tpl:commonwealth", "bank:cba"]),
    );
  });

  it("ANZ template uses signed amount layout", () => {
    const ctx = resolveGenerationAssist("ANZ Internet Banking anz.com");
    expect(ctx.template.id).toBe("anz");
    expect(ctx.amountLayout).toBe("signed_amount_balance");
    expect(ctx.columnOrder).toContain("amount");
  });

  it("formats dates by template dateOrder", () => {
    const ctx = resolveGenerationAssist("", { templateId: "chase" });
    // chase is mdy
    expect(ctx.dateOrder).toBe("mdy");
    const d = formatDateForTemplate("2024-03-15", ctx);
    expect(d).toMatch(/03\/15/);
  });

  it("rewrites descriptions with mapped bank generator", () => {
    const assisted = assistLedgerWithBankTemplate({
      transactions: sample,
      rawText: "Westpac Banking Corporation",
      rewriteDescriptions: true,
    });
    expect(assisted.rewritten).toBe(1);
    expect(assisted.transactions[0].description.length).toBeGreaterThan(3);
    expect(assisted.transactions[0].flags).toContain("bank-desc");
  });
});
