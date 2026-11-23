// Tezgâh yük çizelgesinin zaman ekseni — SAF yerleşim. Eksen bugünün fabrika günü başında açılır (gün sütunları
// takvimle hizalı); "şimdi" çizgisi sunucunun `generatedAt` anıdır. Saat hesabı yapılmaz, yalnız konum.
import { addDaysToKey, factoryDayKey, factoryWallTimeToDate, formatFactory } from "@/lib/factory-time";

export interface AxisTick { h: number; label: string; major: boolean }
export interface TimelineAxis { spanH: number; nowH: number; ticks: AxisTick[] }

const HOUR_MS = 3_600_000;

export function timelineAxis(generatedAt: string, days: number): TimelineAxis {
  const now = Date.parse(generatedAt);
  const key = factoryDayKey(generatedAt) || factoryDayKey();
  const start = factoryWallTimeToDate(key, "00:00")?.getTime() ?? now;
  const at = (i: number) => factoryWallTimeToDate(addDaysToKey(key, i), "00:00")?.getTime() ?? start + i * 24 * HOUR_MS;
  const spanH = (at(days) - start) / HOUR_MS;
  const ticks: AxisTick[] = [];
  // Kısa ufukta 6 saatlik ara çizgi; etiket seyreltmesi genişliğe göre çizimde (`labelStep`).
  for (let i = 0; i < days; i++) {
    const t = at(i);
    ticks.push({ h: (t - start) / HOUR_MS, label: formatFactory(t, days > 7 ? "dd.MM" : "EEE dd.MM"), major: true });
    if (days <= 3) {
      for (const hh of ["06:00", "12:00", "18:00"]) {
        const s = factoryWallTimeToDate(addDaysToKey(key, i), hh)?.getTime();
        if (s != null) ticks.push({ h: (s - start) / HOUR_MS, label: hh.slice(0, 2), major: false });
      }
    }
  }
  return { spanH, nowH: Math.max(0, (now - start) / HOUR_MS), ticks };
}

/** Kaç günde bir gün etiketi yazılır: etiket başına ~`minPx` piksel düşsün (çakışma olmasın). */
export function labelStep(days: number, widthPx: number, minPx = 72): number {
  if (widthPx <= 0) return 1;
  return Math.max(1, Math.ceil((days * minPx) / widthPx));
}

/** Saat konumunu eksen yüzdesine çevirir; eksen dışını kırpar. */
export const pct = (h: number, spanH: number) => `${Math.min(100, Math.max(0, (h / spanH) * 100))}%`;
