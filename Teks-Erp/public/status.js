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

  // Saniyeyi "2 gün 3 sa 14 dk" gibi okunur süreye çevirir.
  function fmtUptime(sec) {
    if (sec == null || isNaN(sec)) return "—";
    sec = Math.floor(sec);
    var d = Math.floor(sec / 86400);
    var h = Math.floor((sec % 86400) / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var parts = [];
    if (d > 0) parts.push(d + " gün");
    if (h > 0) parts.push(h + " sa");
    parts.push(m + " dk");
    return parts.join(" ");
  }

  // Byte → KB/MB/GB.
  function fmtBytes(b) {
    if (b == null || isNaN(b)) return "—";
    var u = ["B", "KB", "MB", "GB", "TB"];
    var i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i === 0 ? b : b.toFixed(1)) + " " + u[i];
  }

  // Son yedek: zaman + "x önce" görece ifade.
  function fmtLastBackup(lb) {
    if (!lb || !lb.time) return "Henüz yedek yok";
    var when = fmtTime(lb.time);
    var diffMs = Date.now() - new Date(lb.time).getTime();
    var rel;
    if (diffMs < 0 || isNaN(diffMs)) rel = "";
    else {
      var hrs = Math.floor(diffMs / 3600000);
      if (hrs < 1) rel = " (1 saatten az önce)";
      else if (hrs < 24) rel = " (" + hrs + " saat önce)";
      else rel = " (" + Math.floor(hrs / 24) + " gün önce)";
    }
    return when + rel;
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
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
      setText("version", "Sürüm " + (j.version || "—"));
      setText("time", fmtTime(j.time));
      setText("uptime", fmtUptime(j.uptimeSec));
      setText("dbsize", dbUp ? fmtBytes(j.dbSizeBytes) : "—");
      setText("conns", j.dbConnections != null ? j.dbConnections + " bağlantı" : "—");
      setText("cachehit", j.cacheHitPct != null ? "%" + j.cacheHitPct : "—");
      setText("rollsdead", j.rollsDeadPct != null ? "%" + j.rollsDeadPct : "—");
      setText("longestq", j.longestQuerySec != null ? j.longestQuerySec + " sn" : "—");
      setText("lastbackup", fmtLastBackup(j.lastBackup));
    } catch (e) {
      // API'ye hiç ulaşılamadı → her şey kırmızı.
      setCard("apiCard", "apiText", false, "Bağlı", "Yanıt yok");
      setCard("dbCard", "dbText", false, "Bağlı", "Bağlantı yok");
      setOverall(false, false);
      setText("time", fmtTime(new Date().toISOString()));
      setText("uptime", "—");
      setText("dbsize", "—");
      setText("conns", "—");
      setText("cachehit", "—");
      setText("rollsdead", "—");
      setText("longestq", "—");
      setText("lastbackup", "—");
    }
  }

  document.getElementById("addr").textContent = location.host;
  refresh();
  setInterval(refresh, 5000);
})();
