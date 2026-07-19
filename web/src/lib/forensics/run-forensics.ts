import { round2 } from "@/lib/money";
import { aiFidelityAnalysis } from "./ai-fidelity";
import {
  analyzeAuthenticity,
  analyzeGenerationLogic,
  analyzeNarrative,
  analyzeQuantitative,
  analyzeSourceAlignment,
  analyzeStructural,
  analyzeVisualPixel,
} from "./local-layers";
import type {
  FidelityForensicsReport,
  ForensicFinding,
  ForensicInput,
  LayerScore,
} from "./types";

function gradeOf(score: number): FidelityForensicsReport["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 55) return "D";
  return "F";
}

function buildMarkdown(report: FidelityForensicsReport): string {
  const lines: string[] = [];
  lines.push(`# Fidelity & Authenticity Forensics`);
  lines.push("");
  lines.push(`**File:** ${report.source.fileName}`);
  lines.push(`**Checked:** ${report.checkedAt}`);
  lines.push(
    `**Verdict:** ${report.verdict.toUpperCase()} · **Score:** ${report.overallScore}/100 (${report.grade}) · **Confidence:** ${(report.confidence * 100).toFixed(0)}%`,
  );
  lines.push("");
  lines.push(`## Executive judgment`);
  lines.push(report.judgment);
  lines.push("");
  lines.push(`## Source`);
  lines.push(
    `- Original rows: ${report.source.originalCount} · Working rows: ${report.source.workingCount}`,
  );
  lines.push(
    `- Pages: ${report.source.pageCount} · Raw text length: ${report.source.rawTextLength}`,
  );
  lines.push("");
  lines.push(`## Layer scores`);
  lines.push(`| Layer | Score | Status | Summary |`);
  lines.push(`|-------|------:|--------|---------|`);
  for (const l of report.layers) {
    lines.push(
      `| ${l.label} | ${l.score.toFixed(0)} | ${l.status} | ${l.summary.replace(/\|/g, "/")} |`,
    );
  }
  lines.push("");
  lines.push(`## Findings`);
  if (!report.findings.length) {
    lines.push(`_No material findings._`);
  } else {
    for (const f of report.findings) {
      lines.push(`### [${f.severity}] ${f.title}`);
      lines.push(`- Layer: \`${f.layer}\``);
      lines.push(`- ${f.detail}`);
      if (f.evidence) lines.push(`- Evidence: \`${f.evidence}\``);
      lines.push("");
    }
  }
  if (report.ai?.ran) {
    lines.push(`## AI forensic notes`);
    lines.push(report.ai.summary ?? "");
    if (report.ai.strengths?.length) {
      lines.push(`### Strengths`);
      for (const s of report.ai.strengths) lines.push(`- ${s}`);
    }
    if (report.ai.risks?.length) {
      lines.push(`### Risks`);
      for (const s of report.ai.risks) lines.push(`- ${s}`);
    }
  }
  lines.push("");
  lines.push(`## Residual limitations`);
  lines.push(
    `- Not a live bank confirmation or cryptographic proof of origin.`,
  );
  lines.push(
    `- Generation/edit flags intentionally reduce source-text narrative match; quantitative and generation-logic layers remain primary for ledger integrity.`,
  );
  lines.push(`- Duration ${report.durationMs}ms.`);
  return lines.join("\n");
}

/**
 * Full multi-layer forensic fidelity + authenticity analysis:
 * structure · quantities · narrative · authenticity · source alignment ·
 * generation logic · optional visual · optional AI.
 */
export async function runFidelityForensics(
  input: ForensicInput,
): Promise<FidelityForensicsReport> {
  const started = performance.now();
  const source = input.sourceTransactions;
  const working = input.workingTransactions;

  const layers: LayerScore[] = [
    analyzeStructural(source, working),
    analyzeQuantitative(source, working),
    analyzeNarrative(source, working),
    analyzeAuthenticity(working, input.rawText),
    analyzeSourceAlignment(working),
    analyzeGenerationLogic(working),
    analyzeVisualPixel(input.pixelScore, input.pixelStatus),
  ];

  const localScores: Record<string, number> = {};
  for (const l of layers) {
    if (l.status !== "skipped") localScores[l.layer] = l.score;
  }

  let aiLayer: LayerScore | null = null;
  let aiMeta: FidelityForensicsReport["ai"] = {
    ran: false,
    skipped: true,
  };

  if (input.runAi !== false) {
    const ai = await aiFidelityAnalysis({
      source,
      working,
      rawTextSnippet: input.rawText,
      localScores,
      signal: input.signal,
    });
    aiLayer = ai.layer;
    aiMeta = {
      ran: ai.ran,
      skipped: ai.skipped,
      summary: ai.summary,
      risks: ai.risks,
      strengths: ai.strengths,
    };
    layers.push(ai.layer);
    if (ai.ran) localScores["ai-fidelity"] = ai.score;
  } else {
    layers.push({
      layer: "ai-fidelity",
      label: "AI fidelity & authenticity",
      score: 0,
      weight: 0.05,
      status: "skipped",
      summary: "AI not requested",
      findings: [],
    });
  }

  // Weighted overall — reweight active layers
  const active = layers.filter((l) => l.status !== "skipped");
  const weightSum = active.reduce((s, l) => s + l.weight, 0) || 1;
  let overall = 0;
  for (const l of active) {
    overall += l.score * (l.weight / weightSum);
  }
  overall = round2(overall);

  const allFindings: ForensicFinding[] = layers.flatMap((l) => l.findings);
  const critical = allFindings.filter((f) => f.severity === "critical").length;
  const material = allFindings.filter((f) => f.severity === "material").length;

  let verdict: FidelityForensicsReport["verdict"] = "pass";
  if (critical > 0 || overall < 70) verdict = "fail";
  else if (material > 0 || overall < 88) verdict = "warn";

  // Confidence: more source data + AI run → higher
  let confidence = 0.45;
  if (source.length >= 5) confidence += 0.15;
  if (input.rawText.length > 200) confidence += 0.1;
  if (input.pixelScore != null) confidence += 0.1;
  if (aiMeta?.ran) confidence += 0.15;
  if (input.limitedExtraction) confidence -= 0.15;
  confidence = Math.min(0.95, Math.max(0.25, confidence));

  const judgment =
    verdict === "pass"
      ? `Working ledger scores ${overall}/100 (${gradeOf(overall)}) against the original source extract. Local forensic layers ${aiMeta?.ran ? "and AI review " : ""}are consistent with high fidelity for structure/math; residual narrative drift is expected only where rows were intentionally edited or regenerated.`
      : verdict === "warn"
        ? `Working ledger scores ${overall}/100 (${gradeOf(overall)}). Material differences from the source file were detected (${material} material / ${critical} critical). Review findings before treating the result as source-faithful.`
        : `Working ledger scores ${overall}/100 (${gradeOf(overall)}). Forensic analysis found integrity or authenticity failures that prevent claiming a perfect match to the original source file.`;

  const report: FidelityForensicsReport = {
    overallScore: overall,
    grade: gradeOf(overall),
    verdict,
    confidence,
    judgment,
    layers,
    findings: allFindings.sort((a, b) => {
      const order = { critical: 0, material: 1, minor: 2, supporting: 3 };
      return order[a.severity] - order[b.severity];
    }),
    source: {
      fileName: input.fileName,
      originalCount: source.length,
      workingCount: working.length,
      rawTextLength: input.rawText.length,
      pageCount: input.pageCount,
    },
    metrics: {
      structuralMatch: localScores.structural ?? 0,
      quantitativeMatch: localScores.quantitative ?? 0,
      narrativeMatch: localScores.narrative ?? 0,
      authenticityScore: localScores.authenticity ?? 0,
      sourceAlignment: localScores["source-alignment"] ?? 0,
      generationConsistency: localScores["generation-logic"] ?? 0,
      aiFidelity: aiMeta?.ran ? (localScores["ai-fidelity"] ?? null) : null,
      visualScore: input.pixelScore ?? null,
    },
    ai: aiMeta,
    checkedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    markdown: "",
  };
  report.markdown = buildMarkdown(report);
  return report;
}

export function downloadForensicsMarkdown(
  report: FidelityForensicsReport,
): void {
  const blob = new Blob([report.markdown], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const base = report.source.fileName.replace(/\.pdf$/i, "") || "statement";
  a.download = `${base}-FIDELITY_AUTHENTICITY_REPORT.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadForensicsJson(report: FidelityForensicsReport): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const base = report.source.fileName.replace(/\.pdf$/i, "") || "statement";
  a.download = `${base}-fidelity-forensics.json`;
  a.click();
  URL.revokeObjectURL(url);
}
