// TeksERP — durum sayfası canlı yoklama.
// /health uçtan API + DB durumunu çeker ve kartları günceller. Inline script
// helmet CSP'sinde bloklanır; bu yüzden harici 'self' dosya olarak yüklenir.
(function () {
  "use strict";

  function setCard(id, textId, ok, okText, badText) {
    var card = document.getElementById(id);
    var txt = document.getElementById(textId);
    card.classList.remove("ok", "bad");
    card.classList.add(ok ? "ok" : "bad");
    txt.textContent = ok ? okText : badText;
  }

  function setOverall(api, db) {
    var el = document.getElementById("overall");
    var txt = document.getElementById("overallText");
    el.classList.remove("ok", "bad");
    if (api && db) {
      el.classList.add("ok");
      txt.textContent = "Her şey çalışıyor";
    } else if (api) {
      el.classList.add("bad");
      txt.textContent = "Veritabanı bağlantısı yok";
    } else {
      el.classList.add("bad");
      txt.textContent = "Sunucuya ulaşılamıyor";
    }
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString("tr-TR");
    } catch (e) {
      return "—";
    }
  }

  async function refresh() {
    try {
      var r = await fetch("/health", { cache: "no-store" });
      var j = await r.json();
      var apiUp = j.api === "UP" || j.status === "UP";
      var dbUp = j.db === "UP";
      setCard("apiCard", "apiText", apiUp, "Bağlı", "Yanıt yok");
      setCard("dbCard", "dbText", dbUp, "Bağlı", "Bağlantı yok");
      setOverall(apiUp, dbUp);
      document.getElementById("version").textContent = "Sürüm " + (j.version || "—");
      document.getElementById("time").textContent = fmtTime(j.time);
    } catch (e) {
      // API'ye hiç ulaşılamadı → her şey kırmızı.
      setCard("apiCard", "apiText", false, "Bağlı", "Yanıt yok");
      setCard("dbCard", "dbText", false, "Bağlı", "Bağlantı yok");
      setOverall(false, false);
      document.getElementById("time").textContent = fmtTime(new Date().toISOString());
    }
  }

  document.getElementById("addr").textContent = location.host;
  refresh();
  setInterval(refresh, 5000);
})();
