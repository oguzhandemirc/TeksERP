// QR SAYFASI İSKELETİ (telefon): fabrika panelinin gösterdiği QR `…/q#<zarf>` açar. `#parça`
// tarayıcıdan sunucuya HİÇ gitmez (günlüğe de giremez); sayfa zarfı tarayıcıda okuyup
// `/v1/cevrimdisi`e gönderir ve yanıtı gösterir. Yanıtı QR'a çevirme ve panele geri aktarma 1d/Faz 3.
import type { Request, Response } from "express";
import { ENDPOINTS } from "../lisans-protokol";

const PAGE = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TeksERP lisans aktarma</title>
<style>
body{font-family:system-ui,sans-serif;margin:1rem;max-width:40rem;color:#1b1b1b;background:#fafafa}
textarea{width:100%;min-height:12rem;font-family:ui-monospace,monospace;font-size:.75rem}
.durum{padding:.5rem;border-radius:.25rem;background:#eef}
</style>
</head>
<body>
<h1>TeksERP lisans aktarma</h1>
<p class="durum" id="durum">Hazırlanıyor…</p>
<textarea id="yanit" readonly hidden></textarea>
<script>
(function () {
  var durum = document.getElementById("durum");
  var yanit = document.getElementById("yanit");
  var zarf = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  if (!zarf) { durum.textContent = "Bağlantıda aktarma verisi yok. Fabrika panelindeki QR kodunu yeniden okutun."; return; }
  durum.textContent = "Lisans sunucusuna gönderiliyor…";
  fetch("${ENDPOINTS.OFFLINE}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: 1, zarf: zarf }) })
    .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, t: t }; }); })
    .then(function (x) {
      if (!x.ok) { durum.textContent = "Sunucu isteği reddetti."; yanit.hidden = false; yanit.value = x.t; return; }
      durum.textContent = "Yanıt hazır: bu metni fabrika paneline aktarın.";
      yanit.hidden = false; yanit.value = x.t;
    })
    .catch(function () { durum.textContent = "Sunucuya ulaşılamadı. İnternet bağlantısını denetleyin."; });
})();
</script>
</body>
</html>`;

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
