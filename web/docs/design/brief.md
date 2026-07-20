# Design Brief — Statement Lens UI/UX Redesign

## Objective

Redesign the **live React application** (not a standalone mockup) so the UI/UX **aligns perfectly with the real multi-stage bank-statement workflow**, eliminates clutter and dual-journey confusion, keeps **100% of features/endpoints/buttons working**, and is **verified by automated tests**.

**Product:** Statement Lens — bank statement PDF → extract → edit → balance → render → visual → math → generate (optional variables + Unredacter) → fidelity → export final PDF.

**Users:** Power operators who need a clear stage pipeline with advanced tools available on demand (Test Lab, Additional tools, forensics).

## Output path (REAL APP)

Implement **in place** under:

```
/Users/adminuser/rork-bank-statement-editor-clone/web/src/
```

Primary files to redesign (preserve all handlers/props wiring):

- `pages/Index.tsx` — shell, layout hierarchy, mode chrome, step action bar
- `components/AppHeader.tsx` — mode switch, pipeline status strip
- `components/WorkflowStepper.tsx` — clearer progress, gate chips
- `components/Toolbar.tsx` — denser, secondary to step actions
- `components/TestWorkflowPanel.tsx` — Test Lab as mode, not equal-weight sidebar dump
- Related step panels only as needed for visual consistency:
  - `ConfirmRenderPanel.tsx`, `VisualValidate.tsx`, `FinalMathCheck.tsx`
  - `StatementGeneratorDashboard.tsx` (header/layout polish only — keep all fields)
  - `AdditionalToolsPanel.tsx` (collapsible advanced rail / default tab control)
  - `AuditPanel.tsx`, `SummaryCards.tsx`

**Do NOT** dump standalone HTML into the app. Use React + Tailwind + existing shadcn/ui.

**Do NOT** remove or rename workflow step IDs (`edit`, `balance`, `render`, `visual`, `math`, `generate`, `fidelity`, `complete`).

**Do NOT** break handlers: export PDF, materialize, Unredacter apply, bank-desc, parsers, undo/redo, Test Lab stress, etc.

## Aesthetic direction

**"Ledger command center"** — professional fintech ops console, not marketing SaaS.

- Calm cool paper background + **teal primary** (existing tokens)
- Clear **stage theater**: one primary stage surface, secondary rail collapses
- Precise, tabular, high-signal — money-in green / money-out coral / dirty amber retained
- Subtle grid-fade / glass only in header; body stays high-contrast for tables
- Opinionated: left-to-right pipeline metaphor with a sticky **stage action bar**

### Typography

- Keep system UI stack (no new font CDN)
- Hierarchy: Stage title `text-lg font-semibold` · Panel title `text-sm font-semibold` · Meta `text-[11px] text-muted-foreground` · Mono for BSB/account/engine tags

### Color

Use existing CSS variables in `web/src/index.css` only:

- primary teal, money-in/out, destructive, amber dirty/mismatch, emerald pass
- Introduce utility classes if needed: `.stage-shell`, `.stage-action-bar`, `.pipeline-chip` in `index.css`

### Memorable detail

A **Pipeline status strip** always visible in workspace: file name · step · `pdfEdits` count · generation delta · last materialize mode · Export final PDF CTA when available.

## Content / information architecture

```
┌─ AppHeader: brand · mode (Editor | Test Lab) · API strip · engine tag ─┐
├─ Phase: upload | extracting | workspace ──────────────────────────────┤
│                                                                        │
│  WORKSPACE:                                                            │
│  ┌─ WorkflowStepper (Editor) OR Test Lab checklist (Lab mode) ───────┐ │
│  ├─ Stage chrome: title + description + gate chips ──────────────────┤ │
│  ├─ MAIN (flex-1)                                                    │ │
│  │   Step primary panel                                              │ │
│  │   View: Table | Compare | PDF (contextual)                        │ │
│  │   Data surface                                                    │ │
│  │   sticky Stage Action Bar: Back | Primary CTA | secondary         │ │
│  └─ CONTEXT RAIL (collapsible, ~320px) ─────────────────────────────┘ │
│      Stage help · relevant tools only · Insights drawer · Audit mini │
└────────────────────────────────────────────────────────────────────────┘
```

### Mode-first

- **`uiMode: "editor" | "testlab"`** state in Index (or derive from `testLabMode`)
- Editor: stepper primary; Test Lab panel collapsed into rail or top secondary
- Test Lab: checklist primary; map jumps to existing `goToStep` / handlers; keep stress suite

### Stage-centric primary CTA

| Step | Primary CTA |
|------|-------------|
| edit | Continue to Balance |
| balance | Continue to Render |
| render | Confirm & apply balances |
| visual | Run pixel check |
| math | Run math check |
| generate | Apply generated statement |
| fidelity | Run forensics |
| complete | Export hub (CSV / JSON / Final PDF) |

### Progressive disclosure

- Default rail: Completeness (compact) + stage-relevant tool + Audit mini
- **Insights** collapsible: charts, findings
- **Advanced tools** collapsible accordion: AdditionalToolsPanel (all 6 tabs intact)
- When `onBankReplaceRequest`: open Additional tools + set Generator tab (if you add `defaultTab` / controlled tab prop)

### PDF pipeline strip (workspace)

Always show when `pdfBytes`:

- Queued PdfEdits count
- Generation delta yes/no
- `canExportFinalPdf` → **Export final PDF** button (existing `handleExportPdf`)

## Technical constraints

1. React 19 + Vite + Tailwind + shadcn components already in `components/ui/`
2. Preserve all props and callback contracts of step panels
3. Prefer structural/CSS changes over rewriting business logic
4. Fix known UX bugs while redesigning:
   - Wire bank-desc request to open Generator tab
   - Identity vs delta visual messaging clarity (status chip)
   - Update misleading copy if any still says PDFs are never rewritten
5. Dark tokens exist — optional theme toggle is nice-to-have, not required
6. Responsive: stack rail under main on `<lg`

## Image needs

None required (ops console). Use lucide-react icons only.

## Validation requirements (MUST run after implement)

```bash
cd /Users/adminuser/rork-bank-statement-editor-clone/web
npx vitest run
# Optionally: npm run build
```

All existing tests must pass. Add a lightweight UI smoke test if useful (optional): that WORKFLOW_STEPS length is 8 and key labels exist — do not flake browser tests.

## Design system reference

- Tokens: `web/src/index.css`
- Tailwind: `web/tailwind.config.ts`
- Components: `web/src/components/ui/*`
- Workflow source: `web/src/lib/types.ts` → `WORKFLOW_STEPS`

## Success criteria

1. Workflow visually obvious (mode + stepper/checklist + stage action bar)
2. No feature removed; all buttons still call existing handlers
3. Less visual noise: one primary surface per step
4. Unredacter / Export final PDF / bank-desc discoverable
5. Tests green
6. Distinctive "ledger command center" aesthetic using existing teal system

## Out of scope

- Rewriting parsers, PDF engines, or generation math
- New backend endpoints
- Changing step IDs or removal of Test Lab / Additional tools features
