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
import type { SuzgecEcho } from "./_filters";
import type { Secenekler } from "./_secenekler";

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

/** Parametresiz rapor uçları: tanınmayan sorgu anahtarı 400 (fail-closed; yanlış adlı süzgeç sessizce yutulmaz). */
export const emptyQuerySchema = z.object({}).strict();

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

// =============================================================================
// DÖNEM KARŞILAŞTIRMA
// =============================================================================
// "Bu ay 1. kalite oranımız %92" tek başına bir bilgi değil; yönetim sorusu her
// zaman "geçen aya göre ne oldu"dur. Bu yüzden karşılaştırma raporun İÇİNDE,
// istemci tarafında iki ayrı istek birleştirilerek DEĞİL.
//
// NEDEN BURADA (ortak katmanda): kalan beş karne de aynı üç modu isteyecek.
// Her raporun kendi "önceki dönem" yorumunu yazması, iki ekranın aynı düğmeye
// farklı anlam yüklemesi demekti.
//
// ⚠️ `prev` MUTLAK pencere kaydırmasıdır, takvim ayı DEĞİL: 1-31 Temmuz'un
// öncesi "Haziran" değil, aynı UZUNLUKTA hemen önceki penceredir. Sebep:
// `dateFrom`/`dateTo` mutlak an sözleşmesi (yukarı bak) ve kullanıcı 12 günlük
// bir aralık seçebiliyor — "önceki takvim ayı" o durumda anlamsızdır. Takvim ayı
// karşılaştırması isteyen kullanıcı iki tarihi de kendisi seçer (`custom`).
export const COMPARE_MODES = ["none", "prev", "prevYear", "custom"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export const compareRangeSchema = z
  .object({
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    compare: z.enum(COMPARE_MODES).optional(),
    compareFrom: z.string().datetime().optional(),
    compareTo: z.string().datetime().optional(),
  })
  .strict();

export type CompareRangeInput = z.infer<typeof compareRangeSchema>;

/**
 * Karşılaştırma aralığını çözer. `none` / verilmemiş → `null` (rapor tek dönem
 * çalışır ve ek sorgu KOŞMAZ — karşılaştırma istemeyen ekran bugünkü maliyeti
 * ödemesin).
 *
 * ⚠️ `prevYear` TAKVİM yılı kaydırmasıdır (`setUTCFullYear(-1)`), 365 gün değil:
 * "geçen yıl aynı dönem" sorusu takvim sorusudur ve 365 gün eklemek artık yıl
 * geçilen her aralıkta cevabı bir gün kaydırırdı. Bilinen sınır: 29 Şubat bir
 * önceki yılda yoktur ve JS onu 1 Mart'a taşır — yılda bir günlük bu kayma,
 * alternatifin (her dört yılda bir gün kayan TÜM aralıklar) yanında kabul edildi.
 */
export function resolveCompareRange(input: CompareRangeInput, primary: DateRange): DateRange | null {
  const mode: CompareMode = input.compare ?? "none";
  if (mode === "none") return null;

  if (mode === "custom") {
    if (!input.compareFrom || !input.compareTo) {
      throw AppError.badRequest("Özel karşılaştırma için compareFrom ve compareTo zorunludur");
    }
    const from = new Date(input.compareFrom);
    const to = new Date(input.compareTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw AppError.badRequest("Geçersiz karşılaştırma tarihi formatı");
    }
    if (from > to) {
      throw AppError.badRequest("Karşılaştırma başlangıcı bitişten büyük olamaz");
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw AppError.badRequest("Karşılaştırma aralığı en fazla 366 gün olabilir");
    }
    return { from, to };
  }

  if (mode === "prev") {
    const span = primary.to.getTime() - primary.from.getTime();
    // Bitiş, ana dönemin başlangıcından 1 ms ÖNCE: iki pencere bitişik ama
    // ÇAKIŞMAZ. Aynı anı iki dönemde birden saymak, tam da karşılaştırmanın
    // ölçtüğü farkı bozardı.
    const to = new Date(primary.from.getTime() - 1);
    return { from: new Date(to.getTime() - span), to };
  }

  // prevYear
  const shift = (d: Date): Date => {
    const c = new Date(d.getTime());
    c.setUTCFullYear(c.getUTCFullYear() - 1);
    return c;
  };
  return { from: shift(primary.from), to: shift(primary.to) };
}

export interface ReportResponse<T> {
  success: true;
  data: T;
  range: { from: string; to: string };
  /** Yalnız karşılaştırma istendiyse dolar — istemci varlığına bakarak Δ çizer. */
  compareRange?: { from: string; to: string };
  /** R5b: süzgeç uygulandıysa beyanı (yalnız verilen anahtarlar, `_filters.filterEcho`); yoksa anahtar YOK. */
  suzgec?: SuzgecEcho;
  /** R5b-c3: seçici kaynakları (`_secenekler`) — raporun eksenleri, pencerede geçen değerler, süzgeçten bağımsız. */
  meta?: { secenekler: Secenekler };
}

export interface EnvelopeEk { suzgec?: SuzgecEcho; secenekler?: Secenekler }

export function reportEnvelope<T>(
  data: T,
  range: DateRange,
  compareRange?: DateRange | null,
  ek: EnvelopeEk = {},
): ReportResponse<T> {
  return {
    success: true,
    data,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    ...(compareRange
      ? { compareRange: { from: compareRange.from.toISOString(), to: compareRange.to.toISOString() } }
      : {}),
    ...(ek.suzgec ? { suzgec: ek.suzgec } : {}),
    ...(ek.secenekler ? { meta: { secenekler: ek.secenekler } } : {}),
  };
}

/** Rapor nesnesinden `secenekler`i ayırır: `data` temiz kalır, liste `meta.secenekler`e gider. */
export function splitOptions<T extends { secenekler: Secenekler; dusenSatir?: number }>(rapor: T): { data: Omit<T, "secenekler" | "dusenSatir">; secenekler: Secenekler; dusenSatir?: number } {
  const { secenekler, dusenSatir, ...data } = rapor;
  return { data, secenekler, ...(dusenSatir === undefined ? {} : { dusenSatir }) };
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
