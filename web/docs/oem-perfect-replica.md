# OEM Perfect Replica Pipeline

**Goal:** Produce a PDF with **updated data** that is **visually inseparable** from a real OEM bank statement — same static chrome, fonts, rules, logos, and bank-native transaction identification style.

## Combined method

| Layer | Source | Role |
|-------|--------|------|
| **Three-part layout** | `statement-layout/` | Part1 static · Part2 header/footer vars · Part3 txn table |
| **Structure fidelity** | `txn-structure` + `structure-ledger` | Keep bank-native desc style (refs, embedded dates, multi-line) |
| **Perfect replacement** | `perfect-replacement/` | Geometry multi-pass FreeText on **original OEM PDF** |
| **St George layered** | `st-george-template/layered-fill` | TEMPLATE 2 base + placement geometry when shell |
| **Verification** | SSIM / tile / pHash / math / forensics | Post-write visual + ledger gates |
| **Audit** | JSON + appended PDF page | Full injection trace |

```
sourcePdf
   │
   ├─ analyzeStatementLayout  → Part1 / Part2 / Part3 + bank structure profile
   ├─ applyStructureToLedger  → OEM-faithful descriptions
   │
   ├─ path = filled-geometry     → runPerfectReplacement ON original (OEM vectors kept)
   ├─ path = st-george-layered   → fillStGeorgeLayered on TEMPLATE 2 base
   ├─ path = token-template      → fillStGeorgeTemplate
   └─ path = hybrid-fallback     → perfect replacement soft
   │
   └─ OEM gates + score → live preview / export (+ audit page)
```

## Why this looks like OEM

1. **Static chrome never redrawn** on filled statements — the original PDF’s logo, lines, and legal text stay as OEM vectors.
2. **Only variable zones** are covered (white Square) + FreeText — no redaction holes.
3. **Transaction text matches bank style** measured from the source (not a generic template).
4. **Amounts/dates** follow original glyph patterns via geometry link + format mirrors.
5. **Multi-layer verification** catches visual / math drift before export.

## API

```ts
import { runOemPerfectReplica } from "@/lib/oem-replica";

const oem = await runOemPerfectReplica({
  sourcePdf,
  sourceBaseline, // parse freeze
  current,        // working ledger
  queuedEdits,
  preserveTxnStructure: true,
});
// oem.candidatePdf · oem.path · oem.score · oem.layout · oem.gates
```

## App integration

- **Live preview** (`Index.tsx` rematerialize) → `runOemPerfectReplica`
- **Export final PDF** → same path + audit page + JSON report
- Fallback chain: OEM → perfect replacement → classic materialize

## Honest limits

Web WASM FreeText cannot always re-embed the exact original font subset. Visual identity is **best-effort OEM geometry reuse** of the source file’s vectors for Part1, with high coverage Part2/Part3 injection. Native PyMuPDF Pro / content-stream rewrite remains a higher tier (see `fidelity-integration-design.md` T0–T3).

For human visual inspection of filled statements rewritten in place, Part1 pixel bands (logo/footer) stay near-identical to the source OEM file.
