# Perfect Replacement Pipeline

Bulletproof multi-strategy data replacement for **any** uploaded bank statement PDF, integrated into the auto workflow (live preview + export).

> Product vision: **Bank Statement Fidelity Editor** — exact replica via automated logic generator data injection. See [`product-concept.md`](./product-concept.md).

## Problem

Single-path “match runs → FreeText” fails on:

- Token templates (`{BSB}`, `{FIRSTNAME LASTNAME}`, …)
- Sparse / multi-line descriptions (St George)
- Stacked edit queues and bad geometry
- Redaction-based writes leaving blank holes

## Solution

`runPerfectReplacement()` in `src/lib/perfect-replacement/`:

```
classify → classify
  ├─ token-template  → template-tokens (St George fill)
  └─ filled-statement → geometry multi-pass + row-cluster residual
queued-edits (always merge)
hybrid-merge (dedupe, never empty)
write: Square cover + FreeText (NO redactions)
gates + score → auto workflow / export
```

### Strategies

| ID | When | What |
|----|------|------|
| `queued-edits` | Always | Explicit PdfEdits from tools/clicks |
| `template-tokens` | `{…}` shell detected | St George Complete Freedom fill |
| `geometry-link` | Filled statements | Dual-pass run-match (preferOriginal + current) |
| `row-cluster` | Residual gaps | Y-band column assignment for unmatched rows |
| `hybrid-merge` | Always | Dedupe by geometry; drop blanks |

### Write policy

- **Never** PDF `Redact` / `applyRedactions`
- White **Square** cover + **FreeText** with real text only
- Sanitized text + finite bboxes before WASM write

### Auto workflow integration

| Trigger | Action |
|---------|--------|
| Ledger / `pdfEdits` change | Debounced `runPerfectReplacement` → live preview |
| Export final PDF | Same pipeline (prefers live candidate when ready) |
| St George template button | Direct `fillStGeorgeTemplate` + preview |

### Coverage gates

- `has-edits` — at least one non-empty replacement when delta exists  
- `description-coverage` — applied/changed ≥ threshold (default ~40–45%)  
- `no-blank-replacements` — always enforced  

Score 0–100 feeds UI notes (`strategy:class:scoreNN`).

## Fixtures verified

| PDF | Class | Result |
|-----|--------|--------|
| St George #726 (filled) | filled-statement | 22/22 desc, score 90 |
| Desktop TEMPLATE | token-template | 27 edits, score 90 |

## API

```ts
import { runPerfectReplacement } from "@/lib/perfect-replacement";

const result = await runPerfectReplacement({
  sourcePdf,
  sourceBaseline, // parse freeze
  current,        // after generate / bank-desc
  queuedEdits,
  variables,      // optional chrome
  strict: false,
});
// result.candidatePdf · result.score · result.coverage
```
