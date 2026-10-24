// =============================================================================
// e-İRSALİYE NUMARASI — üreteç giriş noktası (E2-SERI, 2026-10-24)
// =============================================================================
// GİB biçimi `EIR` + YYYY + 9 hane; biçim kapısı `series-fixed-shape.helper`.
// E5 motoru numarayı TASLAK→OLUSTURULDU claim tx'inde, belge tarihinin FABRİKA
// günüyle çağırır (yıl segmenti fabrika diliminden çözülür).
//
// ⚠️ BOŞLUKSUZLUK E5'İN İŞİ: üreteç max+1 verir; eşzamanlı iki üretim aynı
// numarayı görür ve `documentNo @unique` 409 verir. E5 seriyi kilitlemeli.
//
// ⚠️ YÜKLEYİCİ TEK: üretim ve başlangıç kilidi ("bu yıl numara üretildi mi")
// AYNI yükleyiciden okur. Kayıt tablosu E1-SEMA'da doğar; o güne dek seriden
// numara üretilemez, yükleyici boş döner. Model doğunca bekçi
// (`test_number_series_panel §4e`) bu dosyanın tabloya bağlanmasını ister.
// =============================================================================
import { seriesPrefix, type NumberSeriesFormat } from "../helpers/series-format.helper";
import {
  nextSeriesNo,
  resolveSeriesFormat,
  seriesUsedMaxFrom,
  type SeriesCodeRow,
} from "../number-series.service";

export const E_IRSALIYE_SERIES_KEY = "eIrsaliye";

export type EIrsaliyeCodeLoader = (fullPrefix: string, fmt: NumberSeriesFormat) => Promise<SeriesCodeRow[]>;

/** Kayıt tablosu doğana dek (E1-SEMA) boş: hiçbir e-İrsaliye numarası üretilmedi. */
export const loadEIrsaliyeCodes: EIrsaliyeCodeLoader = async () => [];

/** Sıradaki GİB numarası — `issueDate` belge tarihi; yıl fabrika gününden. */
export async function nextEIrsaliyeDocumentNo(
  issueDate: Date,
  loadCodes: EIrsaliyeCodeLoader = loadEIrsaliyeCodes,
): Promise<string> {
  return nextSeriesNo(E_IRSALIYE_SERIES_KEY, loadCodes, issueDate);
}

/** Başlangıç kilidinin sorusu: `at`ın fabrika yılında bu seriden numara üretildi mi? */
export async function eIrsaliyeYearHasNumbers(
  at: Date,
  loadCodes: EIrsaliyeCodeLoader = loadEIrsaliyeCodes,
): Promise<boolean> {
  const fmt = resolveSeriesFormat(E_IRSALIYE_SERIES_KEY);
  const fullPrefix = seriesPrefix(fmt, at);
  return seriesUsedMaxFrom(fmt, await loadCodes(fullPrefix, fmt), fullPrefix) > 0;
}
