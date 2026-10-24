// =============================================================================
// SABİT BİÇİMLİ SERİ (`fixedShape`) — dış standardın (GİB) biçim kapısı
// =============================================================================
// Bugünkü tek üye: e-İrsaliye numarası (3 karakter seri + yıl + 9 hane sıra;
// ⚠ biçim plan §3.6'da "doğrulanacak"). Fabrika YALNIZ ön eki seçer; tarih,
// hane ve iki ayraç standardındır.
//
// ⚠️ TEK KAYNAK, İKİ KOL: yazma kapısı (`assertSeriesFormatAllowed` DEĞER kolu,
// `assertSeriesCounterAllowed`) ve okuma kolu (`seriesLock` → panelde pasif
// alanlar + cümle) bu dosyadaki AYNI listeden okur — ayrışırlarsa panel alanı
// açık gösterir, uç 400 döner (`numaralandirma.md` "aynı fazları arar").
//
// ⚠️ "Hane taşarsa kod GENİŞLER" kuralının BEYANLI istisnası: GİB numarasının
// uzunluğu standardın parçası. Sayaç `maxValue`da 409 ile durur, sarmaz; adım,
// sınır ve sarma bu seride kapalı.
//
// ⚠️ TEK İSTİSNA BAŞLANGIÇ DEĞERİ (patron kararı 2026-10-24): başka programla
// yıl ortasında kesen fabrika kaldığı sıradan sürmeli. Değer YILA bağlanır
// (`startValueYear`, ertesi yıl 1'den) ve o yıl numara üretilince kilitlenir.
// =============================================================================
import type { SeriesFormatAxis } from "../../config/client-version-policy";
import { numberSeriesCatalogEntry, type NumberSeriesCatalogEntry } from "../../constants/number-series-catalog";
import { AppError } from "../../utils/app-error";
import { factoryYmd } from "../../constants/time";
import type { NumberSeriesFormat } from "./series-format.helper";
import type { SeriesCounterCapabilities, SeriesLock } from "./series-panel.helper";

/** Sabit biçimli seride kilitli eksenler — okuma ve yazma kolunun ORTAK listesi. */
export const FIXED_SHAPE_LOCKED_AXES: readonly SeriesFormatAxis[] = ["dateSegment", "digits", "separator", "separator2"];

type FixedShape = NonNullable<NumberSeriesCatalogEntry["fixedShape"]>;

/** Kilit cümlesi — kullanıcı diliyle; teknik ad yok (bekçi `§13`). */
export function fixedShapeLockReason(fs: FixedShape): string {
  return `${fs.not}. Tarih, hane ve ayraç değiştirilemez; yalnız 3 karakterlik seri (ön ek) değiştirilebilir.`;
}

/** Sayaç kilidi cümlesi — boşluksuz sıra standardın gereği. */
export function fixedShapeCounterReason(fs: FixedShape): string {
  return `${fs.not}. Sıra boşluksuz ilerler ve ${fixedShapeCeiling(fs).toLocaleString("tr-TR")} numarasında durur; ` +
    "artış adımı, üst sınır ve başa dönme ayarları bu seride kapalı.";
}

/** Başlangıç değerinin kuralı — panelde alanın altında birebir gösterilir. */
export const FIXED_SHAPE_START_NOTE =
  "Başlangıç değeri yalnız içinde bulunulan yıl için ve bu yıl henüz numara üretilmemişken " +
  "ayarlanabilir (ör. başka programdan yıl ortasında geçişte kalınan sıranın bir fazlası). " +
  "İlk numara üretilince kilitlenir; ertesi yıl sıra yine 1'den başlar.";

/** Okuma kolu: kısmi YAPISAL kilit — yazma kapısıyla AYNI eksen listesi. */
export function fixedShapeLock(fs: FixedShape): SeriesLock {
  return {
    kind: "YAPISAL",
    reason: fixedShapeLockReason(fs),
    acilma: "Bu kilit kalkmayacak.",
    kimde: "kimse",
    lockedAxes: [...FIXED_SHAPE_LOCKED_AXES],
  };
}

/** Okuma kolu: sayaçta yalnız başlangıç açık (kural cümlesiyle). */
export function fixedShapeCounterCaps(fs: FixedShape): Omit<SeriesCounterCapabilities, "resetReason"> {
  return {
    startValue: true, step: false, maxValue: false, reset: false,
    lockedReason: fixedShapeCounterReason(fs),
    startValueNote: FIXED_SHAPE_START_NOTE,
  };
}

function fixedShapeCeiling(fs: FixedShape): number {
  return 10 ** fs.digits - 1;
}

function fixedShapeOf(key: string): FixedShape | undefined {
  return numberSeriesCatalogEntry(key).fixedShape;
}

/** Bu eksen standardın parçası mı ve aday değer ondan farklı mı? */
function axisDeviates(fs: FixedShape, fmt: Pick<NumberSeriesFormat, SeriesFormatAxis>, axis: SeriesFormatAxis): boolean {
  switch (axis) {
    case "dateSegment": return fmt.dateSegment !== fs.dateSegment;
    case "digits": return fmt.digits !== fs.digits;
    case "separator": return fmt.separator !== fs.separator;
    // `null` = birinci ayraca düş — standartla aynı sonuç.
    case "separator2": return (fmt.separator2 ?? fs.separator) !== fs.separator;
    case "prefix": return false;
  }
}

/**
 * DEĞER kapısı — sabit biçimli seride fail-closed. Ön ek `prefixRe`e uymazsa ya
 * da kilitli eksenlerden biri standarttan saparsa 400 `NUMBER_SERIES_FIXED_SHAPE`.
 */
export function assertFixedShapeFormat(key: string, fmt: Pick<NumberSeriesFormat, SeriesFormatAxis>): void {
  const fs = fixedShapeOf(key);
  if (!fs) return;
  if (!new RegExp(fs.prefixRe).test(fmt.prefix)) {
    throw AppError.badRequest(
      "e-İrsaliye serisi 3 harf/rakam olmalı (İngiliz alfabesi büyük harfleri ve rakam).",
      { code: "NUMBER_SERIES_FIXED_SHAPE", key, field: "prefix" },
    );
  }
  const deviating = FIXED_SHAPE_LOCKED_AXES.find((a) => axisDeviates(fs, fmt, a));
  if (deviating) {
    throw AppError.badRequest(`GİB biçimi değiştirilemez: ${fixedShapeLockReason(fs)}`, {
      code: "NUMBER_SERIES_FIXED_SHAPE",
      key,
      field: deviating,
    });
  }
}

export interface FixedShapeCounterInput {
  startValue: number | null;
  step: number | null;
  maxValue: number | null;
  wrap: boolean;
}

/**
 * Sayaç kapısı (eşzamansız kısım hariç) — sabit biçimli seride yalnız başlangıç
 * değeri yazılabilir. Adım/sarma kapalı; üst sınır standardın tavanında sabit
 * (panel mevcut değeri geri gönderir, bu yüzden "tavana eşit" kabul edilir).
 */
export function assertFixedShapeCounter(key: string, next: FixedShapeCounterInput): void {
  const fs = fixedShapeOf(key);
  if (!fs) return;
  const ceiling = fixedShapeCeiling(fs);
  const deviating = next.step !== null ? "step" : next.wrap ? "wrap" : next.maxValue !== ceiling ? "maxValue" : null;
  if (deviating) {
    throw AppError.badRequest(`Bu serinin sayacı ayarlanamaz: ${fixedShapeCounterReason(fs)}`, {
      code: "NUMBER_SERIES_FIXED_SHAPE",
      key,
      field: deviating,
    });
  }
  if (next.startValue !== null && (next.startValue < 1 || next.startValue > ceiling)) {
    throw AppError.badRequest(`Başlangıç değeri 1 ile ${ceiling.toLocaleString("tr-TR")} arasında olmalı.`, {
      code: "NUMBER_SERIES_FIXED_SHAPE",
      key,
      field: "startValue",
    });
  }
}

/** Fabrika yılı — yıl kaynağı tek: `factoryYmd` (UTC host gece kayması yok). */
export function factoryYearOf(at: Date): number {
  return Number(factoryYmd(at).slice(0, 4));
}

/**
 * Yıla bağlı başlangıç yalnız KENDİ yılında sayılır; başka yılda ayar yokmuş gibi
 * (1'den). `startValueYear` NULL olan her seride biçim aynen döner (bugünkü davranış).
 */
export function startValueInEffect(fmt: NumberSeriesFormat, at: Date): NumberSeriesFormat {
  if (fmt.startValueYear == null || fmt.startValueYear === factoryYearOf(at)) return fmt;
  return { ...fmt, startValue: null, startValueYear: null };
}

/** Yazılacak yıl damgası — yalnız sabit biçimli seride; diğerlerinde kolona dokunulmaz. */
export function fixedShapeStartYear(key: string, startValue: number | null, now: Date): { startValueYear?: number | null } {
  if (!fixedShapeOf(key)) return {};
  return { startValueYear: startValue === null ? null : factoryYearOf(now) };
}

/**
 * BAŞLANGIÇ KİLİDİ — bu yıl seriden numara üretildiyse başlangıç değişmez (409).
 *
 * `yearHasNumbers` üretecin KENDİ yükleyicisiyle sorar (`e-irsaliye-number.ts`);
 * ayrı bir sayım "üretildi mi" sorusunu ikinci yerde cevaplardı. Değer değişmiyorsa
 * sorulmaz (panel sayaç bloğunu bütün gönderir).
 */
export async function assertFixedShapeStartUnlocked(
  key: string,
  current: { startValue?: number | null; startValueYear?: number | null },
  nextStart: number | null,
  ctx: { now: Date; yearHasNumbers: ((at: Date) => Promise<boolean>) | undefined },
): Promise<void> {
  const { now, yearHasNumbers } = ctx;
  if (!fixedShapeOf(key)) return;
  const year = factoryYearOf(now);
  const inEffect = current.startValueYear === year ? (current.startValue ?? null) : null;
  if (nextStart === inEffect) return;
  // Fail-closed: kullanım sorulamıyorsa kilit açılmaz.
  if (!yearHasNumbers || (await yearHasNumbers(now))) {
    throw AppError.conflict(
      `Başlangıç değeri değiştirilemez: ${year} yılında bu seriden numara üretildi. ` +
        "Sıra kaldığı yerden boşluksuz sürer; ertesi yıl yine 1'den başlar.",
      { code: "NUMBER_SERIES_START_LOCKED", key, year },
    );
  }
}
