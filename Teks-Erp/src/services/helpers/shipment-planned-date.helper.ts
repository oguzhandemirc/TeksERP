// =============================================================================
// Sevkiyat PLANLANAN SEVK GÜNÜ — tek ayrıştırıcı + tek biçimleyici (cari-be madde 4)
// =============================================================================
// Kolon `Shipment.plannedDate` takvim günüdür (`@db.Date`, UTC gece yarısı): "YYYY-AA-GG" girer,
// aynı dizge çıkar; saat dilimi dönüşümü YOK (gün kaymasın). Geçmiş gün reddedilmez — gecikme
// kavramı üretilmez, geçmiş tarihli planlı sevkiyat yalnız kendi gününde görünür.
// =============================================================================
import { z } from "zod";
import { AppError } from "../../utils/app-error";

export const PLANNED_DATE_INVALID = "SHIPMENT_PLANNED_DATE_INVALID";

/** Gövde alanı: opsiyonel; `null` temizler; gelmezse NULL (eski istemci). */
export const plannedDateValue = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Planlanan sevk tarihi YYYY-AA-GG biçiminde olmalı")
  .nullable();
export const plannedDateField = plannedDateValue.optional();

/** "YYYY-AA-GG" → UTC gece yarısı `Date`; boş → null; takvimde olmayan gün → 400. */
export function parsePlannedDate(raw: string | null | undefined): Date | null {
  if (raw == null || raw === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.toISOString().slice(0, 10) !== raw) {
    throw AppError.badRequest("Planlanan sevk tarihi geçersiz (YYYY-AA-GG).", { code: PLANNED_DATE_INVALID });
  }
  return d;
}

/** DATE kolonu → "YYYY-AA-GG" (kolonun kendi günü; fabrika dilimi uygulanmaz). */
export function formatPlannedDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Ay anahtarı ("YYYY-AA") → DATE kolonunda `[ilk gün, sonraki ayın ilk günü)` aralığı. */
export function plannedDateMonthRange(monthKey: string): { gte: Date; lt: Date } {
  const [y, m] = monthKey.split("-").map(Number) as [number, number];
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

export interface PlannedDateInput {
  plannedDate?: Date | null;
}
