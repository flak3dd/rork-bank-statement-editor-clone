# Full stress mission — COMPLETE

**Date:** 2026-07-19  
**Fixture:** St George Bank Acc Statement #726 (21.08.24–19.11.24)

## Three consecutive zero-error complete suite runs

| Cycle | Command | Test files | Tests | Failures | `Warning:` count | Exit |
|------:|---------|------------|------:|---------:|-----------------:|-----:|
| 1 | `npx vitest run` | 18 | 68 | 0 | 0 | 0 |
| 2 | `npx vitest run` | 18 | 68 | 0 | 0 | 0 |
| 3 | `npx vitest run` | 18 | 68 | 0 | 0 | 0 |

## Three consecutive perfect replica gate runs

`npm run stress:triple` (anz → cba → westpac)

| Run | Bank | Edits | Mode | Visual score | Math | Status |
|----:|------|------:|------|-------------:|-----:|--------|
| 1 | anz | 54 | full-ledger | 72 | 100 | PASS |
| 2 | cba | 55 | full-ledger | 69 | 100 | PASS |
| 3 | westpac | 55 | full-ledger | 68 | 100 | PASS |

Each run: parse → advanced generator inject → bank-desc descriptions → recompute balances → full-ledger materialize → MuPDF write → export apply → visual render @ 150 DPI.

## Workflow stress (embedded in suite)

5/5 unique flawless consecutive workflow variants (offline-heuristic, pymupdf, local-ocr × bank-desc / generate-apply / hybrid).

## Dev server smoke

- `http://127.0.0.1:8080/` → 200
- Module graph (`Index.tsx`, tools, materialize, mupdf-engine) → 200

## Artefacts

- `scripts/.triple-perfect/run-*/regenerated.pdf`
- `scripts/.triple-perfect/TRIPLE_PERFECT_REPORT.json`
- `scripts/.final-pdf-gen/final-regenerated.pdf`
- `scripts/.workflow-stress/WORKFLOW_STRESS_REPORT.md`
- `scripts/.all-tools-stress/ALL_TOOLS_REPORT.md`
