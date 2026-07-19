/** Parse currency-like strings into numbers. Returns null if unparseable. */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
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
