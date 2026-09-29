// Yükleme sayfasının (/y/<belirteç>) tarayıcı betiği — metin olarak gömülür (paket yok, CSP nonce'lu).
// SHA256_JS: artımlı SHA-256 (WebCrypto yalnız tek parça özet verir; bütün dosya belleğe alınmaz).
// Bekçi test_dagitim_yukleme bu kodu vm'de koşup Node'un sha256'sıyla birebir karşılaştırır.

export const SHA256_JS = String.raw`
var SHA_K = new Uint32Array([
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
function Sha256() {
  this.h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  this.buf = new Uint8Array(64); this.fill = 0; this.total = 0; this.w = new Uint32Array(64);
}
Sha256.prototype.block = function (b, o) {
  var w = this.w, h = this.h, i, t1, t2;
  for (i = 0; i < 16; i++) w[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
  for (i = 16; i < 64; i++) {
    var x = w[i - 15], y = w[i - 2];
    var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
  }
  var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (i = 0; i < 64; i++) {
    var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    var ch = (e & f) ^ (~e & g);
    t1 = (hh + S1 + ch + SHA_K[i] + w[i]) | 0;
    var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    var maj = (a & bb) ^ (a & c) ^ (bb & c);
    t2 = (S0 + maj) | 0;
    hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
  }
  h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
  h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
};
Sha256.prototype.update = function (data) {
  var i = 0, n = data.length;
  this.total += n;
  if (this.fill > 0) {
    while (i < n && this.fill < 64) this.buf[this.fill++] = data[i++];
    if (this.fill < 64) return this;
    this.block(this.buf, 0); this.fill = 0;
  }
  for (; i + 64 <= n; i += 64) this.block(data, i);
  while (i < n) this.buf[this.fill++] = data[i++];
  return this;
};
Sha256.prototype.hex = function () {
  var bits = this.total * 8, pad = new Uint8Array(((this.fill < 56 ? 56 : 120) - this.fill) + 8), i;
  pad[0] = 0x80;
  var hi = Math.floor(bits / 4294967296), lo = bits >>> 0, L = pad.length;
  pad[L - 8] = hi >>> 24; pad[L - 7] = hi >>> 16; pad[L - 6] = hi >>> 8; pad[L - 5] = hi;
  pad[L - 4] = lo >>> 24; pad[L - 3] = lo >>> 16; pad[L - 2] = lo >>> 8; pad[L - 1] = lo;
  this.total -= pad.length; this.update(pad);
  var out = "";
  for (i = 0; i < 8; i++) out += ("00000000" + (this.h[i] >>> 0).toString(16)).slice(-8);
  return out;
};
`;

/**
 * Yükleyici: önce dosyanın bütün ve parça özetleri (tek okuma), sonra oturum (işlem kimliği tarayıcıda saklı:
 * sayfa kapanıp açılsa da AYNI oturum sürer), eksik parçalar sırayla (parça başına 3 deneme), en son tamamla.
 */
export const UPLOAD_JS = String.raw`
(function () {
  var base = location.pathname.replace(/\/+$/, "");
  var el = function (id) { return document.getElementById(id); };
  var info = null;
  function mb(n) { return (n / 1048576).toFixed(1) + " MB"; }
  function say(t, bad) { var s = el("durum"); s.textContent = t; s.className = bad ? "hata" : ""; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  async function api(method, path, body, raw) {
    var opt = { method: method, cache: "no-store", headers: {} };
    if (raw) { opt.body = raw.blob; opt.headers["Content-Type"] = "application/octet-stream"; opt.headers["X-Parca-Sha256"] = raw.sha; }
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; }
    var r = await fetch(base + path, opt), j = null;
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) { var err = new Error((j && j.message) || ("HTTP " + r.status)); err.status = r.status; err.code = j && j.details && j.details.code; throw err; }
    return j ? j.data : null;
  }
  async function load() {
    info = await api("GET", "/durum");
    el("bilgi").textContent = "Kalan kota: " + mb(info.kalanBayt) + " · Dosya tavanı: " + mb(info.azamiDosyaBayt) +
      " · Son gün: " + new Date(info.bitis).toLocaleString("tr-TR") + " · İzinli: " + info.izinliUzantilar.join(", ");
    if (info.aciklama) el("aciklama").textContent = info.aciklama;
  }
  async function digests(file, partBytes) {
    var whole = new Sha256(), parts = [], n = Math.max(1, Math.ceil(file.size / partBytes));
    for (var i = 0; i < n; i++) {
      var buf = new Uint8Array(await file.slice(i * partBytes, Math.min(file.size, (i + 1) * partBytes)).arrayBuffer());
      whole.update(buf);
      parts.push(window.crypto && crypto.subtle
        ? Array.prototype.map.call(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("")
        : new Sha256().update(buf).hex());
      say("Dosya özeti hesaplanıyor… %" + Math.round(((i + 1) / n) * 100));
    }
    return { whole: whole.hex(), parts: parts };
  }
  async function send(file, again) {
    var key = "tekserp-yukleme:" + base + ":" + file.name + ":" + file.size + ":" + file.lastModified;
    var token = recall(key) || uuid();
    store(key, token);
    var h = await digests(file, info.parcaBayt);
    var s;
    try {
      s = await api("POST", "/oturum", { clientToken: token, dosyaAdi: file.name, boyut: file.size, sha256: h.whole, mime: file.type || "" });
    } catch (e) {
      if (e.code === "ISLEM_KIMLIGI_CAKISTI" && !again) { store(key, null); return send(file, true); }
      throw e;
    }
    var have = {};
    s.alinanlar.forEach(function (i) { have[i] = true; });
    for (var i = 0; i < s.parcaSayisi; i++) {
      if (have[i]) continue;
      var blob = file.slice(i * s.parcaBayt, Math.min(file.size, (i + 1) * s.parcaBayt));
      for (var t = 1; ; t++) {
        try { await api("PUT", "/oturum/" + s.oturumId + "/parca/" + i, undefined, { blob: blob, sha: h.parts[i] }); break; }
        catch (e) { if (t >= 3 || (e.status && e.status < 500 && e.status !== 408 && e.status !== 429)) throw e; }
      }
      say("Yükleniyor… " + (i + 1) + "/" + s.parcaSayisi + " parça");
    }
    await api("POST", "/oturum/" + s.oturumId + "/tamamla", {});
    store(key, null);
  }
  el("form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = el("dosya").files[0];
    if (!f || !info) return;
    el("gonder").disabled = true;
    send(f, false).then(function () { say("Tamamlandı: " + f.name); return load(); })
      .catch(function (e) { say("Yükleme durdu: " + e.message + " (sayfayı açık bırakıp yeniden deneyin; alınan parçalar korunur)", true); })
      .then(function () { el("gonder").disabled = false; });
  });
  load().catch(function (e) { say(e.message, true); el("gonder").disabled = true; });
})();
`;
