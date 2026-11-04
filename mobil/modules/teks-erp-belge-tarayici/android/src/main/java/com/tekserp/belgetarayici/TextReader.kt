package com.tekserp.belgetarayici

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.Point
import android.media.ExifInterface
import android.net.Uri
import android.os.SystemClock
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Cihazda OCR (S16c) — ML Kit Latin metin tanıma, GÖMÜLÜ model (Play Hizmetleri/internet gerekmez).
 * Sunucu okuma servisinin aynası (`okuma/app/motor.py`): EXIF yönü uygulanır, uzun kenar > 2600 ise küçültülür,
 * satırların çoğu dikeyse 90/270 döndürülmüş hâller de okunur ve Σ güven × uzunluk en yüksek seçilir.
 * Dönüş: `{ width, height, rotation, ms, lines: [{ c, p }], words: [{ t, c, l, p }] }` — koordinatlar seçilen DİK çerçevede.
 */
internal class TextReader(private val context: Context) {
  private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

  private class Pass(val text: Text, val width: Int, val height: Int, val rotation: Int)

  /** `deadline` = `SystemClock.elapsedRealtime()` tabanlı mutlak süre sonu; aşılırsa TimeoutException. */
  fun read(uri: String, longEdge: Int, deadline: Long): Map<String, Any> {
    val t0 = SystemClock.elapsedRealtime()
    if (t0 >= deadline) throw TimeoutException("kuyrukta süre doldu")
    val upright = loadUpright(context, Uri.parse(uri), longEdge)
    try {
      var best = Pass(recognize(upright, deadline), upright.width, upright.height, 0)
      if (sideways(best.text)) {
        var bestScore = score(best.text)
        for (deg in intArrayOf(90, 270)) {
          if (SystemClock.elapsedRealtime() >= deadline) break
          val rotated = Bitmap.createBitmap(upright, 0, 0, upright.width, upright.height, Matrix().apply { postRotate(deg.toFloat()) }, true)
          try {
            val cand = Pass(recognize(rotated, deadline), rotated.width, rotated.height, deg)
            val s = score(cand.text)
            if (s > bestScore) {
              bestScore = s
              best = cand
            }
          } finally {
            rotated.recycle()
          }
        }
      }
      return toWire(best, SystemClock.elapsedRealtime() - t0)
    } finally {
      upright.recycle()
    }
  }

  private fun recognize(bitmap: Bitmap, deadline: Long): Text {
    val left = (deadline - SystemClock.elapsedRealtime()).coerceAtLeast(1)
    return Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)), left, TimeUnit.MILLISECONDS)
  }

  /** `yan_donuk_mu` aynası: ≥ 3 karakterli satırların yarıdan fazlası dikeyse (ya da hiç satır yoksa) yan yatmıştır. */
  private fun sideways(text: Text): Boolean {
    val long = text.textBlocks.flatMap { it.lines }.filter { it.text.trim().length >= 3 }
    if (long.isEmpty()) return true
    val vertical = long.count { l -> l.boundingBox?.let { it.height() >= 1.5 * it.width() } ?: false }
    return vertical * 2 > long.size
  }

  /** `sayfa_puani` aynası: Σ güven × uzunluk. */
  private fun score(text: Text): Double =
    text.textBlocks.flatMap { it.lines }.sumOf { conf(it.confidence) * it.text.trim().length }

  private fun conf(v: Float): Double = if (v.isFinite()) v.toDouble().coerceIn(0.0, 1.0) else 0.0

  private fun quad(corners: Array<Point>?, box: android.graphics.Rect?): List<List<Int>>? {
    if (corners != null && corners.size == 4) return corners.map { listOf(it.x, it.y) }
    val b = box ?: return null
    return listOf(listOf(b.left, b.top), listOf(b.right, b.top), listOf(b.right, b.bottom), listOf(b.left, b.bottom))
  }

  /** Her kelime satır sırasını (`l`) taşır — sunucu tablo satırlarını cihazın satırından kurar. */
  private fun toWire(pass: Pass, ms: Long): Map<String, Any> {
    val lines = ArrayList<Map<String, Any>>()
    val words = ArrayList<Map<String, Any>>()
    for (block in pass.text.textBlocks) {
      for (line in block.lines) {
        val lc = quad(line.cornerPoints, line.boundingBox) ?: continue
        val l = lines.size
        lines.add(mapOf("c" to lc, "p" to conf(line.confidence)))
        for (el in line.elements) {
          val wc = quad(el.cornerPoints, el.boundingBox) ?: continue
          if (el.text.isBlank()) continue
          words.add(mapOf("t" to el.text, "c" to wc, "l" to l, "p" to conf(el.confidence)))
        }
      }
    }
    return mapOf(
      "width" to pass.width,
      "height" to pass.height,
      "rotation" to pass.rotation,
      "ms" to ms,
      "lines" to lines,
      "words" to words,
    )
  }

  companion object {
    /** Sayfa iyileştirme (`enhancePageAsync`) de aynı dik çerçeveyi kullanır: EXIF bir kez, tek yerde. */
    /** Gönderilen JPEG'in sunucuda çözüldüğü çerçeve: EXIF yönü uygulanmış, uzun kenar `longEdge`i aşmaz. */
    fun loadUpright(context: Context, uri: Uri, longEdge: Int): Bitmap {
      val resolver = context.contentResolver
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalStateException("görüntü çözülemedi")
      val orientation = resolver.openInputStream(uri)?.use {
        ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      } ?: ExifInterface.ORIENTATION_NORMAL
      val opts = BitmapFactory.Options().apply { inSampleSize = JpegFit.sampleSize(bounds.outWidth, bounds.outHeight, longEdge) }
      val decoded = resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, opts) }
        ?: throw IllegalStateException("görüntü çözülemedi")
      val m = Matrix()
      var swap = false
      when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> { m.postRotate(90f); swap = true }
        ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> { m.postRotate(270f); swap = true }
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.postScale(-1f, 1f); swap = true }
        ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.postScale(-1f, 1f); swap = true }
      }
      val ow = if (swap) decoded.height else decoded.width
      val oh = if (swap) decoded.width else decoded.height
      val (fw, _) = JpegFit.fitSize(ow, oh, longEdge)
      if (fw != ow) m.postScale(fw.toFloat() / ow, fw.toFloat() / ow)
      val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true)
      if (upright !== decoded) decoded.recycle()
      return upright
    }
  }
}
