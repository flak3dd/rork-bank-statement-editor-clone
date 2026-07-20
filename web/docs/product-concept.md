# Bank Statement Fidelity Editor — Product Concept (Revised)

## Concept and Usage Goal

The **Bank Statement Fidelity Editor** is an advanced automation tool engineered for reproducing an exact replica of bank statements through fully automated logic generator data injection.

### Primary usage goal

To automatically load a source bank statement PDF, inject generated data via intelligent logic engines (new transactions, balances, dates, descriptions), and produce a complete, **pixel-perfect replica** that is visually, structurally, and mathematically identical to the original while incorporating the injected synthetic content seamlessly.

This supports high-volume generation of realistic statement replicas for **testing**, **training**, **simulation**, **reverse-engineering**, or **data augmentation** workflows.

---

## Core Capabilities

### 1. Automated Visual and Layout Fidelity Engine

Full-page parsing and regeneration with automatic injection of matching fonts, kerning, colors, and positions when reproducing an exact replica.

| Implementation | Path |
|----------------|------|
| Perfect Replacement multi-strategy | `src/lib/perfect-replacement/` |
| Font analysis + donor replication | `src/lib/tools/font-analysis.ts`, `advanced-generator.ts` |
| Geometry run-match | `src/lib/tools/run-match.ts` |
| Write: Square cover + FreeText (no redactions) | `src/lib/pdf-engines/mupdf-engine.ts` |

### 2. Intelligent Balance and Transaction Generator

Automated logic that detects structure and injects consistent cascading balances plus synthetic transactions using additional generation logic and bank-specific templates (ANZ Plus, HSBC, Wise, St George, Commonwealth, NAB, Westpac, Chase, Bank of America, …).

| Implementation | Path |
|----------------|------|
| Statement generator engine | `src/lib/statement-gen/` |
| Balance cascade | `src/lib/balance-engine.ts` |
| Bank description packs | `src/lib/tools/bank-descriptions/` |
| YAML layout templates | `src/lib/parsers/templates/` |
| St George Complete Freedom fill | `src/lib/st-george-template/` |

### 3. Multi-Backend Automated Pipeline

Seamless orchestration of parsers (Mindee, Document AI, offline), editors (PyMuPDF, Pdfium, MuPDF), and renderers with auto-fallbacks for reliable data injection.

| Layer | Backends |
|-------|----------|
| Parse | Mindee · LlamaParse · Google Document AI · PyMuPDF · Local OCR · Offline YAML · Remote `/v1/parse` |
| Edit / write | MuPDF WASM (primary) · Pdfium · browser materialize |
| Render / compare | Pdfium · PDF.js · 300 DPI visual |
| Optional remote | Hosted parse/replace tools |

### 4. Advanced Automated Generation Logic

Built-in transaction transfer, date pattern shifting, description template injection, and AI-driven content synthesis for realistic data injection across entire documents.

| Tool | Module |
|------|--------|
| Advanced generator | `tools/advanced-generator.ts` |
| Date shift | `tools/date-shift.ts` |
| Bank-desc replace | `tools/bank-descriptions/` |
| Hybrid geometry | `tools/hybrid-geometry.ts` |
| Optional variables / Unredacter | `statement-gen/variables.ts`, `tools/chrome-unredact.ts` |
| AI hybrid validate | `lib/ai.ts` |

### 5. Multi-Layer Automated Verification

Continuous SSIM, tile-max, perceptual hash, and AI checks that validate successful reproduction of an exact replica after data injection.

| Layer | Module |
|-------|--------|
| SSIM / tile / pHash / per-pixel | `lib/verification/image-metrics.ts` |
| Visual run @ 300 DPI | `lib/verification/run-visual.ts` |
| Final math check | `lib/math-check.ts` |
| Fidelity forensics + AI | `lib/forensics/` |
| Optional Applitools Eyes | `lib/verification/applitools.ts` |

### 6. Batch Automation and Workflow

Fully automated single or bulk processing with audit logging and smart draft handling for scalable replica generation via logic generator data injection.

| Feature | Status |
|---------|--------|
| Single-file auto workflow (live rematerialize + export) | **Shipped** |
| Append-only audit log + change history | **Shipped** |
| Merged JSON audit report | **Shipped** |
| Audit page appended to final PDF | **Shipped** |
| Workflow draft autosave (`audit/workflow.json`) | **Shipped** |
| Test Lab stress suite | **Shipped** |
| Multi-file bulk UI queue | Planned |

### 7. Bank-Specific Automation Templates

Pre-loaded geometry blueprints and font analyzers that enable precise automated injection tailored to real statement layouts.

| Asset | Path |
|-------|------|
| St George Complete Freedom PDF | `public/templates/st-george-complete-freedom.pdf` |
| Token fill | `lib/st-george-template/` |
| Parser YAML packs | `lib/parsers/templates/*.yaml` |

---

## What You Get in Result

When using the app, the automated process delivers:

1. **A final PDF** that is a complete visual and structural replica of the original, with all injected data perfectly integrated (no visible edits — appears as native content; **no redactions**).
2. **Mathematically consistent** running balances and realistic transaction sequences generated through automated logic.
3. **Comprehensive audit report** (JSON download + optional **appended PDF page**) detailing all data injection steps for full traceability.
4. **High-fidelity synthetic statements** ready for immediate use, where every element (layout, fonts, numbers, text) contributes to reproducing an exact replica enhanced by the injected dataset.
5. **Scalable, repeatable output** suitable for testing suites, training data, or production simulation — achieved entirely through automated logic generator data injection.

---

## Two major steps (any bank PDF)

1. **Perfect three-part analysis** — map every run into static base | header/footer variables | transaction table. See `docs/three-part-layout-analysis.md` and `src/lib/statement-layout/`.
2. **Transaction structure fidelity** — keep each bank’s identification style (refs, embedded dates, multi-line merchants, signed vs debit/credit columns) when injecting synthetic rows.

These combine with app write engines into **`runOemPerfectReplica`** — see `docs/oem-perfect-replica.md`.

## Auto workflow (implementation)

```
Upload source PDF
  → multi-parser extract (baseline freeze)
  → generate / bank-desc / date-shift / variables
  → balance cascade
  → runOemPerfectReplica
        ├ analyzeStatementLayout (Part1/2/3 + structure profile)
        ├ structure-preserve descriptions
        └ write: filled-geometry | st-george-layered | token-template | hybrid
  → live regenerated preview
  → visual SSIM/tile/pHash + math + forensics
  → Export OEM replica PDF (+ audit page) + JSON audit report
```

Primary entry points:

- UI: `src/pages/Index.tsx` (live rematerialize, export)
- Pipeline: `src/lib/perfect-replacement/pipeline.ts` → `runPerfectReplacement`
- Product surface name: **Bank Statement Fidelity Editor** (app shell may still show Statement Lens in legacy strings during transition)

---

## Fidelity notes

Web WASM cannot always match native PyMuPDF Pro absolute pixel identity on every font subset. The product targets **best-effort pixel-perfect geometry reuse** of original text runs with multi-layer verification scores. See also `docs/fidelity-integration-design.md` (T0–T3 tiers) and `docs/perfect-replacement-pipeline.md`.

---

## Related docs

| Doc | Purpose |
|-----|---------|
| `perfect-replacement-pipeline.md` | Multi-strategy replacement API |
| `fidelity-integration-design.md` | Integration / tier model |
| `statement-generation-concepts.md` | Generator engine concepts |
| `google-document-ai-setup.md` | Doc AI credentials |
