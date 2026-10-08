package com.tekserp.lantls

import java.io.FileInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.KeyStore
import java.security.cert.X509Certificate
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import kotlin.concurrent.thread
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

// Bağımlılıksız JVM denetimi (JUnit yok — yeni bağımlılık eklenmedi). Koşucu: ../../../../../../jvm-check.mjs
// Gerçek TLS el sıkışmasıyla ölçer: sabitli parmak izi kabul · farklı iz red · sabitsiz uç sistem güveni ·
// sabitli uca sistemce geçerli sertifika red · sabitli makineye şifresiz istek (yönlendirme dahil) red.
// Argümanlar: <A.p12> <B.p12> <parola>. A: kendinden imzalı, SAN yalnız DNS:sunucu-a (LAN IP'si yok).
// B: SAN IP:127.0.0.1 ve sahte "sistem" kök deposunda güvenilir (sistem CA zinciri yerine geçer).

private var failures = 0
private var passes = 0

private fun ok(name: String, cond: Boolean) {
  if (cond) passes++ else failures++
  println("${if (cond) "✓" else "✗"} $name")
}

private fun keyStore(path: String, pass: String): KeyStore =
  KeyStore.getInstance("PKCS12").apply { FileInputStream(path).use { load(it, pass.toCharArray()) } }

private fun leaf(ks: KeyStore): X509Certificate = ks.getCertificate(ks.aliases().nextElement()) as X509Certificate

private fun respond(socket: Socket, httpsPortForRedirect: Int?, httpPort: Int) {
  socket.use { s ->
    val head = StringBuilder()
    val input = s.getInputStream()
    while (!head.endsWith("\r\n\r\n")) {
      val b = input.read()
      if (b < 0) return
      head.append(b.toChar())
    }
    val path = head.lineSequence().first().split(" ").getOrElse(1) { "/" }
    val out = s.getOutputStream()
    if (httpsPortForRedirect != null && path == "/yonlendir") {
      out.write("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:$httpPort/api/x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
    } else {
      out.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".toByteArray())
    }
    out.flush()
  }
}

private fun tlsServer(ks: KeyStore, pass: String, httpPort: () -> Int): Int {
  val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, pass.toCharArray()) }
  val ctx = SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }
  val server = ctx.serverSocketFactory.createServerSocket(0, 50, InetAddress.getByName("127.0.0.1")) as SSLServerSocket
  thread(isDaemon = true) {
    while (true) {
      val s = try { server.accept() } catch (_: Exception) { break }
      thread(isDaemon = true) { runCatching { respond(s, server.localPort, httpPort()) } }
    }
  }
  return server.localPort
}

private fun httpServer(): Int {
  val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
  thread(isDaemon = true) {
    while (true) {
      val s = try { server.accept() } catch (_: Exception) { break }
      thread(isDaemon = true) { runCatching { respond(s, null, 0) } }
    }
  }
  return server.localPort
}

fun main(args: Array<String>) {
  require(args.size == 4) { "kullanım: <A.p12> <B.p12> <parola> <C.p12>" }
  val pass = args[2]
  val ksA = keyStore(args[0], pass)
  val ksB = keyStore(args[1], pass)
  val fpA = LanTlsPolicy.sha256Hex(leaf(ksA).encoded)
  val fpB = LanTlsPolicy.sha256Hex(leaf(ksB).encoded)

  // Saf kurallar.
  ok("geçersiz parmak izi reddedilir", runCatching { LanTlsState.of(listOf("xx"), emptyList()) }.isFailure)
  ok("geçersiz uç reddedilir", runCatching { LanTlsState.of(emptyList(), listOf("a b:1")) }.isFailure)
  ok("port aralık dışı reddedilir", runCatching { LanTlsState.of(emptyList(), listOf("h:70000")) }.isFailure)
  ok("büyük harf iz/host normalize", LanTlsState.of(listOf(fpA.uppercase()), listOf("SUNUCU:4443")).let {
    fpA in it.fingerprints && it.isPinnedEndpoint("sunucu", 4443)
  })
  ok("IPv6 köşeli parantez normalize", LanTlsState.of(emptyList(), listOf("[::1]:4443")).isPinnedEndpoint("::1", 4443))
  ok("boş durum: HTTP serbest", LanTlsPolicy.cleartextAllowed(LanTlsState.EMPTY, "h", "POST", "/api/x", true))

  var current = LanTlsState.EMPTY
  val provider = { current }

  // Sahte sistem güveni: yalnız B'ye güvenir (gerçek tablette Android'in CA deposu).
  val ksC = keyStore(args[3], pass)
  val sysStore = KeyStore.getInstance("PKCS12").apply {
    load(null, null)
    setCertificateEntry("b", leaf(ksB))
    setCertificateEntry("c", leaf(ksC))
  }
  val system = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    .apply { init(sysStore) }.trustManagers.filterIsInstance<X509TrustManager>().first()
  val tm = PinningTrustManager(system, provider)
  val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }
  val verifier = PinningHostnameVerifier(OkHttpClient().hostnameVerifier, provider)
  val guard = CleartextGuardInterceptor(provider)

  var httpPortRef = 0
  val portA = tlsServer(ksA, pass) { httpPortRef }
  val portB = tlsServer(ksB, pass) { httpPortRef }
  val portH = httpServer()
  httpPortRef = portH

  fun client() = OkHttpClient.Builder()
    .sslSocketFactory(ctx.socketFactory, tm)
    .hostnameVerifier(verifier)
    .addNetworkInterceptor(guard)
    .build()

  fun get(url: String, auth: Boolean = false): Int? = runCatching {
    val rb = Request.Builder().url(url)
    if (auth) rb.header("Authorization", "Bearer x")
    client().newCall(rb.build()).execute().use { it.code }
  }.getOrNull()

  fun post(url: String): Int? = runCatching {
    client().newCall(Request.Builder().url(url).post("{}".toByteArray().toRequestBody()).build()).execute().use { it.code }
  }.getOrNull()

  val a = "https://127.0.0.1:$portA/api/x"
  val b = "https://127.0.0.1:$portB/api/x"
  val h = "http://127.0.0.1:$portH"

  // 1) Sabitli parmak izi kabul (SAN'da IP yok, kendinden imzalı).
  current = LanTlsState.of(listOf(fpA), listOf("127.0.0.1:$portA"))
  ok("sabitli iz tutuyor → kabul", get(a) == 200)

  // 2) Sabit kaldırılınca (oturum önbellekte olsa da) aynı sunucu geçemez.
  current = LanTlsState.EMPTY
  ok("sabit kaldırılınca kendinden imzalı red (oturum yeniden kullanımı dahil)", get(a) == null)

  // 3) Farklı iz red.
  current = LanTlsState.of(listOf(fpB), listOf("127.0.0.1:$portA"))
  ok("sabitli uçta farklı iz → red", get(a) == null)
  current = LanTlsState.of(listOf(fpB), emptyList())
  ok("sabitsiz uçta tanınmayan kendinden imzalı → red", get(a) == null)

  // 4) Sabitsiz uç sistem güveniyle (sabit varken de).
  current = LanTlsState.of(listOf(fpA), listOf("127.0.0.1:$portA"))
  ok("sabitsiz uç: sistem güveni geçerli → kabul", get(b) == 200)
  current = LanTlsState.EMPTY
  ok("sabit yokken sistem güveni → kabul (bugünkü davranış)", get(b) == 200)

  // 5) Sabitli uca sistemce geçerli ama sabit dışı sertifika → red.
  current = LanTlsState.of(listOf(fpA), listOf("127.0.0.1:$portB"))
  ok("sabitli uçta sistemce geçerli sabit dışı sertifika → red", get(b) == null)

  // 6) HTTP'ye düşüş yok.
  current = LanTlsState.of(listOf(fpA), listOf("127.0.0.1:$portA"))
  ok("sabitli makineye şifresiz API isteği → gönderilmez", get("$h/api/auth/me") == null)
  ok("sabitli makineye şifresiz POST → gönderilmez", post("$h/api/discovery/identity") == null)
  ok("kimlik yoklaması (GET, kimlik bilgisiz) → serbest", get("$h/api/discovery/identity") == 200)
  ok("kimlik yoklaması Authorization ile → gönderilmez", get("$h/api/discovery/identity", auth = true) == null)
  ok("https → http yönlendirmesi → izlenmez", get("https://127.0.0.1:$portA/yonlendir") == null)
  current = LanTlsState.EMPTY
  ok("sabit yokken şifresiz istek serbest (bugünkü davranış)", get("$h/api/auth/me") == 200)

  // 7) Yoklama: iz yalnız GÖZLENİR (güven kararı yok), kimlik ucu yalnız gözlenen ize kilitli okunur.
  ok("yoklama: gözlenen iz sunucunun izi", runCatching { LanTlsProbe.observeFingerprint("127.0.0.1", portA, 3000) }.getOrNull() == fpA)
  val probed = runCatching { LanTlsProbe.probe("127.0.0.1", portB, 3000) }.getOrNull()
  ok("yoklama: iz + kimlik yanıtı (sabit yokken de)", probed?.fingerprint == fpB && probed.status == 200 && probed.body == "ok")
  ok("yoklama: beklenen iz tutmazsa kimlik okunmaz", runCatching { LanTlsProbe.fetchIdentity("127.0.0.1", portA, fpB, 3000) }.isFailure)
  ok("yoklama: şifresiz porta iz yok → hata", runCatching { LanTlsProbe.observeFingerprint("127.0.0.1", portH, 3000) }.exceptionOrNull() is TlsProbeException)
  val closed = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }
  ok("yoklama: kapalı port → hata", runCatching { LanTlsProbe.probe("127.0.0.1", closed, 1000) }.exceptionOrNull() is TlsProbeException)

  // 8) İnternet kipi yoklaması: yalnız sistem güveni + ad; sabit kümesi yok sayılır; hata sınıfı ayrılır.
  val portC = tlsServer(ksC, pass) { httpPortRef }
  fun web(host: String, port: Int) = WebPkiProbe.probe(host, port, 3000, system)
  web("127.0.0.1", portB).let { ok("internet: sistemce geçerli + ad tutuyor → kimlik okunur", it.failure == null && it.status == 200 && it.body == "ok") }
  ok("internet: kendinden imzalı (denetleyen vekil gibi) → untrusted", web("127.0.0.1", portA).failure == WebPkiFailure.UNTRUSTED)
  current = LanTlsState.of(listOf(fpA), listOf("127.0.0.1:$portA"))
  ok("internet: sabitli iz internet yoklamasını AÇMAZ", web("127.0.0.1", portA).failure == WebPkiFailure.UNTRUSTED)
  current = LanTlsState.EMPTY
  ok("internet: ad sertifikayla tutmuyor → name", web("localhost", portB).failure == WebPkiFailure.NAME)
  // Güven çapası olarak C'nin tarihi PKIX'te denetlenmez; sınıflama zincir tarihinden (gerçek el sıkışma: emülatör G6).
  ok("internet: sertifika henüz geçerli değil → clock_behind",
    WebPkiProbe.classify(java.security.cert.CertificateException("x"), listOf(leaf(ksC)), System.currentTimeMillis()) == WebPkiFailure.CLOCK_BEHIND)
  ok("internet: güvenilir çapa (C) bağlanabilir", portC > 0 && web("127.0.0.1", portC).status == 200)
  ok("internet: tablet saati ileri → clock_ahead",
    WebPkiProbe.classify(java.security.cert.CertificateException("x"), listOf(leaf(ksB)), System.currentTimeMillis() + 10L * 86_400_000) == WebPkiFailure.CLOCK_AHEAD)
  ok("internet: kapalı port → network", web("127.0.0.1", closed).failure == WebPkiFailure.NETWORK)
  web("127.0.0.1", portH).let { ok("internet: şifresiz port → hata, http'ye düşmez", it.failure != null && it.status == null) }

  println("\n$passes geçti, $failures kaldı")
  if (failures > 0) kotlin.system.exitProcess(1)
}
