# Statement Generation Concepts

This document explains the core concepts behind the statement generation system in plain language. It is intentionally generic and does not describe any one bank or brand.

## 1. Purpose and structure

A statement generator turns a short configuration into a realistic-looking bank statement. The system is split into four concerns: the data that describes the account and the period, the engine that fabricates a plausible series of transactions, the formatter that turns those transactions into a printable multi-page document, and the dashboard used to tweak the configuration and review results.

## 2. Configuration

The generator is driven by a small set of inputs. The statement period is defined by a start date and a number of days. An opening balance is provided. Income is described by an amount and a frequency. Outgoing payments such as savings transfers, mortgage or loan repayments, and recurring bills are also described by amount and frequency. A flag controls whether recurring direct debits are generated, and a percentage of income can be assigned to bills and subscriptions. Account metadata, such as product name, account holder, customer identifier, BSB, account number, and interest rate, is stored so it can be printed in the header.

## 3. Transaction model

Every transaction is a record containing a primary description, an optional secondary description, a transaction date, an optional effective date, a signed amount, the running balance after the transaction, a transaction type, and a category.

Negative amounts represent money leaving the account. Positive amounts represent money entering the account. Zero amounts are used for artificial header and footer rows, such as the opening and closing balance markers. The running balance is stored on every record so the ledger can be rendered and validated without recalculating.

Categories are assigned from a shared taxonomy. They cover wages, groceries, dining, alcohol, online shopping, transport, fuel, telecommunications, utilities, health, home improvement, retail, entertainment, insurance, financial services, tax and super, savings, transfers, BPAY, pending, and a catch-all other category.

## 4. Generation pipeline

Generation begins with an opening balance marker. The engine then walks one day at a time through the requested period.

On each day it consults the configured schedules. If a salary is due, it deposits the income amount and records a credit. If a savings transfer is due and the balance is high enough, it records a debit. If a loan or mortgage payment is due and the balance is high enough, it records a debit. Irregular peer-to-peer transfers are inserted on a staggered cycle.

Recurring direct debits are modelled as a set of merchants, each with a base amount, a repeat interval in days, and an initial offset. The total nominal cost of the scheduled debits is first computed, then a scaling factor is applied so the final total matches the configured share of income. This keeps the statement balanced regardless of the period length.

Card purchases are drawn from a weighted merchant pool. Each merchant carries a typical minimum and maximum spend, a card suffix, a location, and a category. The engine randomly selects merchants, picks amounts inside the merchant’s range, and caps the overall monthly spend at a fixed ratio of expected income. Card transactions are formatted with a card suffix, merchant name, and location. Non-card purchases use the same merchant logic but without the card prefix, simulating direct account debits.

Finally, a closing balance marker is appended using the last day and the final running balance.

## 5. Budget calibration

Income is estimated by counting the number of salary deposits that will occur in the period and multiplying by the salary amount. Spending channels are then calibrated against that income. Card purchases are constrained to a fixed fraction of expected income. Direct debits are scaled to match a user-supplied fraction of income. Transfers, savings, and loan payments are governed by their own schedules and balance buffers rather than a strict income ratio.

All monetary calculations are rounded to two decimal places after each step to avoid floating-point drift.

## 6. Dates and effective dates

Dates are stored internally in a neutral form. When rendered for print, they are formatted as compact day-month-year strings. When rendered for a dashboard summary, they may appear as longer, more readable strings.

The effective date is the day a transaction actually settled. In generated data it usually equals the transaction date, but the two fields are kept separate so the printed table can display an effective date column where required.

## 7. Pagination

Printable statements are paginated by A4 page height. Each page has top and bottom padding, a footer, and a body area that shrinks on the first page because the first page carries a large header block. Continuation pages repeat only the logo and table header, so their body area is larger.

Rows are assigned a printed height. Single-line rows use one height, while rows with a secondary description use a slightly larger height. The engine packs rows greedily and starts a new page whenever the next row would exceed the remaining body height.

A final pass reserves extra vertical space on the last page for legal disclaimers. If the packed last page would overflow once the disclaimer is included, the engine splits the last page so the disclaimer appears cleanly at the bottom.

## 8. Rendering

The first printed page shows the brand identity, account product name, an electronic statement label, the statement period, account holder details, a four-cell summary box with opening balance, total credits, total debits, and closing balance, an interest rate line, and any required regulatory or marketing notices. Below that sits the transaction table with columns for date, description, effective date, debit, credit, and balance.

Continuation pages keep the brand logo and table header and continue the same column layout. Every page footer displays the current page number and total page count along with corporate legal text.

## 9. Dashboard view

The dashboard provides editable controls for the period, opening balance, income schedule, savings and mortgage transfers, recurring bills, and account metadata. Summary cards show total credits, total debits, closing balance, and transaction count. A live ledger table displays every generated row, including category labels and color coding. Changes to any control regenerate the statement immediately.

## 10. Export

The dashboard can export the generated ledger as a plain CSV. The export includes the transaction date, effective date, full description, debit amount, credit amount, running balance, and category. Amounts are exported as plain numbers without currency symbols to keep the file machine-readable.

## 11. Validation

A shared validator checks the generated ledger for realism. It confirms rows are chronological, that the stored running balances are consistent with the signed amounts, that no duplicate transaction with identical description and amount appears on the same day, and that the closing balance behaves as expected. Summarizers can also report cash flow, largest transactions, and category distribution for quick review.

## 12. Extensibility

New statement types can be added by following the same four-layer pattern. A constants layer captures the brand and merchant data. A utilities layer handles formatting and selection. A generator layer implements the calendar walk and balance tracking. An application layer builds the configuration dashboard and renders the paginated printable view. By reusing shared validation and interface components, new generators can be built with minimal repeated work.

## Implementation map

| Concept | Code |
|---------|------|
| Config | `lib/statement-gen/types.ts` → `StatementConfig` |
| Engine | `lib/statement-gen/engine.ts` → `generateStatement` |
| Calibration | `lib/statement-gen/calibrate.ts` |
| Merchants | `lib/statement-gen/merchants.ts` |
| Validation | `lib/statement-gen/validate.ts` |
| Pagination | `lib/statement-gen/paginate.ts` |
| CSV export | `lib/statement-gen/export-csv.ts` |
| Dashboard | `components/StatementGeneratorDashboard.tsx` |
| Print view | `components/StatementPrintView.tsx` |
| Workflow step | `generate` in `lib/types.ts` WORKFLOW_STEPS |
