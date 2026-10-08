package com.tekserp.lantls

import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.KeyStore
import java.security.cert.CertPathValidatorException
import java.security.cert.CertificateExpiredException
import java.security.cert.CertificateNotYetValidException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

// İnternet kipi yoklaması (docs/design/TABLET-GENEL-CA-BAGLANTI.md §3): YALNIZ sistem güven deposu + ad doğrulaması,
// sabit kümesine bakılmaz. Başarısızlığın SINIFI döner (saat · denetleyen ağ · ad · ağ) ki kullanıcıya doğru söylensin.

enum class WebPkiFailure(val code: String) {
  CLOCK_BEHIND("clock_behind"),
  CLOCK_AHEAD("clock_ahead"),
  UNTRUSTED("untrusted"),
  NAME("name"),
  NETWORK("network"),
  TLS("tls"),
}

class WebPkiResult(val failure: WebPkiFailure?, val status: Int?, val body: String?, val detail: String?)

/** Zinciri kaydeder, kararı sistemin güven yöneticisine bırakır (ağ güvenlik yapılandırması orada uygulanır). */
internal class RecordingSystemTrustManager(private val system: X509TrustManager) : X509ExtendedTrustManager() {
  @Volatile
  var chain: List<X509Certificate> = emptyList()
    private set

  private fun record(c: Array<out X509Certificate>?) {
    chain = c?.toList().orEmpty()
  }

  override fun checkServerTrusted(c: Array<out X509Certificate>?, authType: String?) {
    record(c)
    system.checkServerTrusted(c, authType)
  }

  override fun checkServerTrusted(c: Array<out X509Certificate>?, authType: String?, socket: java.net.Socket?) {
    record(c)
    if (system is X509ExtendedTrustManager) system.checkServerTrusted(c, authType, socket) else system.checkServerTrusted(c, authType)
  }

  override fun checkServerTrusted(c: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) {
    record(c)
    if (system is X509ExtendedTrustManager) system.checkServerTrusted(c, authType, engine) else system.checkServerTrusted(c, authType)
  }

  override fun checkClientTrusted(c: Array<out X509Certificate>?, authType: String?) =
    throw java.security.cert.CertificateException("İstemci sertifikası kabul edilmez")

  override fun checkClientTrusted(c: Array<out X509Certificate>?, authType: String?, socket: java.net.Socket?) =
    throw java.security.cert.CertificateException("İstemci sertifikası kabul edilmez")

  override fun checkClientTrusted(c: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) =
    throw java.security.cert.CertificateException("İstemci sertifikası kabul edilmez")

  override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers
}

object WebPkiProbe {
  private const val MAX_BODY = 64L * 1024

  fun systemTrustManager(): X509TrustManager {
    val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    tmf.init(null as KeyStore?)
    return tmf.trustManagers.filterIsInstance<X509TrustManager>().first()
  }

  private fun causes(e: Throwable): Sequence<Throwable> = generateSequence(e) { it.cause.takeIf { c -> c !== it } }.take(12)

  /**
   * Saf sınıflama. Saat önce gelir: zincirdeki bir sertifika tabletin tarihine göre geçersizse ve hata tarih
   * kaynaklıysa ya da zincirin tarihi tutmuyorsa sebep saattir (denetleyen vekilin sertifikası genelde günceldir).
   */
  fun classify(e: Throwable, chain: List<X509Certificate>, nowMs: Long): WebPkiFailure {
    val all = causes(e).toList()
    if (all.any { it is UnknownHostException || it is ConnectException || it is NoRouteToHostException || it is SocketTimeoutException }) {
      return WebPkiFailure.NETWORK
    }
    if (all.any { it is SSLPeerUnverifiedException }) return WebPkiFailure.NAME
    if (chain.any { nowMs < it.notBefore.time }) return WebPkiFailure.CLOCK_BEHIND
    if (chain.any { nowMs > it.notAfter.time }) return WebPkiFailure.CLOCK_AHEAD
    if (all.any { it is CertificateNotYetValidException }) return WebPkiFailure.CLOCK_BEHIND
    if (all.any { it is CertificateExpiredException }) return WebPkiFailure.CLOCK_AHEAD
    if (chain.isNotEmpty() && all.any { it is CertPathValidatorException || it is java.security.cert.CertificateException }) {
      return WebPkiFailure.UNTRUSTED
    }
    return if (chain.isEmpty() && all.any { it is IOException && it !is javax.net.ssl.SSLException }) WebPkiFailure.NETWORK else WebPkiFailure.TLS
  }

  /** Sistem doğrulamalı kimlik okuması: kimlik bilgisi yok, yönlendirme izlenmez, sabit kümesine bakılmaz. */
  fun probe(host: String, port: Int, timeoutMs: Int, system: X509TrustManager = systemTrustManager(), nowMs: () -> Long = System::currentTimeMillis): WebPkiResult {
    val tm = RecordingSystemTrustManager(system)
    val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }
    val client = OkHttpClient.Builder()
      .sslSocketFactory(ctx.socketFactory, tm)
      .followRedirects(false)
      .followSslRedirects(false)
      .retryOnConnectionFailure(false)
      .callTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
      .connectTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
      .build()
    val url = HttpUrl.Builder().scheme("https").host(host).port(port).encodedPath(LanTlsPolicy.IDENTITY_PATH).build()
    return try {
      client.newCall(Request.Builder().url(url).header("Accept", "application/json").build()).execute().use { res ->
        WebPkiResult(null, res.code, res.peekBody(MAX_BODY).string(), null)
      }
    } catch (e: IOException) {
      WebPkiResult(classify(e, tm.chain, nowMs()), null, null, e.javaClass.simpleName)
    } finally {
      client.connectionPool.evictAll()
    }
  }
}
