/**
 * One-shot analysis: St George TEMPLATE vs real statement #726.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cloneUint8Array } from "@/lib/bytes";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { parseTransactionsHybrid } from "@/lib/parse-transactions";
import { getPageTextRunsFromBytes } from "@/lib/tools/pdf-runs";

const TPL =
  "/Users/adminuser/Desktop/St George Bank TEMPLATE- 21.08.24 to 19.11.24.pdf";
const REAL =
  "/Users/adminuser/Downloads/1132%20(2)/698/St George Bank Acc Statement #726 - 21.08.24 to 19.11.24.pdf";
const OUT = resolve(process.cwd(), "scripts/.template-analysis");

describe("template vs real statement analysis", () => {
  it("extracts both PDFs and writes comparison artefacts", async () => {
    expect(existsSync(TPL), TPL).toBe(true);
    expect(existsSync(REAL), REAL).toBe(true);
    mkdirSync(OUT, { recursive: true });

    async function analyze(label: string, path: string) {
      const bytes = new Uint8Array(readFileSync(path));
      const text = await extractTextFromPdf(cloneUint8Array(bytes));
      const runs = await getPageTextRunsFromBytes(cloneUint8Array(bytes), 10);
      const hybrid = parseTransactionsHybrid(text.text);
      const byPage = new Map<number, number>();
      for (const r of runs) byPage.set(r.page, (byPage.get(r.page) ?? 0) + 1);

      // Find likely placeholder / variable tokens
      const placeholders = [
        ...text.text.matchAll(
          /\{\{[^}]+\}\}|<<[^>]+>>|\[[A-Z_][A-Z0-9_ ]{2,}\]|PLACEHOLDER|TODO|XXXX+|\$\$\$+|##+|<name>|<bsb>|<account>|Account Holder|Customer Name/gi,
        ),
      ].map((m) => m[0]);

      // Header-ish runs: top of page 1 (high Y in PDF.js = often top after transform)
      const p1 = runs.filter((r) => r.page === 1);
      const sortedY = [...p1].sort((a, b) => b.y - a.y || a.x - b.x);

      const report = {
        label,
        path,
        byteLength: bytes.byteLength,
        pageCount: text.pageCount,
        textChars: text.text.length,
        runCount: runs.length,
        runsByPage: Object.fromEntries(byPage),
        txnCount: hybrid.transactions.length,
        sampleTxns: hybrid.transactions.slice(0, 8).map((t) => ({
          date: t.date,
          desc: t.description.slice(0, 70),
          debit: t.debit,
          credit: t.credit,
          bal: t.balance,
        })),
        placeholders: [...new Set(placeholders)].slice(0, 40),
        topPage1Text: sortedY.slice(0, 60).map((r) => ({
          t: r.text,
          x: +r.x.toFixed(1),
          y: +r.y.toFixed(1),
          w: +r.width.toFixed(1),
        })),
        fullText: text.text,
      };
      writeFileSync(resolve(OUT, `${label}.json`), JSON.stringify(report, null, 2));
      writeFileSync(resolve(OUT, `${label}.txt`), text.text);
      // eslint-disable-next-line no-console
      console.log(
        `\n=== ${label} === pages=${text.pageCount} bytes=${bytes.byteLength} runs=${runs.length} txns=${hybrid.transactions.length}`,
      );
      // eslint-disable-next-line no-console
      console.log("--- TEXT ---\n" + text.text.slice(0, 3500));
      return report;
    }

    const tpl = await analyze("template", TPL);
    const real = await analyze("statement", REAL);

    writeFileSync(
      resolve(OUT, "COMPARISON.md"),
      [
        "# St George template vs statement #726",
        "",
        "| | Template | Statement |",
        "|--|----------|:--------:|:---------:|",
        `| Bytes | ${tpl.byteLength} | ${real.byteLength} |`,
        `| Pages | ${tpl.pageCount} | ${real.pageCount} |`,
        `| Text runs | ${tpl.runCount} | ${real.runCount} |`,
        `| Parsed txns | ${tpl.txnCount} | ${real.txnCount} |`,
        `| Text chars | ${tpl.textChars} | ${real.textChars} |`,
        "",
        "## Interpretation",
        "",
        "Template = shell layout / fixed chrome + slots for variables.",
        "Statement = filled instance (same format, real identity + transactions).",
        "",
        "### Template placeholders detected",
        ...(tpl.placeholders.length
          ? tpl.placeholders.map((p) => `- \`${p}\``)
          : ["- (none matched common placeholder patterns — may be blank form fields or sample text)"]),
        "",
        "### Statement sample transactions",
        ...real.sampleTxns.map(
          (t) =>
            `- ${t.date} | ${t.desc} | D:${t.debit ?? "—"} C:${t.credit ?? "—"} B:${t.bal ?? "—"}`,
        ),
        "",
      ].join("\n"),
    );

    expect(tpl.pageCount).toBeGreaterThan(0);
    expect(real.pageCount).toBeGreaterThan(0);
  }, 120_000);
});
