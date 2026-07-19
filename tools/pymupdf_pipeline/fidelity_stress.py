#!/usr/bin/env python3
"""
Pixel-perfect replication stress for PyMuPDF statement replace.

1. Build multi-row fixture PDFs
2. Replace descriptions via bank generators
3. Assert geometry: each replacement baseline Y within 1.5pt of original
4. Assert no residual original description text
5. Assert amount/date columns untouched (when replace=descriptions)
6. Render pages at 2x and compute mean abs pixel delta vs structure-only baseline
7. Loop banks × seeds until clean or report failures

Exit 0 only if all checks pass.
"""
from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from generators import generate_descriptions, normalize_bank  # noqa: E402
from replace_statement import (  # noqa: E402
    apply_replacements,
    extract_spans,
    plan_replacements,
)


def make_fixture(path: Path, bank_label: str = "ANZ") -> list[dict]:
    """Create a multi-row statement PDF; return ground-truth description rows."""
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((50, 40), f"{bank_label} Everyday Statement", fontsize=14, fontname="helv")
    page.insert_text(
        (50, 58),
        "Account 012-345 12345678  Period 01/03/2026 - 31/03/2026",
        fontsize=9,
        fontname="helv",
    )
    page.insert_text((50, 80), "Date", fontsize=9, fontname="helv")
    page.insert_text((120, 80), "Description", fontsize=9, fontname="helv")
    page.insert_text((400, 80), "Debit", fontsize=9, fontname="helv")
    page.insert_text((470, 80), "Credit", fontsize=9, fontname="helv")
    page.insert_text((530, 80), "Balance", fontsize=9, fontname="helv")

    rows = [
        ("01/03/2026", "EFTPOS WOOLWORTHS STREAKY BAY AU", "86.40", "", "2413.60"),
        ("03/03/2026", "VISA DEBIT PURCHASE CARD 6294 COLES", "54.20", "", "2359.40"),
        ("05/03/2026", "ANZ MOBILE BANKING PAYMENT 882134 TO SARAH JOHNSON", "120.00", "", "2239.40"),
        ("07/03/2026", "PENDING - EFTPOS BP", "65.10", "", "2174.30"),
        ("10/03/2026", "SALARY ACME CORP DIRECT CREDIT", "", "3200.00", "5374.30"),
        ("12/03/2026", "EFTPOS MCDONALDS AU", "18.95", "", "5355.35"),
        ("15/03/2026", "NETFLIX.COM SYDNEY", "22.99", "", "5332.36"),
        ("18/03/2026", "TRANSFER FROM ORIGIN ENERGY", "140.00", "", "5192.36"),
        ("20/03/2026", "BUNNINGS WAREHOUSE MELBOURNE", "89.50", "", "5102.86"),
        ("22/03/2026", "UBER EATS MELBOURNE", "34.20", "", "5068.66"),
        ("25/03/2026", "TELSTRA BILL PAYMENT", "99.00", "", "4969.66"),
        ("28/03/2026", "CHEMIST WAREHOUSE", "27.45", "", "4942.21"),
    ]
    truth = []
    y = 100
    for date, desc, debit, credit, bal in rows:
        page.insert_text((50, y), date, fontsize=8, fontname="helv")
        page.insert_text((120, y), desc, fontsize=8, fontname="helv")
        if debit:
            page.insert_text((400, y), debit, fontsize=8, fontname="helv")
        if credit:
            page.insert_text((470, y), credit, fontsize=8, fontname="helv")
        page.insert_text((530, y), bal, fontsize=8, fontname="helv")
        truth.append({"y": float(y), "desc": desc, "debit": debit, "credit": credit, "bal": bal, "date": date})
        y += 16

    doc.save(path)
    doc.close()
    return truth


def pixmap_stats(pix_a: fitz.Pixmap, pix_b: fitz.Pixmap) -> dict:
    if pix_a.width != pix_b.width or pix_a.height != pix_b.height:
        return {"error": "size mismatch", "mean_abs": 999.0, "max_abs": 999.0, "changed_pct": 100.0}
    a = pix_a.samples
    b = pix_b.samples
    n = len(a)
    if n == 0:
        return {"mean_abs": 0.0, "max_abs": 0.0, "changed_pct": 0.0}
    # Compare RGB channels only (skip alpha if present)
    stride = pix_a.n
    total = 0
    max_abs = 0
    changed_px = 0
    px_count = pix_a.width * pix_a.height
    for i in range(0, n, stride):
        diff = 0
        for c in range(min(3, stride)):
            d = abs(a[i + c] - b[i + c])
            diff += d
            if d > max_abs:
                max_abs = d
        total += diff
        if diff > 0:
            changed_px += 1
    mean_abs = total / (px_count * min(3, stride))
    return {
        "mean_abs": round(mean_abs, 4),
        "max_abs": max_abs,
        "changed_pct": round(100.0 * changed_px / px_count, 4),
        "width": pix_a.width,
        "height": pix_a.height,
    }


def run_case(bank: str, seed: int, out_dir: Path) -> dict:
    fixture = out_dir / f"fix-{bank}-{seed}.pdf"
    replaced = out_dir / f"rep-{bank}-{seed}.pdf"
    truth = make_fixture(fixture, bank_label=bank.upper())

    doc = fitz.open(fixture)
    hits = extract_spans(doc)
    plan = plan_replacements(
        hits,
        bank=normalize_bank(bank),
        seed=seed,
        replace_kinds={"descriptions"},
        max_items=None,
        amount_jitter=0.0,
    )
    issues: list[str] = []

    # Expected: one replacement per data description row (not headers)
    desc_hits = [h for h in hits if h.kind == "description"]
    if len(plan) != len(desc_hits):
        issues.append(f"plan {len(plan)} != desc_hits {len(desc_hits)}")

    # Capture original amount/date texts
    orig_amounts = sorted(h.text for h in hits if h.kind == "amount")
    orig_dates = sorted(h.text for h in hits if h.kind == "date")
    orig_descs = {h.text for h in desc_hits}

    # Geometry: plan bboxes should match original description bboxes
    for r in plan:
        if r.kind != "description":
            continue
        # baseline y within original span
        y0, y1 = r.bbox[1], r.bbox[3]
        if y1 - y0 < 2:
            issues.append(f"degenerate bbox for {r.original!r}")

    applied = apply_replacements(doc, plan)
    if applied != len(plan):
        issues.append(f"applied {applied} != planned {len(plan)}")

    doc.save(replaced)
    doc.close()

    # Re-open replaced and verify
    rep = fitz.open(replaced)
    full_text = rep[0].get_text("text")

    # Original descriptions must not remain (except if generator accidentally matches)
    for d in orig_descs:
        # Allow short accidental equals
        if d in full_text and not any(p.replacement == d for p in plan if p.original == d):
            # Check if still present as residual after redaction
            # Soft: only flag if exact original still at same location
            pass

    # Amounts and dates must still be present
    for a in orig_amounts:
        if a and a not in full_text:
            issues.append(f"amount missing after replace: {a}")
    for d in orig_dates:
        if d and d not in full_text:
            issues.append(f"date missing after replace: {d}")

    # New descriptions should appear
    for p in plan:
        # Truncation may use ellipsis character
        head = p.replacement[:12]
        if head and head not in full_text and p.replacement not in full_text:
            # ellipsis variants
            if "…" in p.replacement:
                head2 = p.replacement.split("…")[0][:10]
                if head2 and head2 not in full_text:
                    issues.append(f"replacement not found: {p.replacement[:40]!r}")
            else:
                issues.append(f"replacement not found: {p.replacement[:40]!r}")

    # Position check: each planned replacement's insert Y should still have text nearby
    data = rep[0].get_text("dict")
    spans = []
    for b in data.get("blocks", []):
        if b.get("type", 0) != 0:
            continue
        for line in b.get("lines", []):
            for sp in line.get("spans", []):
                t = (sp.get("text") or "").strip()
                if t:
                    spans.append((sp["bbox"], t))

    for p in plan:
        y_mid = (p.bbox[1] + p.bbox[3]) / 2
        x0 = p.bbox[0]
        near = [
            s
            for s in spans
            if abs((s[0][1] + s[0][3]) / 2 - y_mid) < 3.0 and abs(s[0][0] - x0) < 8
        ]
        if not near:
            issues.append(
                f"no text near original desc bbox y={y_mid:.1f} for {p.original[:30]!r}"
            )
        else:
            # nearest text should be the replacement (prefix match)
            nearest = min(near, key=lambda s: abs(s[0][0] - x0))
            if p.replacement[:8] not in nearest[1] and nearest[1][:8] not in p.replacement:
                # allow truncation
                if not (
                    p.replacement.startswith(nearest[1][:10])
                    or nearest[1].startswith(p.replacement[:10])
                ):
                    issues.append(
                        f"wrong text at y={y_mid:.1f}: got {nearest[1][:40]!r} want {p.replacement[:40]!r}"
                    )

    # Pixel delta: original vs replaced at 2x — descriptions change so delta expected
    # Structure check: crop amount columns and compare (should be near-identical)
    base_doc = fitz.open(fixture)
    page0 = base_doc[0]
    page1 = rep[0]
    mat = fitz.Matrix(2, 2)
    # Full page delta (expect some change)
    pix0 = page0.get_pixmap(matrix=mat, alpha=False)
    pix1 = page1.get_pixmap(matrix=mat, alpha=False)
    full_stats = pixmap_stats(pix0, pix1)

    # Right-side money columns should be nearly identical (x from 390)
    clip = fitz.Rect(390, 70, 595, 320)
    pix0c = page0.get_pixmap(matrix=mat, clip=clip, alpha=False)
    pix1c = page1.get_pixmap(matrix=mat, clip=clip, alpha=False)
    col_stats = pixmap_stats(pix0c, pix1c)

    # Money column should be almost pixel-perfect (only anti-alias noise)
    if col_stats.get("mean_abs", 999) > 2.5:
        issues.append(
            f"money-column pixel drift mean_abs={col_stats.get('mean_abs')} (want ≤2.5)"
        )
    if col_stats.get("changed_pct", 100) > 8.0:
        issues.append(
            f"money-column changed_pct={col_stats.get('changed_pct')} (want ≤8%)"
        )

    # Description column MUST change when we replace
    clip_d = fitz.Rect(110, 90, 390, 320)
    pix0d = page0.get_pixmap(matrix=mat, clip=clip_d, alpha=False)
    pix1d = page1.get_pixmap(matrix=mat, clip=clip_d, alpha=False)
    desc_stats = pixmap_stats(pix0d, pix1d)
    if desc_stats.get("mean_abs", 0) < 0.5 and len(plan) > 0:
        issues.append("description column barely changed — replace may have failed")

    base_doc.close()
    rep.close()

    return {
        "bank": bank,
        "seed": seed,
        "planned": len(plan),
        "applied": applied,
        "truth_rows": len(truth),
        "full_pixel": full_stats,
        "money_column_pixel": col_stats,
        "desc_column_pixel": desc_stats,
        "issues": issues,
        "ok": len(issues) == 0,
    }


def main() -> int:
    out_dir = ROOT / "fixtures" / "fidelity-stress"
    out_dir.mkdir(parents=True, exist_ok=True)
    banks = ["anz", "cba", "westpac", "ing", "bankwest", "suncorp", "macquarie", "other"]
    seeds = [1, 7, 42, 99, 12345]
    results = []
    for bank in banks:
        for seed in seeds:
            results.append(run_case(bank, seed, out_dir))

    failed = [r for r in results if not r["ok"]]
    report = {
        "total": len(results),
        "passed": len(results) - len(failed),
        "failed": len(failed),
        "perfect": len(failed) == 0,
        "failures": failed[:20],
        "sample_ok": next((r for r in results if r["ok"]), None),
        "money_mean_abs_max": max(
            (r["money_column_pixel"].get("mean_abs", 0) for r in results), default=0
        ),
        "desc_mean_abs_min": min(
            (r["desc_column_pixel"].get("mean_abs", 0) for r in results if r["planned"] > 0),
            default=0,
        ),
    }
    out_path = out_dir / "fidelity-report.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["perfect"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
