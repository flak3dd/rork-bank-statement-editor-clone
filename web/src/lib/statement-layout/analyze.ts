/**
 * Step 1 — Perfect three-part statement layout analysis.
 *
 * Maps page content into:
 *   Part 1 static (unchanged base)
 *   Part 2 header/footer variables
 *   Part 3 transaction table
 * Then Step 2 builds a bank transaction structure profile from Part 3 samples.
 */
import { categorizeDescription } from "@/lib/categorize";
import { parseAmount } from "@/lib/money";
import { classifyDocument } from "@/lib/perfect-replacement/classify";
import type { Transaction } from "@/lib/types";
import {
  getPageTextRunsFromBytes,
  type ExtractedRun,
} from "@/lib/tools/pdf-runs";
import { classifyRun, type ClassifyContext } from "./classify-runs";
import { buildTxnStructureProfile } from "./txn-structure";
import type {
  AnalyzeLayoutOptions,
  HeaderFooterVariables,
  LayoutRun,
  StatementLayoutAnalysis,
  StaticLayer,
  TransactionTableLayer,
  TransactionTableRow,
} from "./types";

const MONTH =
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

function uid(prefix: string, i: number): string {
  return `${prefix}-${i}`;
}

function detectTableHeaderY(runs: ExtractedRun[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of runs) {
    const t = r.text.trim().toLowerCase();
    if (t === "date" || t === "transaction" || t === "description") {
      const prev = map.get(r.page);
      if (prev == null || r.y > prev) map.set(r.page, r.y);
    }
  }
  // Prefer the row that also has Amount/Balance nearby
  for (const r of runs) {
    const t = r.text.trim().toLowerCase();
    if (t === "amount" || t === "balance") {
      const d = map.get(r.page);
      if (d != null && Math.abs(r.y - d) < 20) {
        map.set(r.page, Math.max(d, r.y));
      }
    }
  }
  return map;
}

function median(nums: number[]): number | undefined {
  if (!nums.length) return undefined;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function parseDateToken(raw: string, yearHint: number): string | null {
  const t = raw.trim();
  // 18 Nov / 18 Nov 2024
  const mmm = t.match(
    new RegExp(String.raw`^(\d{1,2})\s+(${MONTH})[a-z]*(?:\s+(\d{2,4}))?$`, "i"),
  );
  if (mmm) {
    const day = mmm[1].padStart(2, "0");
    const mon = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ].indexOf(mmm[2].slice(0, 3).toLowerCase());
    if (mon < 0) return null;
    let year = mmm[3] ? Number(mmm[3]) : yearHint;
    if (year < 100) year += 2000;
    return `${year}-${String(mon + 1).padStart(2, "0")}-${day}`;
  }
  const dmy = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    return `${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  const long = t.match(
    new RegExp(
      String.raw`^(\d{1,2})[-\s](${MONTH})[a-z]*[-\s](\d{2,4})$`,
      "i",
    ),
  );
  if (long) {
    const day = long[1].padStart(2, "0");
    const mon = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ].indexOf(long[2].slice(0, 3).toLowerCase());
    if (mon < 0) return null;
    let year = Number(long[3]);
    if (year < 100) year += 2000;
    return `${year}-${String(mon + 1).padStart(2, "0")}-${day}`;
  }
  return null;
}

function yearHintFromText(text: string): number {
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  return years.length ? years[years.length - 1] : new Date().getUTCFullYear();
}

/**
 * Cluster transaction-table runs into rows: date anchors + attached desc/amounts.
 */
function buildTransactionRows(
  runs: LayoutRun[],
  yearHint: number,
): TransactionTableRow[] {
  const txnRuns = runs
    .filter((r) => r.part === "transaction_table")
    .sort((a, b) =>
      a.page !== b.page ? a.page - b.page : a.y - b.y || a.x - b.x,
    );

  const dateRuns = txnRuns.filter((r) => r.role === "txn_date");
  const rows: TransactionTableRow[] = [];

  // If no explicit date roles, try any date-looking text in table part
  const anchors =
    dateRuns.length > 0
      ? dateRuns
      : txnRuns.filter((r) =>
          parseDateToken(r.text, yearHint),
        );

  const used = new Set<string>();

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    if (used.has(anchor.id)) continue;
    const next = anchors[i + 1];
    const y0 = anchor.y;
    const y1 =
      next && next.page === anchor.page
        ? next.y - 1
        : y0 + 48; // multi-line window

    const band = txnRuns.filter(
      (r) =>
        r.page === anchor.page &&
        r.y >= y0 - 2 &&
        r.y <= y1 &&
        !used.has(r.id),
    );

    for (const r of band) used.add(r.id);

    const dateRaw = anchor.text.trim();
    const dateIso = parseDateToken(dateRaw, yearHint);

    const moneyRuns = band
      .filter(
        (r) =>
          r.role === "txn_amount" ||
          r.role === "txn_debit" ||
          r.role === "txn_credit" ||
          r.role === "txn_balance" ||
          /^-?\$?[\d,]+\.\d{2}$/.test(r.text.replace(/\s/g, "")),
      )
      .sort((a, b) => a.x - b.x);

    let debit: number | null = null;
    let credit: number | null = null;
    let amount: number | null = null;
    let balance: number | null = null;

    if (moneyRuns.length >= 2) {
      const left = parseAmount(moneyRuns[0].text);
      const right = parseAmount(moneyRuns[moneyRuns.length - 1].text);
      balance = right != null ? Math.abs(right) : null;
      if (left != null) {
        const raw = moneyRuns[0].text;
        if (/^\s*-/.test(raw) || raw.includes("-$") || left < 0) {
          debit = Math.abs(left);
          amount = -Math.abs(left);
        } else {
          credit = Math.abs(left);
          amount = Math.abs(left);
        }
      }
    } else if (moneyRuns.length === 1) {
      const v = parseAmount(moneyRuns[0].text);
      if (v != null) {
        amount = v;
        if (v < 0 || /^-/.test(moneyRuns[0].text)) debit = Math.abs(v);
        else credit = Math.abs(v);
      }
    }

    const descRuns = band
      .filter(
        (r) =>
          r.role === "txn_description_primary" ||
          r.role === "txn_description_secondary" ||
          r.role === "txn_reference" ||
          (r.role === "unknown" && r.x < 360),
      )
      .filter((r) => r.id !== anchor.id);

    // Also include non-money non-date text in band as description
    const extraDesc = band.filter(
      (r) =>
        !moneyRuns.includes(r) &&
        r.id !== anchor.id &&
        !/^-?\$?[\d,]+\.\d{2}$/.test(r.text.replace(/\s/g, "")) &&
        !parseDateToken(r.text.trim(), yearHint),
    );
    // PDF.js viewport transform: y increases downward → smaller y = higher on page
    const allDesc = [
      ...new Map(
        [...descRuns, ...extraDesc].map((r) => [r.id, r]),
      ).values(),
    ].sort((a, b) => a.y - b.y || a.x - b.x);

    const primaryLine = allDesc[0]?.text.trim() ?? "";
    const secondaryLines: string[] = [];
    const referenceLines: string[] = [];
    for (let d = 1; d < allDesc.length; d++) {
      const t = allDesc[d].text.trim();
      if (/^[\d*]{6,}$/.test(t.replace(/\s/g, ""))) referenceLines.push(t);
      else secondaryLines.push(t);
    }

    const description = [primaryLine, ...secondaryLines, ...referenceLines]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const structureTags: string[] = [];
    if (secondaryLines.length) structureTags.push("multi-line");
    if (referenceLines.length) structureTags.push("has-reference");
    if (/\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(primaryLine)) {
      structureTags.push("embedded-date");
    }
    if (/^visa\b/i.test(primaryLine)) structureTags.push("visa");
    if (/^osko\b/i.test(primaryLine)) structureTags.push("osko");
    if (/interbank/i.test(description)) structureTags.push("interbank");

    rows.push({
      index: rows.length,
      page: anchor.page,
      y: y0,
      dateRaw,
      dateIso,
      description: description || primaryLine || "Transaction",
      primaryLine: primaryLine || description,
      secondaryLines,
      referenceLines,
      debit,
      credit,
      amount,
      balance,
      runs: band,
      structureTags,
    });
  }

  return rows;
}

function clusterColumnXs(rows: TransactionTableRow[]): TransactionTableLayer["columns"] {
  const dateXs: number[] = [];
  const descXs: number[] = [];
  const amtXs: number[] = [];
  const balXs: number[] = [];
  for (const row of rows) {
    for (const r of row.runs) {
      if (r.role === "txn_date") dateXs.push(r.x);
      if (
        r.role === "txn_description_primary" ||
        r.role === "txn_description_secondary"
      ) {
        descXs.push(r.x);
      }
      if (r.role === "txn_amount" || r.role === "txn_debit" || r.role === "txn_credit") {
        amtXs.push(r.x);
      }
      if (r.role === "txn_balance") balXs.push(r.x);
    }
    // fallback from money sort
    const monies = row.runs
      .filter((r) => /^-?\$?[\d,]+\.\d{2}$/.test(r.text.replace(/\s/g, "")))
      .sort((a, b) => a.x - b.x);
    if (monies.length >= 2) {
      amtXs.push(monies[0].x);
      balXs.push(monies[monies.length - 1].x);
    }
  }
  return {
    dateX: median(dateXs),
    descriptionX: median(descXs),
    amountX: median(amtXs),
    balanceX: median(balXs),
  };
}

function extractHeaderFields(
  runs: LayoutRun[],
  rawText: string,
): HeaderFooterVariables["fields"] {
  const fields: HeaderFooterVariables["fields"] = {
    addressLines: [],
  };
  const vars = runs.filter((r) => r.part === "header_footer_vars");

  const identities = vars
    .filter((r) => r.role === "var_identity")
    .sort((a, b) => a.y - b.y);
  if (identities[0]) fields.holderName = identities[0].text.trim();

  fields.addressLines = vars
    .filter((r) => r.role === "var_address")
    .sort((a, b) => a.y - b.y)
    .map((r) => r.text.trim());

  const bsb = vars.find((r) => r.role === "var_bsb");
  if (bsb) fields.bsb = bsb.text.trim();

  const acct = vars.find((r) => r.role === "var_account");
  if (acct) {
    const t = acct.text.trim();
    // "116-879   453 657 726"
    const m = t.match(/(\d{3}[-\s]?\d{3})\s+(.+)/);
    if (m) {
      fields.bsb = fields.bsb || m[1].replace(/\s/g, "-");
      fields.accountNumber = m[2].trim();
    } else {
      fields.accountNumber = t;
    }
  }

  const bal = vars.find((r) => r.role === "var_balance_summary");
  if (bal) fields.currentBalance = parseAmount(bal.text);

  const opened = vars.find((r) => r.role === "var_opened");
  if (opened) fields.accountOpened = opened.text.trim();

  const created = vars.find((r) => r.role === "var_created");
  if (created) fields.dateCreated = created.text.trim();

  // Period from raw text
  const period = rawText.match(
    /\((\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{2,4})\s+to\s+(\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{2,4})\)/i,
  );
  if (period) {
    fields.periodStart = period[1];
    fields.periodEnd = period[2];
  }
  const days = rawText.match(/last\s+(\d+)\s+days/i);
  if (days) fields.periodDays = Number(days[1]);

  return fields;
}

function rowsToTransactions(rows: TransactionTableRow[]): Transaction[] {
  return rows.map((row, i) => {
    const { category, confidence } = categorizeDescription(
      row.description,
      row.credit,
      row.debit,
    );
    return {
      id: uid("layout-txn", i),
      date: row.dateIso || row.dateRaw || "",
      description: row.description,
      debit: row.debit,
      credit: row.credit,
      balance: row.balance,
      category,
      categorySource: "heuristic" as const,
      categoryConfidence: confidence,
      flags: ["layout-part3", ...row.structureTags.map((t) => `struct:${t}`)],
    };
  });
}

function scoreAnalysis(a: {
  staticCount: number;
  varCount: number;
  txnRows: number;
  pageCount: number;
}): { score: number; gates: StatementLayoutAnalysis["gates"] } {
  const gates: StatementLayoutAnalysis["gates"] = [
    {
      id: "has-static",
      pass: a.staticCount >= 3,
      detail: `${a.staticCount} static run(s)`,
    },
    {
      id: "has-txn-or-shell",
      pass: a.txnRows >= 1 || a.staticCount >= 5,
      detail: `${a.txnRows} txn row(s)`,
    },
    {
      id: "three-parts-present",
      pass: a.staticCount > 0 && (a.varCount > 0 || a.txnRows > 0),
      detail: `static=${a.staticCount} vars=${a.varCount} txns=${a.txnRows}`,
    },
  ];
  let score = 40;
  score += Math.min(25, a.staticCount);
  score += Math.min(15, a.varCount * 2);
  score += Math.min(30, a.txnRows * 2);
  if (gates.every((g) => g.pass)) score = Math.max(score, 70);
  return { score: Math.min(100, score), gates };
}

/**
 * Analyze PDF bytes into the three-part layout model + txn structure profile.
 */
export async function analyzeStatementLayout(
  pdfBytes: Uint8Array,
  options: AnalyzeLayoutOptions = {},
): Promise<StatementLayoutAnalysis> {
  const t0 = Date.now();
  const maxPages = options.maxPages ?? 12;
  const extracted = await getPageTextRunsFromBytes(pdfBytes, maxPages);
  const rawText =
    options.rawText ||
    extracted
      .map((r) => r.text)
      .join("\n");

  const pageCount = extracted.reduce((m, r) => Math.max(m, r.page), 0) || 1;
  const tableHeaderYByPage = detectTableHeaderY(extracted);
  // PDF.js y increases upward — footer is low y. Use 15th percentile as footer band.
  const ys = extracted.map((r) => r.y).sort((a, b) => a - b);
  const footerYThreshold =
    ys.length > 0 ? ys[Math.floor(ys.length * 0.08)] : 80;
  // Actually for PDF.js bottom-left, footer has SMALL y. Header has LARGE y.
  // Table header detection uses same system. "inFooter = y >= threshold" in classify
  // was written for top-down MuPDF. Need to adapt.

  // Detect coordinate system: if "Complete Freedom" / title has high y → PDF bottom-left
  const title = extracted.find((r) => /complete freedom/i.test(r.text));
  const legal = extracted.find((r) => /abn|credit licence/i.test(r.text));
  const topDown = title && legal ? title.y < legal.y : false;

  const pageHeight = 842;
  const ctx: ClassifyContext = {
    tableHeaderYByPage,
    footerYThreshold: topDown
      ? pageHeight * 0.88
      : ys.length
        ? ys[Math.floor(ys.length * 0.12)]
        : 100,
    pageHeight,
  };

  // Fix classify for PDF.js: footer is LOW y when not topDown
  const runs: LayoutRun[] = extracted.map((r, i) => {
    let classed = classifyRun(
      {
        page: r.page,
        text: r.text,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        fontName: r.fontName,
        fontSize: r.fontSize,
      },
      ctx,
    );

    // Coordinate-aware footer correction for PDF.js (y up)
    if (!topDown && r.y < ctx.footerYThreshold) {
      const t = r.text.trim();
      if (/^\d+$/.test(t) || /^page$/i.test(t) || /^of$/i.test(t)) {
        classed = {
          part: "header_footer_vars",
          role: "var_page",
          confidence: 0.75,
        };
      } else if (/\d{1,2}[-\s][A-Za-z]{3}/.test(t) && /am|pm|:/.test(t)) {
        classed = {
          part: "header_footer_vars",
          role: "var_created",
          confidence: 0.8,
        };
      } else if (/date created/i.test(t)) {
        classed = {
          part: "static",
          role: "static_label",
          confidence: 0.85,
        };
      } else if (/abn|afsl|licence|corporation/i.test(t)) {
        classed = {
          part: "static",
          role: "static_legal",
          confidence: 0.92,
        };
      }
    }

    // Header zone for PDF.js: high Y
    if (!topDown) {
      const headerY = tableHeaderYByPage.get(r.page);
      if (headerY != null && r.y > headerY + 5) {
        // above table in PDF space = larger y
        const t = r.text.trim();
        if (
          classed.part === "transaction_table" &&
          !/^-?\$?[\d,]+\.\d{2}$/.test(t.replace(/\s/g, ""))
        ) {
          // misclassified — leave
        }
      }
      // Table body is BELOW header in visual terms = SMALLER y than header in PDF.js
      if (headerY != null && r.y < headerY - 2) {
        const t = r.text.trim();
        const isDate = parseDateToken(t, yearHintFromText(rawText));
        const isMoney = /^-?\$?[\d,]+\.\d{2}$/.test(t.replace(/\s/g, ""));
        if (isDate) {
          classed = {
            part: "transaction_table",
            role: "txn_date",
            confidence: 0.9,
          };
        } else if (isMoney) {
          classed = {
            part: "transaction_table",
            role: r.x > 450 ? "txn_balance" : "txn_amount",
            confidence: 0.8,
          };
        } else if (
          t.length > 2 &&
          r.x < 400 &&
          !/^(date|transaction|amount|balance)$/i.test(t) &&
          r.y > ctx.footerYThreshold
        ) {
          classed = {
            part: "transaction_table",
            role: "txn_description_primary",
            confidence: 0.65,
          };
        }
      }
    }

    return {
      id: uid("run", i),
      page: r.page,
      text: r.text,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      fontName: r.fontName,
      fontSize: r.fontSize,
      part: classed.part,
      role: classed.role,
      confidence: classed.confidence,
    };
  });

  // Refine secondary descriptions: runs slightly below a date anchor
  const yearHint = yearHintFromText(rawText);
  const dateAnchors = runs.filter((r) => r.role === "txn_date");
  for (const r of runs) {
    if (r.part !== "transaction_table") continue;
    if (r.role !== "txn_description_primary") continue;
    const parent = dateAnchors.find(
      (d) =>
        d.page === r.page &&
        r.y < d.y && // below in PDF.js
        d.y - r.y < 20 &&
        d.y - r.y > 2,
    );
    if (parent) {
      r.role = "txn_description_secondary";
    }
  }

  const staticRuns = runs.filter((r) => r.part === "static");
  const varRuns = runs.filter((r) => r.part === "header_footer_vars");
  const txnRuns = runs.filter((r) => r.part === "transaction_table");

  const part1: StaticLayer = {
    runs: staticRuns,
    labels: [
      ...new Set(
        staticRuns
          .filter((r) => r.role === "static_label" || r.role === "table_header")
          .map((r) => r.text.trim())
          .filter(Boolean),
      ),
    ],
    legalLines: staticRuns
      .filter((r) => r.role === "static_legal")
      .map((r) => r.text.trim()),
    notes: [
      `${staticRuns.length} static run(s) — base layer, keep unchanged on replica.`,
    ],
  };

  const fields = extractHeaderFields(runs, rawText);
  const slots: HeaderFooterVariables["slots"] = {};
  for (const r of varRuns) {
    const list = slots[r.role] ?? [];
    list.push(r);
    slots[r.role] = list;
  }
  const part2: HeaderFooterVariables = {
    runs: varRuns,
    fields,
    slots,
    notes: [
      `${varRuns.length} header/footer variable run(s).`,
      fields.holderName ? `holder=${fields.holderName}` : "holder unresolved",
    ],
  };

  const tableRows = buildTransactionRows(runs, yearHint);
  // Rebuild description from runs in visual reading order (PDF.js: y down)
  for (const row of tableRows) {
    const texts = row.runs
      .filter(
        (r) =>
          !/^-?\$?[\d,]+\.\d{2}$/.test(r.text.replace(/\s/g, "")) &&
          r.role !== "txn_date" &&
          r.text.trim().length > 0,
      )
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (texts.length) {
      row.primaryLine = texts[0].text.trim();
      row.secondaryLines = texts
        .slice(1)
        .filter((r) => !/^[\d*]{6,}$/.test(r.text.replace(/\s/g, "")))
        .map((r) => r.text.trim());
      row.referenceLines = texts
        .filter((r) => /^[\d*]{6,}$/.test(r.text.replace(/\s/g, "")))
        .map((r) => r.text.trim());
      // Join with newline so fragment mapping can split lines
      row.description = [
        row.primaryLine,
        ...row.secondaryLines,
        ...row.referenceLines,
      ]
        .filter(Boolean)
        .join("\n")
        .trim();
    }
  }

  const ysRows = tableRows.map((r) => r.y);
  const pitches: number[] = [];
  for (let i = 1; i < tableRows.length; i++) {
    if (tableRows[i].page === tableRows[i - 1].page) {
      pitches.push(Math.abs(tableRows[i].y - tableRows[i - 1].y));
    }
  }

  const clusteredCols = clusterColumnXs(tableRows);
  let part3: TransactionTableLayer = {
    runs: txnRuns,
    columnOrder: ["date", "description", "amount", "balance"],
    columns: clusteredCols,
    headerY: [...tableHeaderYByPage.values()][0],
    bodyYMin: ysRows.length ? Math.min(...ysRows) : undefined,
    bodyYMax: ysRows.length ? Math.max(...ysRows) : undefined,
    rowPitchMedian: median(pitches),
    rows: tableRows,
    notes: [
      `${tableRows.length} transaction row(s) clustered from geometry.`,
      pitches.length
        ? `median row pitch ≈ ${median(pitches)?.toFixed(1)} pt`
        : "no pitch",
    ],
  };

  const txnStructure = buildTxnStructureProfile({
    rows: tableRows,
    rawText,
    bankHint: options.bankHint ?? options.fileName,
  });

  // St.George Complete Freedom geometry lock (A4, measured column anchors).
  // Measured: table body Y-band ~254–700, row pitch ~36.6, columns date~70 / desc~115 / amount~394 / balance~482.
  if (
    txnStructure.bankId === "st-george" ||
    /st\.?\s*george|complete freedom/i.test(rawText)
  ) {
    const STG = {
      page: { width: 595, height: 842 },
      bodyYMin: 254,
      bodyYMax: 700,
      rowPitch: 36.6,
      columns: {
        dateX: 70,
        descriptionX: 115,
        amountX: 394,
        balanceX: 482,
      },
    } as const;
    const col = part3.columns;
    const near = (a: number | undefined, b: number, tol: number) =>
      a == null || Math.abs(a - b) < tol;
    part3 = {
      ...part3,
      columnOrder: ["date", "description", "amount", "balance"],
      columns: {
        dateX: near(col.dateX, STG.columns.dateX, 40)
          ? (col.dateX ?? STG.columns.dateX)
          : STG.columns.dateX,
        descriptionX: near(col.descriptionX, STG.columns.descriptionX, 50)
          ? (col.descriptionX ?? STG.columns.descriptionX)
          : STG.columns.descriptionX,
        amountX: near(col.amountX, STG.columns.amountX, 50)
          ? (col.amountX ?? STG.columns.amountX)
          : STG.columns.amountX,
        balanceX: near(col.balanceX, STG.columns.balanceX, 50)
          ? (col.balanceX ?? STG.columns.balanceX)
          : STG.columns.balanceX,
      },
      bodyYMin: part3.bodyYMin ?? STG.bodyYMin,
      bodyYMax: part3.bodyYMax ?? STG.bodyYMax,
      rowPitchMedian:
        part3.rowPitchMedian != null &&
        Math.abs(part3.rowPitchMedian - STG.rowPitch) < 12
          ? part3.rowPitchMedian
          : part3.rowPitchMedian ?? STG.rowPitch,
      notes: [
        ...part3.notes,
        "st-george geometry lock: A4 595×842 · body Y≈254–700 · pitch≈36.6 · col anchors date/desc/amount/balance",
      ],
    };
  }

  const transactions = rowsToTransactions(tableRows);
  const docClass = classifyDocument(rawText);
  let documentClass: StatementLayoutAnalysis["documentClass"] = "unknown";
  if (docClass === "token-template") documentClass = "token-template";
  else if (tableRows.length === 0 && staticRuns.length > 10) {
    documentClass = "base-shell";
  } else if (docClass === "filled-statement" || tableRows.length > 0) {
    documentClass = "filled-statement";
  }

  const { score, gates } = scoreAnalysis({
    staticCount: staticRuns.length,
    varCount: varRuns.length,
    txnRows: tableRows.length,
    pageCount,
  });

  const notes = [
    "Step 1: three-part layout map (static | header/footer vars | transaction table).",
    "Step 2: bank transaction structure profile from Part 3 samples.",
    `coordSystem=${topDown ? "top-down" : "pdf-bottom-left"}`,
    `bank=${txnStructure.bankId} structureConf=${txnStructure.confidence.toFixed(2)}`,
    txnStructure.recipe,
  ];

  return {
    version: 1,
    kind: "statement-layout.three-part",
    fileName: options.fileName,
    pageCount,
    pageSize: { width: 595, height: 842 },
    bankHint: txnStructure.bankId,
    documentClass,
    runs,
    part1,
    part2,
    part3,
    txnStructure,
    transactions,
    score,
    gates,
    notes,
    durationMs: Date.now() - t0,
  };
}

/** Summarize analysis for audit / UI. */
export function summarizeLayoutAnalysis(
  a: StatementLayoutAnalysis,
): Record<string, unknown> {
  return {
    kind: a.kind,
    score: a.score,
    documentClass: a.documentClass,
    bank: a.txnStructure.bankId,
    part1_staticRuns: a.part1.runs.length,
    part2_varRuns: a.part2.runs.length,
    part2_fields: a.part2.fields,
    part3_txnRows: a.part3.rows.length,
    part3_pitch: a.part3.rowPitchMedian,
    part3_columns: a.part3.columns,
    structure: {
      recipe: a.txnStructure.recipe,
      multiLine: a.txnStructure.multiLineDescription,
      embedsDate: a.txnStructure.embedsDateInDescription,
      hasRef: a.txnStructure.hasStandaloneReference,
      amountLayout: a.txnStructure.amountLayout,
      patterns: a.txnStructure.descriptionPatterns,
      samples: a.txnStructure.samplePrimaries.slice(0, 5),
    },
    gates: a.gates,
  };
}
