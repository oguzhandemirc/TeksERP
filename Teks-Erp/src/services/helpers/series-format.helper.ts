// =============================================================================
// SERİ BİÇİMİ — SAF ÇEKİRDEK (önbelleksiz, DB'siz)
// =============================================================================
// `number-series.service.ts`ten AYRILDI (2026-09-22, boyut tavanı): servis
// dosyası 300 kod satırı tavanını aştı ve bölme ekseni "kural kalır, ENVANTER
// ayrılır" değil "DURUM kalır, SAF ÇEKİRDEK ayrılır" oldu — buradaki her şey
// `NumberSeriesFormat`ı PARAMETRE alır; önbelleğe, prisma'ya ve kataloğa
// dokunmaz, yani birim testlenebilir ve çevrimiçi olmayan yollardan çağrılabilir.
//
// ⚠️ §7 ihlali YOK ve bu ÖLÇÜLDÜ: kural `dailyCodePrefix` · `buildDailyCode` ·
// `nextDailySeq` üçlüsünü kısıtlar (ön ek LİTERAL yazılmasın diye); buradaki tek
// import `ddmmyy`dir, o üçlüde değildir. Sayaç üreten yol (`nextDailySeq`)
// servis dosyasında KALDI — bölme, kısıtlı yüzeyi taşımadı.
// =============================================================================
import type { NumberSeries } from "@prisma/client";

import { factoryYmd } from "../../constants/time";
import { ddmmyy } from "../../utils/code-format";

/** Biçimin veri-sahipli parçası — panelden yazılan tek şey budur. */
export interface NumberSeriesFormat {
  prefix: string;
  dateSegment: NumberSeries["dateSegment"];
  digits: number;
  separator: string;
  retiredPrefixes: string[];
  /**
   * KOD-SAHİPLİ — katalogdan gelir, `number_series` satırından DEĞİL ve panel
   * yazamaz (`updateSeriesFormat` tipi dışarıda bırakır). Biçimle birlikte
   * taşınmasının sebebi: `matchesSeries(resolveSeriesFormat(key), code)` çağıran
   * bir yol infix'i ayrıca geçirmeyi unutursa sessizce YANLIŞ cevap alırdı.
   */
  infix?: string;
  /**
   * VERİ-SAHİPLİ — biçimin son değiştiği an; sayacın KAPSAM sınırı.
   * `null`/yok = hiç değişmemiş seri ⇒ kapsam daraltması UYGULANMAZ ve davranış
   * bugünküyle birebir aynı kalır.
   */
  formatChangedAt?: Date | null;
  /**
   * SAYAÇ AYARLARI — başlangıç · adım · üst sınır. Hesapları `series-counter.helper`
   * yapar; burada yalnız TAŞINIRLAR ki ön eki kuran okuma ile sayacı kuran okuma
   * AYNI olsun ("iki okuma" sınıfı: ön ek bir sürümden, adım başkasından gelirdi).
   * D2①'de hepsi tanımsız ⇒ davranış bugünküyle birebir.
   */
  startValue?: number | null;
  step?: number | null;
  maxValue?: number | null;
}

/** Tarih segmentinin metni. `NONE` → boş (sayaç hiç sıfırlanmaz). */
function dateText(segment: NumberSeries["dateSegment"], date: Date): string {
  if (segment === "NONE") return "";
  if (segment === "DDMMYY") return ddmmyy(date);
  const ymd = factoryYmd(date); // "YYYY-MM-DD" — fabrika takvim günü (süreç TZ'si değil)
  const yyyy = ymd.slice(0, 4);
  const mm = ymd.slice(5, 7);
  if (segment === "YYMM") return `${yyyy.slice(2)}${mm}`;
  if (segment === "YYYYMM") return `${yyyy}${mm}`;
  if (segment === "YY") return yyyy.slice(2);
  return yyyy; // YYYY
}

/**
 * Sayaç kuyruğundan ÖNCEKİ sabit parça — `where: { gte, startsWith }` sorgusunun
 * anahtarı ve aynı zamanda sayacın kapsamı. Ayraç İKİ eklem yerinde de kullanılır
 * (`PRT` + "-" + `2609` + "-" → `PRT-2609-`; `STK` + "-" → `STK-`).
 */
export function seriesPrefix(fmt: NumberSeriesFormat, date: Date = new Date()): string {
  const dt = dateText(fmt.dateSegment, date);
  return dt === "" ? `${fmt.prefix}${fmt.separator}` : `${fmt.prefix}${fmt.separator}${dt}${fmt.separator}`;
}

/**
 * Tam kod. `digits = 1` → DOLGU YOK (`padStart(1)` seq ≥ 1 için no-op).
 * Sıra `10^digits`'i aşarsa kod GENİŞLER, SARMAZ — sarmak mükerrer kod demektir.
 */
export function formatSeriesCode(fmt: NumberSeriesFormat, seq: number, date: Date = new Date()): string {
  return `${seriesPrefix(fmt, date)}${String(seq).padStart(fmt.digits, "0")}`;
}

/** Panel önizlemesi — "PKT2209260001". */
export function previewSeriesCode(fmt: NumberSeriesFormat, seq = 1, date: Date = new Date()): string {
  return formatSeriesCode(fmt, seq, date);
}

/**
 * Bir kodun seriye UYUP UYMADIĞI — emekli ön ekler DAHİL, hane sayısı ESNEK.
 *
 * ⚠️ Hane esnekliği bir hata düzeltmesidir: bugünkü `isDailyCode(code, prefix, 4)`
 * 9999'u aşan günde üretilen 5 haneli kodu REDDEDİYOR (kayıt yazılıyor ama
 * okutulamıyor — `scripts/audit_repro_E-1-04.ts`). En az `digits`, fazlası serbest.
 */
export function matchesSeries(fmt: NumberSeriesFormat, code: string): boolean {
  const upper = code.trim().toUpperCase();
  const dateLen = { NONE: 0, DDMMYY: 6, YYMM: 4, YYYYMM: 6, YY: 2, YYYY: 4 }[fmt.dateSegment];
  const sep = fmt.separator === "" ? "" : escapeRe(fmt.separator);
  // infix KAÇIRILMAZ: regex parçası olarak katalogda yazılı (`[HF]`), veri değil kod.
  const infix = fmt.infix ?? "";
  for (const prefix of [fmt.prefix, ...fmt.retiredPrefixes]) {
    const head = dateLen === 0 ? `${escapeRe(prefix)}${sep}` : `${escapeRe(prefix)}${sep}\\d{${dateLen}}${sep}`;
    if (new RegExp(`^${head}${infix}\\d{${fmt.digits},}$`).test(upper)) return true;
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
