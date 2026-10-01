// QR SAYFASI (telefon): fabrika panelinin gösterdiği QR `…/q#<zarf>` (ya da çok parçalı istekte her
// parça için `…/q#<TKLQ1 parçası>`) açar. `#parça` tarayıcıdan sunucuya HİÇ gitmez (günlüğe de
// giremez); sayfa zarfı tarayıcıda okuyup `/v1/cevrimdisi`e gönderir ve YANITI çok parçalı QR olarak
// gösterir — fabrikadaki tablet parçaları okutup birleştirir. İstek parçaları sekmeler arasında
// yalnız bu kökenin yerel deposunda en çok 15 dk bekler, küme tamamlanınca silinir. Yanıttaki kiranın (kendi imzalı
// belgemiz; burada yalnız OKUNUR) ödenmiş tarihi (P) ve kapanış uyarısı kullanıcıya tek satırda gösterilir.
// Biçim ve kodlayıcı: `qr-page-lib.ts` + `qr-page-matrix.ts` (bekçi `test_qr_sayfasi`).
import type { Request, Response } from "express";
import { ENDPOINTS } from "../lisans-protokol";
import { QR_PAGE_LIB_JS } from "./qr-page-lib";
import { QR_PAGE_MATRIX_JS } from "./qr-page-matrix";

const CONTROLLER_JS = String.raw`(function () {
  "use strict";
  var OFFLINE = ${JSON.stringify(ENDPOINTS.OFFLINE)}, STORE_KEY = "tklq-istek", STORE_TTL_MS = 15 * 60 * 1000, CYCLE_MS = 2500;
  var byId = function (id) { return document.getElementById(id); };
  var durum = byId("durum"), qrKutu = byId("qr"), qrBilgi = byId("qr-bilgi"), araclar = byId("araclar");
  var yanit = byId("yanit"), kopyala = byId("kopyala"), ozet = byId("lisans-ozet");
  function say(metin) { durum.textContent = metin; }
  function b64uBytes(s) {
    var abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", out = [], acc = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      var v = abc.indexOf(s.charAt(i));
      if (v < 0) return null;
      acc = ((acc << 6) | v) & 0xffffff; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((acc >>> bits) & 255); }
    }
    return out;
  }
  function utf8Text(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += "%" + ("0" + bytes[i].toString(16)).slice(-2);
    return decodeURIComponent(s);
  }
  function day(iso) { return new Date(iso).toLocaleDateString("tr-TR"); }
  function leaseSummary(text) {
    try {
      var bytes = b64uBytes(String(JSON.parse(text).kira).split(".")[1] || "");
      if (!bytes) return null;
      var k = JSON.parse(utf8Text(bytes)), out = [];
      if (k.odenmisTarih === null) out.push("Ödenmiş tarih: süresiz");
      else if (typeof k.odenmisTarih === "string") out.push("Ödenmiş tarih: " + day(k.odenmisTarih));
      if (k.kapanis) {
        var t = k.yaptirim && k.yaptirim.kisitlamaTarihi;
        out.push("UYARI: bu makineye kapanış kirası verildi — lisans " + (t ? day(t) + " tarihinde" : "yakında") + " kısıtlı kipe geçer; satıcıyla görüşün");
      }
      return out.length ? out.join(" · ") : null;
    } catch (e) { return null; }
  }
  function readStore() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      return v && Date.now() - v.at < STORE_TTL_MS ? v.state : null;
    } catch (e) { return null; }
  }
  function writeStore(state) {
    try {
      if (state) localStorage.setItem(STORE_KEY, JSON.stringify({ at: Date.now(), state: state }));
      else localStorage.removeItem(STORE_KEY);
      return true;
    } catch (e) { return false; }
  }
  function showText(text) { yanit.hidden = false; yanit.value = text; kopyala.hidden = false; }
  function drawQr(value) {
    var m = TKLQ.qrMatrix(value), dim = m.length + 8, ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg"), bg = document.createElementNS(ns, "rect"), path = document.createElementNS(ns, "path");
    svg.setAttribute("viewBox", "0 0 " + dim + " " + dim);
    svg.setAttribute("shape-rendering", "crispEdges");
    bg.setAttribute("width", String(dim)); bg.setAttribute("height", String(dim)); bg.setAttribute("fill", "#fff");
    path.setAttribute("d", TKLQ.qrPath(m, 4)); path.setAttribute("fill", "#000");
    svg.appendChild(bg); svg.appendChild(path);
    qrKutu.textContent = "";
    qrKutu.appendChild(svg);
  }
  function showParts(parts) {
    var i = 0, timer = null;
    function show() {
      drawQr(parts[i]);
      qrBilgi.textContent = parts.length > 1 ? "QR " + (i + 1) + " / " + parts.length + " — tablet hepsini okuyana dek açık tutun" : "Tabletle okutun";
    }
    function step(d) { i = (i + d + parts.length) % parts.length; show(); }
    function play(on) {
      if (timer) { clearInterval(timer); timer = null; }
      if (on && parts.length > 1) timer = setInterval(function () { step(1); }, CYCLE_MS);
      byId("dur").textContent = timer ? "Durdur" : "Oynat";
    }
    byId("onceki").onclick = function () { play(false); step(-1); };
    byId("sonraki").onclick = function () { play(false); step(1); };
    byId("dur").onclick = function () { play(!timer); };
    araclar.hidden = parts.length < 2;
    qrKutu.hidden = false;
    qrBilgi.hidden = false;
    show();
    play(true);
  }
  kopyala.onclick = function () {
    var done = function (ok) { kopyala.textContent = ok ? "Kopyalandı" : "Kopyalanamadı — metni seçip kopyalayın"; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(yanit.value).then(function () { done(true); }, function () { done(false); });
    else done(false);
  };
  function message(t) {
    try { var j = JSON.parse(t); return j && typeof j.message === "string" ? j.message : "ayrıntı yok"; } catch (e) { return "ayrıntı yok"; }
  }
  function send(zarf) {
    say("Lisans sunucusuna gönderiliyor…");
    fetch(OFFLINE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: 1, zarf: zarf }) })
      .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, t: t }; }); })
      .then(function (x) {
        if (!x.ok) { say("Sunucu isteği reddetti: " + message(x.t)); showText(x.t); return; }
        var parts = TKLQ.split(x.t), summary = leaseSummary(x.t);
        showText(x.t);
        if (summary) { ozet.hidden = false; ozet.textContent = summary; }
        if (!parts) { say("Yanıt QR'a sığmıyor — metni kopyalayıp fabrika paneline yapıştırın."); return; }
        say("Yanıt hazır. Fabrikadaki tablette Ayarlar → Lisans → “Yanıt QR'ını okut” ile QR'ların hepsini okutun; tablet yoksa metni kopyalayıp panele yapıştırın.");
        showParts(parts);
      })
      .catch(function () { say("Sunucuya ulaşılamadı. İnternet bağlantısını denetleyin."); });
  }
  function missing(state) {
    var out = [];
    for (var k = 0; k < state.parts.length; k++) if (state.parts[k] === null) out.push(k + 1);
    return out.join(", ");
  }
  var raw = location.hash.slice(1), text = raw;
  history.replaceState(null, "", location.pathname);
  try { text = decodeURIComponent(raw); } catch (e) { text = raw; }
  if (!text) { say("Bağlantıda aktarma verisi yok. Fabrika panelindeki QR kodunu yeniden okutun."); return; }
  if (text.indexOf("TKLQ1|") !== 0) { send(text); return; }
  var r = TKLQ.add(readStore(), text);
  if (r.kind === "tamam") { writeStore(null); send(r.text); return; }
  if (r.kind === "eklendi" || r.kind === "tekrar") {
    if (!writeStore(r.state)) { say("Bu tarayıcı parçaları biriktiremiyor (gizli sekme?). Paneldeki “İstek metnini kopyala” yolunu kullanın."); return; }
    say("İstek parçası " + r.received + " / " + r.state.total + " alındı. Paneldeki sıradaki QR'ı okutun (eksik: " + missing(r.state) + ").");
    return;
  }
  writeStore(null);
  say(r.kind === "bozuk" ? "Parçalar birleşmedi (bozuk okuma). Paneldeki QR'ları baştan okutun." : "Bu QR bir lisans isteği parçası değil.");
})();
`;

const PAGE = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TeksERP lisans aktarma</title>
<style>
[hidden]{display:none!important}
body{font-family:system-ui,sans-serif;margin:1rem;max-width:40rem;color:#1b1b1b;background:#fafafa}
textarea{width:100%;min-height:8rem;font-family:ui-monospace,monospace;font-size:.75rem;margin-top:1rem}
.durum{padding:.5rem;border-radius:.25rem;background:#eef}
.ozet{padding:.5rem;border-radius:.25rem;background:#efe;font-weight:600}
.qr svg{display:block;width:min(92vw,68vh);height:auto;margin:1rem auto 0}
.bilgi{text-align:center;font-weight:600}
.araclar{display:flex;gap:.5rem;justify-content:center}
button{font-size:1rem;padding:.5rem .9rem}
</style>
</head>
<body>
<h1>TeksERP lisans aktarma</h1>
<p class="durum" id="durum">Hazırlanıyor…</p>
<p class="ozet" id="lisans-ozet" hidden></p>
<div class="qr" id="qr" hidden></div>
<p class="bilgi" id="qr-bilgi" hidden></p>
<div class="araclar" id="araclar" hidden><button id="onceki" type="button">‹ Önceki</button><button id="dur" type="button">Durdur</button><button id="sonraki" type="button">Sonraki ›</button></div>
<textarea id="yanit" readonly hidden></textarea>
<button id="kopyala" type="button" hidden>Metni kopyala</button>
<script>
${QR_PAGE_LIB_JS}
${QR_PAGE_MATRIX_JS}
${CONTROLLER_JS}
</script>
</body>
</html>`;

/** Sayfa gövdesi — bekçi betiği buradan çıkarıp koşturur. */
export function qrPageHtml(): string {
  return PAGE;
}

export function qrPage(_req: Request, res: Response): void {
  res.set({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
  });
  res.status(200).send(PAGE);
}
