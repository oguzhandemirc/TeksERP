// Kokpit metinleri ve gecikme sınıfı — tablo, özet ve dışa aktarım aynı yerden okur.
import type { CockpitState, SubcontractorCockpitRow } from "./types";

export const STATE_LABEL: Record<CockpitState, string> = {
  ALL: "Tümü",
  OVERDUE: "Gecikenler",
  DUE_SOON: "Yaklaşanlar",
  NO_DUE_DATE: "Terminsiz",
};

export type DueTone = "overdue" | "soon" | "ok" | "none";

/** Sunucunun `overdueDays`ı (fabrika günü) — panel tarih hesaplamaz. "Yaklaşan" = 2 gün içinde (sunucu DUE_SOON ile aynı). */
export function dueTone(r: Pick<SubcontractorCockpitRow, "overdueDays">): DueTone {
  if (r.overdueDays === null) return "none";
  if (r.overdueDays > 0) return "overdue";
  if (r.overdueDays >= -2) return "soon";
  return "ok";
}

export function dueText(r: Pick<SubcontractorCockpitRow, "overdueDays">): string {
  const d = r.overdueDays;
  if (d === null) return "Termin yok";
  if (d > 0) return `${d} gün gecikti`;
  if (d === 0) return "Bugün";
  return `${-d} gün var`;
}

export const fmtQty = (v: string | number, digits = 0): string =>
  Number(v).toLocaleString("tr-TR", { maximumFractionDigits: digits });

/** Firma/satır bakiyesi tek metin: kumaş metresi; yalnız iplik/levent bakiyesi varsa "0 m" yerine onlar yazılır. */
export function balanceText(b: { outstandingQty: string; yarnOutstandingKg: string; beamOutstandingCount: number }): string {
  const parts: string[] = [];
  if (Number(b.outstandingQty) > 0) parts.push(`${fmtQty(b.outstandingQty)} m`);
  if (Number(b.yarnOutstandingKg) > 0) parts.push(`${fmtQty(b.yarnOutstandingKg, 1)} kg iplik`);
  if (b.beamOutstandingCount > 0) parts.push(`${b.beamOutstandingCount} levent`);
  return parts.length > 0 ? parts.join(" · ") : "0 m";
}
