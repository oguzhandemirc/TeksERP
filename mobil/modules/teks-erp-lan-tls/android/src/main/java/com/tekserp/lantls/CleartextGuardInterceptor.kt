package com.tekserp.lantls

import java.io.IOException
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Ağ katmanı kesicisi: yönlendirmeler dahil her gerçek isteği görür. Sabitli sunucunun ana makinesine
 * şifresiz istek (kimlik yoklaması dışında) gönderilmeden düşer.
 */
class CleartextGuardInterceptor(private val state: () -> LanTlsState) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    if (!request.isHttps) {
      val credentials = request.header("Authorization") != null || request.header("Cookie") != null
      if (!LanTlsPolicy.cleartextAllowed(state(), request.url.host, request.method, request.url.encodedPath, credentials)) {
        throw IOException("Sunucu şifreli bağlantıya sabitli — şifresiz (HTTP) istek gönderilmedi")
      }
    }
    return chain.proceed(request)
  }
}
