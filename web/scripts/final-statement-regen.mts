/**
 * Final statement regeneration pipeline.
 *
 * 1. Generate full ledgers from user-configurable cfg (multi-bank)
 * 2. Quality-analyze each (perfect generation invariants)
 * 3. Rewrite descriptions with bank generators
 * 4. Re-validate balances after description rewrite
 * 5. Export CSV + JSON + summary report
 * 6. Optionally run native PyMuPDF replace on fixture PDF
 *
 * Run from web/:
 *   npx vitest run scripts/final-statement-regen.test.ts
 *   # or via package script:
 *   npm run regen:final
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// This file is executed by the companion vitest test which imports the real modules.
// Standalone entry when invoked via vitest --config or as a test.

export {};
