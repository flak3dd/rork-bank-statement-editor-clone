# Bank Statement Fidelity Editor — Complete App Overview

**Product names:** Bank Statement Fidelity Editor (UI brand) · Statement Lens (Rork / legacy)  
**Repo:** `rork-bank-statement-editor-clone`  
**App path:** `web/`  
**Primary UI:** `src/pages/Index.tsx`  
**Run:** `cd web && npm run dev` → http://localhost:8080/

---

## 1. What this app is

A **browser-based bank-statement fidelity workstation**. You upload a source bank statement PDF; the app:

1. **Extracts** transactions (multi-parser, bank YAML templates)
2. Lets you **edit** the ledger (inline table, undo/redo, dirty tracking)
3. **Rebalances** running balances with a cascade engine
4. **Injects** synthetic data (generators, bank-description packs, date shifts, variables)
5. **Rewrites** the PDF in place on the original geometry (OEM perfect replica — no redaction holes)
6. **Verifies** visual fidelity (SSIM / tile / pHash), math integrity, and optional forensics
7. **Exports** final PDF (+ optional audit page), CSV, JSON, and a merged audit report

**Primary usage goal:** produce high-fidelity statement **replicas** for testing, training, simulation, reverse-engineering, and data-augmentation workflows — layout, fonts, structure, and balances that look and compute like the OEM original while carrying injected synthetic content.

> Honest limit: browser WASM FreeText cannot always re-embed the exact original font subset. The product targets **best-effort pixel-perfect geometry reuse** of the source file’s vectors, with multi-layer verification scores. Native PyMuPDF Pro content-stream rewrite is a higher fidelity tier (see `fidelity-integration-design.md` T0–T3).

---

## 2. Repository layout

```
rork-bank-statement-editor-clone/
├── rork.json                          # Rork app manifest (path: web)
├── math.js                            # Shared math helpers (root)
├── transactionalDescriptionGenerator.js
├── tools/
│   └── pymupdf_pipeline/              # Optional native Python CLI (not required for web)
│       ├── replace_statement.py
│       ├── generators.py
│       └── fixtures/
└── web/                               # ★ Main application
    ├── package.json                   # Vite + React SPA
    ├── .env.example / .env.local      # Cloud keys (not committed)
    ├── scripts/
    │   ├── refresh-docai-token.sh     # Refresh Google OAuth → .env.local
    │   └── stress-*.mjs / font-cli…
    ├── public/templates/              # St George base PDFs
    ├── docs/                          # Design + pipeline docs
    ├── dist/                          # Production build
    └── src/
        ├── main.tsx / App.tsx         # SPA shell (React Router)
        ├── pages/Index.tsx            # Entire product surface
        ├── pages/NotFound.tsx
        ├── components/                # UI + workflow panels
        ├── hooks/
        ├── lib/                       # All engines, parsers, pipelines
        └── test/                      # Vitest + browser tests
```

There is **no multi-page product router** beyond `/` and a catch-all 404. Almost everything lives in **one workspace page** (`Index.tsx`) driven by phase + workflow step state.

---

## 3. Tech stack

| Layer | Choice |
|-------|--------|
| UI | React 19, TypeScript, Tailwind, shadcn/Radix, Sonner toasts |
| App shell | Vite 8, React Router 6, TanStack Query |
| PDF parse / text | MuPDF WASM (`mupdf`), PDF.js (`pdfjs-dist`), optional cloud APIs |
| PDF write | MuPDF WASM — Square cover + FreeText (chunked); optional remote `/v1/replace` |
| PDF visual render | Pdfium WASM (`@hyzyla/pdfium`) for verification |
| Charts | Recharts |
| Tests | Vitest + Playwright browser tests |
| Optional remote | Hosted parse/replace engine via `VITE_REMOTE_ENGINE_URL` / toolkit URL |
| Optional AI | SpaceXAI / toolkit hooks (`lib/ai.ts`) for categorize + hybrid validate + fidelity |

---

## 4. Product phases & UI modes

### 4.1 App phases (`AppPhase`)

| Phase | What the user sees |
|-------|--------------------|
| **upload** | Dropzone, parser selector, API status |
| **extracting** | Multi-step progress (read → parse → structure → AI → score) |
| **workspace** | Full editor: stepper, table, previews, tools, export |

### 4.2 UI modes (`UiMode`)

| Mode | Purpose |
|------|---------|
| **Editor** | Stage-centric pipeline (default power-user path) |
| **Test Lab** | Checklist + stress suite; jumps to the same handlers as Editor |

Header brand: **Bank Statement Fidelity Editor** · subtitle emphasizes exact replica · generator injection · verify · export.

### 4.3 Workspace workflow steps (`WorkflowStep`)

Ordered pipeline (IDs are stable — do not rename):

| Step | Label | Primary action |
|------|-------|----------------|
| `edit` | Inline Edit | Edit Date / Description / Debit / Credit / Balance; continue |
| `balance` | Balance Out Preview | Preview cascade diffs; continue |
| `render` | Confirm & Render | Apply balances via engine fallbacks |
| `visual` | Visual Validate | Run pixel check (SSIM · tile · pHash; Applitools optional) |
| `math` | Final Math Check | Running-balance + integrity check |
| `generate` | Statement Generate | Generator dashboard / bank replace / apply |
| `fidelity` | Fidelity Forensics | Local layers + optional AI authenticity |
| `complete` | Complete | Export hub (CSV / JSON / Final PDF) |

Supporting chrome:

- **WorkflowStepper** — progress + gate chips  
- **Stage action bar** — Back / primary CTA / secondary  
- **Context rail** — tools, insights, audit mini, thresholds  
- **Views** — Table · side-by-side Compare · source PDF · regenerated PDF  

---

## 5. End-to-end happy path

```
Upload PDF
  → clone bytes → setPdfBytes
  → [remote mode?] remoteParsePdf(/v1/parse)
  → else runRequiredCloudParser / runDocumentParser(parserId)
  → Stage 1 Step 1 (structure step): analyzeStatementLayout(pdfBytes, bankHint)
        Layer 1 static-chrome · Layer 2 variables · Layer 3 transactions
        + txn structure profile (+ St George geometry lock when detected)
  → freeze layoutProfile → ExtractionResult.layout + Index state
  → buildExtractionResult(+ layout) + analyzeCompleteness
  → optional AI categorize + hybrid validate
  → freeze sourceBaseline
  → workspace @ step "edit"
  → user edits / generate / bank-desc / date-shift
  → buildBalancePreview (always-on)
  → debounced rebuildLiveCandidatePdf → runOemPerfectReplica({ layout: frozen })
  → Confirm render · Visual · Math · Forensics (gates)
  → Export final PDF (+ audit page) + merged JSON audit
```

**Live rematerialize** (debounced on ledger changes) is the core write path — not Confirm Render (which probes/applies balances). **PDF bytes are rewritten** primarily on rematerialize and on **Export final PDF**.

---

## 6. Core domain model

Key types live in `src/lib/types.ts`.

### Transaction

Editable ledger row:

- `date`, `description`, `debit`, `credit`, `balance`
- `category` (+ `categorySource`: heuristic | ai | manual, confidence)
- `flags`, `notes`
- `original` snapshot for per-row revert
- `rendered` after Confirm & Render applied balances

### ExtractionResult

Parse output for one file: page count, raw text, transactions, summary (totals, opening/closing, period), completeness findings + score (A–F), hybrid meta, parser meta.

### CompletenessScore

Weighted 0–100 across: extraction density, date coverage, amount coverage, balance chain, description quality, AI confidence.

### PdfEdit

Geometry-linked replacement: page, run id, original → replacement text (+ font metadata for write engines).

### Workflow / audit

- Append-only **audit log** events  
- **Change history** with field diffs  
- **Undo/redo** stack of transaction snapshots  
- **Workflow draft** autosave (`audit/workflow.json` pattern / local storage)  
- **Merged audit report** download + optional **audit page** appended to final PDF  

---

## 7. Parsing layer

**Registry:** `src/lib/parsers/registry.ts`  
**Order:** LlamaParse → Google DocAI → PyMuPDF → Mindee → Local OCR → Offline heuristic  

| Parser ID | Module | Cloud? | Notes |
|-----------|--------|--------|-------|
| `llamaparse` | `llamaparse.ts` | Yes | Preferred production; needs API key |
| `google-docai` | `google-docai.ts` | Yes | Needs project + processor + OAuth token (~1h) |
| `pymupdf` | `pymupdf.ts` | No | MuPDF WASM text extract; YAML bank structure |
| `mindee` | `mindee.ts` | Yes | Optional bank statement API |
| `local-ocr` | `local-ocr.ts` | No | Browser OCR path |
| `offline-heuristic` | `offline-heuristic.ts` | No | Last-resort line heuristics |

**Bank YAML templates** (`parsers/templates/`): generic, ANZ, Commonwealth, NAB, Westpac, Chase, Bank of America — noise filters, description cleanup, layout hints via `detectBankTemplate`.

**Required cloud policy:** production-quality parse may require LlamaParse **or** Document AI credentials (`required-cloud.ts`). Local engines still work for structure enrichment and offline emergencies; cloud parsers soft-fallback to offline on hard API failure (with clear error text, e.g. DocAI 401).

**DocAI token refresh:**

```bash
cd web && ./scripts/refresh-docai-token.sh
# then restart Vite so VITE_* env reloads
```

---

## 8. PDF engines

| Engine | Load / parse | Visual render | Write replacements |
|--------|--------------|---------------|--------------------|
| **mupdf** | Yes (primary text + write) | Pixmap in tools | **Yes** — primary (chunked burn/FreeText) |
| **pdfium** | Fallback load | **Yes** — visual verification @ 300 DPI | No (throws if write attempted) |
| **pdfjs** | Text extract + **run geometry** | Text runs for layout | No |
| **remote** | Optional `/v1/parse` | — | Optional `/v1/replace` |

Write strategy: **white Square cover** over original glyphs + **FreeText** annotation text — **no redaction holes**. Remote engine mode is toggleable in Additional Tools.

---

## 9. OEM Perfect Replica (the product heart)

**Entry:** `runOemPerfectReplica` — `src/lib/oem-replica/`  
**Docs:** `docs/oem-perfect-replica.md`, `docs/three-part-layout-analysis.md`, `docs/perfect-replacement-pipeline.md`

### 9.1 Three-part layout analysis

Every page’s text runs are classified:

| Part | Name | Replica rule |
|------|------|--------------|
| **1** | Static chrome | Logo, titles, column headers, rules, legal/ABN — **keep OEM vectors** |
| **2** | Header/footer variables | Name, address, BSB, account, period, balances, page n of m — **inject** |
| **3** | Transaction table | Date · description · amount · balance — **regenerate rows**, preserve bank structure |

Implementation: `statement-layout/analyze.ts`, `classify-runs.ts`, `txn-structure.ts`.

### 9.2 Transaction structure fidelity

Banks identify transactions differently (St George multi-line + embedded dates + refs vs CBA debit/credit columns, etc.). The app builds a **structure profile** from the source and formats synthetic descriptions to match.

### 9.3 Write paths (picked by document)

| Path | When / what |
|------|-------------|
| `filled-geometry` | `runPerfectReplacement` on original PDF (geometry multi-pass FreeText) |
| `st-george-layered` | St George TEMPLATE 2 base + placement map |
| `token-template` | Token-based St George fill |
| `hybrid-fallback` | Soft perfect replacement |

Live preview fallback if OEM throws: perfect replacement → classic `materializeCandidatePdf`.

---

## 10. Balance, math, generation

### Balance engine (`balance-engine.ts`)

- Infer opening balance  
- Recompute running balances (`hybridBalances` / cascade)  
- `buildBalancePreview` — always-on workspace strip with yellow mismatch overlays  
- `applyRenderWithFallbacks` — Confirm & Render  

### Final math check (`math-check.ts`)

Re-validates ledger integrity and running-balance consistency after edits/generation.

### Statement generator (`statement-gen/`)

Config-driven synthetic statement engine:

- Merchants, formatters, pagination, quality reports  
- Export CSV, print view  
- Apply generated ledger into the app table  
- Stress suite for Test Lab  

### Advanced generation tools (`tools/`)

| Tool | Role |
|------|------|
| Bank-description packs | Bank-authentic description strings (`bank-descriptions/`) |
| Advanced generator | Full synthetic replace + font run linking |
| Date shift | Shift all dates + period bounds |
| Font analysis | Run fonts, complete font names for write |
| Hybrid geometry | Template + geometry extract assist |
| St George fill | Token / layered template fill |
| DocAI admin | Processor snapshot / train / deploy |
| Remote engine | Probe + parse/replace mode |
| Chrome Unredacter | Optional variable path for unredacted text recovery |

---

## 11. Verification & forensics

### Visual (`verification/`)

- Materialize candidate PDF  
- Pdfium render at **300 DPI** (configurable thresholds)  
- Metrics: **SSIM**, **tile-max**, **perceptual hash**, per-pixel  
- Optional **Applitools Eyes** if `VITE_APPLITOOLS_API_KEY` set  
- Thresholds panel: load/save pass criteria  

### Fidelity forensics (`forensics/`)

- Local layer comparison vs original source  
- Optional AI fidelity / authenticity analysis  
- Panel: `FidelityForensicsPanel`  

### Completeness & findings

- Score card + findings list after extract  
- Summary cards (in/out/net, period)  
- Charts for spending categories  

---

## 12. UI component map

### Shell / navigation

| Component | Role |
|-----------|------|
| `AppHeader` | Brand, Editor/Test Lab mode, API strip, engine tags |
| `UploadDropzone` | File pick |
| `ParserSelector` | Document parser choice |
| `ExtractProgress` | Extraction step machine |
| `WorkflowStepper` | Pipeline steps + gates |
| `Toolbar` | Secondary actions (undo/redo, export shortcuts, etc.) |
| `ApiStatusPanel` | Env/key readiness probes |

### Stage panels

| Component | Step |
|-----------|------|
| `TransactionTable` | Edit (primary data surface) |
| `BalanceOutPreview` | Balance |
| `ConfirmRenderPanel` | Render |
| `VisualValidate` | Visual |
| `FinalMathCheck` | Math |
| `StatementGeneratorDashboard` | Generate |
| `FidelityForensicsPanel` | Fidelity |
| Export CTAs on `complete` / toolbar | Complete |

### Previews & compare

- `PdfDocumentViewer` / `PdfPageViewer` — source PDF  
- `RegeneratedPdfPreview` — live candidate  
- `SideBySideComparison` — original vs regenerated  
- `StatementPrintView` — generator print layout  
- `StatementCharts`, `SummaryCards`, `CompletenessScoreCard`, `FindingsPanel`  

### Advanced / ops

- `AdditionalToolsPanel` — tabs: generator, dates, fonts, docai, geometry, remote  
- `AuditPanel` — log, history, draft, report download  
- `TestWorkflowPanel` — Test Lab stages + stress  
- `VerificationThresholds` — SSIM/tile/pHash gates  

### Design system

Full shadcn/ui kit under `components/ui/*` (button, dialog, tabs, table, sidebar, etc.).

---

## 13. `src/lib` architecture (mental model)

```
lib/
├── parsers/           # Document extraction backends + bank YAML
├── pdf-engines/       # mupdf / pdfium / pdfjs load + write options
├── statement-layout/  # Three-part run classification
├── perfect-replacement/  # Geometry replace multi-strategy
├── oem-replica/       # Orchestrator: layout → structure → path → PDF
├── st-george-template/   # St George token + layered fill
├── statement-gen/     # Synthetic statement engine
├── balance-engine.ts  # Running balances
├── math-check.ts      # Integrity
├── verification/      # Visual metrics + thresholds
├── forensics/         # Authenticity / layer forensics
├── audit/             # Log, undo, drafts, report, PDF audit page
├── tools/             # Advanced ops (generators, remote, fonts…)
├── generation/        # Bank-template assist helpers
├── ai.ts              # Optional categorize / validate / fidelity AI
├── api-status.ts      # Credential readiness
├── export.ts          # CSV / JSON / download bytes
├── parse-transactions.ts / edit-utils / money / categorize / …
└── types.ts           # Shared domain types
```

---

## 14. Configuration & secrets

Copy `web/.env.example` → `web/.env.local`:

| Variable | Purpose |
|----------|---------|
| `VITE_LLAMAPARSE_API_KEY` / `VITE_LLAMA_CLOUD_API_KEY` | LlamaParse |
| `VITE_GOOGLE_DOCAI_PROJECT` | GCP project |
| `VITE_GOOGLE_DOCAI_LOCATION` | `us` / `eu` |
| `VITE_GOOGLE_DOCAI_PROCESSOR` | Processor id |
| `VITE_GOOGLE_DOCAI_TOKEN` / `VITE_GOOGLE_ACCESS_TOKEN` | OAuth access token (~1h) |
| `VITE_MINDEE_API_KEY` | Mindee (optional) |
| `VITE_REMOTE_ENGINE_URL` / `VITE_TOOLKIT_URL` | Remote parse/replace / AI toolkit |
| `VITE_APPLITOOLS_API_KEY` | Optional visual cloud |

**Important:** Vite bakes `VITE_*` at process start — after token refresh, **restart the dev server**. Never commit `.env.local`.

Setup notes: `docs/google-document-ai-setup.md`.

---

## 15. Scripts & tests

### npm scripts (`web/package.json`)

| Script | Purpose |
|--------|---------|
| `dev` | Vite dev server (port 8080) |
| `build` / `preview` | Production build + preview |
| `test` | Unit + browser Vitest |
| `test:watch` / `test:browser` | Interactive / browser-only |
| `regen:final`, `regen:final-pdf` | Final statement regeneration suites |
| `stress:workflow`, `stress:all-tools`, `stress:triple` | Stress / triple replica |
| `font-cli` | Font utility |

### Test coverage areas (illustrative)

Parsers, balance/render, perfect replacement, OEM replica, St George fill, statement-gen, layout analysis, forensics, audit, image metrics, full workflow stress, write coordinate space, tools.

### Optional native CLI

`tools/pymupdf_pipeline/` — Python + PyMuPDF for offline description/amount replace with bank generators. Parallel to the web app, not required at runtime.

---

## 16. What is shipped vs planned

| Feature | Status |
|---------|--------|
| Single-file upload → edit → generate → rematerialize → verify → export | **Shipped** |
| Multi-parser + bank YAML | **Shipped** |
| OEM three-part + structure fidelity pipeline | **Shipped** |
| Live regenerated PDF preview | **Shipped** |
| Visual SSIM/tile/pHash + math + forensics | **Shipped** |
| Audit log / history / draft / PDF audit page | **Shipped** |
| Test Lab + stress suites | **Shipped** |
| St George templates (public PDFs) | **Shipped** |
| Remote engine parse/replace | **Shipped** (needs URL) |
| Multi-file bulk queue UI | **Planned** |

---

## 17. Operator quick reference

```bash
# Install & run
cd web
npm install          # or bun install
npm run dev          # http://localhost:8080/

# Refresh Google Document AI token (expires ~1h)
./scripts/refresh-docai-token.sh
# restart Vite after this

# Tests
npm test
npm run stress:workflow
```

**Typical session**

1. Confirm API strip shows needed parsers green (or use local pymupdf)  
2. Upload statement PDF  
3. Review completeness score + findings  
4. Edit table and/or open Generate / Additional Tools  
5. Watch Balance strip + live regenerated PDF  
6. Run Visual + Math (+ Forensics if needed)  
7. Export final PDF + audit JSON  

---

## 18. Related deep-dive docs

| Doc | Topic |
|-----|-------|
| `product-concept.md` | Product vision & capability matrix |
| `runtime-functionality-analysis.md` | What actually runs on the happy path (call graph) |
| `oem-perfect-replica.md` | OEM orchestrator paths & gates |
| `three-part-layout-analysis.md` | Part1/2/3 + structure fidelity |
| `perfect-replacement-pipeline.md` | Geometry replace strategies |
| `fidelity-integration-design.md` | Fidelity tiers T0–T3 |
| `statement-generation-concepts.md` | Generator design |
| `google-document-ai-setup.md` | DocAI project/processor/token |
| `design/brief.md` | UI/UX “ledger command center” brief |
| `st-george-layer-analysis/` | Empirical St George layer/geometry notes |

---

## 19. One-paragraph summary

**Bank Statement Fidelity Editor** is a single-page Vite/React workstation that turns a real bank statement PDF into an editable, rebalanced, regenerable ledger and writes synthetic or corrected data back onto the **original PDF geometry** via MuPDF FreeText (OEM perfect replica), then proves the result with visual metrics, math checks, forensics, and a full audit trail — with cloud parsers (LlamaParse, Document AI), local WASM engines (MuPDF, Pdfium, PDF.js), bank-specific generators and YAML templates, and a Test Lab for stress validation.
