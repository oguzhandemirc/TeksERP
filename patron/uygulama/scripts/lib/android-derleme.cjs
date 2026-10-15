// Patron Android derlemesi — TEK KAYNAK (Gradle eklentisi + build-aab + anahtar-uret): bulut adresi ve YÜKLEME anahtarı.
// Telefonda sayfa kökeni yoktur (src/lib/config.ts): adres derlemeye açıkça gömülür; tek bulut, müşteri kimliği değil.
// Anahtar repo DIŞINDA (~/.tekserp/patron-android/yukleme/, dizin 700 · dosya 600); parola macOS Anahtar Zinciri `tekserp/patron-play-yukleme`
// (scripts/lib/parola-kasasi.mjs) ve yalnız Gradle/keytool alt sürecine ortamla verilir — diske, argv'ye, çıktıya girmez.
const os = require("node:os");
const path = require("node:path");

const PATRON_API = "https://patron.etkiliyazilim.com";
const KOK_DIZIN = path.join(os.homedir(), ".tekserp", "patron-android");
const IMZA = Object.freeze({
  dizin: path.join(KOK_DIZIN, "yukleme"),
  storeFile: "tekserp-patron-yukleme.keystore",
  alias: "tekserp-patron-yukleme",
  cn: "TeksERP Patron Play Yukleme",
  kasa: "patron-play-yukleme",
});
const CIKTI_DIZINI = path.join(KOK_DIZIN, "cikti");
/** Gradle'a ortamla giden anahtar dosyası yolu ve parola (değer yalnız alt süreç ortamında). */
const ORTAM_DOSYA = "TEKSERP_PATRON_IMZA_DOSYASI";
const ORTAM_PAROLA = "TEKSERP_PATRON_IMZA_PAROLASI";

module.exports = { PATRON_API, KOK_DIZIN, IMZA, CIKTI_DIZINI, ORTAM_DOSYA, ORTAM_PAROLA };
