package com.tekserp.lantls

import java.security.MessageDigest
import java.util.Locale

// Saf kurallar (Android'e bağımlı değil; JVM denetimi: modules/teks-erp-lan-tls/jvm-check.mjs).
// Sunucu adresle değil sertifika DER'inin SHA-256'sıyla tanınır (docs/design/LAN-TLS.md §3, §6).

/** Sabit kümesi: kabul edilen parmak izleri + şifreli bağlanılan sabitli uç noktalar ("host:port"). */
class LanTlsState private constructor(
  val fingerprints: Set<String>,
  val endpoints: Set<String>,
) {
  /** Sabitli uçların ana makineleri — bunlara şifresiz istek gitmez (keşif kimlik yoklaması hariç). */
  val pinnedHosts: Set<String> = endpoints.map { it.substring(0, it.lastIndexOf(':')) }.toSet()

  fun isPinnedEndpoint(host: String?, port: Int): Boolean =
    host != null && endpointKey(host, port) in endpoints

  fun isEmpty(): Boolean = fingerprints.isEmpty() && endpoints.isEmpty()

  companion object {
    val EMPTY = LanTlsState(emptySet(), emptySet())
    private val HEX64 = Regex("^[0-9a-f]{64}$")
    private val HOST = Regex("^[0-9a-z._\\-:]{1,253}$")

    fun normalizeHost(host: String): String =
      host.trim().removePrefix("[").removeSuffix("]").lowercase(Locale.ROOT)

    fun endpointKey(host: String, port: Int): String = "${normalizeHost(host)}:$port"

    /** Geçersiz tek bir girdi bütün çağrıyı reddeder (önceki küme yürürlükte kalır). */
    fun of(fingerprints: Collection<String>, endpoints: Collection<String>): LanTlsState {
      val fps = fingerprints.map { fp ->
        val n = fp.trim().lowercase(Locale.ROOT)
        require(HEX64.matches(n)) { "geçersiz parmak izi" }
        n
      }.toSet()
      val eps = endpoints.map { ep ->
        val i = ep.lastIndexOf(':')
        require(i > 0) { "geçersiz uç: $ep" }
        val host = normalizeHost(ep.substring(0, i))
        val port = ep.substring(i + 1).toIntOrNull()
        require(host.isNotEmpty() && HOST.matches(host)) { "geçersiz uç: $ep" }
        require(port != null && port in 1..65535) { "geçersiz uç: $ep" }
        endpointKey(host, port)
      }.toSet()
      return LanTlsState(fps, eps)
    }
  }
}

enum class TlsVerdict {
  /** Sertifika sabit kümesinde: kabul (zincir/ad denetimi yok — kimlik parmak izinde). */
  PINNED,
  /** Sabitli uca sabit dışı sertifika: RED — sistem CA'sı geçerli saysa bile. */
  REJECT,
  /** Sabitle ilgisi yok: sistemin olağan CA + ad doğrulaması. */
  SYSTEM,
}

object LanTlsPolicy {
  const val IDENTITY_PATH = "/api/discovery/identity"

  fun sha256Hex(der: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { "%02x".format(it) }

  fun tlsVerdict(state: LanTlsState, leafFingerprint: String?, host: String?, port: Int): TlsVerdict = when {
    leafFingerprint != null && leafFingerprint in state.fingerprints -> TlsVerdict.PINNED
    state.isPinnedEndpoint(host, port) -> TlsVerdict.REJECT
    else -> TlsVerdict.SYSTEM
  }

  /**
   * Sabitli sunucunun ana makinesine şifresiz istek gitmez — HTTP'ye düşüş yok. Tek istisna keşfin
   * kimlik bilgisiz kimlik yoklamasıdır (aynı sunucunun yeni adresini bulmak için; yanıtı güven kaynağı değil).
   */
  fun cleartextAllowed(state: LanTlsState, host: String, method: String, path: String, hasCredentials: Boolean): Boolean {
    if (normalizeHost(host) !in state.pinnedHosts) return true
    return method == "GET" && path == IDENTITY_PATH && !hasCredentials
  }

  private fun normalizeHost(host: String) = LanTlsState.normalizeHost(host)
}
