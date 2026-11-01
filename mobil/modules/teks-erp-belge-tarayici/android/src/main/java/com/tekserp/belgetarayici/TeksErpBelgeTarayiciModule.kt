package com.tekserp.belgetarayici

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Belge Tara — ML Kit belge tarayıcısı köprüsü. Tarayıcı Play Hizmetleri modülüdür ve ilk kullanımda
 * internetten iner: `availabilityAsync` modül HAZIR değilse indirmeyi arka plana bırakır ve "yok" der,
 * JS klasik kameraya düşer (fabrika tableti internetsiz olabilir; tarama hiç beklemez).
 */
class TeksErpBelgeTarayiciModule : Module() {
  private val worker: ExecutorService by lazy { Executors.newSingleThreadExecutor() }
  private val main = Handler(Looper.getMainLooper())
  private var pending: PendingScan? = null

  /** JS `scanAsync` seçenekleri (kalite yüzde; süre ms). */
  class ScanOptions : Record {
    @Field var pageLimit: Int = 1
    @Field var longEdge: Int = 2600
    @Field var maxBytes: Int = 5 * 1024 * 1024
    @Field var quality: Int = 80
    @Field var startTimeoutMs: Int = 8000
  }

  private class PendingScan(val promise: Promise, val longEdge: Int, val maxBytes: Int, val quality: Int, val pageLimit: Int)

  override fun definition() = ModuleDefinition {
    Name("TeksErpBelgeTarayici")

    /** Hiç reddetmez: `{ available, reason }` (reason: ok · play_services · module_missing · timeout · error · no_context). */
    AsyncFunction("availabilityAsync") { timeoutMs: Int, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(verdict(false, "no_context"))
      } else {
        worker.execute { promise.resolve(checkAvailability(context, timeoutMs.coerceIn(500, 15_000).toLong())) }
      }
    }

    /** `{ canceled, pages: [{ uri, base64, width, height, bytes }] }`; başlatılamazsa ERR_DOC_SCAN_UNAVAILABLE. */
    AsyncFunction("scanAsync") { options: ScanOptions, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_DOC_SCAN_UNAVAILABLE", "Ekran etkin değil", null)
        return@AsyncFunction
      }
      val scan = PendingScan(
        promise,
        options.longEdge.coerceIn(800, 6000),
        options.maxBytes,
        options.quality.coerceIn(JpegFit.MIN_QUALITY, 100),
        options.pageLimit.coerceIn(1, 100),
      )
      synchronized(this@TeksErpBelgeTarayiciModule) {
        if (pending != null) {
          promise.reject("ERR_DOC_SCAN_BUSY", "Tarayıcı zaten açık", null)
          return@AsyncFunction
        }
        pending = scan
      }
      pruneCache(activity)
      val started = AtomicBoolean(false)
      // getStartScanIntent modül inmemişse indirmeyi bekleyebilir: sınırlı süre, sonra kamera yedeği.
      val timeout = Runnable {
        if (started.compareAndSet(false, true)) failPending("ERR_DOC_SCAN_UNAVAILABLE", "Belge tarayıcı zamanında açılamadı")
      }
      main.postDelayed(timeout, options.startTimeoutMs.coerceIn(1_000, 30_000).toLong())
      GmsDocumentScanning.getClient(scannerOptions(scan.pageLimit))
        .getStartScanIntent(activity)
        .addOnSuccessListener { sender ->
          main.removeCallbacks(timeout)
          if (!started.compareAndSet(false, true)) return@addOnSuccessListener
          try {
            activity.startIntentSenderForResult(sender, REQUEST_CODE, null, 0, 0, 0)
          } catch (e: Exception) {
            failPending("ERR_DOC_SCAN_UNAVAILABLE", "Belge tarayıcı açılamadı (${e.javaClass.simpleName})")
          }
        }
        .addOnFailureListener { e ->
          main.removeCallbacks(timeout)
          if (started.compareAndSet(false, true)) failPending("ERR_DOC_SCAN_UNAVAILABLE", e.message ?: "Belge tarayıcı kullanılamıyor")
        }
    }

    OnActivityResult { activity, (requestCode, resultCode, data) ->
      if (requestCode != REQUEST_CODE) return@OnActivityResult
      val scan = takePending() ?: return@OnActivityResult
      if (resultCode == Activity.RESULT_CANCELED) {
        scan.promise.resolve(mapOf("canceled" to true, "pages" to emptyList<Any>()))
        return@OnActivityResult
      }
      val result = if (resultCode == Activity.RESULT_OK) GmsDocumentScanningResult.fromActivityResultIntent(data) else null
      if (result == null) {
        scan.promise.reject("ERR_DOC_SCAN_FAILED", "Tarama sonucu okunamadı", null)
        return@OnActivityResult
      }
      val uris = result.pages.orEmpty().map { it.imageUri }.take(scan.pageLimit)
      worker.execute {
        try {
          scan.promise.resolve(mapOf("canceled" to false, "pages" to uris.map { encodePage(activity, it, scan) }))
        } catch (e: Exception) {
          scan.promise.reject("ERR_DOC_SCAN_FAILED", "Taranan sayfa işlenemedi (${e.javaClass.simpleName})", e)
        }
      }
    }
  }

  private fun verdict(available: Boolean, reason: String) = mapOf("available" to available, "reason" to reason)

  private fun scannerOptions(pageLimit: Int) = GmsDocumentScannerOptions.Builder()
    .setGalleryImportAllowed(false) // yalnız kâğıt belge; galeriden eski fotoğraf girmez
    .setPageLimit(pageLimit)
    .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
    .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
    .build()

  private fun checkAvailability(context: Context, timeoutMs: Long): Map<String, Any> {
    return try {
      if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) != ConnectionResult.SUCCESS) {
        return verdict(false, "play_services")
      }
      val scanner = GmsDocumentScanning.getClient(scannerOptions(1))
      val installer = ModuleInstall.getClient(context)
      val response = Tasks.await(installer.areModulesAvailable(scanner), timeoutMs, TimeUnit.MILLISECONDS)
      if (response.areModulesAvailable()) {
        verdict(true, "ok")
      } else {
        // İnternet gelince Play Hizmetleri indirir; bu tarama kamerayla sürer.
        installer.deferredInstall(scanner)
        verdict(false, "module_missing")
      }
    } catch (e: TimeoutException) {
      verdict(false, "timeout")
    } catch (e: Exception) {
      verdict(false, "error")
    }
  }

  private fun takePending(): PendingScan? = synchronized(this) { pending.also { pending = null } }

  private fun failPending(code: String, message: String) {
    takePending()?.promise?.reject(code, message, null)
  }

  private fun encodePage(context: Context, uri: Uri, scan: PendingScan): Map<String, Any> {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalStateException("boş sayfa")
    val decodeOpts = BitmapFactory.Options().apply { inSampleSize = JpegFit.sampleSize(bounds.outWidth, bounds.outHeight, scan.longEdge) }
    val decoded = resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, decodeOpts) }
      ?: throw IllegalStateException("sayfa çözülemedi")
    val (w, h) = JpegFit.fitSize(decoded.width, decoded.height, scan.longEdge)
    val bitmap = if (w != decoded.width || h != decoded.height) {
      Bitmap.createScaledBitmap(decoded, w, h, true).also { if (it !== decoded) decoded.recycle() }
    } else {
      decoded
    }
    var bytes = ByteArray(0)
    try {
      for (q in JpegFit.qualitySteps(scan.quality)) {
        bytes = ByteArrayOutputStream().use { out ->
          bitmap.compress(Bitmap.CompressFormat.JPEG, q, out)
          out.toByteArray()
        }
        if (bytes.size <= scan.maxBytes) break
      }
    } finally {
      bitmap.recycle()
    }
    // Önizleme gönderilecek baytın kendisini gösterir (ML Kit'in ham dosyası değil).
    val file = File(cacheDir(context), "${UUID.randomUUID()}.jpg")
    file.writeBytes(bytes)
    return mapOf(
      "uri" to Uri.fromFile(file).toString(),
      "base64" to Base64.encodeToString(bytes, Base64.NO_WRAP),
      "width" to w,
      "height" to h,
      "bytes" to bytes.size,
    )
  }

  private fun cacheDir(context: Context) = File(context.cacheDir, "belge-tara").apply { mkdirs() }

  /** Bir günden eski tarama dosyaları atılır (önbellek; sayfa listesi oturumluk). */
  private fun pruneCache(context: Context) {
    val cutoff = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(1)
    cacheDir(context).listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
  }

  companion object {
    private const val REQUEST_CODE = 0x7e5a
  }
}
