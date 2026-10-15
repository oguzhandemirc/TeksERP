// Patron Android derlemesi — TEK KAYNAK (Gradle eklentisi + build-aab + anahtar-uret): bulut adresi ve YÜKLEME anahtarı.
// Telefonda sayfa kökeni yoktur (src/lib/config.ts): adres derlemeye açıkça gömülür; tek bulut, müşteri kimliği değil.
// Anahtar repo DIŞINDA (~/.tekserp/patron-android/yukleme/, dizin 700 · dosya 600); parola macOS Anahtar Zinciri `tekserp/patron-play-yukleme`
// (scripts/lib/parola-kasasi.mjs) ve yalnız Gradle/keytool alt sürecine ortamla verilir — diske, argv'ye, çıktıya girmez.
const os = require("node:os");
const path = require("node:path");

// Birincil ad yonetim (2026-10-16); patron.etkiliyazilim.com kalıcı takma addır (kurulu fabrikalar), uygulama onu taşımaz.
const PATRON_API = "https://yonetim.etkiliyazilim.com";
/** Mağaza paketinin görünen adı ve dosya adı öneki (app.json `expo.name` ile aynı olmalı; build-aab ölçer). */
const GORUNEN_AD = "TeksERP Yönetim";
const CIKTI_ONEKI = "tekserp-yonetim";
const KOK_DIZIN = path.join(os.homedir(), ".tekserp", "patron-android");
const IMZA = Object.freeze({
  dizin: path.join(KOK_DIZIN, "yukleme"),
  storeFile: "tekserp-patron-yukleme.keystore",
  alias: "tekserp-patron-yukleme",
  cn: "TeksERP Patron Play Yukleme", // var olan yükleme sertifikasının DN'i — anahtar AYNI kalır, değişmez
  kasa: "patron-play-yukleme",
});
const CIKTI_DIZINI = path.join(KOK_DIZIN, "cikti");
/** Gradle'a ortamla giden anahtar dosyası yolu ve parola (değer yalnız alt süreç ortamında). */
const ORTAM_DOSYA = "TEKSERP_PATRON_IMZA_DOSYASI";
const ORTAM_PAROLA = "TEKSERP_PATRON_IMZA_PAROLASI";

module.exports = { PATRON_API, GORUNEN_AD, CIKTI_ONEKI, KOK_DIZIN, IMZA, CIKTI_DIZINI, ORTAM_DOSYA, ORTAM_PAROLA };
