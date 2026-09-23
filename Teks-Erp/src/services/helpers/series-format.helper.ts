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
  /**
   * İKİNCİ AYRAÇ — tarih ile sayaç ARASINDAKİ eklem (D5②).
   *
   * `null`/yok = `separator`a düşer ⇒ 52 serinin hepsi bayt bayt bugünküyle
   * aynı kodu üretir. Ayrı bir alan olmasının sebebi `PRT-2609/0001` gibi
   * biçimlerin sektörde yaygın olması; tek ayraçla bunu kurmanın yolu yoktu.
   *
   * ⚠️ TARİH YOKSA İKİNCİ EKLEM DE YOKTUR: `dateSegment: "NONE"` olan seride
   * tek eklem `prefix|sayaç`tır ve onu daima `separator` kurar. Bu, ayrı bir
   * KURAL değil yapının SONUCUDUR — üreteç de eşleştirici de tarih boşken
   * ikinci eklemi hiç kurmaz. (İlk yazımda `seriesJoints` içine ayrıca bir
   * `NONE` dalı koymuştum; negatif sonda onu ÖLÜ KOD olarak gösterdi — dal
   * kaldırılınca hiçbir iddia kırmızı vermedi, çünkü hiçbir çağrı yolu oraya
   * ulaşmıyordu. Ölçülemeyen savunma, savunma değildir.)
   */
  separator2?: string | null;
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
  /**
   * NUMARA KAYNAĞI — `FREE` bugünkü davranış (elle gelirse kabul, gelmezse üret),
   * `SYSTEM` elle geleni reddeder, `MANUAL` elle değeri ZORUNLU kılar.
   */
  /**
   * EMEKLİ BİÇİMLER — geçmiş `number_series_lines` satırları (D4②).
   *
   * ⚠️ `retiredPrefixes` yalnız ÖN EK eksenini koruyordu: hane 4 → 6 yapılınca
   * dünkü kod TANINMIYORDU (ölçüldü 2026-09-23), çünkü emekli ön ek YÜRÜRLÜKTEKİ
   * segment/haneyle deneniyordu. Burada her emekli biçim KENDİ segment/hanesiyle
   * denenir. Liste boşsa davranış bugünküyle birebir aynıdır (fail-safe).
   */
  retiredFormats?: Array<{
    prefix: string;
    dateSegment: NumberSeries["dateSegment"];
    digits: number;
    separator: string;
    separator2?: string | null;
  }>;
  numberSource?: "FREE" | "SYSTEM" | "MANUAL";
  startValue?: number | null;
  step?: number | null;
  maxValue?: number | null;
}

/**
 * TARİH SEGMENTİ TABLOSU — TEK KAYNAK (D5①).
 *
 * ⚠️ Daha önce aynı bilgi BEŞ yerde yaşıyordu: üretici (`dateText`) bir `if`
 * zinciri, `matchesSeries` içinde İKİ özdeş uzunluk haritası, panelde ve
 * tablette birer `DATE_LEN`. Yeni bir segment eklemek beş yeri birden
 * güncellemek demekti ve biri unutulduğunda sonuç SESSİZ bir yanlış koddu —
 * kök kuralın "altıncı enum değeri unutuldu" sınıfı.
 *
 * ⚠️ FALLBACK KALDIRILDI: eski `dateText`in son satırı `return yyyy` idi, yani
 * TANINMAYAN bir segment sessizce 4 haneli yıl üretiyordu. Artık tablo
 * `Record<...>` olarak TAM (exhaustive) yazılıyor: yeni bir enum değeri
 * eklendiğinde DERLEYİCİ eksik satırı gösterir.
 *
 * `len` ile `render` birlikte durur çünkü ikisi AYNI kararın iki yüzü: kaç
 * rakam yazılacağı ve hangi rakamlar. Ayrı dursalardı biri güncellenip öteki
 * unutulabilirdi (bu dosyada tam olarak o olmuştu).
 */
export const DATE_SEGMENTS: Record<
  NumberSeries["dateSegment"],
  { len: number; render: (date: Date) => string }
> = {
  NONE: { len: 0, render: () => "" },
  DDMMYY: { len: 6, render: (d) => ddmmyy(d) },
  DDMMYYYY: { len: 8, render: (d) => `${ddmmyy(d).slice(0, 4)}${factoryYmd(d).slice(0, 4)}` },
  YYMM: { len: 4, render: (d) => `${factoryYmd(d).slice(2, 4)}${factoryYmd(d).slice(5, 7)}` },
  MMYY: { len: 4, render: (d) => `${factoryYmd(d).slice(5, 7)}${factoryYmd(d).slice(2, 4)}` },
  YYYYMM: { len: 6, render: (d) => `${factoryYmd(d).slice(0, 4)}${factoryYmd(d).slice(5, 7)}` },
  YYYYMMDD: { len: 8, render: (d) => factoryYmd(d).replace(/-/g, "") },
  YY: { len: 2, render: (d) => factoryYmd(d).slice(2, 4) },
  YYYY: { len: 4, render: (d) => factoryYmd(d).slice(0, 4) },
};

/**
 * Biçimin İKİ EKLEM YERİ — üretici ile eşleştirici AYNI karardan okusun diye.
 *
 * ⚠️ Bu fonksiyon D5①'in dersinin uygulanmasıdır: `seriesPrefix` ile
 * `matchesSeries` aynı soruyu iki ayrı yerde cevaplarsa bir gün ayrışırlar ve
 * sonuç sessiz bir "üretilen kod kendi serisine uymuyor" hâlidir.
 */
export function seriesJoints(fmt: { separator: string; separator2?: string | null }): {
  sep1: string;
  sep2: string;
} {
  return { sep1: fmt.separator, sep2: fmt.separator2 ?? fmt.separator };
}

/** Tarih segmentinin metni. `NONE` → boş (sayaç hiç sıfırlanmaz). */
function dateText(segment: NumberSeries["dateSegment"], date: Date): string {
  return DATE_SEGMENTS[segment].render(date);
}

/**
 * Sayaç kuyruğundan ÖNCEKİ sabit parça — `where: { gte, startsWith }` sorgusunun
 * anahtarı ve aynı zamanda sayacın kapsamı. Ayraç İKİ eklem yerinde de kullanılır
 * (`PRT` + "-" + `2609` + "-" → `PRT-2609-`; `STK` + "-" → `STK-`).
 */
export function seriesPrefix(fmt: NumberSeriesFormat, date: Date = new Date()): string {
  const dt = dateText(fmt.dateSegment, date);
  const { sep1, sep2 } = seriesJoints(fmt);
  return dt === "" ? `${fmt.prefix}${sep1}` : `${fmt.prefix}${sep1}${dt}${sep2}`;
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
  const dateLen = DATE_SEGMENTS[fmt.dateSegment].len;
  const { sep1: s1, sep2: s2 } = seriesJoints(fmt);
  const sep = s1 === "" ? "" : escapeRe(s1);
  const sepB = s2 === "" ? "" : escapeRe(s2);
  // infix KAÇIRILMAZ: regex parçası olarak katalogda yazılı (`[HF]`), veri değil kod.
  const infix = fmt.infix ?? "";
  for (const prefix of [fmt.prefix, ...fmt.retiredPrefixes]) {
    const head = dateLen === 0 ? `${escapeRe(prefix)}${sep}` : `${escapeRe(prefix)}${sep}\\d{${dateLen}}${sepB}`;
    if (new RegExp(`^${head}${infix}\\d{${fmt.digits},}$`).test(upper)) return true;
  }
  // ⚠️ EMEKLİ BİÇİMLER KENDİ segment/haneleriyle denenir. Üstteki döngü emekli
  // ÖN EKLERİ yürürlükteki biçimle deniyor (bugünkü davranış, KORUNUYOR); bu
  // döngü onun kapatamadığı ekseni kapatır — hane/segment değişimi sonrası eski
  // kod. İkisi birlikte bir ÜST KÜME: hiçbir kod eskisinden daha az tanınmaz.
  for (const eski of fmt.retiredFormats ?? []) {
    const eskiLen = DATE_SEGMENTS[eski.dateSegment].len;
    const { sep1: e1, sep2: e2 } = seriesJoints(eski);
    const eskiSep = e1 === "" ? "" : escapeRe(e1);
    const eskiSepB = e2 === "" ? "" : escapeRe(e2);
    const head =
      eskiLen === 0
        ? `${escapeRe(eski.prefix)}${eskiSep}`
        : `${escapeRe(eski.prefix)}${eskiSep}\\d{${eskiLen}}${eskiSepB}`;
    if (new RegExp(`^${head}${infix}\\d{${eski.digits},}$`).test(upper)) return true;
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * SAYACA GİREN KOD MU? — elle yazılmış serbest kodları eleyen TEK yüklem.
 *
 * ⚠️ ELLE REGEX YASAK ve bu ÖLÇÜLMÜŞ bir arızadır (K27, 2026-09-23): ürün
 * kodunun süzgeci `/^STK-\d{1,12}$/` diye SABİT yazılmıştı. Ön ek panelden
 * değiştirilince süzgeç BÜTÜN satırları eledi, sayaç hep 1'den başladı, çakışma
 * atlaması eleme yüzünden hiçbir şey göremedi ve İKİNCİ üründen itibaren her
 * kayıt P2002 → yanıltıcı 409 ("Barkod üretimi 5 denemede başarısız") verdi:
 * fabrika yeni ürün AÇAMAZ hâle geldi. Biçim VERİ olduğu an, biçme kuralı da
 * veriden doğmak zorundadır.
 *
 * ⚠️ HANE TAVANI biçimden BAĞIMSIZ ve ayrı bir gerekçesi var: `parseInt` 13+
 * haneli bir kodu `Number.MAX_SAFE_INTEGER` üstüne taşır, orada `max + 1 === max`
 * olur ve sayaç SESSİZCE kilitlenir. Bu, biçim doğruluğu değil ARİTMETİK sınırdır.
 */
const COUNTER_DIGIT_CEILING = 12;

export function codeCountsForCounter(fmt: NumberSeriesFormat, code: string): boolean {
  if (!matchesSeries(fmt, code)) return false;
  const kuyruk = code.trim().replace(/^.*?(\d+)$/, "$1");
  return kuyruk.length <= COUNTER_DIGIT_CEILING;
}
