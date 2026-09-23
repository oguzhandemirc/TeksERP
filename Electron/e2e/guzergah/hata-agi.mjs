// =============================================================================
// HATA AĞI — sürücülerin ortak dört ağı: toast · ağ · konsol · backend logu
// =============================================================================
// Her kayıt o anki ADIMA eşlenir (`ag.adim(ad)`). Sürücünün kasıtlı denediği hata
// adımda BEYAN edilir (`ag.beklenen({ status, url })`); beyansız her 4xx/5xx,
// her `console.error`, her yakalanmamış istisna ve her backend hata satırı KIRMIZIdır.
// 2 sn'yi aşan istekler ayrıca listelenir. "Ortam kaynaklı" kayıt silinmez; rapor
// sınıflamayı yalnız beyanla yapar — tahminle susturmaz.
//
// Kullanım:
//   const ag = await hataAgiKur({ app, page, cikti, backendLog, apiUrl });
//   ag.adim("A1 · Cari aç"); ag.beklenen({ status: 400, url: /\/preview$/ });
//   ...
//   const ozet = ag.rapor(); // hata-agi.json + hata-agi.md yazar, özet döner
// =============================================================================
import fs from "node:fs";
import path from "node:path";

const YAVAS_MS = 2000;
// Backend logunda hata/uyarı sayılan satırlar: morgan 4xx/5xx, logger seviyeleri, yığın izi.
const BACKEND_HATA = /\s[45]\d\d\s|\b(HATA|UYARI|ERROR|WARN|Error:|Unhandled|TypeError|ReferenceError|PrismaClient\w*Error)\b|^\s+at\s/;
// ANSI renk kodu (ESC = 0x1b) — kurucuyla: düz regex literalinde kontrol karakteri lint kuralına takılır.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Rol değişince uygulama yeniden açılır: aynı `durum` nesnesi yeni örneğe verilir, kayıt ve adım sürer. */
export function hataAgiDurumu() {
  return { simdiki: "başlangıç", beklenenler: [], kayitlar: { toast: [], ag: [], yavas: [], konsol: [], main: [], backend: [], surucu: [] }, gorNo: 0 };
}

export async function hataAgiKur({ app, page, cikti, backendLog, apiUrl, durum = hataAgiDurumu() }) {
  const D = durum;
  const kayitlar = D.kayitlar;
  const gor = async (etiket) => {
    const dosya = `ag-${String(++D.gorNo).padStart(4, "0")}-${etiket}.png`;
    await page.screenshot({ path: path.join(cikti, dosya) }).catch(() => undefined);
    return dosya;
  };

  // ── 1 · TOAST ──────────────────────────────────────────────────────────────
  await page.exposeFunction("__hataAgiToast", async (t) => {
    const gorsel = await gor("toast");
    kayitlar.toast.push({ adim: D.simdiki, tur: t.tur, metin: t.metin, zaman: new Date().toISOString(), gorsel });
  });
  const toastIzle = () => {
    if (window.__hataAgiKuruldu) return;
    window.__hataAgiKuruldu = true;
    const gorulen = new WeakSet();
    const tara = () => document.querySelectorAll("[data-sonner-toast]").forEach((el) => {
      if (gorulen.has(el)) return;
      gorulen.add(el);
      requestAnimationFrame(() => window.__hataAgiToast({ tur: el.getAttribute("data-type") ?? "?", metin: (el.textContent ?? "").trim() }));
    });
    const kur = () => { new MutationObserver(tara).observe(document.body, { childList: true, subtree: true }); tara(); };
    if (document.body) kur(); else document.addEventListener("DOMContentLoaded", kur);
  };
  await page.evaluate(toastIzle).catch(() => undefined);
  // Sayfa yeniden yüklenirse gözlemci yeniden kurulur.
  page.on("load", () => void page.evaluate(toastIzle).catch(() => undefined));

  // ── 2 · AĞ ─────────────────────────────────────────────────────────────────
  const apiKok = apiUrl ? new URL(apiUrl).host : null;
  page.on("requestfinished", async (req) => {
    const u = req.url();
    if (apiKok && !u.includes(apiKok)) return;
    const res = await req.response().catch(() => null);
    const t = req.timing();
    const ms = t && t.responseEnd > 0 ? Math.round(t.responseEnd) : null;
    const status = res?.status() ?? 0;
    const satir = { adim: D.simdiki, yontem: req.method(), url: u.replace(/^https?:\/\/[^/]+/, ""), status, ms, zaman: new Date().toISOString() };
    if (ms !== null && ms > YAVAS_MS) kayitlar.yavas.push(satir);
    if (status >= 400) {
      const govde = await res.text().catch(() => "");
      satir.mesaj = (() => { try { const j = JSON.parse(govde); return [j.message, j?.details?.code].filter(Boolean).join(" · "); } catch { return govde.slice(0, 200); } })();
      // Ayar şifresi PROTOKOLÜ: ilk istek başlıksız gider, 403 SETTINGS_PASSWORD_REQUIRED döner, diyalog açılır —
      // tasarım gereği; ayrı sınıfta sayılır, kırmızı değil (hatalı şifre `_INVALID` kırmızı kalır).
      satir.protokol = status === 403 && /SETTINGS_PASSWORD_REQUIRED/.test(satir.mesaj ?? "");
      satir.beklenen = satir.protokol || D.beklenenler.some((b) => (b.status === undefined || b.status === status) && (!b.url || b.url.test(satir.url)));
      satir.gorsel = await gor(`ag-${status}`);
      kayitlar.ag.push(satir);
    }
  });
  page.on("requestfailed", (req) => {
    const u = req.url();
    if (apiKok && !u.includes(apiKok)) return; // 4000'e yönlenen engelli istekler bilerek sayılmaz
    kayitlar.ag.push({ adim: D.simdiki, yontem: req.method(), url: u.replace(/^https?:\/\/[^/]+/, ""), status: 0, mesaj: req.failure()?.errorText ?? "başarısız", beklenen: false, zaman: new Date().toISOString() });
  });

  // ── 3 · KONSOL (renderer + main) ───────────────────────────────────────────
  page.on("console", (m) => {
    const tur = m.type();
    if (tur !== "error" && tur !== "warning") return;
    const metin = m.text();
    // Ağ 4xx'inin tarayıcı yansıması ağ kolunda zaten sayılıyor — çift saymamak için ayrı işaretlenir.
    const agYansimasi = /Failed to load resource: the server responded with a status of \d+/.test(metin);
    kayitlar.konsol.push({ adim: D.simdiki, tur, metin: metin.slice(0, 600), agYansimasi, zaman: new Date().toISOString() });
  });
  page.on("pageerror", (e) => kayitlar.konsol.push({ adim: D.simdiki, tur: "pageerror", metin: String(e?.stack ?? e).slice(0, 1200), agYansimasi: false, zaman: new Date().toISOString() }));
  const proc = app.process();
  for (const akis of [proc.stdout, proc.stderr]) {
    akis?.on("data", (buf) => {
      for (const satir of String(buf).split("\n")) {
        if (!satir.trim()) continue;
        // "error: null" gibi alan adları hata değildir (ölçüldü: mdns durum nesnesi) — sözcük + değer birlikte aranır.
        const hataSatiri = /\b(\w*Error|ERROR|Uncaught|Unhandled|Exception|EXCEPTION|WARN(ING)?)\b/.test(satir) || /\berror\b(?!\s*:\s*(null|undefined|false))/i.test(satir);
        if (hataSatiri && !/DevTools|Autofill\.|GPU process|electron-updater/.test(satir)) {
          kayitlar.main.push({ adim: D.simdiki, metin: satir.replace(ANSI, "").slice(0, 500), zaman: new Date().toISOString() });
        }
      }
    });
  }

  // ── 4 · BACKEND LOGU ───────────────────────────────────────────────────────
  let logOfset = backendLog && fs.existsSync(backendLog) ? fs.statSync(backendLog).size : 0;
  const backendOku = () => {
    if (!backendLog || !fs.existsSync(backendLog)) return;
    const boy = fs.statSync(backendLog).size;
    if (boy <= logOfset) return;
    const fd = fs.openSync(backendLog, "r");
    const buf = Buffer.alloc(boy - logOfset);
    fs.readSync(fd, buf, 0, buf.length, logOfset);
    fs.closeSync(fd);
    logOfset = boy;
    for (const ham of buf.toString("utf-8").split("\n")) {
      const satir = ham.replace(ANSI, "");
      // Yığın izi satırları önceki kaydın PARÇASIDIR — ayrı kayıt sayılırsa tek uyarı on bir kırmızı olur.
      if (/^\s+at\s/.test(satir)) { const son = kayitlar.backend[kayitlar.backend.length - 1]; if (son) { son.yigin = `${son.yigin ?? ""}${satir.trim()}\n`.slice(0, 2000); continue; } }
      if (!satir.trim() || !BACKEND_HATA.test(satir)) continue;
      const m = satir.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s+(\d{3})/);
      const beklenen = m ? D.beklenenler.some((b) => (b.status === undefined || b.status === Number(m[3])) && (!b.url || b.url.test(m[2].split("?")[0]) || b.url.test(m[2]))) : false;
      kayitlar.backend.push({ adim: D.simdiki, metin: satir.slice(0, 500), beklenen, http: m ? { yontem: m[1], url: m[2], status: Number(m[3]) } : null, zaman: new Date().toISOString() });
    }
  };
  const logZamanlayici = setInterval(backendOku, 500);

  // Backend HTTP satırı ya panelin (ağ kolunda zaten sayılır) ya sürücünün kendi API sondasının
  // yansımasıdır; ikisine de uymayan HTTP satırı ve HTTP OLMAYAN her hata satırı KIRMIZIdır.
  const esit = (a, b) => a.split("?")[0] === b.split("?")[0];
  const backendSinifi = (x) => {
    if (x.beklenen) return "beklenen";
    if (!x.http) return "kirmizi";
    if (kayitlar.ag.some((a) => a.status === x.http.status && esit(a.url, x.http.url))) return "panel-yansimasi";
    if (kayitlar.surucu.some((a) => a.status === x.http.status && esit(a.url, x.http.url))) return "surucu-sondasi";
    return "kirmizi";
  };

  return {
    /** Yeni adıma geç: önceki adımın backend satırları önceki adıma yazılır, beklenen beyanı sıfırlanır. */
    adim(ad) { backendOku(); D.simdiki = ad; D.beklenenler = []; },
    /** Sürücünün kendi API çağrısı (panel dışı sonda) — backend satırı bununla eşlenir. */
    surucuCagrisi(yontem, url, status) { if (status >= 400) kayitlar.surucu.push({ adim: D.simdiki, yontem, url, status }); },
    /** Uygulama kapanırken: log zamanlayıcısını durdur (kayıtlar `durum`da kalır). */
    kapat() { backendOku(); clearInterval(logZamanlayici); },
    /** Bu adımda sürücünün KASITLI tetiklediği hata. `url` RegExp, `status` sayı. */
    beklenen(b) { D.beklenenler.push(b); },
    kayitlar,
    /** Adımın kendi kırmızıları (sürücünün adım sonucuna bağlaması için). */
    adimKirmizilari(ad) {
      backendOku();
      return [
        ...kayitlar.ag.filter((x) => x.adim === ad && !x.beklenen).map((x) => `ağ ${x.status} ${x.yontem} ${x.url} — ${x.mesaj ?? ""}`),
        ...kayitlar.konsol.filter((x) => x.adim === ad && !x.agYansimasi && (x.tur === "error" || x.tur === "pageerror")).map((x) => `konsol ${x.tur}: ${x.metin.slice(0, 160)}`),
        ...kayitlar.toast.filter((x) => x.adim === ad && x.tur === "error").map((x) => `toast: ${x.metin.slice(0, 160)}`),
        ...kayitlar.backend.filter((x) => x.adim === ad && backendSinifi(x) === "kirmizi").map((x) => `backend: ${x.metin.slice(0, 160)}`),
        ...kayitlar.main.filter((x) => x.adim === ad).map((x) => `main: ${x.metin.slice(0, 160)}`),
      ];
    },
    rapor() {
      backendOku();
      clearInterval(logZamanlayici);
      const kirmizi = {
        ag: kayitlar.ag.filter((x) => !x.beklenen),
        // Hata toast'ı, adımında yalnız BEYANLI ağ hatası varsa beklenen sayılır (kasıtlı denemenin yansıması).
        toastHata: kayitlar.toast.filter((x) => x.tur === "error" && !(kayitlar.ag.some((a) => a.adim === x.adim && a.beklenen) && !kayitlar.ag.some((a) => a.adim === x.adim && !a.beklenen))),
        konsol: kayitlar.konsol.filter((x) => !x.agYansimasi && (x.tur === "error" || x.tur === "pageerror")),
        main: kayitlar.main,
        backend: kayitlar.backend.filter((x) => backendSinifi(x) === "kirmizi"),
      };
      const ozet = {
        surucuSondasi: kayitlar.surucu.length,
        toast: kayitlar.toast.length, toastHata: kirmizi.toastHata.length,
        ag4xx5xx: kayitlar.ag.length, agBeklenmedik: kirmizi.ag.length,
        yavas: kayitlar.yavas.length,
        konsolHata: kirmizi.konsol.length, konsolUyari: kayitlar.konsol.filter((x) => x.tur === "warning").length,
        main: kirmizi.main.length, backendBeklenmedik: kirmizi.backend.length,
      };
      fs.writeFileSync(path.join(cikti, "hata-agi.json"), JSON.stringify({ ozet, kayitlar }, null, 2));
      const md = [];
      const tablo = (baslik, satirlar, kolonlar) => {
        md.push(`## ${baslik} (${satirlar.length})`, "");
        if (!satirlar.length) { md.push("_yok_", ""); return; }
        md.push(`| ${kolonlar.join(" | ")} |`, `|${kolonlar.map(() => "---").join("|")}|`);
        for (const s of satirlar) md.push(`| ${kolonlar.map((k) => String(s[k] ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 220)).join(" | ")} |`);
        md.push("");
      };
      md.push(`# Hata ağı raporu`, "", "```", JSON.stringify(ozet), "```", "");
      tablo("Ağ — BEYANSIZ 4xx/5xx (KIRMIZI)", kirmizi.ag, ["adim", "yontem", "url", "status", "mesaj", "gorsel"]);
      tablo("Ağ — beyanlı (beklenen) 4xx/5xx", kayitlar.ag.filter((x) => x.beklenen), ["adim", "yontem", "url", "status", "mesaj"]);
      tablo("Toast — BEKLENMEDİK hata toast'ları (KIRMIZI)", kirmizi.toastHata, ["adim", "metin", "gorsel"]);
      tablo("Toast — hepsi", kayitlar.toast, ["adim", "tur", "metin", "gorsel"]);
      tablo("Konsol — error/pageerror (ağ yansıması hariç)", kirmizi.konsol, ["adim", "tur", "metin"]);
      tablo("Konsol — warning", kayitlar.konsol.filter((x) => x.tur === "warning"), ["adim", "metin"]);
      tablo("Main process", kirmizi.main, ["adim", "metin"]);
      tablo("Backend logu — beyansız hata/uyarı (KIRMIZI)", kirmizi.backend, ["adim", "metin"]);
      tablo("Backend logu — sürücü sondası yansıması (kırmızı değil)", kayitlar.backend.filter((x) => backendSinifi(x) === "surucu-sondasi"), ["adim", "metin"]);
      tablo(`Yavaş istekler (> ${YAVAS_MS} ms)`, kayitlar.yavas, ["adim", "yontem", "url", "status", "ms"]);
      fs.writeFileSync(path.join(cikti, "hata-agi.md"), md.join("\n"));
      return ozet;
    },
  };
}
