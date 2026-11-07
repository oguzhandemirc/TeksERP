package com.tekserp.donanimokuyucu

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Parcelable
import android.util.Base64
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * El terminali donanım okuyucusu — İNCE köprü (docs/plan/EL-TERMINALI-OKUYUCU-PLAN.md §1).
 * Marka, eylem/extra adı, kod çözme, tekrar eleme ve yönlendirme JS'tedir (OTA ile düzeltilebilir);
 * burada yalnız: alıcı kaydı + jenerik extras iletimi, etiketli extras ile yayın, yaşam döngüsü yayınları,
 * yetenek sorgusu ve ayar ekranı açma.
 */
class TeksErpDonanimOkuyucuModule : Module() {
  private var receiver: BroadcastReceiver? = null
  private var actions: List<String> = emptyList()
  private var foregroundBroadcasts: List<Map<String, Any?>> = emptyList()
  private var backgroundBroadcasts: List<Map<String, Any?>> = emptyList()
  private var inForeground = true

  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("TeksErpDonanimOkuyucu")
    Events("onIntent")

    /** Cihaz künyesi + JS'in sorduğu paketlerin kurulu olup olmadığı + sistem paylaşımlı kütüphaneleri. */
    Function("getCapabilities") { packages: List<String> ->
      val ctx = context
      val pm = ctx?.packageManager
      val installed = mutableMapOf<String, Boolean>()
      for (p in packages) installed[p] = pm != null && isInstalled(pm, p)
      val libs = try { pm?.systemSharedLibraryNames?.toList() ?: emptyList() } catch (_: Throwable) { emptyList() }
      mapOf(
        "manufacturer" to (Build.MANUFACTURER ?: ""),
        "brand" to (Build.BRAND ?: ""),
        "model" to (Build.MODEL ?: ""),
        "sdkInt" to Build.VERSION.SDK_INT,
        "packages" to installed,
        "sharedLibraries" to libs,
      )
    }

    /**
     * Alıcı eylemleri + ön/arka plan yayınları. Ön plandaysa hemen kaydeder ve ön plan yayınlarını gönderir;
     * arka plana geçişte (JS askıda olabilir) arka plan yayınlarını native gönderir ve alıcıyı kaldırır.
     * Boş eylem listesi = kapat (önce arka plan yayınları gönderilir).
     */
    Function("configure") { config: Map<String, Any?> ->
      val wasActive = actions.isNotEmpty()
      val previousBackground = backgroundBroadcasts
      @Suppress("UNCHECKED_CAST")
      actions = (config["actions"] as? List<String>)?.filter { it.isNotBlank() } ?: emptyList()
      foregroundBroadcasts = mapList(config["foreground"])
      backgroundBroadcasts = mapList(config["background"])
      val applyNow = config["applyForeground"] != false
      unregister()
      if (actions.isEmpty()) {
        if (wasActive && inForeground) sendAll(previousBackground)
      } else if (inForeground) {
        register()
        if (applyNow) sendAll(foregroundBroadcasts)
      }
      Unit
    }

    /** Tek yayın: `{ action, package?, extras? }` — extras etiketli değer (bkz. `toBundle`). */
    Function("sendBroadcast") { spec: Map<String, Any?> ->
      send(spec)
    }

    /** Ayar ekranı: eylemle aktivite (paket opsiyonel). Bulunamazsa false. */
    Function("startActivity") { action: String, pkg: String? ->
      val ctx = context ?: return@Function false
      try {
        val intent = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (!pkg.isNullOrBlank()) intent.setPackage(pkg)
        ctx.startActivity(intent)
        true
      } catch (t: Throwable) {
        Log.w(TAG, "startActivity $action: ${t.message}")
        false
      }
    }

    /** Paketin başlatıcı aktivitesini aç (ör. DataWedge). Yoksa false. */
    Function("launchPackage") { pkg: String ->
      val ctx = context ?: return@Function false
      try {
        val intent = ctx.packageManager.getLaunchIntentForPackage(pkg) ?: return@Function false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
        true
      } catch (t: Throwable) {
        Log.w(TAG, "launchPackage $pkg: ${t.message}")
        false
      }
    }

    OnActivityEntersForeground {
      inForeground = true
      if (actions.isNotEmpty()) {
        register()
        sendAll(foregroundBroadcasts)
      }
    }

    OnActivityEntersBackground {
      inForeground = false
      if (actions.isNotEmpty()) sendAll(backgroundBroadcasts)
      unregister()
    }

    OnDestroy {
      if (actions.isNotEmpty() && inForeground) sendAll(backgroundBroadcasts)
      unregister()
    }
  }

  private fun register() {
    if (receiver != null || actions.isEmpty()) return
    val ctx = context ?: return
    val filter = IntentFilter()
    for (a in actions) filter.addAction(a)
    val r = object : BroadcastReceiver() {
      override fun onReceive(c: Context?, intent: Intent?) {
        if (intent == null) return
        try {
          sendEvent("onIntent", mapOf("action" to (intent.action ?: ""), "extras" to bundleToMap(intent.extras)))
        } catch (t: Throwable) {
          Log.w(TAG, "onIntent: ${t.message}")
        }
      }
    }
    try {
      // Okuyucu hizmeti başka bir süreçtir: API 33+ dinamik alıcı açıkça EXPORTED olmalı.
      if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(r, filter, Context.RECEIVER_EXPORTED)
      else ctx.registerReceiver(r, filter)
      receiver = r
    } catch (t: Throwable) {
      Log.w(TAG, "registerReceiver: ${t.message}")
    }
  }

  private fun unregister() {
    val r = receiver ?: return
    receiver = null
    try { context?.unregisterReceiver(r) } catch (_: Throwable) {}
  }

  private fun sendAll(list: List<Map<String, Any?>>) {
    for (spec in list) send(spec)
  }

  private fun send(spec: Map<String, Any?>): Boolean {
    val ctx = context ?: return false
    val action = spec["action"] as? String ?: return false
    return try {
      val intent = Intent(action)
      (spec["package"] as? String)?.takeIf { it.isNotBlank() }?.let { intent.setPackage(it) }
      @Suppress("UNCHECKED_CAST")
      (spec["extras"] as? Map<String, Any?>)?.let { intent.putExtras(toBundle(it)) }
      ctx.sendBroadcast(intent)
      true
    } catch (t: Throwable) {
      Log.w(TAG, "sendBroadcast $action: ${t.message}")
      false
    }
  }

  companion object {
    private const val TAG = "TeksErpDonanimOkuyucu"

    private fun isInstalled(pm: PackageManager, pkg: String): Boolean = try {
      if (Build.VERSION.SDK_INT >= 33) pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0))
      else @Suppress("DEPRECATION") pm.getPackageInfo(pkg, 0)
      true
    } catch (_: Throwable) {
      false
    }

    @Suppress("UNCHECKED_CAST")
    private fun mapList(v: Any?): List<Map<String, Any?>> =
      (v as? List<*>)?.mapNotNull { it as? Map<String, Any?> } ?: emptyList()

    /**
     * JS etiketli değeri → Bundle. Her değer `{ t, v }`: string · int · long · bool · double · bundle (nesne) ·
     * bundleArray (`Parcelable[]`) · bundleList (`ArrayList<Bundle>`) · stringArray. Tanınmayan etiket atlanır.
     */
    @Suppress("UNCHECKED_CAST")
    fun toBundle(map: Map<String, Any?>): Bundle {
      val b = Bundle()
      for ((key, raw) in map) {
        val tagged = raw as? Map<String, Any?> ?: continue
        val v = tagged["v"]
        when (tagged["t"]) {
          "string" -> b.putString(key, v as? String)
          "int" -> (v as? Number)?.let { b.putInt(key, it.toInt()) }
          "long" -> (v as? Number)?.let { b.putLong(key, it.toLong()) }
          "double" -> (v as? Number)?.let { b.putDouble(key, it.toDouble()) }
          "bool" -> (v as? Boolean)?.let { b.putBoolean(key, it) }
          "bundle" -> (v as? Map<String, Any?>)?.let { b.putBundle(key, toBundle(it)) }
          "bundleArray" -> (v as? List<*>)?.let { l ->
            b.putParcelableArray(key, l.mapNotNull { (it as? Map<String, Any?>)?.let(::toBundle) }.toTypedArray<Parcelable>())
          }
          "bundleList" -> (v as? List<*>)?.let { l ->
            b.putParcelableArrayList(key, ArrayList(l.mapNotNull { (it as? Map<String, Any?>)?.let(::toBundle) }))
          }
          "stringArray" -> (v as? List<*>)?.let { l -> b.putStringArray(key, l.map { it?.toString() ?: "" }.toTypedArray()) }
        }
      }
      return b
    }

    /** Gelen intent extras → JS: byte[] `{ $bytes: base64 }`, iç içe Bundle nesne, diziler liste. */
    fun bundleToMap(bundle: Bundle?): Map<String, Any?> {
      if (bundle == null) return emptyMap()
      val out = mutableMapOf<String, Any?>()
      for (key in bundle.keySet()) {
        @Suppress("DEPRECATION")
        out[key] = toJs(bundle.get(key))
      }
      return out
    }

    private fun toJs(v: Any?): Any? = when (v) {
      null -> null
      is String, is Boolean, is Int, is Double, is Float -> v
      is Long -> v.toDouble()
      is Short -> v.toInt()
      is Byte -> v.toInt()
      is Char -> v.toString()
      is ByteArray -> mapOf("\$bytes" to Base64.encodeToString(v, Base64.NO_WRAP))
      is IntArray -> v.toList()
      is LongArray -> v.map { it.toDouble() }
      is BooleanArray -> v.toList()
      is Array<*> -> v.map { toJs(it) }
      is Collection<*> -> v.map { toJs(it) }
      is Bundle -> bundleToMap(v)
      else -> v.toString()
    }
  }
}
