/** Neutral ISO → compact print (DD/MM/YYYY). */
export function formatPrintDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Longer dashboard form: 12 Mar 2026 */
export function formatDashboardDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function periodEndIso(start: string, days: number): string {
  return addDaysIso(start, Math.max(0, days - 1));
}

export function money2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function formatMoneyDisplay(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-${s}` : s;
}
