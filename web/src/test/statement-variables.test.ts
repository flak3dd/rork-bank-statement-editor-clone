/**
 * Optional statement variables + Unredacter (NEVER blank redaction).
 */
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyStatementVariableOverrides,
  defaultStatementConfig,
  generateStatement,
  isVariableSet,
  setVariableKeys,
  type StatementVariableOverrides,
} from "@/lib/statement-gen";
import {
  assertNoBlankRedactions,
  unredactStatementVariables,
} from "@/lib/tools/chrome-unredact";
import { applyReplacementsWithFallbacks } from "@/lib/pdf-engines";
import { cloneUint8Array } from "@/lib/bytes";

const PDF_PATH =
  "/Users/adminuser/Downloads/1132%20(2)/698/St George Bank Acc Statement #726 - 21.08.24 to 19.11.24.pdf";

describe("statement variable overrides", () => {
  it("isVariableSet treats empty as unset", () => {
    expect(isVariableSet("")).toBe(false);
    expect(isVariableSet("  ")).toBe(false);
    expect(isVariableSet(null)).toBe(false);
    expect(isVariableSet(undefined)).toBe(false);
    expect(isVariableSet("Jane Doe")).toBe(true);
    expect(isVariableSet(0)).toBe(true);
    expect(isVariableSet(false)).toBe(true);
  });

  it("merge only applies set keys", () => {
    const base = defaultStatementConfig();
    const overrides: StatementVariableOverrides = {
      holderName: "JANE UNREDACT",
      salaryDescription: "PAYROLL ACME CORP",
      salaryAmount: 4444.44,
      salaryFrequency: "weekly",
      hasRentalIncome: true,
      rentalAmount: 800,
      rentalDescription: "RENT FROM 9 SMITH ST",
      mortgageLender: "BIG BANK HOME",
      loanReference: "LN-999",
      // accountName omitted → keep base
    };
    const merged = applyStatementVariableOverrides(base, overrides);
    expect(merged.account.holderName).toBe("JANE UNREDACT");
    expect(merged.account.accountName).toBe(base.account.accountName);
    expect(merged.salaryDescription).toBe("PAYROLL ACME CORP");
    expect(merged.salaryAmount).toBe(4444.44);
    expect(merged.hasRentalIncome).toBe(true);
    expect(merged.rentalAmount).toBe(800);
    expect(merged.mortgageLender).toBe("BIG BANK HOME");
    expect(merged.loanReference).toBe("LN-999");
    expect(setVariableKeys(overrides)).toContain("holderName");
    expect(setVariableKeys(overrides)).not.toContain("accountName");
  });

  it("generation ledger reflects set salary/savings/mortgage variables", () => {
    const base = defaultStatementConfig();
    const config = applyStatementVariableOverrides(base, {
      salaryDescription: "CUSTOM PAYROLL LINE",
      salaryAmount: 5000,
      salaryFrequency: "fortnightly",
      salaryAccount: "EMPLOYER PAY",
      savingsDescription: "TO BONUS SAVER X",
      savingsAmount: 300,
      savingsFrequency: "fortnightly",
      mortgageDescription: "HOME LOAN XYZ",
      mortgageLender: "LENDERCO",
      mortgageAmount: 1600,
      mortgageFrequency: "monthly",
      loanReference: "REF-42",
      hasRentalIncome: true,
      rentalAmount: 650,
      rentalDescription: "RENT INCOME LINE",
    });
    const result = generateStatement(config);
    const descs = result.rows.map((r) => r.description);
    expect(descs.some((d) => d.includes("CUSTOM PAYROLL"))).toBe(true);
    expect(descs.some((d) => d.includes("TO BONUS SAVER"))).toBe(true);
    expect(descs.some((d) => d.includes("HOME LOAN XYZ"))).toBe(true);
    expect(descs.some((d) => d.includes("RENT INCOME"))).toBe(true);
    const salary = result.rows.find((r) =>
      r.description.includes("CUSTOM PAYROLL"),
    );
    expect(salary?.amount).toBe(5000);
    expect(salary?.secondaryDescription).toMatch(/EMPLOYER PAY/);
    const mtg = result.rows.find((r) => r.description.includes("HOME LOAN XYZ"));
    expect(mtg?.secondaryDescription).toMatch(/LENDERCO/);
    expect(mtg?.secondaryDescription).toMatch(/REF-42/);
  });

  it("assertNoBlankRedactions throws on empty inserts", () => {
    expect(() =>
      assertNoBlankRedactions([{ replacement: "ok" }, { replacement: "  " }]),
    ).toThrow(/NEVER REDACT/);
  });
});

describe("Unredacter chrome on real PDF", () => {
  it(
    "injects set identity variables with non-empty replacements only",
    async () => {
      expect(existsSync(PDF_PATH)).toBe(true);
      const pdf = new Uint8Array(readFileSync(PDF_PATH));
      const overrides: StatementVariableOverrides = {
        holderName: "ALEX UNREDACT HOLDER",
        bsb: "062-999",
        accountNumber: "99887766",
        addressLine1: "99 Unredact Avenue",
        salaryDescription: "SHOULD NOT BE CHROME",
      };
      const result = await unredactStatementVariables({
        pdfBytes: cloneUint8Array(pdf),
        overrides,
      });
      expect(result.mode).toBe("unredact");
      // Every edit must have non-empty replacement
      for (const e of result.edits) {
        expect(e.replacement.trim().length).toBeGreaterThan(0);
      }
      assertNoBlankRedactions(result.edits);

      if (result.edits.length > 0) {
        const out = await applyReplacementsWithFallbacks(
          cloneUint8Array(pdf),
          result.edits.map((e) => ({
            page: e.page,
            bbox: e.bbox,
            replacement: e.replacement,
            fontSpec: e.fontSpec,
          })),
        );
        expect(out.byteLength).toBeGreaterThan(100);
        // Must differ from original (text was inserted, not blank redaction)
        const same =
          out.byteLength === pdf.byteLength &&
          out.every((b, i) => b === pdf[i]);
        expect(same).toBe(false);
        const latin = Buffer.from(out).toString("latin1");
        // FreeText content often appears in the stream
        const anyApplied = result.appliedKeys.some((k) => {
          const v = overrides[k as keyof StatementVariableOverrides];
          return typeof v === "string" && latin.includes(v.slice(0, 8));
        });
        expect(anyApplied || out.byteLength !== pdf.byteLength).toBe(true);
      }
    },
    60_000,
  );
});
