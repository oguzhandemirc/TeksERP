package com.tekserp.belgetarayici

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.ExifInterface
import android.net.Uri
import android.os.SystemClock
import android.util.Size
import android.view.View
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Canlı okuma (L2): CameraX önizleme + kare analizi (ML Kit metin tanıma, gömülü model) + tek fotoğraf.
 * Olaylar: `onText` (ClientOcr biçimi, dik kare çerçevesinde) · `onStability` · `onError`. Analiz yalnız görünüm
 * pencereye bağlı VE etkinken çalışır; ayrılınca kamera bırakılır, yok edilince okuyucu kapanır.
 * Önizleme FIT_CENTER: kare görünüme orantılı sığar (kutu çizimi için `contain` dönüşümü yeter).
 */
@SuppressLint("ViewConstructor")
class LiveCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onText by EventDispatcher()
  private val onStability by EventDispatcher()
  private val onError by EventDispatcher()

  private val previewView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FIT_CENTER
  }
  private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private val mainExecutor = ContextCompat.getMainExecutor(context)
  private var recognizer: TextRecognizer? = null
  private val stability = FrameStability()

  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var bound: List<UseCase> = emptyList()
  private var imageCapture: ImageCapture? = null

  private var active = true
  private var released = false
  /** Her bağlamada artar: eski bağlamanın geç gelen sonucu yayımlanmaz. */
  @Volatile private var generation = 0
  private val reading = AtomicBoolean(false)
  @Volatile private var lastTextAt = 0L
  @Volatile private var lastStabilityAt = 0L
  @Volatile private var lastStill: Boolean? = null
  private var readerErrorSent = false
  private var capturing = false

  init {
    // RN yerleşimi native çocukları ölçmez: PreviewView kendi yüzeyini sonradan ekleyince elle yerleştirilir.
    previewView.setOnHierarchyChangeListener(object : OnHierarchyChangeListener {
      override fun onChildViewRemoved(parent: View?, child: View?) = Unit
      override fun onChildViewAdded(parent: View?, child: View?) {
        parent?.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
        parent?.layout(0, 0, parent.measuredWidth, parent.measuredHeight)
      }
    })
    addView(previewView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    previewView.measure(MeasureSpec.makeMeasureSpec(right - left, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(bottom - top, MeasureSpec.EXACTLY))
    previewView.layout(0, 0, right - left, bottom - top)
    updateRotation()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (active) start()
  }

  override fun onDetachedFromWindow() {
    stop()
    super.onDetachedFromWindow()
  }

  /** JS `setActive`: ekran arkadayken kamera ve analiz bırakılır (pil/ısınma). */
  fun setActive(value: Boolean) {
    if (active == value) return
    active = value
    if (value && isAttachedToWindow) start() else if (!value) stop()
  }

  /** Görünüm yok edilirken (OnViewDestroys): kamera, okuyucu ve iş parçacığı kapanır. */
  fun release() {
    if (released) return
    released = true
    stop()
    recognizer?.close()
    recognizer = null
    analysisExecutor.shutdown()
  }

  private fun emitError(code: String, message: String) {
    onError(mapOf("code" to code, "message" to message))
  }

  private fun start() {
    if (released || bound.isNotEmpty()) return
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      emitError("NO_PERMISSION", "Kamera izni yok")
      return
    }
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      emitError("NO_ACTIVITY", "Ekran etkin değil")
      return
    }
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      try {
        val p = future.get()
        provider = p
        // Dinleyici gelene dek görünüm ayrılmış/etkisizleşmiş olabilir.
        if (released || !active || !isAttachedToWindow || bound.isNotEmpty()) return@addListener
        bind(p, owner)
      } catch (e: Exception) {
        emitError("CAMERA_UNAVAILABLE", "Kamera açılamadı (${e.javaClass.simpleName})")
      }
    }, mainExecutor)
  }

  private fun ratio43(target: Size?): ResolutionSelector {
    val b = ResolutionSelector.Builder().setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
    if (target != null) b.setResolutionStrategy(ResolutionStrategy(target, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
    return b.build()
  }

  private fun bind(p: ProcessCameraProvider, owner: LifecycleOwner) {
    val rotation = previewView.display?.rotation ?: android.view.Surface.ROTATION_0
    val preview = Preview.Builder().setResolutionSelector(ratio43(null)).setTargetRotation(rotation).build()
    preview.setSurfaceProvider(previewView.surfaceProvider)
    val analysis = ImageAnalysis.Builder()
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setResolutionSelector(ratio43(Size(LiveTuning.ANALYSIS_WIDTH, LiveTuning.ANALYSIS_HEIGHT)))
      .setTargetRotation(rotation)
      .build()
    val capture = ImageCapture.Builder()
      .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
      .setJpegQuality(LiveTuning.CAPTURE_JPEG_QUALITY)
      .setResolutionSelector(ratio43(null))
      .setTargetRotation(rotation)
      .build()
    generation++
    val gen = generation
    stability.reset()
    lastStill = null
    readerErrorSent = false
    analysis.setAnalyzer(analysisExecutor) { proxy -> analyze(proxy, gen) }
    val useCases = listOf(preview, analysis, capture)
    try {
      // unbindAll DEĞİL: aynı sağlayıcıyı kullanan başka bir kamera görünümüne dokunulmaz.
      camera = p.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, *useCases.toTypedArray())
      bound = useCases
      imageCapture = capture
    } catch (e: Exception) {
      analysis.clearAnalyzer()
      emitError("CAMERA_UNAVAILABLE", "Kamera açılamadı (${e.javaClass.simpleName})")
    }
  }

  private fun stop() {
    generation++
    val uses = bound
    bound = emptyList()
    imageCapture = null
    camera = null
    if (uses.isEmpty()) return
    (uses.firstOrNull { it is ImageAnalysis } as? ImageAnalysis)?.clearAnalyzer()
    provider?.unbind(*uses.toTypedArray())
  }

  private fun updateRotation() {
    val rotation = previewView.display?.rotation ?: return
    for (u in bound) {
      when (u) {
        is ImageAnalysis -> u.targetRotation = rotation
        is ImageCapture -> u.targetRotation = rotation
        is Preview -> u.targetRotation = rotation
      }
    }
  }

  @androidx.annotation.OptIn(ExperimentalGetImage::class)
  private fun analyze(proxy: ImageProxy, gen: Int) {
    if (gen != generation) {
      proxy.close()
      return
    }
    val now = SystemClock.elapsedRealtime()
    try {
      val plane = proxy.planes[0]
      val s = stability.update(plane.buffer, plane.rowStride, plane.pixelStride, proxy.width, proxy.height)
      if (s.still != lastStill || now - lastStabilityAt >= LiveTuning.STABILITY_MIN_INTERVAL_MS) {
        lastStill = s.still
        lastStabilityAt = now
        val sharp = Math.round(s.sharpness * 100) / 100.0
        mainExecutor.execute { if (gen == generation) onStability(mapOf("still" to s.still, "sharpness" to sharp)) }
      }
    } catch (e: Exception) {
      // Sabitlik ölçülemedi: metin okuması yine denenir.
    }
    val media = proxy.image
    if (media == null || now - lastTextAt < LiveTuning.TEXT_MIN_INTERVAL_MS || !reading.compareAndSet(false, true)) {
      proxy.close()
      return
    }
    lastTextAt = now
    val rot = proxy.imageInfo.rotationDegrees
    val swap = rot == 90 || rot == 270
    val w = if (swap) proxy.height else proxy.width
    val h = if (swap) proxy.width else proxy.height
    val reader = recognizer ?: TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).also { recognizer = it }
    try {
      reader.process(InputImage.fromMediaImage(media, rot))
        .addOnSuccessListener(mainExecutor) { text ->
          if (gen != generation) return@addOnSuccessListener
          // ML Kit köşeleri dik (döndürülmüş) karede verir → `rotation` 0; algılayıcı açısı ayrıca bilgi olarak gider.
          val wire = TextReader.wire(text, w, h, 0, SystemClock.elapsedRealtime() - now, LiveTuning.MAX_LINES, LiveTuning.MAX_WORDS)
          onText(wire + mapOf("sensorRotation" to rot, "at" to System.currentTimeMillis()))
        }
        .addOnFailureListener(mainExecutor) { e ->
          if (gen != generation || readerErrorSent) return@addOnFailureListener
          readerErrorSent = true
          emitError("READER_FAILED", "Metin okunamadı (${e.javaClass.simpleName})")
        }
        .addOnCompleteListener(analysisExecutor) {
          proxy.close()
          reading.set(false)
        }
    } catch (e: Exception) {
      proxy.close()
      reading.set(false)
    }
  }

  /** `{ uri, width, height }` — önbellek dizinine JPEG; boyutlar EXIF yönü uygulanmış (dik) çerçevede. */
  fun captureStill(promise: Promise) {
    val capture = imageCapture
    if (capture == null) {
      promise.reject("ERR_LIVE_NOT_READY", "Kamera hazır değil", null)
      return
    }
    if (capturing) {
      promise.reject("ERR_LIVE_BUSY", "Çekim sürüyor", null)
      return
    }
    capturing = true
    val dir = File(context.cacheDir, "belge-tara").apply { mkdirs() }
    val file = File(dir, "${LiveTuning.CAPTURE_PREFIX}${UUID.randomUUID()}.jpg")
    capture.takePicture(
      ImageCapture.OutputFileOptions.Builder(file).build(),
      analysisExecutor,
      object : ImageCapture.OnImageSavedCallback {
        override fun onImageSaved(output: ImageCapture.OutputFileResults) {
          try {
            val (w, h) = uprightSize(file)
            promise.resolve(mapOf("uri" to Uri.fromFile(file).toString(), "width" to w, "height" to h))
          } catch (e: Exception) {
            promise.reject("ERR_LIVE_CAPTURE_FAILED", "Fotoğraf okunamadı (${e.javaClass.simpleName})", null)
          } finally {
            mainExecutor.execute { capturing = false }
          }
        }

        override fun onError(exception: ImageCaptureException) {
          mainExecutor.execute { capturing = false }
          promise.reject("ERR_LIVE_CAPTURE_FAILED", "Fotoğraf çekilemedi (${exception.imageCaptureError})", null)
        }
      },
    )
  }

  private fun uprightSize(file: File): Pair<Int, Int> {
    val exif = ExifInterface(file.absolutePath)
    var w = exif.getAttributeInt(ExifInterface.TAG_IMAGE_WIDTH, 0)
    var h = exif.getAttributeInt(ExifInterface.TAG_IMAGE_LENGTH, 0)
    if (w <= 0 || h <= 0) {
      val o = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
      android.graphics.BitmapFactory.decodeFile(file.absolutePath, o)
      w = o.outWidth
      h = o.outHeight
    }
    if (w <= 0 || h <= 0) throw IllegalStateException("boyut yok")
    return when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
      ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_ROTATE_270,
      ExifInterface.ORIENTATION_TRANSPOSE, ExifInterface.ORIENTATION_TRANSVERSE -> h to w
      else -> w to h
    }
  }
}
