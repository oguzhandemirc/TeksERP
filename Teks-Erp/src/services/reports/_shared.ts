// =============================================================================
// TeksERP - Reports / Shared Helpers
// =============================================================================
// Rapor servisleri için ortak: tarih aralığı parse + guard, response zarf
// formatı, küçük yardımcılar. Sorgu kuralları: tarih indeksli kolonlar
// üzerinden filtreleme, JS-tarafı groupBy yok (her zaman Prisma aggregate /
// raw SQL), liste detayları için cursor pagination.
// =============================================================================

import { z } from "zod";
import { AppError } from "../../utils/app-error";
import { factoryDayStart, factoryYmd } from "../../constants/time";

const DAY_MS = 86_400_000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_MS = 366 * DAY_MS;

// Reports için tarih aralığı parametreleri. `.strict()` ile yanlış isimli
// query string'leri (örn. `from`, `to`, `startDate`) 400 ile reddeder —
// operatör doğru parametre adını hemen öğrenir, sessiz default 30 günlük
// aralık tuzağına düşmez.
export const dateRangeSchema = z
  .object({
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
  })
  .strict();

export type DateRangeInput = z.infer<typeof dateRangeSchema>;

export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Boş gelirse son 30 gün uygula; aralık > 366 gün ise 400.
 *
 * SAAT DİLİMİ SÖZLEŞMESİ: `dateFrom`/`dateTo` MUTLAK AN'lardır (ISO 8601, offset
 * taşır) — takvim günü değil. Gün sınırını İSTEMCİ çizer: Electron rapor filtresi
 * seçilen takvim gününün YEREL 00:00.000 / 23:59:59.999 anını ISO'ya çevirip
 * gönderir (`Electron/src/pages/Reports/_hooks/useReportDateRange.ts`). Burada
 * ekstra bir gün yuvarlaması YAPILMAZ; aksi halde istemcinin niyeti iki kez
 * yorumlanır. Sorgu İÇİNDEKİ günlük gruplama ise ayrı bir sorudur ve fabrika
 * takvim gününe göre kesilir (bkz. `constants/time.ts` → `factoryDaySql`).
 * Varsayılan aralık (son 30 gün) bilinçli olarak MUTLAK penceredir: "şu andan
 * geriye 30×24 saat" — gün başına yuvarlanmaz.
 */
export function resolveDateRange(input: DateRangeInput): DateRange {
  const now = new Date();
  const from = input.dateFrom
    ? new Date(input.dateFrom)
    : new Date(now.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  const to = input.dateTo ? new Date(input.dateTo) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw AppError.badRequest("Geçersiz tarih formatı");
  }
  if (from > to) {
    throw AppError.badRequest("Başlangıç tarihi bitiş tarihinden büyük olamaz");
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw AppError.badRequest("Tarih aralığı en fazla 366 gün olabilir");
  }
  return { from, to };
}

export interface ReportResponse<T> {
  success: true;
  data: T;
  range: { from: string; to: string };
}

export function reportEnvelope<T>(data: T, range: DateRange): ReportResponse<T> {
  return {
    success: true,
    data,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
  };
}

/**
 * Bucketed seri için günleri tek tek dolduran yardımcı — boş günleri sıfırla
 * doldurmak isteyen grafikler için (şu an çağıran yok, ama SQL tarafındaki
 * gün kesme sözleşmesiyle hizalı kalmalı ki ilk kullanan kayık seri üretmesin).
 *
 * GÜN = FABRİKA TAKVİM GÜNÜ (Europe/Istanbul) — SQL tarafındaki `factoryDaySql`
 * ile AYNI sınır. Eskiden `setHours(0,0,0,0)` ile SÜREÇ saat dilimine (TZ env)
 * bağlıydı: sunucu UTC kurulursa seri etiketleri SQL'in ürettiği günlerden
 * kayardı ve grafik "boş gün" uydururdu.
 */
export function* eachDay(range: DateRange): Generator<Date> {
  const start = factoryDayStart(range.from);
  const end = factoryDayStart(range.to);
  let cur = start;
  while (cur <= end) {
    yield cur;
    // Bir sonraki takvim günü: 26 saat ileri atıp tekrar güne oturt. DST'de
    // 23/25 saatlik günler olabileceği için sabit +24sa eklemek gün ATLAYABİLİR
    // ya da AYNI günü iki kez üretebilir (Türkiye'de yaz saati yok, ama bu
    // yardımcı saat dilimi sabitine bağlı — varsayımı koda gömme).
    cur = factoryDayStart(new Date(cur.getTime() + 26 * 3_600_000));
  }
}

/**
 * YYYY-MM-DD — chart kategorisi. FABRİKA takvim gününe göre (süreç saat dilimine
 * göre DEĞİL); raw SQL'in döndürdüğü gün etiketiyle aynı sözleşme.
 */
export function ymdLocal(d: Date): string {
  return factoryYmd(d);
}
