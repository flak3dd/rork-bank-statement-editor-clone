# Runtime Functionality Analysis — What Actually Runs

**Scope:** Happy-path **upload → edit → generate/replace → balance → render → visual → math → export** on the Vite app (`Index.tsx`).  
**Method:** Static call-graph from UI handlers + import reachability from `pages/` + `components/` (not “every file that exists”).  
**Date:** 2026-07-19

---

## 1. Entry & shell (always on mount)

| Function / module | Role |
|-------------------|------|
| `main.tsx` → `App.tsx` → `pages/Index.tsx` | SPA mount |
| `AppHeader` | Branding, engine mode strip |
| `UploadDropzone` + `ParserSelector` | File pick + parser id |
| `loadParserPreference` / `DEFAULT_DOCUMENT_PARSER` | Default **`pymupdf`** |
| `loadEngineMode` / `isRemoteEngineConfigured` | local vs remote parse |
| `ApiStatusPanel` → `api-status` | Env/key probes (display only unless opened) |

**Not used until user acts:** Test Lab, Additional Tools tabs, forensics, export.

---

## 2. Upload / extract path (`handleFile`)

```
file.arrayBuffer → cloneUint8Array → setPdfBytes
  ├─ [if engineMode=remote + URL] remoteParsePdf (/v1/parse)
  │     └─ on empty/error → runDocumentParser(parserId)
  └─ [else] runDocumentParser(parserId)
        └─ default: pyMuPdfParser.parse
              ├─ extractTextWithPyMuPdf (mupdf WASM)
              │     └─ fallback extractTextFromPdf (pdfjs)
              ├─ structurePyMuPdfText
              │     ├─ detectBankTemplate (YAML)
              │     ├─ coalesceMultilineStatementText
              │     └─ parseTransactionsHybrid
              └─ on hard fail → runOfflineHeuristicParse
  → buildExtractionResult
  → analyzeCompleteness
  → [try] aiCategorizeTransactions + aiHybridValidate  (soft-skip if AI down)
  → setSourceBaseline (freeze)
  → appendAuditEvent(parse.complete)
```

### Functions **actually called** on default local upload

| Layer | Functions |
|-------|-----------|
| Index | `handleFile`, `cloneUint8Array`, `setStep`/`initialSteps` |
| Parsers | `runDocumentParser` → **`pyMuPdfParser.parse`** |
| PyMuPDF | `extractTextWithPyMuPdf`, `parseWithPyMuPdf` / `structurePyMuPdfText`, `coalesceMultilineStatementText` |
| Templates | `detectBankTemplate`, noise + descriptionCleanup |
| Hybrid | `parseTransactionsHybrid`, `attachOriginals` |
| Completeness | `analyzeCompleteness`, `buildExtractionResult`, `buildSummary` |
| AI (optional) | `aiCategorizeTransactions`, `aiHybridValidate` |
| Audit | `appendAuditEvent`, `emptyUndoState` |

### Parser branches **only if selected / remote**

| Parser id | Module | When |
|-----------|--------|------|
| `mindee` | `parsers/mindee.ts` | User selects Mindee + API key |
| `llamaparse` | `parsers/llamaparse.ts` | User selects + key |
| `google-docai` | `parsers/google-docai.ts` | User selects + credentials |
| `local-ocr` | `parsers/local-ocr.ts` | User selects |
| `offline-heuristic` | `parsers/offline-heuristic.ts` | User selects **or** PyMuPDF hard-fail |
| remote | `tools/remote-engine.remoteParsePdf` | Engine mode = remote + URL |

---

## 3. Workspace steps (stepper primary button)

| Step | Primary action | Live functions |
|------|----------------|----------------|
| **edit** | Advance | Table edits → `countDirty`, `dirtyFields`, undo `pushSnapshot` / `undo` / `redo` |
| **balance** | Advance | **Always live:** `buildBalancePreview` → `hybridBalances` / `recomputeBalances` / `inferOpeningBalance` / `movementOf` |
| **render** | `handleConfirmRender` | `applyRenderWithFallbacks` → balance cascade; `loadPdfWithFallbacks("mupdf")` **probe only**; optional `rebuildLiveCandidatePdf` |
| **visual** | `handlePixelCheck` | `materializeCandidatePdf` or live candidate; `runVisualVerification` → Pdfium render + `image-metrics` (SSIM/tile/pHash); optional Applitools |
| **math** | `handleMathCheck` | `runFinalMathCheck` |
| **generate** | Generator apply / bank replace | See §4 |
| **fidelity** | `handleForensics` | `runFidelityForensics` → local layers + optional `aiFidelityAnalysis` |
| **complete** | Export | `handleExportPdf` or `exportCsv` |

---

## 4. Live PDF rewrite (auto + export) — **core path**

Triggered by:

- Debounced ledger/edits change → `rebuildLiveCandidatePdf`
- Confirm render (if balances updated) → `rebuildLiveCandidatePdf`
- Export final PDF → `handleExportPdf`

### Primary call stack

```
runOemPerfectReplica
  ├─ extractTextWithPyMuPdf          (if rawText thin)
  ├─ analyzeStatementLayout
  │     ├─ getPageTextRunsFromBytes (pdfjs)
  │     ├─ classifyRun (layout parts 1/2/3)
  │     ├─ buildTransactionRows
  │     └─ buildTxnStructureProfile
  ├─ assistLedgerWithBankTemplate    (YAML cleanup, flags; rewriteDescriptions=false on OEM)
  ├─ applyStructureToLedger
  ├─ pickPath →
  │     filled-geometry → runPerfectReplacement
  │     │   ├─ classifyDocument
  │     │   ├─ linkRunMatches + pairGeneratedToMatches
  │     │   ├─ buildFontReplicatedReplacements
  │     │   ├─ strategyRowCluster
  │     │   ├─ buildStGeorgeTemplateEdits (token-template only)
  │     │   └─ applyReplacementsWithFallbacks
  │     │         ├─ mupdf chunked applyReplacements (burn+FreeText)
  │     │         └─ remoteReplacePdf (/v1/replace) if configured
  │     st-george-layered → fillStGeorgeLayered
  │     │   └─ applyReplacementsWithFallbacks (burn=false, chunked)
  │     token-template → fillStGeorgeTemplate
  │     hybrid-fallback → runPerfectReplacement
  └─ [export] appendAuditPageToPdf + downloadMergedReport + downloadBytes
```

### Fallback if OEM throws (live preview only)

```
runPerfectReplacement → materializeCandidatePdf → applyReplacementsWithFallbacks
```

---

## 5. Advanced tools (user-initiated only)

| UI action | Functions used |
|-----------|----------------|
| Bank-desc replace | `replaceStatementDataWithGeneration` → `assistLedgerWithBankTemplate` / generators → `linkRunMatches` → `buildFontReplicatedReplacements` |
| Advanced generator | `advancedGenerator` + `replaceWithGenerated` + font runs |
| Date shift | `shiftTransactionDates`, `periodBounds` |
| Font analysis | `getPageTextRunsFromBytes`, `analyzeFonts`, `completeFontName` |
| Hybrid geometry | `extractWithHybridGeometry` → `detectBankTemplate` |
| St George fill | `fillStGeorgeTemplate` / public template fetch |
| DocAI admin | `fetchDocAiAdminSnapshot`, `deployProcessorVersion`, `trainProcessorVersion` |
| Remote tab | `probeRemoteEngine`, `remoteParsePdf`, `saveEngineMode` |
| Chrome / Unredacter | `chrome-unredact` (via generator dashboard variables) |

These are **not** on the automatic upload path unless the user opens Advanced tools.

---

## 6. Engines — what actually writes vs probes

| Engine | Load/parse | Visual render | PDF write (replacements) |
|--------|------------|---------------|---------------------------|
| **mupdf** | Yes (parser + OEM text) | Via pixmap in tools | **Yes** — primary (chunked burn/FreeText) |
| **pdfium** | Fallback load | **Yes** — visual verification | **No** (throws if write attempted) |
| **pdfjs** | Text extract fallback | Text runs for geometry | **No** |
| **remote** | `/v1/parse` optional | — | `/v1/replace` optional |

**Confirm Render** only **probes** PDF load (`loadPdfWithFallbacks`). It does **not** write the statement PDF. Write happens on **Export final PDF** / live rematerialize via OEM.

---

## 7. Always-on workspace computations (no button)

| Memo / effect | Functions |
|---------------|-----------|
| Balance strip | `buildBalancePreview` |
| Dirty count | `countDirty` |
| Live PDF debounce | `rebuildLiveCandidatePdf` → `runOemPerfectReplica` |
| Summary cards | `buildSummary` |
| Autosave | `createAutosaveController`, `buildWorkflowDraft` |

---

## 8. Reachable vs effectively idle

### Import-reachable from UI (~101 `src/lib` files)

Almost all of `lib/` is import-reachable from Index + AdditionalTools. That does **not** mean every export runs each session.

### Effectively idle unless user opts in

| Area | Idle unless |
|------|-------------|
| Mindee / LlamaParse / DocAI / OCR | Parser selector |
| Remote parse/replace | Remote mode + URL |
| Applitools Eyes | Env configured + visual run |
| DocAI admin train/deploy | Tools → DocAI |
| Font analysis / hybrid geometry tabs | Tools opened |
| Stress / Test Lab suite | Test Lab mode |
| `statement-gen` full print/CSV | Generator dashboard apply |
| `generation/index.ts` barrel | Unused re-export only (`from-bank-template` is used) |

### Known “exists but not on happy path”

- Python CLI `tools/pymupdf_pipeline/replace_statement.py` — docs/hints only from web
- Many UI shadcn primitives unused in main workflow
- Pdfium `applyReplacements` intentionally non-writing

---

## 9. Default full run — function checklist (ordered)

**Assume:** local mode, default parser `pymupdf`, user edits a few amounts, Confirm Render, Export PDF.

1. `handleFile`  
2. `runDocumentParser("pymupdf")` → `pyMuPdfParser.parse`  
3. `extractTextWithPyMuPdf` → mupdf `Document.openDocument` / `countPages` / `toStructuredText`  
4. `structurePyMuPdfText` → `detectBankTemplate` → `coalesceMultilineStatementText` → `parseTransactionsHybrid`  
5. `buildExtractionResult` + `analyzeCompleteness`  
6. `aiCategorizeTransactions` / `aiHybridValidate` *(optional)*  
7. UI edit → transaction state updates + audit/undo  
8. `buildBalancePreview` (live)  
9. Debounced `runOemPerfectReplica` (preview)  
10. `handleConfirmRender` → `applyRenderWithFallbacks` → `recomputeBalances`/`hybridBalances`  
11. `loadPdfWithFallbacks("mupdf")` *(probe)*  
12. `handlePixelCheck` → `runVisualVerification` *(if user continues)*  
13. `handleMathCheck` → `runFinalMathCheck` *(if user continues)*  
14. `handleExportPdf` → `runOemPerfectReplica` → `runPerfectReplacement` → `applyReplacementsWithFallbacks` (mupdf chunks)  
15. `appendAuditPageToPdf` + `downloadMergedReport` + `downloadBytes`  

---

## 10. Gaps / misleading UI (from analysis)

| Symptom | Cause |
|---------|--------|
| “PDF engine: pdfium (fallback)” on Confirm Render | Load probe fell back; **not** the write engine |
| “0 balances updated” (before fix) | Hybrid re-anchored to stale stated; stated fallback always “healthy” |
| Many YAML templates listed | Only **detected** template affects generation assist each run |
| 280+ lib exports | ~half only used if tools/Test Lab/cloud parsers engaged |

---

## 11. Conclusion

**Core runtime spine** (what makes a real replica session work):

`pymupdf parse` → ledger state → `buildBalancePreview` / `applyRenderWithFallbacks` → `runOemPerfectReplica` → `runPerfectReplacement` → `applyReplacementsWithFallbacks(mupdf)` → audit/export.

Everything else is **branch optional** (cloud parsers, remote, tools tabs, forensics AI, Eyes).
