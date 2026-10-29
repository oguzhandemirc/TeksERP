// H8 dönem sonu hizmet faturası — panelin saf yardımcıları (React'siz; test aynı kodu koşar).
import { factoryDayKey } from "@/lib/factory-time";

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Varsayılan dönem: fabrika takviminde BİR ÖNCEKİ ay — dönem sonu faturası ay kapandıktan sonra kesilir. */
export function defaultServicePeriod(now: Date = new Date()): string {
  const [y = 0, m = 1] = factoryDayKey(now).split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function isValidServicePeriod(value: string): boolean {
  return PERIOD_PATTERN.test(value);
}

/** "2026-10" → "Ekim 2026" (salt takvim; saat dilimi yok). */
export function servicePeriodLabel(period: string): string {
  if (!isValidServicePeriod(period)) return period;
  const [y = 0, m = 1] = period.split("-").map(Number);
  const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  return `${months[m - 1]} ${y}`;
}

/** Oluştur düğmesi ne zaman açık: önizleme bu cari+dönem için alınmış, iş var, dönem açık. */
export function canCreateServicePeriodDraft(p: { workCount: number; periodClosed: string | null } | null | undefined): boolean {
  return !!p && p.workCount > 0 && p.periodClosed === null;
}

/** Seçilebilir dönemler: içinde bulunulan fabrika ayından geriye `count` ay (yeniden eskiye). */
export function recentServicePeriods(now: Date = new Date(), count = 24): string[] {
  const [y = 0, m = 1] = factoryDayKey(now).split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const idx = y * 12 + (m - 1) - i;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
  });
}
