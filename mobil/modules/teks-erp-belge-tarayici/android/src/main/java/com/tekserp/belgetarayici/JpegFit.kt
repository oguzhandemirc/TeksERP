package com.tekserp.belgetarayici

/**
 * Sayfa boyu kuralı (Android'siz, saf): uzun kenar hedefe indirilir, büyütülmez. Kamera yolunun
 * ölçüldüğü boy (uzun kenar ≈ 2600, `docScan.ts` TARGET_LONG_EDGE_PX) burada da aynen uygulanır.
 */
object JpegFit {
  /** Hedefin ALTINA inmeyen en büyük 2'nin kuvveti (BitmapFactory alt örneklemesi). */
  fun sampleSize(width: Int, height: Int, longEdge: Int): Int {
    val long = maxOf(width, height)
    var sample = 1
    while (long / (sample * 2) >= longEdge) sample *= 2
    return sample
  }

  /** Oranı koruyarak uzun kenarı `longEdge`e indirir; zaten küçükse dokunmaz. */
  fun fitSize(width: Int, height: Int, longEdge: Int): Pair<Int, Int> {
    val long = maxOf(width, height)
    if (long <= longEdge || long <= 0) return width to height
    val scale = longEdge.toDouble() / long
    return maxOf(1, Math.round(width * scale).toInt()) to maxOf(1, Math.round(height * scale).toInt())
  }

  /** Tavana sığmayan sayfa için denenen kalite basamakları (ilk = istenen kalite). */
  fun qualitySteps(quality: Int): List<Int> =
    (listOf(quality.coerceIn(MIN_QUALITY, 100)) + listOf(70, 60, 50).filter { it < quality }).distinct()

  const val MIN_QUALITY = 50
}
