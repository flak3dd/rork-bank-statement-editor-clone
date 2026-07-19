# PyMuPDF statement replace pipeline

Replace original bank-statement PDF text with **bank-authentic generation logic** from `transactionalDescriptionGenerator.js` (Python port in `generators.py`), while **reproducing layout geometry** (same bboxes, font sizes, colors).

## Requirements

```bash
pip install pymupdf
```

## Usage

```bash
# Descriptions only (default) — ANZ formats
python tools/pymupdf_pipeline/replace_statement.py \
  --pdf path/to/statement.pdf \
  --bank anz \
  --seed 42 \
  --out path/to/out.pdf

# Also jitter amounts (±15%)
python tools/pymupdf_pipeline/replace_statement.py \
  --pdf statement.pdf --bank cba --replace descriptions,amounts --seed 7

# Dry-run (plan only)
python tools/pymupdf_pipeline/replace_statement.py \
  --pdf statement.pdf --bank westpac --dry-run
```

### Banks

| `--bank`   | Generator |
|------------|-----------|
| `anz`      | ANZ       |
| `cba`      | CommBank  |
| `westpac`  | Westpac   |
| `ing`      | ING       |
| `bankwest` | Bankwest  |
| `suncorp`  | Suncorp   |
| `macquarie`| Macquarie |
| `rams`     | RAMS      |
| `other`    | Generic   |

## How it works

1. **Extract** text spans via PyMuPDF `get_text("dict")` (bbox, size, color, font).
2. **Classify** each span: `description` | `amount` | `date` | `skip`.
3. **Generate** replacements with the bank description engine (same rules as the JS generator).
4. **Redact** original rects (white fill) then **insert_text** at the original baseline — layout replica.
5. **Audit** JSON lists every original → replacement pair.

## Web app integration

Statement Lens (Vite) imports the same JS generators:

- `web/src/lib/tools/bank-descriptions/` — ESM generators + typed wrapper
- `web/src/lib/tools/pymupdf-replace.ts` — rewrite table + queue PdfEdits for mupdf WASM export
- UI: **Additional tools → Generator → Replace original descriptions**

Browser export uses mupdf WASM (redact + FreeText insert). For **native PyMuPDF** fidelity, run this CLI.

## Fixture

```bash
python tools/pymupdf_pipeline/replace_statement.py \
  --pdf tools/pymupdf_pipeline/fixtures/sample-statement.pdf \
  --bank anz --seed 7 --out /tmp/out.pdf
```
