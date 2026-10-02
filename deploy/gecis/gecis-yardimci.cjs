// =============================================================================
// gecis.ps1 yardimcisi - pm2 duzeni -> Windows hizmeti duzeni gecisinin SAF hesaplari
// =============================================================================
// gecis.ps1 bunu PAKETIN Node'uyla (runtime\node.exe) kosar; girdi stdin'den TEK JSON, cikti
// stdout'un SON satirinda TEK satir JSON (ASCII; kur.ps1 birlestirici kalibi). Bagimlilik YOK.
// SIR HIJYENI: .env / ecosystem / pm2 ortami DEGERLERI ciktiya, hata metnine, dosyaya (yalniz
// hedef .env haric) GIRMEZ - cikti yalniz anahtar ADLARI, karar siniflari ve satir numaralari tasir.
//
//   ortam  : app\.env + ecosystem.config.js env blogu -> yapilandirma\.env (birlestirme + denetim)
//   pm2    : `pm2 jlist` ciktisini siniflar (bu kokun backend'i / moduller / baska uygulama)
//   kira   : lisans\kira.jws yukunden YALNIZ gosterim alanlari (dogrulama yapmaz, yetki degildir)
//
// Ikiz kaynaklar (bekci test_gecis olcer):
//   HIZMET_VARSAYILANLARI / YOL_AYARLARI  = Teks-Erp/src/lib/hizmet-duzeni.ts serviceDefaults / PATH_SETTINGS
//   dotenvCozumle                         = dotenv 17.4.2 `parse` - yapilandirma\.env'i okuyan IKI surec de
//                                           bu anlami gorur: backend (dotenv) ve guncelleyici (envfile.rs, D2b'den
//                                           beri dotenv'in birebir aynasi). Ortak vektorler:
//                                           Teks-Erp/native/test-vektorleri/env-dosyasi.json (test_env_okuyucu uretir)
// =============================================================================
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");

function cik(nesne, kod) {
  const s = JSON.stringify(nesne).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  process.stdout.write("\n" + s + "\n");
  process.exitCode = kod;
}

// --- Ikiz: hizmet-duzeni.ts --------------------------------------------------------
const YOL_AYARLARI = Object.freeze([
  "BACKUP_DIR", "BACKUP_KEY_DIR", "BACKUP_OFFSITE_DIR", "BACKUP_RCLONE_BIN", "BACKUP_RCLONE_CONFIG",
  "LICENSE_DIR", "MOBILE_UPDATE_DIR", "PG_BIN_DIR", "PGDATA_DIR",
]);
function mutlakMi(v) {
  return /^[A-Za-z]:[\\/]/.test(v) || /^[\\/]{2}[^\\/]/.test(v) || /^\/(?!\/)/.test(v);
}
function ileriBolu(v) {
  const s = String(v).replace(/\\/g, "/");
  return /^[A-Za-z]:\/$/.test(s) || s === "/" ? s : s.replace(/\/+$/, "");
}
function kokAlti(kok, ...parcalar) {
  const b = kok.endsWith("/") ? kok.slice(0, -1) : kok;
  return [b, ...parcalar].join("/");
}
function hizmetVarsayilanlari(kok) {
  return Object.freeze({
    NODE_ENV: "production",
    APP_ENV: "production",
    BACKUP_SCHEDULE_ENABLED: "false",
    BACKUP_DIR: kokAlti(kok, "backups"),
    LICENSE_DIR: kokAlti(kok, "lisans"),
    PG_BIN_DIR: kokAlti(kok, "pgsql", "bin"),
    BACKUP_RCLONE_BIN: kokAlti(kok, "rclone", "rclone.exe"),
    BACKUP_RCLONE_CONFIG: kokAlti(kok, "veri", "rclone.conf"),
    MOBILE_UPDATE_DIR: kokAlti(kok, "mobil-guncelleme"),
  });
}
// Konak (tekserp-hizmet) node'a dotenv'DEN ONCE verir: .env bunlari EZEMEZ (dotenv var olani degistirmez).
const KONAK_SABIT = Object.freeze({ NODE_ENV: "production", NODE_USE_SYSTEM_CA: "1" });
function konakAnahtariMi(k) {
  return Object.prototype.hasOwnProperty.call(KONAK_SABIT, k) || /^TEKSERP_/.test(k);
}

// --- Ikiz: dotenv 17 parse (backend'in .env okuyucusu) -----------------------------
const DOTENV_SATIR = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
function dotenvCozumle(kaynak) {
  const nesne = {};
  const satirlar = String(kaynak).replace(/\r\n?/mg, "\n");
  const re = new RegExp(DOTENV_SATIR.source, DOTENV_SATIR.flags);
  let m;
  while ((m = re.exec(satirlar)) != null) {
    const anahtar = m[1];
    let deger = (m[2] || "").trim();
    const tirnak = deger[0];
    deger = deger.replace(/^(['"`])([\s\S]*)\1$/mg, "$2");
    if (tirnak === '"') {
      deger = deger.replace(/\\n/g, "\n");
      deger = deger.replace(/\\r/g, "\r");
    }
    nesne[anahtar] = deger;
  }
  return nesne;
}

// --- Satir duzeyi --------------------------------------------------------------------
function satirlaraBol(metin) {
  const out = [];
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let m;
  while ((m = re.exec(metin)) != null) {
    if (m[0] === "" && re.lastIndex >= metin.length) break;
    out.push({ metin: m[1], son: m[2] });
    if (m[2] === "") break;
  }
  return out;
}
/** dotenv'in (backend ve guncelleyici ayni anlamla okur) TAM bu degeri gordugu satir; temsil edilemiyorsa null. */
function kanonikSatir(k, v) {
  if (/^[^\s#'"`\\]*$/.test(v)) return k + "=" + v;
  if (!/['\r\n]/.test(v)) return k + "='" + v + "'";
  if (!/["\\\r\n]/.test(v)) return k + '="' + v + '"';
  return null;
}
function satirDeger(satir) {
  const d = dotenvCozumle(satir);
  const a = Object.keys(d);
  return a.length ? { k: a[a.length - 1], v: d[a[a.length - 1]] } : null;
}

// --- ecosystem.config.js ---------------------------------------------------------------
function ecoYukle(yol) {
  const kaynak = fs.readFileSync(yol, "utf8").replace(/^﻿/, "");
  const m = new Module(yol, null);
  m.filename = yol;
  m.paths = Module._nodeModulePaths(path.dirname(yol));
  const eskiAd = process.env.TEKSERP_PM2_AD;
  delete process.env.TEKSERP_PM2_AD;
  try { m._compile(kaynak, yol); } finally { if (eskiAd !== undefined) process.env.TEKSERP_PM2_AD = eskiAd; }
  const ex = m.exports;
  const app = ex && Array.isArray(ex.apps) && ex.apps.length === 1 ? ex.apps[0] : null;
  if (!app || typeof app !== "object") throw new Error("ecosystem.config.js tek uygulama tasimiyor");
  const env = {};
  const bicimsiz = [];
  const kaynakEnv = app.env && typeof app.env === "object" ? app.env : {};
  for (const [k, v] of Object.entries(kaynakEnv)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string") env[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") env[k] = String(v);
    else bicimsiz.push(k);
  }
  return { ad: typeof app.name === "string" ? app.name : null, env, bicimsiz };
}

// Lisans saticisi kokeni (https://host[:port], kucuk harf host, sonda / yok) ya da null. Backend'in cozucusu
// (vendor-url.ts) bundan genis kabul eder (dongu adresine http); kanal beklentisi daima https oldugundan
// burada tanimayan deger zaten UYUSMAZ'dir. Kimlik bilgili/yollu deger tanimaz - ciktiya hic girmez.
function lisansKoken(v) {
  const m = /^https:\/\/([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(:[0-9]{1,5})?\/?$/.exec(String(v == null ? "" : v).trim());
  return m ? "https://" + m[1].toLowerCase() + (m[2] || "") : null;
}

// --- ortam -------------------------------------------------------------------------------
// Eski etkin: pm2 ecosystem env'i surece dotenv'den ONCE verir -> ecosystem (bos olsa bile) .env'i ezer.
// Yeni etkin: konak sabitleri > .env > hizmet varsayilanlari (bos ya da yoksa).
function ortam(g) {
  const anahtarlar = [];
  const engeller = [];
  const uyarilar = [];
  const not = (ad, islem, aciklama) => anahtarlar.push({ ad, islem, not: aciklama || null });
  const kok = ileriBolu(g.kok);
  const eskiApp = ileriBolu(g.eskiApp);
  const varsayilan = hizmetVarsayilanlari(kok);

  const envBayt = fs.readFileSync(g.eskiEnv);
  const bom = envBayt.length >= 3 && envBayt[0] === 0xef && envBayt[1] === 0xbb && envBayt[2] === 0xbf;
  const envMetin = envBayt.toString("utf8").replace(/^﻿/, "");
  const dot = dotenvCozumle(envMetin);
  let eco = { ad: null, env: {}, bicimsiz: [] };
  if (g.eko) {
    try { eco = ecoYukle(g.eko); } catch (e) { engeller.push("ecosystem.config.js okunamadi: " + String(e && e.message || e).slice(0, 200)); }
  }
  for (const k of eco.bicimsiz) engeller.push("ecosystem env." + k + " dize/sayi/mantik degil - elle tasinmali");

  const eskiEtkin = Object.assign({}, dot, eco.env);
  const satirlar = satirlaraBol(envMetin);
  const eol = (satirlar.find((s) => s.son) || { son: "\r\n" }).son || "\r\n";
  const sonSatir = {};
  satirlar.forEach((s, i) => { const d = satirDeger(s.metin); if (d) sonSatir[d.k] = i; });

  // Cok satirli dotenv degeri (tirnak satir atlar): satir bazli okuma bunu gormez -> elle.
  const tekTek = {};
  for (const s of satirlar) { const d = satirDeger(s.metin); if (d) tekTek[d.k] = d.v; }
  for (const k of Object.keys(dot)) if (tekTek[k] !== dot[k]) engeller.push(k + ": cok satirli ya da satir bazinda farkli okunan deger - .env elle tek satira indirilmeli");

  const istenen = {};
  for (let i = 0; i < satirlar.length; i++) {
    const s = satirlar[i];
    const d = satirDeger(s.metin);
    // Okuyucunun yok saydigi satir (yorum, bicimsiz) ve tekrar eden anahtarin onceki satirlari AYNEN kalir:
    // iki surec de ayni okuyucu anlamini gorur, tekrar edende SONUNCUSU gecerli.
    if (!d) continue;
    const k = d.k;
    if (sonSatir[k] !== i) continue;
    let hedef = d.v;
    let islem = "KORUNDU";
    if (konakAnahtariMi(k)) {
      islem = "KONAK";
      const kv = KONAK_SABIT[k];
      if (kv !== undefined && eskiEtkin[k] !== kv) uyarilar.push(k + ": konak sabitler (" + kv + "), eski etkin deger farkliydi");
      else if (kv === undefined) uyarilar.push(k + ": konagin verdigi ortam adi - .env'deki satir etkisiz");
    } else if (Object.prototype.hasOwnProperty.call(eco.env, k) && eco.env[k] !== d.v) {
      hedef = eco.env[k];
      islem = "ECO_DEGER";
    }
    if (YOL_AYARLARI.includes(k) && hedef.trim() !== "" && !mutlakMi(hedef.trim())) {
      hedef = ileriBolu(path.posix.normalize(eskiApp + "/" + ileriBolu(hedef.trim())));
      islem = islem === "ECO_DEGER" ? "ECO_DEGER+MUTLAK" : "MUTLAK";
    }
    istenen[k] = hedef;
    // Yalniz degeri DEGISEN satir yeniden yazilir; digerleri bayt bayt korunur.
    if (hedef !== d.v) {
      const yeni = kanonikSatir(k, hedef);
      if (yeni === null) { engeller.push(k + ": deger okuyucunun ayni okuyacagi bicimde yazilamiyor (tirnak + ters bolu/satir sonu) - elle duzeltilmeli"); continue; }
      s.metin = yeni;
    }
    not(k, islem);
  }

  // ecosystem'de olup .env'de olmayanlar.
  const ekler = [];
  for (const [k, v] of Object.entries(eco.env)) {
    if (Object.prototype.hasOwnProperty.call(dot, k)) continue;
    if (konakAnahtariMi(k)) {
      const kv = KONAK_SABIT[k];
      if (kv !== undefined && v !== kv) uyarilar.push(k + ": ecosystem degeri konak sabitinden farkli; hizmette konak sabiti gecerli");
      not(k, "KONAK");
      continue;
    }
    if (k === "NODE_OPTIONS") { uyarilar.push("NODE_OPTIONS: konak siler (butunluk kurali) - hizmette uygulanmaz"); not(k, "KONAK_SILER"); continue; }
    if (k === "BACKUP_RCLONE_CONFIG" && v.trim() === "") { not(k, "VARSAYILAN_VERI", "rclone.conf veri\\ altina"); continue; }
    const esitVarsayilan = Object.prototype.hasOwnProperty.call(varsayilan, k) &&
      (YOL_AYARLARI.includes(k) ? ileriBolu(v).toLowerCase() === varsayilan[k].toLowerCase() : v === varsayilan[k]);
    if (esitVarsayilan) { not(k, "VARSAYILAN"); continue; }
    if (Object.prototype.hasOwnProperty.call(varsayilan, k) && v.trim() === "") {
      uyarilar.push(k + ": eski duzende bos (kod varsayilani); hizmet duzeninde varsayilan " + varsayilan[k]);
      not(k, "VARSAYILAN", "eski bos");
      continue;
    }
    let hedef = v;
    if (YOL_AYARLARI.includes(k) && v.trim() !== "" && !mutlakMi(v.trim())) hedef = ileriBolu(path.posix.normalize(eskiApp + "/" + ileriBolu(v.trim())));
    const satir = kanonikSatir(k, hedef);
    if (satir === null) { engeller.push(k + ": ecosystem degeri .env'e okuyucunun ayni okuyacagi bicimde yazilamiyor - elle"); continue; }
    ekler.push(satir);
    istenen[k] = hedef;
    not(k, hedef === v ? "ECO_EKLENDI" : "ECO_EKLENDI+MUTLAK");
  }

  // Kanal satirlari (gecis.ps1 kanal-adlari.ps1 + PAKET.json'dan verir; DEGERLER .env'den basilmaz):
  //   guncellemeDizini {yol, yaz}: ikinci kanalin backend'i guncelleyicinin veri kokunu gormeli (setup ile ayni satir).
  //   lisans {beklenen, varsayilan, yaz}: etkin LICENSE_SERVER_URL kanal kaydina karsi; yaz = yapilandirma\.env'e kanal degeri.
  const izinliFark = new Set();
  const kanalEkler = [];
  if (g.guncellemeDizini && g.guncellemeDizini.yol) {
    const bek = ileriBolu(String(g.guncellemeDizini.yol));
    const var0 = eskiEtkin.TEKSERP_GUNCELLEME_DIZINI;
    if (var0 !== undefined && String(var0).trim() !== "") {
      if (ileriBolu(String(var0).trim()).toLowerCase() !== bek.toLowerCase()) engeller.push("TEKSERP_GUNCELLEME_DIZINI: eski yapilandirmadaki deger bu kanalin guncelleme dizini degil (beklenen " + bek + ") - backend ile guncelleyici farkli dizin gorurdu; satir elle duzeltilmeli");
    } else if (g.guncellemeDizini.yaz) {
      const satir = kanonikSatir("TEKSERP_GUNCELLEME_DIZINI", bek);
      if (satir === null) engeller.push("TEKSERP_GUNCELLEME_DIZINI: yol okuyucunun ayni okuyacagi bicimde yazilamiyor");
      else { kanalEkler.push(satir); istenen.TEKSERP_GUNCELLEME_DIZINI = bek; not("TEKSERP_GUNCELLEME_DIZINI", "KANAL_GUNCELLEME", "kanal veri koku"); }
    }
  }
  let lisans = null;
  if (g.lisans && g.lisans.beklenen) {
    const L = g.lisans;
    const beklenen = lisansKoken(L.beklenen);
    const varsayilanK = lisansKoken(L.varsayilan);
    const ham = Object.prototype.hasOwnProperty.call(eskiEtkin, "LICENSE_SERVER_URL") ? String(eskiEtkin.LICENSE_SERVER_URL).trim() : "";
    let kaynak = Object.prototype.hasOwnProperty.call(eco.env, "LICENSE_SERVER_URL") ? "ecosystem" : (Object.prototype.hasOwnProperty.call(dot, "LICENSE_SERVER_URL") ? ".env" : "varsayilan");
    let bulunan;
    if (ham === "") { bulunan = varsayilanK; kaynak = "varsayilan"; }
    else if (ham.toLowerCase() === "kapali") bulunan = "kapali";
    else bulunan = lisansKoken(ham);
    const durum = !beklenen || (kaynak === "varsayilan" && !varsayilanK) ? "OLCULEMEDI" : bulunan === "kapali" ? "KAPALI" : bulunan === beklenen ? "UYUMLU" : "UYUSMAZ";
    let yazilacak = false;
    if (L.yaz && beklenen && durum !== "UYUMLU" && durum !== "OLCULEMEDI") {
      const satir = "LICENSE_SERVER_URL=" + beklenen;
      if (sonSatir.LICENSE_SERVER_URL !== undefined) satirlar[sonSatir.LICENSE_SERVER_URL].metin = satir;
      else {
        const i = ekler.findIndex((x) => x.startsWith("LICENSE_SERVER_URL="));
        if (i >= 0) ekler[i] = satir; else kanalEkler.push(satir);
      }
      istenen.LICENSE_SERVER_URL = beklenen;
      izinliFark.add("LICENSE_SERVER_URL");
      not("LICENSE_SERVER_URL", "KANAL_LISANS", "kanal kaydindan");
      yazilacak = true;
    }
    lisans = { durum, beklenen, bulunan: bulunan || "(bicimsiz - deger basilmaz)", kaynak, yazilacak };
  }

  // Uygulama dizinini (app\) gosteren yollar: app\ gecisten sonra emekli.
  const appOnek = eskiApp.toLowerCase() + "/";
  for (const [k, v] of Object.entries(istenen)) {
    const n = ileriBolu(String(v)).toLowerCase();
    if (!n) continue;
    if (YOL_AYARLARI.includes(k) && (n === eskiApp.toLowerCase() || n.startsWith(appOnek))) engeller.push(k + ": uygulama dizinini (app\\) gosteriyor - gecisten sonra yok; .env'de kalici bir yola tasinmali");
    else if (/^[A-Za-z]:\//.test(n) && n.startsWith(appOnek)) uyarilar.push(k + ": app\\ altini gosteren deger (emekli olabilir)");
  }
  for (const emekli of ["WEB_DIST_DIR", "REMOTE_PORT", "CF_ACCESS_ENABLED", "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD"]) {
    if (Object.prototype.hasOwnProperty.call(istenen, emekli)) uyarilar.push(emekli + ": emekli anahtar (B6) - satir silinebilir");
  }

  // Birlesik metin.
  let govde = satirlar.map((s) => s.metin + s.son).join("");
  if (ekler.length) {
    if (govde.length && !/\r?\n$/.test(govde)) govde += eol;
    govde += "# --- gecis.ps1 " + String(g.damga || "") + ": pm2 ecosystem.config.js env blogundan (hizmet duzeninde pm2 yok) ---" + eol;
    govde += ekler.map((x) => x + eol).join("");
  }
  if (kanalEkler.length) {
    if (govde.length && !/\r?\n$/.test(govde)) govde += eol;
    govde += "# --- gecis.ps1 " + String(g.damga || "") + ": kanal kaydindan (hizmet/kanal-adlari.ps1 + paket kimligi) ---" + eol;
    govde += kanalEkler.map((x) => x + eol).join("");
  }
  // Denetim: istenen degerler birlesik dosyada (okuyucunun gozunden) etkin olmali.
  const dotYeni = dotenvCozumle(govde);
  for (const [k, v] of Object.entries(istenen)) if (dotYeni[k] !== v) engeller.push(k + ": birlesik dosyada istenen deger etkin degil (ic hata)");

  // Etkin ayar karsilastirmasi (anahtar adi). Izinli farklar: konak sabitleri, rclone.conf -> veri\, mutlaklastirma.
  const yeniEtkin = Object.assign({}, dotYeni);
  for (const [k, v] of Object.entries(varsayilan)) if ((yeniEtkin[k] || "").trim() === "") yeniEtkin[k] = v;
  for (const [k, v] of Object.entries(KONAK_SABIT)) yeniEtkin[k] = v;
  const etkinFark = [];
  const coz = (k, v) => {
    const s = String(v === undefined ? "" : v);
    if (YOL_AYARLARI.includes(k) && s.trim() !== "" && !mutlakMi(s.trim())) return ileriBolu(path.posix.normalize(eskiApp + "/" + ileriBolu(s.trim()))).toLowerCase();
    return YOL_AYARLARI.includes(k) ? ileriBolu(s.trim()).toLowerCase() : s;
  };
  for (const k of new Set([...Object.keys(eskiEtkin), ...Object.keys(yeniEtkin)])) {
    if (konakAnahtariMi(k) || k === "NODE_OPTIONS") continue;
    const e = eskiEtkin[k];
    const y = yeniEtkin[k];
    if (k === "BACKUP_RCLONE_CONFIG" && (e === undefined || e.trim() === "")) continue;
    if ((e === undefined || e.trim() === "") && Object.prototype.hasOwnProperty.call(varsayilan, k)) continue;
    if (izinliFark.has(k)) continue;
    if (coz(k, e) !== coz(k, y)) etkinFark.push(k);
  }
  if (etkinFark.length) engeller.push("etkin ayar degisirdi: " + etkinFark.join(", "));

  // rclone.conf: eski duzende BACKUP_RCLONE_CONFIG bossa backend <BACKUP_DIR>/../rclone.conf kullanirdi.
  let rclone = null;
  if ((eskiEtkin.BACKUP_RCLONE_CONFIG || "").trim() === "") {
    const yedekDizini = (eskiEtkin.BACKUP_DIR || "").trim() !== "" ? ileriBolu(eskiEtkin.BACKUP_DIR.trim()) : kokAlti(kok, "backups");
    const eskiYol = ileriBolu(path.posix.normalize(path.posix.dirname(yedekDizini) + "/rclone.conf"));
    rclone = { eskiYol, yeniYol: varsayilan.BACKUP_RCLONE_CONFIG };
  }

  const portHam = (yeniEtkin.PORT || "").trim();
  const port = /^\d{1,5}$/.test(portHam) ? Number(portHam) : (portHam === "" ? 4000 : null);
  if (port === null) engeller.push("PORT sayi degil");

  // pm2 baslatma ortamindan gelen (dosyada olmayan) uygulama ayarlari: hizmette OLMAYACAK.
  const pm2OrtamFarki = [];
  if (Array.isArray(g.pm2Anahtarlar)) {
    const makine = new Set((g.makineAnahtarlari || []).map((x) => String(x).toUpperCase()));
    const ilgili = /^(DATABASE_|JWT_|BACKUP_|LICENSE_|PG_|PGDATA|MOBILE_|DISCOVERY_|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|NODE_EXTRA_CA|RATE_LIMIT|CLIENT_IP|CLOUD_|PATRON_|APP_|PORT$|HOST$)/i;
    for (const k of g.pm2Anahtarlar) {
      const s = String(k);
      if (!ilgili.test(s) || makine.has(s.toUpperCase()) || Object.prototype.hasOwnProperty.call(eco.env, s) || Object.prototype.hasOwnProperty.call(dot, s)) continue;
      pm2OrtamFarki.push(s);
    }
  }
  if (pm2OrtamFarki.length) uyarilar.push("calisan pm2 surecinin baslatma ortaminda olup dosyalarda olmayan ayar (hizmette OLMAYACAK): " + pm2OrtamFarki.join(", "));

  let yazildi = false;
  if (g.cikti && !engeller.length) {
    const gecici = g.cikti + ".yaziliyor";
    fs.writeFileSync(gecici, Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(govde, "utf8")]));
    fs.renameSync(gecici, g.cikti);
    yazildi = true;
  }
  return {
    karar: engeller.length ? "ENGEL" : "TAMAM",
    anahtarlar, engeller, uyarilar, yazildi, rclone, port, lisans,
    ecoAd: eco.ad, ecoAnahtarSayisi: Object.keys(eco.env).length, envAnahtarSayisi: Object.keys(dot).length,
    ozet: anahtarlar.reduce((o, a) => { o[a.islem] = (o[a.islem] || 0) + 1; return o; }, {}),
  };
}

// --- pm2 -----------------------------------------------------------------------------------
function jlistCoz(metin) {
  const satirlar = String(metin).replace(/^﻿/, "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (let i = satirlar.length - 1; i >= 0; i--) {
    if (satirlar[i][0] !== "[") continue;
    try { const v = JSON.parse(satirlar[i]); if (Array.isArray(v)) return v; } catch (e) { /* pm2 log satiri */ }
  }
  return null;
}
function yolDuz(y) { return String(y || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase(); }
function pm2(g) {
  const l = jlistCoz(g.jlist);
  if (l === null) return { karar: "OLCULEMEDI", neden: "pm2 listesi (pm2 jlist) okunamadi" };
  const app = yolDuz(g.app);
  const ozet = (u) => {
    const e = (u && u.pm2_env) || {};
    const env = e.env && typeof e.env === "object" ? e.env : {};
    const port = String(env.PORT || e.PORT || "");
    return {
      ad: String((u && u.name) || ""), durum: String(e.status || "?"), pid: Number(u && u.pid) || 0,
      cwd: String(e.pm_cwd || ""), betik: String(e.pm_exec_path || ""), port: /^\d+$/.test(port) ? port : "",
      yorumlayici: String(e.exec_interpreter || ""), modul: e.pmx_module === true,
      ortamAnahtarlari: Object.keys(env).concat(Object.keys(e).filter((k) => /^[A-Z][A-Z0-9_]*$/.test(k))),
    };
  };
  const hepsi = l.map(ozet);
  const moduller = hepsi.filter((x) => x.modul);
  const uygulamalar = hepsi.filter((x) => !x.modul);
  const backendMi = (x) => /(^|[\\/])dist[\\/]server\.js$/i.test(x.betik) || /^tekserp-backend/i.test(x.ad);
  const bizim = uygulamalar.filter((x) => backendMi(x) && app !== "" && yolDuz(x.cwd) === app);
  const digerTeks = uygulamalar.filter((x) => backendMi(x) && !bizim.includes(x));
  const digerleri = uygulamalar.filter((x) => !backendMi(x));
  const sade = (x) => ({ ad: x.ad, durum: x.durum, pid: x.pid, port: x.port, cwd: x.cwd, betik: x.betik, yorumlayici: x.yorumlayici });
  const sonuc = {
    bizim: bizim.length === 1 ? sade(bizim[0]) : null,
    pm2Anahtarlar: bizim.length === 1 ? [...new Set(bizim[0].ortamAnahtarlari)] : [],
    moduller: moduller.map((x) => x.ad), digerTeksErp: digerTeks.map(sade), digerleri: digerleri.map((x) => ({ ad: x.ad, durum: x.durum, cwd: x.cwd })),
  };
  if (bizim.length > 1) return Object.assign(sonuc, { karar: "ENGEL", neden: "bu kokun backend'i pm2'de " + bizim.length + " kez kayitli (" + bizim.map((x) => x.ad).join(", ") + ")" });
  if (digerTeks.length) return Object.assign(sonuc, { karar: "ENGEL", neden: "ayni pm2'de baska kokun TeksERP backend'i var (" + digerTeks.map((x) => x.ad + " @ " + (x.cwd || "?")).join(", ") + ") - acilis gorevi ve daemon ortak; once o kurulum cozulmeli" });
  if (digerleri.length) return Object.assign(sonuc, { karar: "ENGEL", neden: "pm2 TeksERP disi uygulama da yonetiyor (" + digerleri.map((x) => x.ad).join(", ") + ") - daemon kapatilamaz, acilis gorevi kapatilamaz; elle cozulmeli" });
  if (!bizim.length) return Object.assign(sonuc, { karar: "YOK", neden: "pm2'de bu kokun (" + g.app + ") backend'i kayitli degil" });
  if (g.ad && bizim[0].ad !== g.ad) return Object.assign(sonuc, { karar: "UYUMLU", neden: "pm2 adi '" + bizim[0].ad + "', paket kimligi '" + g.ad + "' (bilgi)" });
  return Object.assign(sonuc, { karar: "UYUMLU", neden: null });
}

// --- kira (yalniz gosterim) ----------------------------------------------------------------
function kira(g) {
  if (!g.yol || !fs.existsSync(g.yol)) return { var: false };
  try {
    const st = fs.lstatSync(g.yol);
    if (!st.isFile() || st.size > 64 * 1024) return { var: true, bicimli: false };
    const parca = fs.readFileSync(g.yol, "utf8").trim().split(".");
    if (parca.length !== 3) return { var: true, bicimli: false };
    const yuk = JSON.parse(Buffer.from(parca[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const gu = yuk && typeof yuk.guncelleme === "object" && yuk.guncelleme ? yuk.guncelleme : null;
    const kod = (s) => (typeof s === "string" && /^[A-Za-z0-9._:+-]{1,40}$/.test(s) ? s : null);
    return {
      var: true, bicimli: true,
      kanal: kod(yuk && yuk.kanal && yuk.kanal.kod),
      kanalBackend: kod(yuk && yuk.kanal && yuk.kanal.guncelSurumler && yuk.kanal.guncelSurumler.backend),
      bitis: kod(yuk && yuk.bitis),
      politika: gu ? kod(gu.kip) : "ALAN_YOK",
      hedefSurum: gu ? kod(gu.hedefSurum) : null,
      guncellemeDonuk: !!(yuk && yuk.yaptirim && yuk.yaptirim.guncellemeDonuk),
    };
  } catch (e) {
    return { var: true, bicimli: false };
  }
}

const KOMUTLAR = { ortam, pm2, kira };
module.exports = { dotenvCozumle, kanonikSatir, lisansKoken, hizmetVarsayilanlari, YOL_AYARLARI, KONAK_SABIT, ortam, pm2, kira, jlistCoz };

if (require.main === module) {
  const komut = process.argv[2];
  try {
    if (!Object.prototype.hasOwnProperty.call(KOMUTLAR, komut)) throw new Error("bilinmeyen komut: " + String(komut).slice(0, 20));
    const girdi = JSON.parse(fs.readFileSync(0, "utf8").replace(/^﻿/, "") || "{}");
    cik(KOMUTLAR[komut](girdi), 0);
  } catch (e) {
    cik({ karar: "HATA", hata: String(e && e.message || e).slice(0, 300) }, 3);
  }
}
