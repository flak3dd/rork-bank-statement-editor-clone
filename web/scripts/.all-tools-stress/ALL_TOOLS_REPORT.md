# All Additional Tools stress report

- All passed: **true**
- 12/12 tools
- Baseline parse: 22 transactions

| Tool | Status | Detail |
|------|--------|--------|
| bank-descriptions | PASS | 9 banks · rewrite ok |
| advancedGenerator+run-match+font-edits | PASS | txns=22 runs=348 linked=95 edits=82 |
| pymupdf-replace (bank-desc) | PASS | mode=table+geometry edits=45 material=full-ledger |
| date-shift | PASS | period 2024-08-24→2024-11-18 · shifted 22 |
| font-analysis | PASS | 2 fonts · complete="Helvetica Neue, Arial, sans-serif", "Times New Roman", Georgia, serif |
| hybrid-geometry | PASS | txns=39 notes=3 |
| pdf-runs | PASS | 251 runs page1-2 |
| run-match | PASS | fields=90 linked=95 paired=95 |
| docai-admin | PASS | configured · snapshot ok · train soft-fail: Train HTTP 403: {
  "error": {
    "code": 403,
    "message": "This API met |
| remote-engine | PASS | configured · parse soft-fail: fetch failed |
| pymupdfCliHint | PASS | python tools/pymupdf_pipeline/replace_statement.py --pdf statement.pdf --bank an |
| advancedGenerator(locale=us) | PASS | txns=6 |
