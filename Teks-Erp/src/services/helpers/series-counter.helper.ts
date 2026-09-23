// =============================================================================
// SAYAÇ ÇEKİRDEĞİ — başlangıç · adım · üst sınırın TEK SAHİBİ (2026-09-23)
// =============================================================================
// Saf: önbelleğe, prisma'ya, kataloğa dokunmaz. `seriesSeqFrom` da `nextSeriesNo`
// da BURAYI çağırır; ikinci bir kopya "ayrışan yüzey" sınıfına girerdi — ön ek
// bir hesaptan, adım başka bir hesaptan gelirdi ve fark yalnız SAHADA görünürdü.
//
// ⚠️ Bu dilimde (D2①) alanların HİÇBİRİ dolu DEĞİL: kolonlar bir sonraki dilimde
// iner. Boş ayarla sonuç `currentMax + 1`dir, yani BUGÜNKÜ davranış birebir.
// Helper'ın önce inmesi bilinçli: 28 çağrı yerinin imzası bir kez değişsin, veri
// geldiğinde hiçbir üreteç dosyasına dokunulmasın.
// =============================================================================
import { AppError } from "../../utils/app-error";

/** Serinin sayaç ayarları — hepsi opsiyonel, hepsinin yokluğu = bugünkü davranış. */
export interface SeriesCounterSettings {
  /** İlk numara (SAP "aralık başı"). Yoksa 1. Mevcut maksimumun ALTINDAYSA etkisizdir. */
  startValue?: number | null;
  /** Artış adımı (Odoo `number_increment`). Yoksa 1. */
  step?: number | null;
  /** Üst sınır; aşımda 409. Yoksa sınır yok — taşma HANEYİ GENİŞLETİR (İ3). */
  maxValue?: number | null;
}

/**
 * Sıradaki sıra numarası.
 *
 * ⚠️ `digits` BURAYA GİRMEZ ve bu bilinçli: hane bir DOLGU ayarıdır, kapasite
 * değil (ölçüldü — `digits=4` iken sıra 10000 → "10000", sarmaz). Sayacı
 * durduran tek şey `maxValue`dur; panel de bunu bu cümleyle söyler, yoksa
 * kullanıcı "4 hane" görüp 9999'da duracağını sanar.
 */
export function nextCounterSeq(
  settings: SeriesCounterSettings,
  currentMax: number,
  seriesLabel: string,
): number {
  const start = settings.startValue ?? 1;
  const step = settings.step ?? 1;
  // Başlangıç mevcut maksimumun ÜSTÜNDEyse doğrudan oraya atlanır; altındaysa
  // sessizce etkisizdir — geçmişi ezmek bir numarayı MÜKERRER yapardı.
  const seq =
    currentMax < start ? start : start + Math.ceil((currentMax + 1 - start) / step) * step;
  if (settings.maxValue != null && seq > settings.maxValue) {
    throw AppError.conflict(
      `"${seriesLabel}" serisinin numara aralığı doldu (üst sınır ${settings.maxValue}). ` +
        "Seri ayarından üst sınırı yükseltin ya da yeni bir ön eke geçin.",
      { code: "NUMBER_SERIES_RANGE_EXHAUSTED", series: seriesLabel, maxValue: settings.maxValue },
    );
  }
  return seq;
}

/**
 * Atlama döngüsünün bir sonraki adayı — çakışan kod bulunduğunda.
 *
 * ⚠️ Atlama ADIM KADAR ilerler, 1 kadar değil: adım 10 olan bir seride 1'er
 * ilerlemek serinin kendi dizisinin DIŞINDA numara üretirdi. Sınır sayımı
 * çağırana aittir ve DENEME sayar (ölçüldü 2026-09-23: bugünkü `SKIP_LIMIT`
 * SIRA BİRİMİ sayıyor, yani adım 10'da sessizce 10 kat daralırdı).
 */
export function nextCounterCandidate(settings: SeriesCounterSettings, seq: number): number {
  return seq + (settings.step ?? 1);
}
