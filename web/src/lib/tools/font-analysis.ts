import { matchFontSpec } from "@/lib/pdf-render";
import type { PdfFontSpec } from "@/lib/types";

export interface FontSample {
  fontName: string;
  fontFamily?: string;
  count: number;
  sampleText: string;
  avgSize: number;
  spec: PdfFontSpec;
}

export interface FontAnalysisReport {
  samples: FontSample[];
  dominant: FontSample | null;
  completionTable: Array<{ query: string; resolved: PdfFontSpec }>;
  summary: string;
}

const KNOWN_FONTS: Array<{ keys: string[]; family: string; weight?: number }> = [
  { keys: ["helv", "helvetica", "arial"], family: "Helvetica Neue, Arial, sans-serif" },
  { keys: ["times", "timesnewroman", "georgia"], family: "Times New Roman, Georgia, serif" },
  { keys: ["cour", "courier", "mono"], family: "Courier New, Consolas, monospace" },
  { keys: ["roboto"], family: "Roboto, Helvetica Neue, Arial, sans-serif" },
  { keys: ["inter"], family: "Inter, Helvetica Neue, Arial, sans-serif" },
  { keys: ["dejavu", "liberation"], family: "DejaVu Sans, Liberation Sans, Arial, sans-serif" },
  { keys: ["noto"], family: "Noto Sans, Arial, sans-serif" },
];

/** Complete a partial / PDF-internal font name to a donor stack. */
export function completeFontName(query: string): PdfFontSpec {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const k of KNOWN_FONTS) {
    if (k.keys.some((key) => q.includes(key) || key.includes(q))) {
      return matchFontSpec(k.family, query);
    }
  }
  return matchFontSpec(query, query);
}

/**
 * Analyze font usage from PDF.js-style text runs.
 */
export function analyzeFonts(
  runs: Array<{
    fontName?: string;
    fontFamily?: string;
    fontSize?: number;
    text?: string;
  }>,
): FontAnalysisReport {
  const map = new Map<
    string,
    { count: number; sizeSum: number; sample: string; family?: string; name: string }
  >();

  for (const r of runs) {
    const name = r.fontName || r.fontFamily || "unknown";
    const cur = map.get(name) ?? {
      count: 0,
      sizeSum: 0,
      sample: "",
      family: r.fontFamily,
      name,
    };
    cur.count += 1;
    cur.sizeSum += r.fontSize ?? 0;
    if (!cur.sample && r.text) cur.sample = r.text.slice(0, 40);
    map.set(name, cur);
  }

  const samples: FontSample[] = [...map.values()]
    .map((v) => ({
      fontName: v.name,
      fontFamily: v.family,
      count: v.count,
      sampleText: v.sample,
      avgSize: v.count ? v.sizeSum / v.count : 0,
      spec: completeFontName(v.name),
    }))
    .sort((a, b) => b.count - a.count);

  const dominant = samples[0] ?? null;
  const completionTable = samples.slice(0, 12).map((s) => ({
    query: s.fontName,
    resolved: s.spec,
  }));

  const summary =
    samples.length === 0
      ? "No font samples found."
      : `${samples.length} font(s); dominant “${dominant?.fontName}” (${dominant?.count} runs) → ${dominant?.spec.family}`;

  return { samples, dominant, completionTable, summary };
}

/** CLI-friendly plain text report. */
export function formatFontReportCli(report: FontAnalysisReport): string {
  const lines: string[] = [];
  lines.push("Font analysis / completion");
  lines.push("==========================");
  lines.push(report.summary);
  lines.push("");
  lines.push("Name\tCount\tAvgSz\tDonor stack");
  for (const s of report.samples) {
    lines.push(
      `${s.fontName}\t${s.count}\t${s.avgSize.toFixed(1)}\t${s.spec.family} w${s.spec.weight}`,
    );
  }
  lines.push("");
  lines.push("Completion table");
  for (const c of report.completionTable) {
    lines.push(`  ${c.query}  →  ${c.resolved.family} (${c.resolved.weight}/${c.resolved.style})`);
  }
  return lines.join("\n");
}
