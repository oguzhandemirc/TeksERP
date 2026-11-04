package com.tekserp.belgetarayici

/**
 * Canlı okuma (L2) sabitleri — TEK YER. Tavanlar `mobil/src/services/deviceOcr.ts` ile aynıdır
 * (bekçi `mobil/src/services/liveCamera.test.ts` iki dosyayı karşılaştırır).
 */
internal object LiveTuning {
  /** `onText` en sık: iki okuma başlangıcı arasında en az bu kadar (~4/sn). Okuyucu meşgulken kare zaten atlanır. */
  const val TEXT_MIN_INTERVAL_MS = 250L
  /** `onStability` en sık (sabitlik değişince beklemeden gider). */
  const val STABILITY_MIN_INTERVAL_MS = 250L

  /** Sunucu tavanları (`CLIENT_OCR_MAX_WORDS` / `CLIENT_OCR_MAX_LINES`); canlı karede fazlası kesilir. */
  const val MAX_WORDS = 4000
  const val MAX_LINES = 2000

  /** Analiz karesi hedefi (4:3; ML Kit için yeterli, pil/ısı için küçük). */
  const val ANALYSIS_WIDTH = 1280
  const val ANALYSIS_HEIGHT = 960

  /** Parlaklık ızgarası: GRID × GRID hücre, hücre ortalaması örnek adımıyla. */
  const val GRID = 8
  const val GRID_SAMPLE_STEP = 4
  /** Ardışık iki karenin hücre ortalaması farkı (parlaklık birimi, 0–255) bunun altındaysa kare "kıpırtısız". */
  const val STILL_MAX_DIFF = 4.0
  /** Sabit sayılmak için art arda kıpırtısız kare sayısı. */
  const val STILL_MIN_FRAMES = 3
  /** Netlik: orta bölgede komşu pikseller arası ortalama mutlak fark (parlaklık birimi); ölçüm adımı. */
  const val SHARPNESS_STEP = 2

  /** `captureStill` JPEG kalitesi (yükleme yolu boyu/tavanı ayrıca uygular). */
  const val CAPTURE_JPEG_QUALITY = 90
  /** Çekilen fotoğrafın önbellek öneki. */
  const val CAPTURE_PREFIX = "canli-"
}
