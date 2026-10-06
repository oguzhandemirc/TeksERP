package com.tekserp.lantls

import android.content.Context
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.modules.websocket.WebSocketModule
import java.security.KeyStore
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import okhttp3.OkHttpClient

/**
 * Süreç geneli sabit durumu + OkHttp kurulumu. Kalıcı kopya kendi SharedPreferences'ında durur
 * (parmak izi sır değildir): uygulama açılırken JS'ten ÖNCE yüklenir, ilk istek de sabitle gider.
 * Gerçeğin kaynağı JS deposudur; JS her açılışta ve her değişiklikte kümeyi yeniden iter.
 */
object LanTls {
  private const val PREFS = "tekserp_lan_tls"
  private const val KEY_FPS = "fingerprints"
  private const val KEY_EPS = "endpoints"

  @Volatile
  var state: LanTlsState = LanTlsState.EMPTY
    private set

  @Volatile
  var installed = false
    private set

  private val stateProvider: () -> LanTlsState = { state }

  private val systemTrustManager: X509TrustManager by lazy {
    val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    tmf.init(null as KeyStore?)
    tmf.trustManagers.filterIsInstance<X509TrustManager>().first()
  }

  private val trustManager: PinningTrustManager by lazy { PinningTrustManager(systemTrustManager, stateProvider) }

  private val sslContext: SSLContext by lazy {
    SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustManager), null) }
  }

  private val hostnameVerifier: PinningHostnameVerifier by lazy {
    PinningHostnameVerifier(OkHttpClient().hostnameVerifier, stateProvider)
  }

  private val guard = CleartextGuardInterceptor(stateProvider)

  /** RN ağ istemcisinin olağan kurulumuna sabit katmanını takar (sabit yokken davranış aynı). */
  fun applyTo(builder: OkHttpClient.Builder): OkHttpClient.Builder =
    builder
      .sslSocketFactory(sslContext.socketFactory, trustManager)
      .hostnameVerifier(hostnameVerifier)
      .addNetworkInterceptor(guard)

  /** Application.onCreate: kalıcı kümeyi yükler, OkHttp fabrikasını kurar (RN ağ modülünden ÖNCE). */
  @Synchronized
  fun install(context: Context) {
    if (installed) return
    val app = context.applicationContext
    state = load(app)
    // fetch/XHR, expo/fetch ve görsel yükleyici (Fresco) bu fabrikadan istemci alır.
    OkHttpClientProvider.setOkHttpClientFactory {
      applyTo(OkHttpClientProvider.createClientBuilder(app)).build()
    }
    WebSocketModule.setCustomClientBuilder { builder -> applyTo(builder) }
    installed = true
  }

  @Synchronized
  fun update(context: Context, fingerprints: List<String>, endpoints: List<String>) {
    val next = LanTlsState.of(fingerprints, endpoints)
    val ok = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putStringSet(KEY_FPS, next.fingerprints)
      .putStringSet(KEY_EPS, next.endpoints)
      .commit()
    check(ok) { "sabit kümesi diske yazılamadı" }
    state = next
  }

  private fun load(context: Context): LanTlsState {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val fps = prefs.getStringSet(KEY_FPS, emptySet()).orEmpty().toList()
    val eps = prefs.getStringSet(KEY_EPS, emptySet()).orEmpty().toList()
    return try {
      LanTlsState.of(fps, eps)
    } catch (_: IllegalArgumentException) {
      // Bozuk kalıcı kopya: geçerli parmak izleri korunur (sabitli sunucu yine yalnız parmak iziyle
      // kabul edilir); JS açılışta gerçek kümeyi yeniden iter.
      LanTlsState.of(fps.filter { runCatching { LanTlsState.of(listOf(it), emptyList()) }.isSuccess }, emptyList())
    }
  }
}
