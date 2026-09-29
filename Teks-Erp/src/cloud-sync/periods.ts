// Standart dönem pencereleri (§3.3, §7): "bugün · bu ay · geçen ay · son 30 gün". Sınırlar
// FABRİKA günüdür (`constants/time.ts`, Europe/Istanbul) — bulut tarih aritmetiği yapmaz.
import { factoryDayStart, factoryYmd } from "../constants/time";
import type { DateRange } from "../services/reports/_shared";

export const STANDARD_PERIODS = ["bugun", "bu-ay", "gecen-ay", "son-30-gun"] as const;
export type StandardPeriod = (typeof STANDARD_PERIODS)[number];

const DAY_MS = 86_400_000;

/** Fabrika ayının ilk gününün başlangıcı; `monthOffset` −1 = önceki ay. */
function factoryMonthStart(now: Date, monthOffset: number): Date {
  const [y, m] = factoryYmd(now).split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + monthOffset;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  // Öğlen UTC çıpası: hangi dilimde yorumlanırsa yorumlansın aynı takvim gününe düşer.
  return factoryDayStart(new Date(`${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-01T12:00:00.000Z`));
}

export function periodRange(period: StandardPeriod, now: Date): DateRange {
  switch (period) {
    case "bugun":
      return { from: factoryDayStart(now), to: now };
    case "bu-ay":
      return { from: factoryMonthStart(now, 0), to: now };
    case "gecen-ay":
      return { from: factoryMonthStart(now, -1), to: new Date(factoryMonthStart(now, 0).getTime() - 1) };
    case "son-30-gun":
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: now };
  }
}
