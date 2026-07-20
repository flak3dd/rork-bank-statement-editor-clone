# St George Layered Layout Fidelity Analysis

**Date:** 2026-07-19T05:42:13.651Z  
**Updated:** layered compose wired in `src/lib/st-george-template/layered-fill.ts`

## Role of each file

| Layer | File | Role |
|-------|------|------|
| **Base (keep as-is)** | TEMPLATE 2 | Static visual foundation — branding, labels, table headers, legal chrome, page geometry. **Nothing on this layer is stripped.** |
| **Placement map** | TEMPLATE | Shows **where** generated data is injected (`{TOKEN}` slots) when painted onto TEMPLATE 2. |
| **Structure target** | Final #726 | Shows **how** filled data should look: row density, amount formats, multi-line descriptions, continuation pages. |

**Compose rule:** `output = TEMPLATE_2_base + paint(generated_data @ TEMPLATE_token_geometry) + clone_txn_rows_to_match_#726_density`

## Pixel visual fidelity (page 1, 1× RGB)

| Pair | Mean abs Δ | % pixels Δ>8 |
|------|------------|--------------|
| TEMPLATE 2 vs TEMPLATE | **1.81** | **1.38%** |
| TEMPLATE 2 vs FINAL #726 | 6.08 | 5.18% |
| TEMPLATE vs FINAL #726 | 6.36 | 5.55% |

### Band-wise TEMPLATE 2 vs FINAL

| Band | Mean abs Δ | % diff |
|------|------------|--------|
| Header 0–200 pt | 3.17 | 2.34% |
| Table body 250–700 pt | **7.58** | **6.52%** |
| Footer 750–842 pt | **1.22** | **1.09%** |

**Read:** Base and placement map share the same chrome (logo, titles, rules, footer). Almost all visual delta vs #726 is **injected variable content** in the identity block + transaction table — exactly the layered model.

## Shared anchors (exact match all three)

| Anchor | Position |
|--------|----------|
| Complete Freedom | p1 (225, 74) |
| Transaction Listing | p1 (223, 97) |
| Account/Card number | p1 (419, 128) |
| Period line start | p1 (70, 205) |
| Table header Y | p1 y=254 |

Page size: **595×842 pt (A4)** on every page of every file.

## Transaction structure target (#726)

| Metric | Value |
|--------|-------|
| Pages | 3 |
| Date-row count | 39 |
| Row pitch | **36.6 pt** (stable 36–37) |
| Amount column X | ~394 |
| Balance column X | ~482 |
| P1 rows before footer | 13 |
| P2+ first row Y | 155 |
| Secondary desc offset | ~12 pt below primary |

## File metrics

| Doc | Pages | Text runs | Bytes | Page size |
|-----|-------|-----------|-------|-----------|
| TEMPLATE 2 | 2 | 41 | 41000 | 595×842, 595×842 |
| TEMPLATE | 2 | 63 | 40752 | 595×842, 595×842 |
| FINAL #726 | 3 | 255 | 22547 | 595×842, 595×842, 595×842 |

## Page geometry fidelity

All three share **A4 (595×842 pt)** — layout canvas matches.

| Doc | P1 runs | P2 runs | …

| Doc | P1 runs | P2 runs | P3 runs |
|-----|---|---|---|
| template2 | 27 | 14 | — |
| template | 45 | 18 | — |
| final | 91 | 91 | 73 |

## TEMPLATE tokens (data placement map)

Unique tokens found: **15**

### `{ACCOUNT}` (2 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 459 | 140 | 56 | 16 | {ACCOUNT} |
| 2 | 471 | 89 | 56 | 16 | {ACCOUNT} |

### `{ADDRESS LINE 1}` (1 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 70 | 143 | 96 | 14 | {ADDRESS LINE 1}   |

### `{ADDRESS LINE 2}` (1 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 70 | 155 | 96 | 14 | {ADDRESS LINE 2}   |

### `{AMOUNT}` (4 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 385 | 287 | 50 | 16 | {AMOUNT} |
| 1 | 474 | 287 | 50 | 16 | {AMOUNT} |
| 2 | 385 | 155 | 50 | 16 | {AMOUNT} |
| 2 | 474 | 155 | 50 | 16 | {AMOUNT} |

### `{BSB}` (1 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 424 | 140 | 26 | 16 | {BSB} |

### `{CURRENT BALANCE}` (1 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 153 | 229 | 107 | 16 | {CURRENT BALANCE}  |

### `{DATE CREATE {TIME}` (1 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 2 | 132 | 800 | 109 | 16 |  {DATE CREATE {TIME} |

### `{DATE}` (1 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 467 | 164 | 33 | 16 | {DATE} |

### `{FIRSTNAME LASTNAME}` (1 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 70 | 131 | 127 | 14 | {FIRSTNAME LASTNAME}  |

### `{FROM DATE}` (1 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 400 | 206 | 67 | 14 | {FROM DATE} |

### `{STGEORGE TRANSACTION}` (3 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 115 | 287 | 137 | 16 | {STGEORGE TRANSACTION} |
| 1 | 115 | 324 | 137 | 16 | {STGEORGE TRANSACTION} |
| 2 | 70 | 155 | 183 | 16 | {dd mmm}{STGEORGE TRANSACTION} |

### `{TIME}` (1 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 208 | 800 | 30 | 16 | {TIME} |

### `{TO DATE}` (1 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 482 | 206 | 51 | 14 | {TO DATE} |

### `{X}` (4 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 498 | 800 | 13 | 16 | {X} |
| 1 | 522 | 800 | 16 | 16 |  {X} |
| 2 | 498 | 800 | 13 | 16 | {X} |
| 2 | 522 | 800 | 16 | 16 |  {X} |

### `{dd mmm}` (3 hit(s))

| page | x | y | w | h | context |
|------|---|---|---|---|----------|
| 1 | 70 | 287 | 45 | 16 | {dd mmm} |
| 1 | 70 | 324 | 45 | 16 | {dd mmm} |
| 2 | 70 | 155 | 183 | 16 | {dd mmm}{STGEORGE TRANSACTION} |

## TEMPLATE 2 base chrome (static — keep)

Tokens on TEMPLATE 2: **2**  
`{FROM DATE}`, `{TO DATE}`

### Page 1 row bands (Y-order)

- y=74: Complete Freedom
- y=97: Transaction Listing
- y=128: Account/Card number
- y=166: AUSTRALIA \|       \| Account Opened: 
- y=191: Transactions
- y=205: This statement covers the last  \| {NUMBER OF DAYS) \|  days of transactions  \| ( \|  to  \| ). \| {FROM DATE} \| {TO D
- y=230: Current Balance: 
- y=254: Date \| Transaction \| Amount \| Balance \|  
- y=784: St.George Bank - A Division of Westpac Banking Corporation ABN 33 007 457 141 AFSL and Australian credit licence 233714
- y=800:   \|   \| Date created: \| Page  \|  of

## FINAL #726 structure (target density)

### Page 1 row bands (sample)

- y=56:  
- y=74: Complete Freedom
- y=97: Transaction Listing
- y=114:  
- y=128: Account/Card number \| ELYSIA LEAVER
- y=140: 116-879   453 657 726 \| 48 DENISON ST
- y=154: COOMA NSW 2630
- y=164: Account Opened:  \| 31-Aug-2021 \| AUSTRALIA
- y=191: Transactions
- y=205: This statement covers the last 90 days of transactions  \| (21-Aug-2024 to 19-Nov-2024).
- y=229: $64,474.33 \| Current Balance: 
- y=254: Date \| Transaction \| Amount \| Balance
- y=272:  
- y=287: 18 Nov \| Visa Purchase 14Nov \| -$99.30 \| $64,474.33
- y=299: Oz Lotteries Melbourne
- y=324: 18 Nov \| Elysia Anne Leav \| $10,000.00 \| $64,573.63
- y=336: Interbank Trans
- y=361: 18 Nov \| Elysia Anne Leav \| $10,000.00 \| $54,573.63
- y=373: Interbank Trans
- y=397: 18 Nov \| Elysia Anne Leav \| $10,000.00 \| $44,573.63
- y=409: Interbank Trans
- y=434: 18 Nov \| Sct Deposit 17Nov09:55 \| $250.00 \| $34,573.63
- y=446: Ct.1228Hu Ct.1228Hu Ladbrokes Wit Ladbro
- y=470: 16 Nov \| Eftpos Debit 16Nov14:18 \| -$100.00 \| $34,323.63
- y=482: Paypal *Ladbrokes Sydney Au
- y=507: 16 Nov \| Osko Deposit 16Nov07:51 \| $1,000.00 \| $34,423.63
- y=519: Interbank Trans Elysia Anne Leaver
- y=543: 15 Nov \| Elysia Anne Leav \| $10,000.00 \| $33,423.63
- y=555: Interbank Trans
- y=580: 15 Nov \| Osko Deposit 15Nov06:20 \| $1,000.00 \| $23,423.63
- y=592: Interbank Trans Elysia Anne Leaver
- y=617: 14 Nov \| Elysia Anne Leav \| $10,000.00 \| $22,423.63
- y=629: Interbank Trans
- y=653: 14 Nov \| Elysia Anne Leav \| $10,000.00 \| $12,423.63
- y=665: Interbank Trans
- y=690: 14 Nov \| Clough Projects \| $1,000.00 \| $2,423.63
- y=702: 014164000000000000
- y=726: 14 Nov \| Osko Deposit 14Nov05:37 \| $1,000.00 \| $1,423.63
- y=738: Interbank Trans Elysia Anne Leaver
- y=784: St.George Bank - A Division of Westpac Banking Corporation ABN 33 007 457 141 AFSL and Australian credit licence 233714
- y=801: Date created: 19-Nov-2024 07:28 am \| Page 1 of \|  3

## Column X clusters (layout fidelity)

### TEMPLATE 2 p1
```json
[
  {
    "x": 70,
    "n": 7,
    "min": 70,
    "max": 70
  },
  {
    "x": 217.7,
    "n": 3,
    "min": 205,
    "max": 225
  },
  {
    "x": 395.8,
    "n": 5,
    "min": 387,
    "max": 400
  },
  {
    "x": 476.8,
    "n": 4,
    "min": 467,
    "max": 486
  },
  {
    "x": 503.7,
    "n": 3,
    "min": 498,
    "max": 512
  }
]
```

### TEMPLATE p1
```json
[
  {
    "x": 70,
    "n": 12,
    "min": 70,
    "max": 70
  },
  {
    "x": 119.3,
    "n": 4,
    "min": 115,
    "max": 132
  },
  {
    "x": 213.4,
    "n": 5,
    "min": 205,
    "max": 225
  },
  {
    "x": 390.3,
    "n": 6,
    "min": 381,
    "max": 400
  },
  {
    "x": 421.5,
    "n": 2,
    "min": 419,
    "max": 424
  },
  {
    "x": 470.2,
    "n": 9,
    "min": 451,
    "max": 486
  },
  {
    "x": 510.3,
    "n": 3,
    "min": 498,
    "max": 522
  }
]
```

### FINAL p1
```json
[
  {
    "x": 70,
    "n": 26,
    "min": 70,
    "max": 70
  },
  {
    "x": 115,
    "n": 27,
    "min": 115,
    "max": 115
  },
  {
    "x": 224,
    "n": 2,
    "min": 223,
    "max": 225
  },
  {
    "x": 388.9,
    "n": 15,
    "min": 381,
    "max": 400
  },
  {
    "x": 421.5,
    "n": 2,
    "min": 419,
    "max": 424
  },
  {
    "x": 474.9,
    "n": 16,
    "min": 467,
    "max": 486
  }
]
```

## Diff notes

### Lines only on TEMPLATE (placement / tokens / sample data)
- {FIRSTNAME LASTNAME}
- {ADDRESS LINE 1}
- {ADDRESS LINE 2}
- {BSB}
- {ACCOUNT}
- {DATE}
- {CURRENT BALANCE}
- {dd mmm}
- {STGEORGE TRANSACTION}
- {AMOUNT}
- $10,000.00
- $64,573.63
- {DATE CREATE
- {TIME}
- {X}
- {DATE CREATE {TIME}
- {dd mmm}{STGEORGE TRANSACTION}

### Lines only on TEMPLATE 2 (base-only chrome)

### Sample lines only on FINAL (generated content density)
- ELYSIA LEAVER
- 48 DENISON ST
- COOMA NSW 2630
- 116-879   453 657 726
- 31-Aug-2021
- This statement covers the last 90 days of transactions
- (21-Aug-2024 to 19-Nov-2024).
- $64,474.33
- 18 Nov
- Visa Purchase 14Nov
- Oz Lotteries Melbourne
- -$99.30
- Elysia Anne Leav
- Interbank Trans
- $54,573.63
- $44,573.63
- Sct Deposit 17Nov09:55
- Ct.1228Hu Ct.1228Hu Ladbrokes Wit Ladbro
- $250.00
- $34,573.63
- 16 Nov
- Eftpos Debit 16Nov14:18
- Paypal *Ladbrokes Sydney Au
- -$100.00
- $34,323.63
- Osko Deposit 16Nov07:51
- Interbank Trans Elysia Anne Leaver
- $1,000.00
- $34,423.63
- 15 Nov
- $33,423.63
- Osko Deposit 15Nov06:20
- $23,423.63
- 14 Nov
- $22,423.63
- $12,423.63
- Clough Projects
- 014164000000000000
- $2,423.63
- Osko Deposit 14Nov05:37

## Visual previews

PNG renders @ 1.6× scale in this folder:

- `template2-p1.png`
- `template2-p2.png`
- `template-p1.png`
- `template-p2.png`
- `final-p1.png`
- `final-p2.png`
- `final-p3.png`

## Implementation implications

1. **Base PDF for generation = TEMPLATE 2** (not the token template alone, and not #726).
2. **Token template** is the **geometry blueprint** for FreeText/cover injection coordinates; align token bboxes from TEMPLATE onto TEMPLATE 2 page space (same 595×842 — coordinates should transfer 1:1 if both derived from same design).
3. **#726** defines:
   - Number of transaction rows / multi-line description pattern
   - Amount/balance formatting (`$x,xxx.xx`, debit vs credit columns)
   - Continuation page headers and footer repetition
4. **Write policy:** never strip TEMPLATE 2 content; only **overlay** generated values in empty/token zones. Prefer cover+FreeText only where TEMPLATE shows a token or #726 shows variable data that is blank on TEMPLATE 2.
5. **Txn row cloning:** TEMPLATE has few token row slots; #726 has many rows — clone row pitch from first filled row band spacing on #726 / template table body Y-range.

## Coordinate transfer check

Same page size across all three → template token `(x,y,w,h)` can be applied directly onto TEMPLATE 2 without affine scale (verify logo/title anchors match).

### Shared anchor positions

| Anchor | T2 | TEMPLATE | FINAL |
|--------|----|----------|-------|
| Complete Freedom | p1 (225,74) | p1 (225,74) | p1 (225,74) |
| Transaction Listing | p1 (223,97) | p1 (223,97) | p1 (223,97) |
| Account/Card number | p1 (419,128) | p1 (419,128) | p1 (419,128) |
| Current Balance | p1 (70,230) | p1 (70,230) | p1 (70,230) |
| Date | p1 (400,206) | p1 (467,164) | p1 (70,254) |
| Amount | p1 (396,254) | p1 (396,254) | p1 (396,254) |
| Balance | p1 (70,230) | p1 (70,230) | p1 (70,230) |
