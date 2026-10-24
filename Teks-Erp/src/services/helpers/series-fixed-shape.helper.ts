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
// uzunluğu standardın parçası. Sayaç `maxValue`da 409 ile durur, sarmaz; bu
// yüzden sayaç ayarları (başlangıç · adım · sınır · sarma) da bu seride kapalı.
// =============================================================================
import type { SeriesFormatAxis } from "../../config/client-version-policy";
import { numberSeriesCatalogEntry, type NumberSeriesCatalogEntry } from "../../constants/number-series-catalog";
import { AppError } from "../../utils/app-error";
import type { NumberSeriesFormat } from "./series-format.helper";

/** Sabit biçimli seride kilitli eksenler — okuma ve yazma kolunun ORTAK listesi. */
export const FIXED_SHAPE_LOCKED_AXES: readonly SeriesFormatAxis[] = ["dateSegment", "digits", "separator", "separator2"];

type FixedShape = NonNullable<NumberSeriesCatalogEntry["fixedShape"]>;

/** Kilit cümlesi — kullanıcı diliyle; teknik ad yok (bekçi `§13`). */
export function fixedShapeLockReason(fs: FixedShape): string {
  return `${fs.not}. Tarih, hane ve ayraç değiştirilemez; yalnız 3 karakterlik seri (ön ek) değiştirilebilir.`;
}

/** Sayaç kilidi cümlesi — boşluksuz sıra standardın gereği. */
export function fixedShapeCounterReason(fs: FixedShape): string {
  return `${fs.not}. Sıra boşluksuz ilerler ve ${(10 ** fs.digits - 1).toLocaleString("tr-TR")} numarasında durur; ` +
    "başlangıç, adım, üst sınır ve başa dönme ayarları bu seride kapalı.";
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
  const sapan = FIXED_SHAPE_LOCKED_AXES.find((a) => axisDeviates(fs, fmt, a));
  if (sapan) {
    throw AppError.badRequest(`GİB biçimi değiştirilemez: ${fixedShapeLockReason(fs)}`, {
      code: "NUMBER_SERIES_FIXED_SHAPE",
      key,
      field: sapan,
    });
  }
}

/** Sayaç kapısı — sabit biçimli seride her sayaç ayarı reddedilir (boşluksuz sıra). */
export function assertFixedShapeCounter(key: string): void {
  const fs = fixedShapeOf(key);
  if (!fs) return;
  throw AppError.badRequest(`Bu serinin sayacı ayarlanamaz: ${fixedShapeCounterReason(fs)}`, {
    code: "NUMBER_SERIES_FIXED_SHAPE",
    key,
  });
}
