/**
 * Collapse FreeText / OCR doubled-glyph money garbage.
 * e.g. "$ $4 4,,3 39 98 8..9 90 0" → "$4,398.90"
 * e.g. "$ $1 19 90 0..5 51 1" → "$190.51"
 */
export function collapseDoubledMoneyGlyphs(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return s;
  // Only for dense spaced/doubled noise (not normal "$1,234.56")
  const looksGarbled =
    /\$\s*\$/.test(s) ||
    (/\d\s+\d/.test(s) && (s.match(/\d/g)?.length ?? 0) >= 6);
  if (!looksGarbled) return s;
  const noSpace = s.replace(/\s+/g, "");
  // Collapse consecutive duplicate characters once
  return noSpace.replace(/(.)\1/g, "$1");
}

/**
 * True when token is a real money amount (currency or .cc decimals),
 * not a bare account/BSB integer.
 */
export function isMoneyToken(raw: string): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  if (/[$£€]/.test(s)) return true;
  if (/\(\s*[$£€]?\s*[\d,]+\.\d{2}\s*\)/.test(s)) return true;
  // Must have exactly two decimal places (statement money)
  if (/^-?[\d,]+\.\d{2}$/.test(s.replace(/\s/g, ""))) return true;
  return false;
}

/** Parse currency-like strings into numbers. Returns null if unparseable. */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = collapseDoubledMoneyGlyphs(String(raw).trim());
  if (!s) return null;

  const isParenNegative = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "");
  s = s.replace(/[$£€¥₹]/g, "");
  s = s.replace(/\s/g, "");

  const trailingMinus = s.endsWith("-");
  const leadingMinus = s.startsWith("-") || s.startsWith("−");
  s = s.replace(/^[-−+]/, "").replace(/-$/, "");

  // European format: 1.234,56
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d{1,2}$/.test(s)) {
    s = s.replace(",", ".");
  } else {
    // US / AU: 1,234.56
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;

  const negative = isParenNegative || trailingMinus || leadingMinus;
  return negative ? -Math.abs(n) : n;
}

export function formatMoney(value: number | null | undefined, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Format a money value to mirror the original PDF glyph style
 * (currency symbol, commas, leading/trailing minus, parentheses).
 * Transaction amounts are usually unsigned; sign comes from original text.
 */
export function formatMoneyLikeOriginal(
  value: number,
  original: string,
): string {
  const absStr = Math.abs(value).toFixed(2);
  const useCommas = original.includes(",");
  const num = useCommas
    ? absStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : absStr;

  const currMatch = original.match(/[$£€]/);
  const curr = currMatch?.[0] ?? "";
  const trimmed = original.trim();

  if (/^\(/.test(trimmed) && /\)$/.test(trimmed)) {
    return `(${curr}${num})`;
  }

  // -$99.30 / −$1,234.56
  if (/^[-−]\s*[$£€]/.test(trimmed) || /[-−]\s*[$£€]/.test(original)) {
    return `-${curr}${num}`;
  }
  // $-99.30
  if (curr && new RegExp(`${curr.replace("$", "\\$")}\\s*[-−]`).test(original)) {
    return `${curr}-${num}`;
  }
  // leading minus without currency
  if (/^[-−]/.test(trimmed)) {
    return `-${curr}${num}`;
  }
  // trailing minus
  if (/[-−]\s*$/.test(trimmed)) {
    return `${curr}${num}-`;
  }

  return `${curr}${num}`;
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Format an ISO date (YYYY-MM-DD) to match how it appeared on the PDF
 * (e.g. "18 Nov", "18/11/24", "11/18/2024").
 */
export function formatDateLikeOriginal(iso: string, original: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, y, mon, day] = m;
  const dNum = Number(day);
  const mNum = Number(mon);
  const monName = SHORT_MONTHS[mNum - 1] ?? mon;
  const orig = original.trim();

  // 18 Nov / 18 November
  if (/^\d{1,2}\s+[A-Za-z]{3,}/.test(orig) && !/\d{4}/.test(orig)) {
    const full = /[A-Za-z]{4,}/.test(orig);
    return full
      ? `${dNum} ${new Date(`${y}-${mon}-${day}T12:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" })}`
      : `${dNum} ${monName}`;
  }
  // 18 Nov 2024
  if (/^\d{1,2}\s+[A-Za-z]{3,}/.test(orig) && /\d{4}/.test(orig)) {
    return `${dNum} ${monName} ${y}`;
  }
  // Mar 12, 2024
  if (/^[A-Za-z]{3,}/.test(orig) && /\d{1,2}/.test(orig)) {
    const comma = orig.includes(",");
    return comma
      ? `${monName} ${dNum}, ${y}`
      : `${monName} ${dNum} ${y}`;
  }
  // slash / dash numeric
  const slash = orig.match(
    /^(\d{1,2})([\/\-])(\d{1,2})\2(\d{2,4})$/,
  );
  if (slash) {
    const sep = slash[2];
    const yOut = slash[4].length === 2 ? y.slice(2) : y;
    // Heuristic: if first number > 12, it's day-first; if second > 12, month-first;
    // else preserve original field order by comparing which matched month-ish.
    const a = Number(slash[1]);
    const b = Number(slash[3]);
    if (a > 12 || (b <= 12 && a === dNum)) {
      return `${String(dNum).padStart(slash[1].length, "0")}${sep}${String(mNum).padStart(slash[3].length, "0")}${sep}${yOut}`;
    }
    // month-first (US)
    return `${String(mNum).padStart(slash[1].length, "0")}${sep}${String(dNum).padStart(slash[3].length, "0")}${sep}${yOut}`;
  }
  // ISO already
  if (/^\d{4}[\/\-]\d{2}[\/\-]\d{2}$/.test(orig)) {
    const sep = orig.includes("/") ? "/" : "-";
    return `${y}${sep}${mon}${sep}${day}`;
  }
  return iso;
}
