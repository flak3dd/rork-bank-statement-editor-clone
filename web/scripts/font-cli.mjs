#!/usr/bin/env node
/**
 * Font analysis / completion CLI
 *
 * Usage:
 *   node scripts/font-cli.mjs complete Helvetica-Bold
 *   node scripts/font-cli.mjs analyze sample-fonts.json
 *   node scripts/font-cli.mjs table
 *
 * sample-fonts.json: [{ "fontName": "Helvetica", "fontSize": 10, "text": "..." }, ...]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const KNOWN = [
  { keys: ["helv", "helvetica", "arial"], family: "Helvetica Neue, Arial, sans-serif" },
  { keys: ["times", "timesnewroman", "georgia"], family: "Times New Roman, Georgia, serif" },
  { keys: ["cour", "courier", "mono"], family: "Courier New, Consolas, monospace" },
  { keys: ["roboto"], family: "Roboto, Helvetica Neue, Arial, sans-serif" },
  { keys: ["inter"], family: "Inter, Helvetica Neue, Arial, sans-serif" },
  { keys: ["dejavu", "liberation"], family: "DejaVu Sans, Liberation Sans, Arial, sans-serif" },
  { keys: ["noto"], family: "Noto Sans, Arial, sans-serif" },
];

function complete(query) {
  const q = String(query).toLowerCase().replace(/[^a-z0-9]/g, "");
  let weight = 400;
  if (/bold|heavy|black/.test(query.toLowerCase())) weight = 700;
  else if (/light|thin/.test(query.toLowerCase())) weight = 300;
  let style = "normal";
  if (/italic/.test(query.toLowerCase())) style = "italic";
  for (const k of KNOWN) {
    if (k.keys.some((key) => q.includes(key) || key.includes(q))) {
      return { family: k.family, weight, style, stretch: "normal", query };
    }
  }
  return {
    family: `"${query}", sans-serif`,
    weight,
    style,
    stretch: "normal",
    query,
  };
}

function analyze(runs) {
  const map = new Map();
  for (const r of runs) {
    const name = r.fontName || r.fontFamily || "unknown";
    const cur = map.get(name) || { count: 0, sizeSum: 0, sample: "" };
    cur.count += 1;
    cur.sizeSum += r.fontSize || 0;
    if (!cur.sample && r.text) cur.sample = String(r.text).slice(0, 40);
    map.set(name, cur);
  }
  const samples = [...map.entries()]
    .map(([fontName, v]) => ({
      fontName,
      count: v.count,
      avgSize: v.count ? v.sizeSum / v.count : 0,
      sample: v.sample,
      donor: complete(fontName),
    }))
    .sort((a, b) => b.count - a.count);
  return samples;
}

function usage() {
  console.log(`Font analysis / completion CLI

Commands:
  complete <fontName>     Resolve donor font stack
  analyze <file.json>     Analyze font run samples
  table                   Print known completion keys

Examples:
  node scripts/font-cli.mjs complete Helvetica-Bold
  node scripts/font-cli.mjs analyze ./font-runs.json
`);
}

const [,, cmd, arg] = process.argv;

if (!cmd || cmd === "help" || cmd === "-h") {
  usage();
  process.exit(0);
}

if (cmd === "complete") {
  if (!arg) {
    console.error("Usage: complete <fontName>");
    process.exit(1);
  }
  console.log(JSON.stringify(complete(arg), null, 2));
  process.exit(0);
}

if (cmd === "table") {
  console.log("Known completion keys → family");
  for (const k of KNOWN) {
    console.log(`  ${k.keys.join("|")}  →  ${k.family}`);
  }
  process.exit(0);
}

if (cmd === "analyze") {
  if (!arg) {
    console.error("Usage: analyze <file.json>");
    process.exit(1);
  }
  const raw = readFileSync(resolve(arg), "utf8");
  const runs = JSON.parse(raw);
  if (!Array.isArray(runs)) {
    console.error("JSON must be an array of { fontName, fontSize?, text? }");
    process.exit(1);
  }
  const samples = analyze(runs);
  console.log(`Fonts: ${samples.length}`);
  console.log("name\tcount\tavgSize\tdonor");
  for (const s of samples) {
    console.log(
      `${s.fontName}\t${s.count}\t${s.avgSize.toFixed(1)}\t${s.donor.family} w${s.donor.weight}`,
    );
  }
  process.exit(0);
}

console.error(`Unknown command: ${cmd}`);
usage();
process.exit(1);
