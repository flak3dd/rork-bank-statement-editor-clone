# Two Major Steps: Layout Analysis + Transaction Structure Fidelity

When applying the Bank Statement Fidelity Editor concept to **any** PDF (not only St George), two steps are non-negotiable.

---

## Step 1 — Perfect initial analysis / parse (three-part map)

The first parse must cleanly extract and map every page into **three parts**:

| Part | Name | What it is | Replica rule |
|------|------|------------|--------------|
| **1** | **Static (unchanged)** | Logo, product titles, section labels (`Transactions`, column headers), horizontal rules, legal/ABN/licence chrome, fixed country labels | **Keep as-is** on the base layer — never strip or rewrite |
| **2** | **Header & footer variables** | Holder name, address, BSB, account number, account opened, statement period / day count, current/opening balance, date created, page n of m | **Replace** with generated/injected values at measured geometry |
| **3** | **Transaction table** | Date · description (multi-line) · credit/debit or signed amount · running balance; optional reference lines | **Regenerate rows** but **keep the bank’s row structure** (Step 2) |

```
Source PDF
   │
   ▼
run-level geometry extract (PDF.js / MuPDF)
   │
   ▼
classify each run → part1 | part2 | part3
   │
   ├─ Part 1 → frozen base layer
   ├─ Part 2 → variable injection slots
   └─ Part 3 → table columns + row clusters + structure samples
```

### Implementation

| Module | Role |
|--------|------|
| `src/lib/statement-layout/analyze.ts` | `analyzeStatementLayout(pdfBytes)` |
| `src/lib/statement-layout/classify-runs.ts` | Per-run part/role classification |
| `src/lib/statement-layout/types.ts` | Contracts for the three parts |

### Quality gates (Step 1)

- `has-static` — enough Part 1 chrome to form a base  
- `has-txn-or-shell` — filled table **or** empty base shell  
- `three-parts-present` — static + (vars or txns)  

Score 0–100 is returned on the analysis object.

---

## Step 2 — Preserve bank-specific transaction structure

Banks do **not** identify transactions the same way. Synthetic data must follow the **source** structure, not a generic template.

| Bank example | Structure traits |
|--------------|------------------|
| **St.George Complete Freedom** | `dd mmm` date; primary type line often **embeds process date** (`Visa Purchase 14Nov`); secondary merchant/type (`Oz Lotteries Melbourne`, `Interbank Trans`); optional **digit reference** line; **signed amount** + balance columns |
| **ANZ / CBA / NAB** | Often `dd/mm/yyyy`; separate **debit/credit** columns; channel codes; trailing refs |
| **Westpac** | Narrative with card/date tokens; multi-line merchant |

### What we measure from Part 3 samples

- Multi-line description rate  
- Embedded date-in-description rate  
- Standalone reference rate  
- Signed amount vs debit/credit layout  
- Prefix families (`Visa`, `Osko`, `Eftpos`, `Sct`, `BPAY`, …)  
- Median **row pitch** and column X anchors  

### Profile + formatters

| API | Purpose |
|-----|---------|
| `buildTxnStructureProfile({ rows, rawText })` | Infer bank structure from this PDF |
| `formatDescriptionToStructure(profile, raw)` | Force synthetic text into primary / secondary / reference |
| `joinStructuredDescription(parts)` | Ledger string for balance engine |

**Rule:** generators (bank-desc packs, advanced generator) should pass output through the structure profile for the **active document**, so a St George replica never gets CBA-style lines (and vice versa).

---

## End-to-end compose (any bank)

```
1. analyzeStatementLayout(sourcePdf)     → three parts + structure profile
2. freeze Part 1 as base (or TEMPLATE 2-style shell when available)
3. generate ledger (balances cascade)
4. format each description via txnStructure profile
5. paint Part 2 vars + Part 3 rows at measured geometry
6. verify SSIM / math / forensics
```

For St George specifically, the three files map as:

| File | Maps to |
|------|---------|
| TEMPLATE 2 | Pure Part 1 base (+ empty Part 2/3 slots) |
| TEMPLATE | Part 2/3 **placement geometry** (`{TOKEN}` map) |
| Final #726 | Filled Part 2 + Part 3 **structure target** |

See also: `docs/st-george-layer-analysis/`, `docs/product-concept.md`.
