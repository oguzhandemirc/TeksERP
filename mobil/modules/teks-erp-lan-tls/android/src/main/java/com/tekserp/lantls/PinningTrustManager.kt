package com.tekserp.lantls

import java.net.Socket
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager

/**
 * Sabitli parmak izini kabul eden, geri kalan her şeyi sistemin güven yöneticisine bırakan katman.
 * Sabitli uca (host:port) sabit dışı sertifika gelirse sistem CA'sına sorulmadan reddedilir.
 */
class PinningTrustManager(
  private val system: X509TrustManager,
  private val state: () -> LanTlsState,
) : X509ExtendedTrustManager() {

  private fun leafFingerprint(chain: Array<out X509Certificate>?): String? =
    chain?.firstOrNull()?.let { LanTlsPolicy.sha256Hex(it.encoded) }

  private fun verdict(chain: Array<out X509Certificate>?, host: String?, port: Int): TlsVerdict =
    LanTlsPolicy.tlsVerdict(state(), leafFingerprint(chain), host, port)

  private fun rejectPinned(): Nothing =
    throw CertificateException("Sabitli sunucunun sertifika parmak izi tutmuyor")

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    if (verdict(chain, null, -1) == TlsVerdict.PINNED) return
    system.checkServerTrusted(chain, authType)
  }

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) {
    val session = (socket as? SSLSocket)?.handshakeSession
    when (verdict(chain, session?.peerHost, session?.peerPort ?: -1)) {
      TlsVerdict.PINNED -> return
      TlsVerdict.REJECT -> rejectPinned()
      TlsVerdict.SYSTEM ->
        if (system is X509ExtendedTrustManager) system.checkServerTrusted(chain, authType, socket)
        else system.checkServerTrusted(chain, authType)
    }
  }

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) {
    when (verdict(chain, engine?.peerHost, engine?.peerPort ?: -1)) {
      TlsVerdict.PINNED -> return
      TlsVerdict.REJECT -> rejectPinned()
      TlsVerdict.SYSTEM ->
        if (system is X509ExtendedTrustManager) system.checkServerTrusted(chain, authType, engine)
        else system.checkServerTrusted(chain, authType)
    }
  }

  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
    system.checkClientTrusted(chain, authType)

  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) =
    system.checkClientTrusted(chain, authType)

  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) =
    system.checkClientTrusted(chain, authType)

  override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers
}
