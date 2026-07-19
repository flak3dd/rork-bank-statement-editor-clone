import { describe, expect, it } from "vitest";
import {
  BANK_TEMPLATES,
  DEFAULT_DOCUMENT_PARSER,
  detectBankTemplate,
  isDocumentParserId,
  lineItemsToTransactions,
  listDocumentParsers,
  parseSimpleYaml,
} from "@/lib/parsers";

describe("document parser registry", () => {
  it("lists all six parsers with Mindee as default", () => {
    const list = listDocumentParsers();
    expect(list.map((p) => p.id)).toEqual([
      "mindee",
      "llamaparse",
      "google-docai",
      "pymupdf",
      "local-ocr",
      "offline-heuristic",
    ]);
    expect(DEFAULT_DOCUMENT_PARSER).toBe("mindee");
    expect(list.find((p) => p.id === "mindee")?.default).toBe(true);
    expect(isDocumentParserId("mindee")).toBe(true);
    expect(isDocumentParserId("nope")).toBe(false);
  });
});

describe("bank YAML templates", () => {
  it("loads templates from YAML", () => {
    expect(BANK_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const ids = BANK_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("generic");
    expect(ids).toContain("commonwealth");
    expect(ids).toContain("chase");
  });

  it("detects CommBank from text", () => {
    const t = detectBankTemplate(
      "Commonwealth Bank of Australia\nNetBank Statement\n03/03/2026 WOOLWORTHS 10.00",
    );
    expect(t.id).toBe("commonwealth");
    expect(t.dateOrder).toBe("dmy");
  });

  it("detects Chase (US mdy)", () => {
    const t = detectBankTemplate("JPMorgan Chase Bank\nchase.com\n03/12/2026 PURCHASE");
    expect(t.id).toBe("chase");
    expect(t.dateOrder).toBe("mdy");
  });

  it("falls back to generic", () => {
    const t = detectBankTemplate("random pdf without bank markers");
    expect(t.id).toBe("generic");
  });
});

describe("yaml-mini", () => {
  it("parses maps and lists", () => {
    const obj = parseSimpleYaml(`
id: demo
name: Demo Bank
match:
  - Demo
  - DEMO BANK
dateOrder: dmy
columnOrder:
  - date
  - description
  - debit
`);
    expect(obj.id).toBe("demo");
    expect(obj.match).toEqual(["Demo", "DEMO BANK"]);
    expect(obj.columnOrder).toEqual(["date", "description", "debit"]);
  });
});

describe("normalize line items", () => {
  it("maps API rows to transactions", () => {
    const txns = lineItemsToTransactions([
      {
        date: "03/03/2026",
        description: "WOOLWORTHS",
        debit: "85.40",
        balance: "1200.00",
      },
      {
        date: "2026-03-05",
        description: "SALARY",
        credit: 2500,
        balance: 3700,
      },
    ]);
    expect(txns.length).toBe(2);
    expect(txns[0].debit).toBe(85.4);
    expect(txns[1].credit).toBe(2500);
    expect(txns[0].original).toBeDefined();
  });
});
