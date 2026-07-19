/**
 * Final statement regeneration script (run as test).
 *
 * npm run regen:final
 * npx vitest run src/test/final-statement-regen.test.ts
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  analyzeGenerationQuality,
  defaultStatementConfig,
  generateStatement,
  ledgerToAppTransactions,
  ledgerToCsv,
  normalizeStatementConfig,
  runStressSuite,
  type StatementConfig,
} from "@/lib/statement-gen";
import {
  BANK_IDS,
  generateBankDescription,
  generateBankDescriptions,
  type BankId,
} from "@/lib/tools/bank-descriptions";

const OUT_DIR = resolve(process.cwd(), "scripts/.final-regen");
const BANKS: BankId[] = [
  "anz",
  "cba",
  "westpac",
  "ing",
  "bankwest",
  "suncorp",
  "macquarie",
  "other",
];

function makeConfig(
  bank: BankId,
  seed: number,
  overrides: Partial<StatementConfig> = {},
): StatementConfig {
  return normalizeStatementConfig({
    ...defaultStatementConfig(),
    seed,
    periodStart: "2026-03-01",
    periodDays: 31,
    salaryDescription: `${bank.toUpperCase()} PAYROLL CREDIT`,
    salaryAmount: 3850,
    salaryFrequency: "fortnightly",
    salaryAccount: "PAYROLL",
    hasRentalIncome: bank === "cba" || bank === "anz",
    rentalAmount: bank === "cba" || bank === "anz" ? 650 : 0,
    rentalDescription: "RENTAL INCOME",
    savingsDescription: "TRANSFER TO BONUS SAVER",
    savingsAmount: 250,
    savingsFrequency: "fortnightly",
    savingsAccount: "BONUS",
    mortgageDescription: "HOME LOAN REPAYMENT",
    mortgageLender: "HOME LENDER",
    mortgageAmount: 1680,
    mortgageFrequency: "monthly",
    loanReference: `LN-${bank}-${seed}`,
    cardLast4: String(4000 + (seed % 5000)).slice(0, 4),
    cardSpendPct: 26,
    billsSubsPct: 20,
    billSpendMultiplier: 1,
    hasDirectDebits: true,
    hasSubscriptions: true,
    account: {
      ...defaultStatementConfig().account,
      holderName: `Regen Customer ${bank.toUpperCase()}`,
      accountName: "Everyday Transaction Account",
      brandLabel: `${bank.toUpperCase()} Demo Bank`,
      bsb: "062-000",
      accountNumber: String(10000000 + seed),
      customerID: `CUS-${bank}-${seed}`,
      interestRate: 0.05,
      branch: "Main Branch",
      timezone: "Australia/Sydney",
    },
    address: {
      addressLine1: "12 Sample Street",
      addressLine2: "",
      addressStreet: "12 Sample Street",
      addressCity: "Sydney NSW 2000",
    },
    entity: {
      entityName: "Statement Demo Bank Pty Ltd",
      entityAddress: "100 Demo Tower",
      entityCity: "Sydney",
      entityState: "NSW",
      entityCountry: "Australia",
    },
    ...overrides,
  });
}

/** After generation, rewrite descriptions with bank generators (table path). */
function rewriteDescriptionsWithBank(
  result: ReturnType<typeof generateStatement>,
  bank: BankId,
) {
  const descs = generateBankDescriptions(bank, result.rows.length);
  let di = 0;
  const rows = result.rows.map((r) => {
    if (r.type === "opening" || r.type === "closing") return r;
    if (r.type === "credit" && r.category === "Wages") return r; // keep salary label
    const next = { ...r, description: descs[di % descs.length] };
    di += 1;
    return next;
  });
  return { ...result, rows };
}

describe("final statement regeneration", () => {
  it("regenerates multi-bank statements, quality-checks, exports artefacts", () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const t0 = Date.now();
    const report: {
      startedAt: string;
      banks: string[];
      cases: Array<Record<string, unknown>>;
      stress: ReturnType<typeof runStressSuite>;
      pymupdf?: Record<string, unknown>;
      perfect: boolean;
      durationMs: number;
    } = {
      startedAt: new Date().toISOString(),
      banks: BANKS,
      cases: [],
      stress: runStressSuite(80, 7777),
      perfect: true,
      durationMs: 0,
    };

    expect(report.stress.perfect).toBe(true);
    expect(report.stress.failed).toBe(0);

    for (const bank of BANKS) {
      const seed = 9000 + BANK_IDS.indexOf(bank) * 13;
      const config = makeConfig(bank, seed);
      const generated = generateStatement(config);
      const quality = analyzeGenerationQuality(generated, config);

      expect(quality.ok, `${bank} quality fail: ${JSON.stringify(quality.checks.filter((c) => c.severity === "error"))}`).toBe(true);

      // Bank description rewrite (table) + keep balance chain
      const rewritten = rewriteDescriptionsWithBank(generated, bank);
      // balances unchanged by description-only rewrite
      for (let i = 0; i < generated.rows.length; i++) {
        expect(rewritten.rows[i].balance).toBe(generated.rows[i].balance);
        expect(rewritten.rows[i].amount).toBe(generated.rows[i].amount);
      }

      const q2 = analyzeGenerationQuality(
        { ...rewritten, config },
        config,
      );
      // salary check may warn if description changed — structure/balances must pass
      expect(q2.validation.balanceConsistent).toBe(true);
      expect(q2.validation.chronological).toBe(true);
      expect(q2.validation.ok).toBe(true);

      const txns = ledgerToAppTransactions(rewritten.rows);
      const csv = ledgerToCsv(rewritten.rows);
      const base = `statement-${bank}-${seed}`;

      writeFileSync(resolve(OUT_DIR, `${base}.csv`), csv, "utf8");
      writeFileSync(
        resolve(OUT_DIR, `${base}.json`),
        JSON.stringify(
          {
            bank,
            seed,
            config,
            summary: rewritten.summary,
            periodEnd: rewritten.periodEnd,
            quality: {
              score: quality.score,
              grade: quality.grade,
              ok: quality.ok,
            },
            qualityAfterRewrite: {
              score: q2.score,
              grade: q2.grade,
              ok: q2.ok,
            },
            rows: rewritten.rows,
            appTransactions: txns,
            sampleDescriptions: rewritten.rows
              .filter((r) => r.type !== "opening" && r.type !== "closing")
              .slice(0, 5)
              .map((r) => r.description),
          },
          null,
          2,
        ),
        "utf8",
      );

      report.cases.push({
        bank,
        seed,
        rows: rewritten.rows.length,
        transactions: rewritten.summary.transactionCount,
        opening: rewritten.summary.openingBalance,
        closing: rewritten.summary.closingBalance,
        credits: rewritten.summary.totalCredits,
        debits: rewritten.summary.totalDebits,
        qualityScore: quality.score,
        qualityGrade: quality.grade,
        qualityOk: quality.ok,
        afterRewriteOk: q2.validation.ok,
        sampleDesc: generateBankDescription(bank),
      });

      if (!quality.ok || !q2.validation.ok) report.perfect = false;
    }

    // Native PyMuPDF replace on fixture (if Python + pymupdf available)
    const repoRoot = resolve(process.cwd(), "..");
    const fixture = resolve(
      repoRoot,
      "tools/pymupdf_pipeline/fixtures/sample-statement.pdf",
    );
    const pyScript = resolve(
      repoRoot,
      "tools/pymupdf_pipeline/replace_statement.py",
    );
    if (existsSync(fixture) && existsSync(pyScript)) {
      const outPdf = resolve(OUT_DIR, "sample-anz-replaced.pdf");
      const py = spawnSync(
        "python3",
        [
          pyScript,
          "--pdf",
          fixture,
          "--bank",
          "anz",
          "--seed",
          "42",
          "--replace",
          "descriptions",
          "--out",
          outPdf,
          "--audit",
          resolve(OUT_DIR, "sample-anz-replaced.audit.json"),
        ],
        { encoding: "utf8", cwd: repoRoot },
      );
      report.pymupdf = {
        status: py.status,
        ok: py.status === 0 && existsSync(outPdf),
        stdout: (py.stdout || "").slice(0, 500),
        stderr: (py.stderr || "").slice(0, 300),
        outPdf: existsSync(outPdf) ? outPdf : null,
      };
      if (py.status !== 0) {
        // non-fatal for JS regen path, but flag
        report.perfect = report.perfect && false;
      }
    } else {
      report.pymupdf = { skipped: true, reason: "fixture or script missing" };
    }

    report.durationMs = Date.now() - t0;
    report.perfect = report.perfect && report.stress.perfect;

    writeFileSync(
      resolve(OUT_DIR, "FINAL_REGEN_REPORT.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );

    const md = [
      "# Final statement regeneration report",
      "",
      `- Started: ${report.startedAt}`,
      `- Duration: ${report.durationMs}ms`,
      `- Perfect: **${report.perfect}**`,
      `- Stress suite: ${report.stress.passed}/${report.stress.n} · ${report.stress.totalRows} rows`,
      `- Banks: ${report.banks.join(", ")}`,
      "",
      "## Per-bank cases",
      "",
      "| Bank | Seed | Txns | Close | Quality | Rewrite |",
      "|------|------|------|-------|---------|---------|",
      ...report.cases.map(
        (c) =>
          `| ${c.bank} | ${c.seed} | ${c.transactions} | ${c.closing} | ${c.qualityGrade} ${c.qualityScore} | ${c.afterRewriteOk ? "ok" : "FAIL"} |`,
      ),
      "",
      "## PyMuPDF",
      "",
      "```json",
      JSON.stringify(report.pymupdf, null, 2),
      "```",
      "",
      `Artefacts written to \`${OUT_DIR}\``,
      "",
    ].join("\n");

    writeFileSync(resolve(OUT_DIR, "FINAL_REGEN_REPORT.md"), md, "utf8");

    // Console summary for the operator
    // eslint-disable-next-line no-console
    console.log(md);

    expect(report.perfect).toBe(true);
    expect(report.cases).toHaveLength(BANKS.length);
  });
});
