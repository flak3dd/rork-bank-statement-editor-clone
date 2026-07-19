import { buildBalancePreview } from "@/lib/balance-engine";
import { movementOf, moneyEqual } from "@/lib/edit-utils";
import { round2 } from "@/lib/money";
import { buildSummary } from "@/lib/parse-transactions";
import type { Transaction } from "@/lib/types";
import type { ForensicFinding, LayerScore } from "./types";

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function statusFromScore(score: number): LayerScore["status"] {
  if (score >= 88) return "pass";
  if (score >= 70) return "warn";
  return "fail";
}

/** Structural: counts, date coverage, period overlap. */
export function analyzeStructural(
  source: Transaction[],
  working: Transaction[],
): LayerScore {
  const findings: ForensicFinding[] = [];
  const sDates = source.map((t) => t.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const wDates = working.map((t) => t.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const sSet = new Set(sDates);
  const wSet = new Set(wDates);
  let overlap = 0;
  for (const d of wSet) if (sSet.has(d)) overlap += 1;
  const union = new Set([...sSet, ...wSet]).size || 1;
  const dateJaccard = (overlap / union) * 100;

  const countRatio =
    source.length === 0
      ? working.length === 0
        ? 100
        : 40
      : clamp(100 - Math.abs(working.length - source.length) * (100 / Math.max(source.length, 1)));

  if (source.length > 0 && Math.abs(working.length - source.length) > Math.max(2, source.length * 0.25)) {
    findings.push({
      id: "struct-count",
      layer: "structural",
      severity: "material",
      title: "Row count drift vs source",
      detail: `Source ${source.length} rows vs working ${working.length} — generation/edits may have replaced the ledger.`,
    });
  }

  const score = clamp(countRatio * 0.45 + dateJaccard * 0.55);
  return {
    layer: "structural",
    label: "Structural fidelity",
    score: round2(score),
    weight: 0.15,
    status: statusFromScore(score),
    summary: `Count ${working.length}/${source.length} · date Jaccard ${dateJaccard.toFixed(0)}%`,
    findings,
  };
}

/** Quantitative: totals, net, balance chain. */
export function analyzeQuantitative(
  source: Transaction[],
  working: Transaction[],
): LayerScore {
  const findings: ForensicFinding[] = [];
  const sSum = buildSummary(source);
  const wSum = buildSummary(working);

  const totalInDelta = Math.abs(sSum.totalIn - wSum.totalIn);
  const totalOutDelta = Math.abs(sSum.totalOut - wSum.totalOut);
  const scale = Math.max(sSum.totalIn + sSum.totalOut, wSum.totalIn + wSum.totalOut, 1);
  const totalsScore = clamp(100 - ((totalInDelta + totalOutDelta) / scale) * 100);

  const preview = buildBalancePreview(working, "recompute");
  const chainScore =
    working.length === 0
      ? 50
      : clamp(100 - (preview.mismatchCount / Math.max(working.length, 1)) * 100);

  if (preview.mismatchCount > 0) {
    const first = preview.rows.find((r) => r.mismatched);
    findings.push({
      id: "quant-chain",
      layer: "quantitative",
      severity: preview.mismatchCount > 3 ? "critical" : "material",
      title: "Running balance mismatches",
      detail: `${preview.mismatchCount} row(s) fail recompute chain` +
        (first
          ? ` (first: expected ${first.expectedBalance?.toFixed(2)} vs ${first.statedBalance?.toFixed(2)})`
          : ""),
      transactionId: first?.transactionId,
    });
  }

  if (totalInDelta > 0.05 || totalOutDelta > 0.05) {
    findings.push({
      id: "quant-totals",
      layer: "quantitative",
      severity: totalInDelta + totalOutDelta > scale * 0.15 ? "material" : "minor",
      title: "Period totals differ from source",
      detail: `In Δ ${totalInDelta.toFixed(2)} · Out Δ ${totalOutDelta.toFixed(2)} vs source extraction.`,
    });
  }

  // Amount realism: fraction of non-round amounts in working
  const moneyRows = working.filter((t) => (t.debit ?? t.credit ?? 0) > 0);
  const nonRound = moneyRows.filter((t) => {
    const v = t.debit ?? t.credit ?? 0;
    return Math.abs(v * 100 - Math.round(v * 100)) < 0.001 && v % 1 !== 0;
  });
  const realism =
    moneyRows.length === 0 ? 70 : clamp(40 + (nonRound.length / moneyRows.length) * 60);

  const score = clamp(totalsScore * 0.4 + chainScore * 0.4 + realism * 0.2);
  return {
    layer: "quantitative",
    label: "Quantitative fidelity",
    score: round2(score),
    weight: 0.2,
    status: statusFromScore(score),
    summary: `Totals score ${totalsScore.toFixed(0)} · chain ${chainScore.toFixed(0)} · ${preview.mismatchCount} bal Δ`,
    findings,
  };
}

/** Narrative: description style vs source, placeholders, caps patterns. */
export function analyzeNarrative(
  source: Transaction[],
  working: Transaction[],
): LayerScore {
  const findings: ForensicFinding[] = [];
  const srcDesc = new Set(
    source.map((t) => t.description.trim().toLowerCase()).filter(Boolean),
  );

  let exact = 0;
  let partial = 0;
  for (const t of working) {
    const d = t.description.trim().toLowerCase();
    if (!d) continue;
    if (srcDesc.has(d)) exact += 1;
    else if ([...srcDesc].some((s) => s.includes(d.slice(0, 10)) || d.includes(s.slice(0, 10)))) {
      partial += 1;
    }
  }
  const n = Math.max(working.length, 1);
  const narrativeScore = clamp((exact / n) * 100 + (partial / n) * 40);

  const placeholders = working.filter((t) =>
    /\b(test merchant|lorem|asdf|sample|xxx|placeholder|foo bar)\b/i.test(
      t.description,
    ),
  );
  if (placeholders.length) {
    findings.push({
      id: "narr-placeholder",
      layer: "narrative",
      severity: "critical",
      title: "Placeholder-like descriptions",
      detail: `${placeholders.length} row(s) look synthetic (test/lorem/placeholder language).`,
      transactionId: placeholders[0].id,
      evidence: placeholders[0].description,
    });
  }

  // Caps / rail-ish patterns
  const railLike = working.filter((t) =>
    /\b(visa|mastercard|eftpos|bpay|direct\s*debit|salary|payroll|card\s*\*)/i.test(
      t.description,
    ),
  );
  const railBonus = working.length ? (railLike.length / working.length) * 15 : 0;

  if (source.length > 0 && exact / n < 0.2 && working.some((t) => t.flags.includes("generated") || t.flags.includes("statement-gen"))) {
    findings.push({
      id: "narr-replaced",
      layer: "narrative",
      severity: "minor",
      title: "Narratives largely replaced",
      detail:
        "Working descriptions diverge from source parse — expected after statement generation; fidelity to *original PDF text* is reduced.",
    });
  }

  const score = clamp(narrativeScore * 0.85 + railBonus);
  return {
    layer: "narrative",
    label: "Narrative fidelity",
    score: round2(score),
    weight: 0.15,
    status: statusFromScore(score),
    summary: `${exact} exact / ${partial} partial desc matches · ${railLike.length} rail-like`,
    findings,
  };
}

const RAIL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(visa|mastercard|card\s*\*)/i, label: "card rail" },
  { re: /\beftpos\b/i, label: "EFTPOS" },
  { re: /\bbpay\b/i, label: "BPAY" },
  { re: /\b(direct\s*debit|ddr)\b/i, label: "direct debit" },
  { re: /\b(salary|payroll|wages)\b/i, label: "payroll" },
  { re: /\b(transfer|tfr|osko|payid)\b/i, label: "transfer" },
  { re: /\b(atm|withdrawal)\b/i, label: "ATM" },
  { re: /\b(interest|int\s*cr|int\s*dr)\b/i, label: "interest" },
];

/** Authenticity markers on working set + source text. */
export function analyzeAuthenticity(
  working: Transaction[],
  rawText: string,
): LayerScore {
  const findings: ForensicFinding[] = [];
  let score = 55;

  // Rail vocabulary
  let railHits = 0;
  for (const { re } of RAIL_PATTERNS) {
    if (working.some((t) => re.test(t.description)) || re.test(rawText)) {
      railHits += 1;
    }
  }
  score += Math.min(20, railHits * 3);

  // Legal / statement structure tokens in source text
  const docMarkers = [
    /\b(statement\s+period|opening\s+balance|closing\s+balance)\b/i,
    /\b(bsb|account\s+number)\b/i,
    /\b(page\s+\d+\s+of\s+\d+)\b/i,
    /\babn\b/i,
  ];
  let docHits = 0;
  for (const re of docMarkers) {
    if (re.test(rawText)) docHits += 1;
  }
  score += Math.min(15, docHits * 4);
  if (docHits >= 2) {
    findings.push({
      id: "auth-structure",
      layer: "authenticity",
      severity: "supporting",
      title: "Source text has statement structure markers",
      detail: `Found ${docHits} documentary markers (period/BSB/page/ABN-style) in source extract.`,
    });
  }

  // Future dates
  const today = new Date().toISOString().slice(0, 10);
  const future = working.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.date > today);
  if (future.length) {
    score -= 15;
    findings.push({
      id: "auth-future",
      layer: "authenticity",
      severity: "material",
      title: "Future-dated transactions",
      detail: `${future.length} row(s) dated after today.`,
      transactionId: future[0].id,
    });
  }

  // Perfect round-only spend red flag
  const spends = working.filter((t) => t.debit != null && t.debit > 0);
  if (spends.length >= 8) {
    const allRound = spends.every((t) => (t.debit ?? 0) % 10 === 0);
    if (allRound) {
      score -= 12;
      findings.push({
        id: "auth-round",
        layer: "authenticity",
        severity: "minor",
        title: "Unusually round debit pattern",
        detail: "Most/all debits are multiples of 10 — can look synthetic.",
      });
    }
  }

  // Generated flags reduce documentary authenticity vs source PDF
  const gen = working.filter(
    (t) =>
      t.flags.includes("generated") ||
      t.flags.includes("statement-gen") ||
      t.flags.includes("replaced"),
  );
  if (gen.length > working.length * 0.5 && working.length > 0) {
    score -= 10;
    findings.push({
      id: "auth-generated",
      layer: "authenticity",
      severity: "minor",
      title: "Majority generated/replaced rows",
      detail: `${gen.length}/${working.length} rows carry generation flags — authenticity is evaluated as synthetic demo data vs documentary source match.`,
    });
  }

  score = clamp(score);
  return {
    layer: "authenticity",
    label: "Authenticity markers",
    score: round2(score),
    weight: 0.15,
    status: statusFromScore(score),
    summary: `${railHits} rail types · ${docHits} doc markers · ${gen.length} generated rows`,
    findings,
  };
}

/** Source alignment: original snapshots vs current values. */
export function analyzeSourceAlignment(working: Transaction[]): LayerScore {
  const findings: ForensicFinding[] = [];
  let comparable = 0;
  let fieldMatches = 0;
  let fieldTotal = 0;

  for (const t of working) {
    if (!t.original) continue;
    comparable += 1;
    const fields: Array<"date" | "description" | "debit" | "credit" | "balance"> = [
      "date",
      "description",
      "debit",
      "credit",
      "balance",
    ];
    for (const f of fields) {
      fieldTotal += 1;
      const a = t.original[f];
      const b = t[f];
      if (f === "date" || f === "description") {
        if (String(a) === String(b)) fieldMatches += 1;
      } else if (moneyEqual(a as number | null, b as number | null)) {
        fieldMatches += 1;
      }
    }
  }

  const score =
    fieldTotal === 0
      ? working.length === 0
        ? 100
        : 50
      : clamp((fieldMatches / fieldTotal) * 100);

  const dirty = working.filter((t) => {
    if (!t.original) return false;
    return (
      t.date !== t.original.date ||
      t.description !== t.original.description ||
      !moneyEqual(t.debit, t.original.debit) ||
      !moneyEqual(t.credit, t.original.credit) ||
      !moneyEqual(t.balance, t.original.balance)
    );
  });

  if (dirty.length) {
    findings.push({
      id: "align-dirty",
      layer: "source-alignment",
      severity: dirty.length > working.length * 0.3 ? "material" : "minor",
      title: "Fields diverge from parse-time originals",
      detail: `${dirty.length} row(s) differ from source-snapshot values (edits or generation).`,
      transactionId: dirty[0].id,
    });
  }

  return {
    layer: "source-alignment",
    label: "Source alignment",
    score: round2(score),
    weight: 0.15,
    status: statusFromScore(score),
    summary: `${fieldMatches}/${fieldTotal} field equals · ${dirty.length} dirty rows · ${comparable} with originals`,
    findings,
  };
}

/** Generation-logic consistency: signed amounts, markers, calibration sanity. */
export function analyzeGenerationLogic(working: Transaction[]): LayerScore {
  const findings: ForensicFinding[] = [];
  let score = 80;

  // Dual positive debit+credit
  const dual = working.filter(
    (t) => t.debit != null && t.credit != null && t.debit > 0 && t.credit > 0,
  );
  if (dual.length) {
    score -= Math.min(20, dual.length * 5);
    findings.push({
      id: "gen-dual",
      layer: "generation-logic",
      severity: "material",
      title: "Dual-sided amount rows",
      detail: `${dual.length} row(s) have both debit and credit > 0.`,
      transactionId: dual[0].id,
    });
  }

  // Movement consistency with balance where possible
  const withBal = working.filter(
    (t) => t.balance != null && (t.debit != null || t.credit != null),
  );
  let okChain = 0;
  for (let i = 1; i < withBal.length; i++) {
    const prev = withBal[i - 1];
    const cur = withBal[i];
    if (prev.balance == null || cur.balance == null) continue;
    const expected = round2(prev.balance + movementOf(cur));
    if (moneyEqual(expected, cur.balance, 0.05)) okChain += 1;
  }
  const chainDenom = Math.max(withBal.length - 1, 1);
  const chainPct = (okChain / chainDenom) * 100;
  score = clamp(score * 0.5 + chainPct * 0.5);

  // Chronology
  for (let i = 1; i < working.length; i++) {
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(working[i].date) &&
      /^\d{4}-\d{2}-\d{2}$/.test(working[i - 1].date) &&
      working[i].date < working[i - 1].date
    ) {
      score -= 10;
      findings.push({
        id: "gen-chrono",
        layer: "generation-logic",
        severity: "critical",
        title: "Non-chronological dates",
        detail: `${working[i].date} follows ${working[i - 1].date}`,
        transactionId: working[i].id,
      });
      break;
    }
  }

  return {
    layer: "generation-logic",
    label: "Generation logic integrity",
    score: round2(clamp(score)),
    weight: 0.1,
    status: statusFromScore(score),
    summary: `Balance-step OK ${okChain}/${chainDenom} · dual-sided ${dual.length}`,
    findings,
  };
}

export function analyzeVisualPixel(
  pixelScore: number | null | undefined,
  pixelStatus: string | null | undefined,
): LayerScore {
  if (pixelScore == null) {
    return {
      layer: "visual-pixel",
      label: "Visual / pixel fidelity",
      score: 0,
      weight: 0.05,
      status: "skipped",
      summary: "No pixel verification run yet — run Visual step for SSIM/pHash at 300 DPI.",
      findings: [
        {
          id: "vis-skip",
          layer: "visual-pixel",
          severity: "minor",
          title: "Pixel layer skipped",
          detail: "Run Pdfium + metrics on the Visual step to include SSIM/tile/pHash.",
        },
      ],
    };
  }
  const findings: ForensicFinding[] = [];
  if (pixelStatus === "fail" || pixelScore < 70) {
    findings.push({
      id: "vis-fail",
      layer: "visual-pixel",
      severity: "material",
      title: "Pixel verification weak",
      detail: `Pixel score ${pixelScore}/100 (status ${pixelStatus ?? "n/a"}).`,
    });
  }
  return {
    layer: "visual-pixel",
    label: "Visual / pixel fidelity",
    score: round2(clamp(pixelScore)),
    weight: 0.05,
    status: statusFromScore(pixelScore),
    summary: `Pixel score ${pixelScore}/100 · ${pixelStatus ?? "n/a"}`,
    findings,
  };
}
