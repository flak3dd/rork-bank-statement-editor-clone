# Final statement regeneration report

- Started: 2026-07-19T11:52:35.107Z
- Duration: 653ms
- Perfect: **true**
- Stress suite: 80/80 · 3634 rows
- Banks: anz, cba, westpac, ing, bankwest, suncorp, macquarie, other

## Per-bank cases

| Bank | Seed | Txns | Close | Quality | Rewrite |
|------|------|------|-------|---------|---------|
| anz | 9000 | 50 | 7946.54 | A 100 | ok |
| cba | 9013 | 53 | 7801.16 | A 100 | ok |
| westpac | 9026 | 52 | 6641.55 | A 100 | ok |
| ing | 9039 | 52 | 6268.37 | A 100 | ok |
| bankwest | 9052 | 56 | 6256.51 | A 100 | ok |
| suncorp | 9065 | 52 | 5951.4 | A 100 | ok |
| macquarie | 9078 | 53 | 6339.07 | A 100 | ok |
| other | 9104 | 46 | 6668.29 | A 100 | ok |

## PyMuPDF

```json
{
  "status": 0,
  "ok": true,
  "stdout": "{\n  \"input\": \"/Users/adminuser/rork-bank-statement-editor-clone/tools/pymupdf_pipeline/fixtures/sample-statement.pdf\",\n  \"output\": \"/Users/adminuser/rork-bank-statement-editor-clone/web/scripts/.final-regen/sample-anz-replaced.pdf\",\n  \"bank\": \"anz\",\n  \"seed\": 42,\n  \"replace\": [\n    \"descriptions\"\n  ],\n  \"spans_total\": 38,\n  \"spans_by_kind\": {\n    \"description\": 8,\n    \"amount\": 16,\n    \"date\": 8,\n    \"skip\": 6\n  },\n  \"planned\": 8,\n  \"dry_run\": false,\n  \"applied\": 8\n}\n\nWrote /Users/adminuser/rork",
  "stderr": "",
  "outPdf": "/Users/adminuser/rork-bank-statement-editor-clone/web/scripts/.final-regen/sample-anz-replaced.pdf"
}
```

Artefacts written to `/Users/adminuser/rork-bank-statement-editor-clone/web/scripts/.final-regen`
