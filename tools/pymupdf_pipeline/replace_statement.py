#!/usr/bin/env python3
"""
PyMuPDF high-fidelity statement data replacement.

Replaces original description (and optionally amount) text on a bank statement
PDF using bank-authentic generation logic from generators.py (port of
transactionalDescriptionGenerator.js).

Workflow
--------
1. Open PDF with PyMuPDF (fitz).
2. Extract text spans with geometry, font size, and color.
3. Classify spans: money amounts vs narrative descriptions.
4. Generate new descriptions via bank generator (ANZ/CBA/Westpac/…).
5. Optionally regenerate money amounts (keep sign/magnitude band).
6. Redact original rects (white fill) and insert_text at original origin
   with matching fontsize/color — reproducing an exact layout replica.
7. Write output PDF + JSON audit of every replacement.

Usage
-----
  python tools/pymupdf_pipeline/replace_statement.py \\
    --pdf input.pdf --bank anz --seed 42 --out out.pdf

  # Descriptions only (default):
  python ... --replace descriptions

  # Descriptions + amounts (balances left alone unless --replace balances):
  python ... --replace descriptions,amounts

  # Dry-run (no write, print plan):
  python ... --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

try:
    import fitz  # PyMuPDF
except ImportError as e:
    print("PyMuPDF (fitz) is required: pip install pymupdf", file=sys.stderr)
    raise SystemExit(1) from e

from generators import generate_descriptions, normalize_bank

# Money like 1,234.56 or -12.00 or $45.00
MONEY_RE = re.compile(
    r"""
    ^\$?\s*
    -?
    (?:\d{1,3}(?:,\d{3})+|\d+)
    (?:\.\d{1,2})?
    $
    """,
    re.VERBOSE,
)
# ISO-ish or AU dates
DATE_RE = re.compile(
    r"""
    ^(?:
        \d{1,2}[/-]\d{1,2}[/-]\d{2,4}
      | \d{4}-\d{2}-\d{2}
      | \d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}
    )$
    """,
    re.VERBOSE | re.IGNORECASE,
)
# Exact/short column headers only — NOT "debit"/"credit" inside transaction text
HEADER_EXACT = re.compile(
    r"^(date|description|debit|credit|balance|transaction|particulars|"
    r"details|amount|withdrawals|deposits|money\s*in|money\s*out|"
    r"opening\s*balance|closing\s*balance|page\s+\d+(\s+of\s+\d+)?|"
    r"continued|summary)$",
    re.I,
)
# Statement chrome (account header / period line) — skip for description replace
CHROME_RE = re.compile(
    r"\b(statement\s+period|account\s+number|bsb|period\s+\d|page\s+\d+\s+of)\b",
    re.I,
)
ACCOUNT_HEADER_RE = re.compile(
    r"^(account|bsb|period|statement)\b",
    re.I,
)


@dataclass
class SpanHit:
    page: int  # 0-based
    text: str
    bbox: tuple[float, float, float, float]  # x0,y0,x1,y1
    size: float
    color: tuple[float, float, float]
    font: str
    kind: str  # description | amount | date | skip
    origin: tuple[float, float]  # baseline insert point


@dataclass
class Replacement:
    page: int
    kind: str
    original: str
    replacement: str
    bbox: list[float]
    size: float
    color: list[float]
    font: str


def _srgb_to_rgb(color: int | None) -> tuple[float, float, float]:
    if color is None:
        return (0.0, 0.0, 0.0)
    if isinstance(color, (list, tuple)) and len(color) >= 3:
        return (float(color[0]), float(color[1]), float(color[2]))
    # PyMuPDF often stores as int 0xRRGGBB
    c = int(color) & 0xFFFFFF
    r = ((c >> 16) & 255) / 255.0
    g = ((c >> 8) & 255) / 255.0
    b = (c & 255) / 255.0
    return (r, g, b)


def classify_text(text: str) -> str:
    t = text.strip()
    if not t or len(t) < 2:
        return "skip"
    if MONEY_RE.match(t.replace(" ", "")) or MONEY_RE.match(t):
        return "amount"
    if DATE_RE.match(t):
        return "date"
    # Column headers are short exact labels
    if HEADER_EXACT.match(t):
        return "skip"
    # Account / period chrome (keep out of description rewrite)
    if CHROME_RE.search(t) or (ACCOUNT_HEADER_RE.match(t) and "period" in t.lower()):
        return "skip"
    # Title-like short chrome
    if len(t) < 48 and re.search(r"\bstatement\b", t, re.I) and not re.search(
        r"\b(visa|eftpos|payment|transfer|purchase)\b", t, re.I
    ):
        return "skip"
    # Narrative: letters present, not pure numbers
    if re.search(r"[A-Za-z]{3,}", t) and not MONEY_RE.match(
        t.replace(",", "").replace("$", "")
    ):
        return "description"
    return "skip"


def extract_spans(doc: fitz.Document) -> list[SpanHit]:
    hits: list[SpanHit] = []
    for page_index in range(doc.page_count):
        page = doc[page_index]
        data = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
        for block in data.get("blocks", []):
            if block.get("type", 0) != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = (span.get("text") or "").strip()
                    if not text:
                        continue
                    bbox = tuple(span.get("bbox", (0, 0, 0, 0)))
                    size = float(span.get("size") or 9.0)
                    color = _srgb_to_rgb(span.get("color"))
                    font = span.get("font") or "helv"
                    kind = classify_text(text)
                    # Insert at left baseline ≈ (x0, y1 - slight)
                    origin = (bbox[0], bbox[3] - size * 0.15)
                    hits.append(
                        SpanHit(
                            page=page_index,
                            text=text,
                            bbox=bbox,  # type: ignore[arg-type]
                            size=size,
                            color=color,
                            font=font,
                            kind=kind,
                            origin=origin,
                        )
                    )
    return hits


def parse_money(text: str) -> float | None:
    cleaned = text.replace("$", "").replace(",", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def format_money_like(original: str, value: float) -> str:
    """Preserve approximate formatting (commas, $) of the original amount span."""
    has_dollar = "$" in original
    has_comma = "," in original
    neg = value < 0
    abs_v = abs(value)
    body = f"{abs_v:,.2f}" if has_comma else f"{abs_v:.2f}"
    if has_dollar:
        body = f"${body}"
    if neg and not body.startswith("-"):
        body = f"-{body}"
    return body


def plan_replacements(
    hits: list[SpanHit],
    bank: str,
    seed: int,
    replace_kinds: set[str],
    max_items: int | None,
    amount_jitter: float,
) -> list[Replacement]:
    descs = [h for h in hits if h.kind == "description"]
    amounts = [h for h in hits if h.kind == "amount"]
    dates = [h for h in hits if h.kind == "date"]

    if max_items is not None:
        descs = descs[:max_items]
        amounts = amounts[:max_items]
        dates = dates[:max_items]

    plan: list[Replacement] = []

    if "descriptions" in replace_kinds and descs:
        new_descs = generate_descriptions(bank, len(descs), seed=seed)
        for hit, new_text in zip(descs, new_descs):
            # Fit roughly into original width by truncating if much longer
            max_chars = max(len(hit.text), 12)
            if len(new_text) > max_chars * 1.8:
                new_text = new_text[: int(max_chars * 1.6)].rstrip() + "…"
            if new_text == hit.text:
                continue
            plan.append(
                Replacement(
                    page=hit.page,
                    kind="description",
                    original=hit.text,
                    replacement=new_text,
                    bbox=list(hit.bbox),
                    size=hit.size,
                    color=list(hit.color),
                    font=hit.font,
                )
            )

    if "amounts" in replace_kinds and amounts:
        import random

        random.seed(seed + 17)
        for i, hit in enumerate(amounts):
            val = parse_money(hit.text)
            if val is None:
                continue
            # Keep sign; jitter magnitude within band
            mag = abs(val)
            if mag < 0.01:
                continue
            factor = 1.0 + (random.random() * 2 - 1) * amount_jitter
            new_val = round(mag * factor, 2)
            if val < 0:
                new_val = -new_val
            new_text = format_money_like(hit.text, new_val)
            if new_text == hit.text:
                continue
            plan.append(
                Replacement(
                    page=hit.page,
                    kind="amount",
                    original=hit.text,
                    replacement=new_text,
                    bbox=list(hit.bbox),
                    size=hit.size,
                    color=list(hit.color),
                    font=hit.font,
                )
            )

    if "dates" in replace_kinds and dates:
        # Shift day component slightly while keeping format skeleton — minimal
        import random

        random.seed(seed + 31)
        for hit in dates:
            m = re.match(r"^(\d{1,2})([/-])(\d{1,2})([/-])(\d{2,4})$", hit.text.strip())
            if not m:
                continue
            d, sep1, mo, sep2, y = m.groups()
            new_d = max(1, min(28, int(d) + random.randint(-2, 2)))
            new_text = f"{new_d:02d}{sep1}{mo}{sep2}{y}" if len(d) == 2 else f"{new_d}{sep1}{mo}{sep2}{y}"
            if new_text == hit.text:
                continue
            plan.append(
                Replacement(
                    page=hit.page,
                    kind="date",
                    original=hit.text,
                    replacement=new_text,
                    bbox=list(hit.bbox),
                    size=hit.size,
                    color=list(hit.color),
                    font=hit.font,
                )
            )

    return plan


def apply_replacements(doc: fitz.Document, plan: list[Replacement]) -> int:
    """Cover original spans with white rects and insert new text (NO redactions).

    Policy: never use ``add_redact_annot`` / ``apply_redactions`` — output PDFs
    must not contain redaction annotations. White filled draw rects + insert_text
    keep row alignment without Redact subtypes.
    """
    by_page: dict[int, list[Replacement]] = {}
    for r in plan:
        by_page.setdefault(r.page, []).append(r)

    applied = 0
    for page_index, items in by_page.items():
        page = doc[page_index]

        # Drop any existing redaction annotations on this page
        try:
            for annot in list(page.annots() or []):
                try:
                    if annot.type[0] == fitz.PDF_ANNOT_REDACT:  # type: ignore[attr-defined]
                        page.delete_annot(annot)
                    elif "redact" in str(annot.type).lower():
                        page.delete_annot(annot)
                except Exception:
                    pass
        except Exception:
            pass

        for r in items:
            if not (r.replacement or "").strip():
                continue
            x0, y0, x1, y1 = r.bbox
            fontsize = max(4.0, min(float(r.size), 18.0))
            baseline_y = y1 - max(0.5, fontsize * 0.12)
            color = (
                tuple(r.color)
                if r.color and len(r.color) >= 3
                else (0.0, 0.0, 0.0)
            )

            rect = fitz.Rect(x0, y0, x1, y1)
            rect = rect + (-0.6, -0.4, 0.6, 0.4)
            # White cover — NOT a redaction annotation
            page.draw_rect(rect, color=(1, 1, 1), fill=(1, 1, 1), overlay=True)

            page.insert_text(
                fitz.Point(x0, baseline_y),
                r.replacement,
                fontsize=fontsize,
                fontname="helv",
                color=color,
                overlay=True,
            )
            applied += 1
    return applied


def run(
    pdf_path: Path,
    out_path: Path,
    bank: str,
    seed: int,
    replace: str,
    max_items: int | None,
    amount_jitter: float,
    dry_run: bool,
    audit_path: Path | None,
) -> dict[str, Any]:
    bank_key = normalize_bank(bank)
    kinds = {k.strip().lower() for k in replace.split(",") if k.strip()}
    if not kinds:
        kinds = {"descriptions"}

    doc = fitz.open(pdf_path)
    try:
        hits = extract_spans(doc)
        plan = plan_replacements(
            hits,
            bank=bank_key,
            seed=seed,
            replace_kinds=kinds,
            max_items=max_items,
            amount_jitter=amount_jitter,
        )
        summary = {
            "input": str(pdf_path),
            "output": str(out_path),
            "bank": bank_key,
            "seed": seed,
            "replace": sorted(kinds),
            "spans_total": len(hits),
            "spans_by_kind": {
                k: sum(1 for h in hits if h.kind == k)
                for k in ("description", "amount", "date", "skip")
            },
            "planned": len(plan),
            "dry_run": dry_run,
            "replacements": [asdict(r) for r in plan],
        }

        if dry_run:
            return summary

        applied = apply_replacements(doc, plan)
        summary["applied"] = applied
        out_path.parent.mkdir(parents=True, exist_ok=True)
        doc.save(out_path, garbage=3, deflate=True)
        if audit_path:
            audit_path.parent.mkdir(parents=True, exist_ok=True)
            audit_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        return summary
    finally:
        doc.close()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Replace statement PDF text with bank-authentic generated data (PyMuPDF).",
    )
    p.add_argument("--pdf", required=True, type=Path, help="Source statement PDF")
    p.add_argument("--out", type=Path, default=None, help="Output PDF path")
    p.add_argument(
        "--bank",
        default="anz",
        help="Bank generator: anz|cba|westpac|ing|bankwest|suncorp|macquarie|rams|other",
    )
    p.add_argument("--seed", type=int, default=42, help="RNG seed for generation logic")
    p.add_argument(
        "--replace",
        default="descriptions",
        help="Comma list: descriptions,amounts,dates",
    )
    p.add_argument("--max", type=int, default=None, dest="max_items", help="Cap replacements per kind")
    p.add_argument(
        "--amount-jitter",
        type=float,
        default=0.15,
        help="Relative jitter for amount replacement (default 0.15)",
    )
    p.add_argument("--dry-run", action="store_true", help="Plan only; do not write PDF")
    p.add_argument("--audit", type=Path, default=None, help="Write JSON audit log")
    args = p.parse_args(argv)

    if not args.pdf.is_file():
        print(f"PDF not found: {args.pdf}", file=sys.stderr)
        return 2

    out = args.out or args.pdf.with_name(args.pdf.stem + f"-{normalize_bank(args.bank)}-replaced.pdf")
    audit = args.audit or (None if args.dry_run else out.with_suffix(".audit.json"))

    summary = run(
        pdf_path=args.pdf,
        out_path=out,
        bank=args.bank,
        seed=args.seed,
        replace=args.replace,
        max_items=args.max_items,
        amount_jitter=args.amount_jitter,
        dry_run=args.dry_run,
        audit_path=audit,
    )

    print(json.dumps({k: v for k, v in summary.items() if k != "replacements"}, indent=2))
    if args.dry_run:
        print(f"\nPlanned {summary['planned']} replacement(s). Sample:")
        for r in summary["replacements"][:8]:
            print(f"  p{r['page']+1} [{r['kind']}] {r['original']!r} → {r['replacement']!r}")
    else:
        print(f"\nWrote {out} ({summary.get('applied', 0)} applied)")
        if audit:
            print(f"Audit {audit}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
