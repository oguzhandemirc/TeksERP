package com.tekserp.lantls

import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLSession

/**
 * Sertifika SAN'ında LAN IP'si yok (DHCP) — sabitli parmak izinde ad denetimi atlanır. Oturum yeniden
 * kullanıldığında güven yöneticisi çağrılmaz; bu doğrulayıcı her bağlantıda GÜNCEL sabit kümesine bakar
 * (sabit kaldırılınca eski oturum geçemez).
 */
class PinningHostnameVerifier(
  private val delegate: HostnameVerifier,
  private val state: () -> LanTlsState,
) : HostnameVerifier {
  override fun verify(hostname: String?, session: SSLSession?): Boolean {
    if (hostname == null || session == null) return false
    val leaf = try {
      session.peerCertificates.firstOrNull() as? X509Certificate
    } catch (_: SSLPeerUnverifiedException) {
      null
    }
    val fp = leaf?.let { LanTlsPolicy.sha256Hex(it.encoded) }
    return when (LanTlsPolicy.tlsVerdict(state(), fp, hostname, session.peerPort)) {
      TlsVerdict.PINNED -> true
      TlsVerdict.REJECT -> false
      TlsVerdict.SYSTEM -> delegate.verify(hostname, session)
    }
  }
}
