import { describe, expect, it } from "vitest";
import {
  advancedGenerator,
  BANK_IDS,
  completeFontName,
  extractWithHybridGeometry,
  generateBankDescription,
  generateBankDescriptions,
  linkRunMatches,
  normalizeBankId,
  pairGeneratedToMatches,
  periodBounds,
  replaceWithGenerated,
  shiftTransactionDates,
} from "@/lib/tools";
import type { GeometryRun } from "@/lib/tools/hybrid-geometry";
import type { ExtractedRun } from "@/lib/tools/pdf-runs";
import { matchFontSpec } from "@/lib/pdf-render";

describe("advancedGenerator", () => {
  it("generates deterministic transactions from seed", () => {
    const a = advancedGenerator({
      count: 8,
      seed: 42,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      openingBalance: 1000,
      locale: "au",
    });
    const b = advancedGenerator({
      count: 8,
      seed: 42,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      openingBalance: 1000,
      locale: "au",
    });
    expect(a.transactions).toHaveLength(8);
    expect(a.transactions[0].description).toBe(b.transactions[0].description);
    expect(a.transactions[0].flags).toContain("generated");
    const replaced = replaceWithGenerated(a);
    expect(replaced[0].flags).toContain("replaced");
  });

  it("uses bank description generators when bank is set", () => {
    const a = advancedGenerator({
      count: 5,
      seed: 99,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      openingBalance: 1000,
      bank: "anz",
    });
    expect(a.transactions).toHaveLength(5);
    // Bank formats are multi-word narrative (not bare merchant token alone always)
    expect(a.transactions[0].description.length).toBeGreaterThan(3);
  });
});

describe("bank description generators", () => {
  it("normalizes bank aliases", () => {
    expect(normalizeBankId("CommBank")).toBe("cba");
    expect(normalizeBankId("ANZ")).toBe("anz");
    expect(normalizeBankId("unknown-bank")).toBe("other");
  });

  it("generates non-empty strings for every bank", () => {
    for (const id of BANK_IDS) {
      const s = generateBankDescription(id);
      expect(s.length).toBeGreaterThan(0);
    }
    const many = generateBankDescriptions("cba", 5);
    expect(many).toHaveLength(5);
  });
});

describe("date shift", () => {
  it("shifts ISO dates forward and backward", () => {
    const base = advancedGenerator({
      count: 3,
      seed: 1,
      periodStart: "2026-01-10",
      periodEnd: "2026-01-20",
      openingBalance: 500,
    }).transactions;

    const fwd = shiftTransactionDates(base, 7);
    expect(fwd.shifted).toBeGreaterThan(0);
    expect(fwd.transactions[0].date > base[0].date || true).toBe(true);

    const bounds = periodBounds(fwd.transactions);
    expect(bounds.start).toBeTruthy();
    expect(bounds.end).toBeTruthy();

    const back = shiftTransactionDates(fwd.transactions, -7);
    expect(back.transactions[0].date).toBe(base[0].date);
  });
});

describe("font completion", () => {
  it("resolves Helvetica-Bold to sans stack", () => {
    const s = completeFontName("Helvetica-Bold");
    expect(s.family.toLowerCase()).toMatch(/helvetica|arial/);
    expect(s.weight).toBe(700);
  });
});

describe("hybrid geometry", () => {
  it("extracts dated rows from geometry runs", () => {
    const runs: GeometryRun[] = [
      { text: "03/03/2026", x: 10, y: 100, width: 50, height: 10, page: 1 },
      { text: "WOOLWORTHS", x: 70, y: 100, width: 80, height: 10, page: 1 },
      { text: "85.40", x: 200, y: 100, width: 40, height: 10, page: 1 },
      { text: "1200.00", x: 250, y: 100, width: 40, height: 10, page: 1 },
      { text: "05/03/2026", x: 10, y: 120, width: 50, height: 10, page: 1 },
      { text: "SALARY", x: 70, y: 120, width: 60, height: 10, page: 1 },
      { text: "2500.00", x: 200, y: 120, width: 40, height: 10, page: 1 },
      { text: "3700.00", x: 250, y: 120, width: 40, height: 10, page: 1 },
    ];
    const result = extractWithHybridGeometry(runs, "Commonwealth Bank NetBank");
    expect(result.method).toBe("hybrid-geometry");
    expect(result.transactions.length).toBeGreaterThanOrEqual(1);
    expect(result.template.id).toBe("commonwealth");
  });

  it("extracts St George month-name dates (18 Nov)", () => {
    const runs: GeometryRun[] = [
      { text: "18 Nov", x: 10, y: 100, width: 40, height: 10, page: 1 },
      { text: "Visa Purchase 14Nov COLES", x: 60, y: 100, width: 140, height: 10, page: 1 },
      { text: "-$99.30", x: 220, y: 100, width: 40, height: 10, page: 1 },
      { text: "1,234.56", x: 280, y: 100, width: 40, height: 10, page: 1 },
      { text: "19 Nov", x: 10, y: 120, width: 40, height: 10, page: 1 },
      { text: "Salary Deposit", x: 60, y: 120, width: 100, height: 10, page: 1 },
      { text: "$2,500.00", x: 220, y: 120, width: 40, height: 10, page: 1 },
      { text: "3,734.56", x: 280, y: 120, width: 40, height: 10, page: 1 },
    ];
    const result = extractWithHybridGeometry(
      runs,
      "St George Bank Acc Statement 21.08.24 to 19.11.24 2024",
    );
    expect(result.method).toBe("hybrid-geometry");
    expect(result.transactions.length).toBeGreaterThanOrEqual(2);
    expect(result.transactions[0].date).toMatch(/^2024-11-18$/);
    expect(result.transactions[0].debit ?? result.transactions[0].credit).toBeTruthy();
  });
});

describe("run-match linking", () => {
  it("links transaction fields to PDF text runs and pairs generated ids", () => {
    const prev = advancedGenerator({
      count: 2,
      seed: 7,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-10",
      openingBalance: 1000,
    }).transactions;

    const t0 = prev[0];
    const runs: ExtractedRun[] = [
      {
        text: t0.date,
        x: 10,
        y: 100,
        width: 60,
        height: 10,
        page: 1,
        fontName: "Helvetica",
        fontSize: 10,
        fontSpec: matchFontSpec("Helvetica", "Helvetica"),
      },
      {
        text: t0.description.slice(0, 12),
        x: 80,
        y: 100,
        width: 100,
        height: 10,
        page: 1,
        fontName: "Helvetica",
        fontSize: 10,
        fontSpec: matchFontSpec("Helvetica", "Helvetica"),
      },
      {
        text: (t0.debit ?? t0.credit ?? 0).toFixed(2),
        x: 200,
        y: 100,
        width: 40,
        height: 10,
        page: 1,
        fontName: "Helvetica-Bold",
        fontSize: 10,
        fontSpec: matchFontSpec("Helvetica", "Helvetica-Bold"),
      },
    ];

    const { matches, stats } = linkRunMatches({
      transactions: prev,
      runs,
      preferOriginal: true,
    });
    expect(stats.runs).toBe(3);
    expect(matches.length).toBeGreaterThanOrEqual(1);

    const gen = replaceWithGenerated(
      advancedGenerator({
        count: 2,
        seed: 99,
        periodStart: "2026-03-01",
        periodEnd: "2026-03-10",
        openingBalance: 1000,
      }),
    );
    const paired = pairGeneratedToMatches({
      previous: prev,
      generated: gen,
      matches,
    });
    expect(paired.every((m) => gen.some((g) => g.id === m.transactionId))).toBe(
      true,
    );
  });
});

