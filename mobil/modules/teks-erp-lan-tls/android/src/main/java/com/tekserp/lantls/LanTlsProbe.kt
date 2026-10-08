package com.tekserp.lantls

import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Locale
import java.util.concurrent.TimeUnit
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSession
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/** Yoklama sonucu: gözlenen yaprak sertifika izi + (okunabildiyse) kimlik ucunun DOĞRULANMAMIŞ yanıtı. */
class TlsProbeResult(val fingerprint: String, val status: Int?, val body: String?)

class TlsProbeException(message: String) : Exception(message)

/** El sıkışmada zinciri kaydeder ve HER ZAMAN reddeder: gözlem bağlantısında hiçbir veri gönderilmez. */
internal class ObservingTrustManager : X509TrustManager {
  @Volatile
  var fingerprint: String? = null
    private set

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    chain?.firstOrNull()?.let { fingerprint = LanTlsPolicy.sha256Hex(it.encoded) }
    throw CertificateException("Gözlem bağlantısı: güven kararı verilmez")
  }

  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
    throw CertificateException("İstemci sertifikası kabul edilmez")

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

/** Yalnız tek bir parmak izini kabul eden güven yöneticisi + ad doğrulayıcı (ikinci adım). */
internal class ExpectedFingerprintTrustManager(private val expected: String) : X509TrustManager, HostnameVerifier {
  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    val fp = chain?.firstOrNull()?.let { LanTlsPolicy.sha256Hex(it.encoded) }
    if (fp == expected) return
    throw CertificateException("Sertifika gözlenen parmak iziyle aynı değil")
  }

  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
    throw CertificateException("İstemci sertifikası kabul edilmez")

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

  override fun verify(hostname: String?, session: SSLSession?): Boolean {
    val leaf = runCatching { session?.peerCertificates?.firstOrNull() as? X509Certificate }.getOrNull() ?: return false
    return LanTlsPolicy.sha256Hex(leaf.encoded) == expected
  }
}

/**
 * Sunucunun sertifika parmak izini GÖZLEM olarak okur; güven kararı vermez (karar kullanıcının kod
 * karşılaştırması ya da QR'dır — docs/design/LAN-TLS.md §4). Kimlik ucu yalnız az önce gözlenen ize
 * kilitli ayrı bir istemciyle, kimlik bilgisi taşımadan ve yönlendirme izlemeden okunur.
 */
object LanTlsProbe {
  private const val MAX_BODY = 64L * 1024

  fun observeFingerprint(host: String, port: Int, timeoutMs: Int): String {
    val recorder = ObservingTrustManager()
    val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(recorder), null) }
    val raw = Socket()
    try {
      raw.connect(InetSocketAddress(host, port), timeoutMs)
      raw.soTimeout = timeoutMs
      (ctx.socketFactory.createSocket(raw, host, port, true) as SSLSocket).use { ssl ->
        runCatching { ssl.startHandshake() }
      }
    } catch (e: IOException) {
      if (recorder.fingerprint == null) throw TlsProbeException("Sunucuya ulaşılamadı (${e.javaClass.simpleName})")
    } finally {
      runCatching { raw.close() }
    }
    return recorder.fingerprint ?: throw TlsProbeException("Bu adreste şifreli (HTTPS) sunucu yok")
  }

  fun fetchIdentity(host: String, port: Int, expectedFingerprint: String, timeoutMs: Int): Pair<Int, String> {
    val expected = expectedFingerprint.lowercase(Locale.ROOT)
    val tm = ExpectedFingerprintTrustManager(expected)
    val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }
    val client = OkHttpClient.Builder()
      .sslSocketFactory(ctx.socketFactory, tm)
      .hostnameVerifier(tm)
      .followRedirects(false)
      .followSslRedirects(false)
      .retryOnConnectionFailure(false)
      .callTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
      .build()
    val url = HttpUrl.Builder().scheme("https").host(host).port(port).encodedPath(LanTlsPolicy.IDENTITY_PATH).build()
    try {
      client.newCall(Request.Builder().url(url).header("Accept", "application/json").build()).execute().use { res ->
        return res.code to res.peekBody(MAX_BODY).string()
      }
    } finally {
      client.connectionPool.evictAll()
    }
  }

  /** Gözlem + kimlik. Kimlik okunamazsa iz yine döner (eski sunucu, geçici hata). */
  fun probe(host: String, port: Int, timeoutMs: Int): TlsProbeResult {
    val fp = observeFingerprint(host, port, timeoutMs)
    val identity = runCatching { fetchIdentity(host, port, fp, timeoutMs) }.getOrNull()
    return TlsProbeResult(fp, identity?.first, identity?.second)
  }
}
