package com.tekserp.lantls

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class LanTlsNotInstalledException :
  CodedException("ERR_LAN_TLS_NOT_INSTALLED", "Şifreli bağlantı katmanı ağ istemcisine kurulmamış", null)

/**
 * JS köprüsü. `setPinState` adı D4'ün beklediği `setPins`ten bilerek farklı: eski JS bu modülü
 * "yok" sayar ve sabit yazmaz (yanlış biçimli çağrı yerine etkisizlik).
 */
class TeksErpLanTlsModule : Module() {
  // Expo'nun AsyncFunction kuyruğu tek iş parçacığıdır; ağ taraması yoklamaları paralel koşar.
  private val probePool: ExecutorService by lazy { Executors.newFixedThreadPool(PROBE_THREADS) }

  override fun definition() = ModuleDefinition {
    Name("TeksErpLanTls")

    AsyncFunction("setPinState") { fingerprints: List<String>, endpoints: List<String> ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      // Fabrika React'tan sonra kurulamaz (ağ istemcisi çoktan doğmuş olur): kurulu değilse zorlama yok.
      if (!LanTls.installed) throw LanTlsNotInstalledException()
      LanTls.update(context, fingerprints, endpoints)
    }

    /** Parmak izi gözlemi + kimlik (güven kararı vermez; karar kod karşılaştırması ya da QR'dır). */
    AsyncFunction("probeTls") { host: String, port: Int, timeoutMs: Int, promise: Promise ->
      probePool.execute {
        try {
          val r = LanTlsProbe.probe(host, port, timeoutMs.coerceIn(200, 15_000))
          promise.resolve(mapOf("fingerprint" to r.fingerprint, "status" to r.status, "body" to r.body))
        } catch (e: TlsProbeException) {
          promise.reject("ERR_LAN_TLS_PROBE", e.message, e)
        } catch (e: Exception) {
          promise.reject("ERR_LAN_TLS_PROBE", "Şifreli yoklama başarısız (${e.javaClass.simpleName})", e)
        }
      }
    }

    OnDestroy { probePool.shutdownNow() }

    /** `installed` false ise JS sabit YAZMAZ (D4 kuralı: zorlayamayan sürüm sabit tutmaz). */
    Function("getPinState") {
      val s = LanTls.state
      mapOf(
        "installed" to LanTls.installed,
        "fingerprints" to s.fingerprints.sorted(),
        "endpoints" to s.endpoints.sorted(),
      )
    }
  }
}

private const val PROBE_THREADS = 24
