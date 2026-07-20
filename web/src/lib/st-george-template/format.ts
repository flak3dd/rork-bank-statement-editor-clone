/**
 * St George "Complete Freedom Transaction Listing" display formats
 * (aligned to statement #726 style).
 */
import { formatMoneyLikeOriginal } from "@/lib/money";
import type { Transaction } from "@/lib/types";

const MONTHS = [
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

/** ISO yyyy-mm-dd → "18 Nov" */
export function formatStGeorgeDayMonth(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const day = Number(m[3]);
  const mon = MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${day} ${mon}`;
}

/** ISO → "21-Aug-2024" (period / opened style on #726) */
export function formatStGeorgeLongDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const day = String(Number(m[3])).padStart(2, "0");
  const mon = MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${day}-${mon}-${m[1]}`;
}

/** Signed amount for St George amount column: -$99.30 / $10,000.00 */
export function formatStGeorgeAmount(
  debit: number | null | undefined,
  credit: number | null | undefined,
): string {
  if (credit != null && credit > 0) {
    return formatMoneyLikeOriginal(credit, "$1,234.56");
  }
  if (debit != null && debit > 0) {
    return formatMoneyLikeOriginal(debit, "-$99.30");
  }
  return "$0.00";
}

export function formatStGeorgeBalance(balance: number | null | undefined): string {
  if (balance == null || !Number.isFinite(balance)) return "$0.00";
  const abs = Math.abs(balance);
  const core = formatMoneyLikeOriginal(abs, "$1,234.56");
  return balance < 0 ? `-${core.replace(/^-/, "")}` : core;
}

/** Multiline narrative like #726 Visa / Osko lines — single line for slot fill. */
export function formatStGeorgeTransactionLine(t: Transaction): string {
  return (t.description || "Transaction").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function periodDayCount(startIso: string, endIso: string): number {
  const a = Date.parse(startIso + "T12:00:00Z");
  const b = Date.parse(endIso + "T12:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 90;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

export function formatNowStGeorgeCreated(d = new Date()): {
  dateCreate: string;
  time: string;
} {
  const day = String(d.getDate()).padStart(2, "0");
  const mon = MONTHS[d.getMonth()];
  const y = d.getFullYear();
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return {
    dateCreate: `${day}-${mon}-${y}`,
    time: `${String(h).padStart(2, "0")}:${min} ${ampm}`,
  };
}
