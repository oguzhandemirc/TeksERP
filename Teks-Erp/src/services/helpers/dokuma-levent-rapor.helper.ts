// =============================================================================
// DOKUMA LEVENT/KAPASİTE RAPORLARI — saf aritmetik (bölmenin TEK evi)
// =============================================================================
// Levent sonucu · kapasite kullanımı · levent bitiş tahmini servisleri oranı ve
// bölmeyi burada alır; servis dosyalarında bölme yok. Payda 0/eksik → null (ölçülemedi
// BEYANDIR, sıfır değil). Takvim günü aritmetiği yalnız `YYYY-MM-DD` anahtarı üzerindedir
// (UTC takvim parçası, dilimsiz); anı güne çeviren tek kaynak `constants/time.ts`.
// =============================================================================
import { Prisma } from "@prisma/client";

const roundTo = (v: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
/** Metre: 3 hane (Decimal(12,3) kolonlarıyla aynı). */
export const roundM = (v: number): number => roundTo(v, 3);
/** Yüzde: 2 hane. */
export const roundPct = (v: number): number => roundTo(v, 2);

/** Beklenen kumaş = sarılan × (1 − takeUp/100); take-up bilinmiyorsa null (uydurulmaz). */
export function expectedFabricM(woundM: number, takeUpPct: number | null): number | null {
  if (takeUpPct === null) return null;
  return roundM(woundM * (1 - takeUpPct / 100));
}

/** part ÷ whole × 100; payda ≤ 0 → null. */
export function shareOfPct(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return roundPct((part / whole) * 100);
}

/** Leventin kullanılan payı: (sarılan − kalan) ÷ sarılan. */
export function usedSharePct(woundM: number, remainingM: number): number | null {
  return shareOfPct(woundM - remainingM, woundM);
}

/**
 * Teorik m/saat = devir/dk ÷ atkı/cm × 0,6 (cm/dk → m/sa) — FORMÜLÜN TEK EVİ (Decimal, yuvarlamasız).
 * Maliyet motoru (`fabric-cost.helper`) bunu çağırır; sayı sürümü aşağıda buna delege eder.
 */
export function theoreticalMPerHourDecimal(nominalUnitsPerMin: Prisma.Decimal.Value | null, unitsPerCm: Prisma.Decimal.Value | null): Prisma.Decimal | null {
  if (nominalUnitsPerMin === null || unitsPerCm === null) return null;
  const p = new Prisma.Decimal(unitsPerCm);
  if (!p.gt(0)) return null;
  return new Prisma.Decimal(nominalUnitsPerMin).div(p).mul("0.6");
}

/** Rapor sürümü (sayı, 3 hane) — Decimal ikizine delege eder (iki formül yazılmaz). Eksik terim → null. */
export function theoreticalMPerHour(nominalUnitsPerMin: number | null, unitsPerCm: number | null): number | null {
  const d = theoreticalMPerHourDecimal(nominalUnitsPerMin, unitsPerCm);
  return d === null ? null : roundM(d.toNumber());
}

/** Süre ağırlıklı ortalama; ağırlık toplamı 0 → null. */
export function weightedAverage(parts: ReadonlyArray<{ value: number; weight: number }>): number | null {
  const w = parts.reduce((a, p) => a + p.weight, 0);
  if (!(w > 0)) return null;
  return roundTo(parts.reduce((a, p) => a + p.value * p.weight, 0) / w, 3);
}

/** Milisaniye → saat (2 hane). */
export const msToHours = (ms: number): number => roundTo(ms / 3_600_000, 2);

/** Günlük ortalama; toplam 0 → null (hız yok = tahmin yok). */
export function dailyAverageM(totalM: number, days: number): number | null {
  if (!(totalM > 0) || !(days > 0)) return null;
  return roundM(totalM / days);
}

/** Kalan gün (1 hane); hız yoksa null. */
export function daysToFinish(remainingM: number, dailyM: number | null): number | null {
  if (dailyM === null || !(dailyM > 0)) return null;
  return roundTo(Math.max(0, remainingM) / dailyM, 1);
}

// ── Takvim günü anahtarı (YYYY-MM-DD) ───────────────────────────────────────
const parseYmd = (ymd: string): Date => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
const fmtYmd = (d: Date): string => d.toISOString().slice(0, 10);

/** Takvim günü + n gün. */
export function addDaysYmd(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtYmd(d);
}

/** İki gün anahtarı arasındaki gün farkı (to − from). */
export function daysBetweenYmd(from: string, to: string): number {
  return Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86_400_000);
}

/** ISO hafta: anahtar `YYYY-Www` + haftanın pazartesisi (gün anahtarı). */
export function isoWeekOf(ymd: string): { key: string; monday: string } {
  const d = parseYmd(ymd);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = pazartesi
  const monday = addDaysYmd(ymd, -dow);
  const thursday = parseYmd(addDaysYmd(monday, 3));
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * 86_400_000));
  return { key: `${year}-W${String(week).padStart(2, "0")}`, monday };
}
