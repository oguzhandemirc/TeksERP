// Release imzasını prebuild'e bağlar: `android/` prebuild çıktısıdır (git dışı), elle düzenleme bir sonraki prebuild'de
// silinir ve release paket sessizce herkese açık debug mührüyle çıkardı. FAIL-CLOSED: release paketleyen görev
// istenip anahtar yolu/parolası ortamda yoksa Gradle durur. Anahtar ve parola scripts/lib/android-derleme.cjs düzeninden.
const { withAppBuildGradle } = require("@expo/config-plugins");
const { IMZA, ORTAM_DOSYA, ORTAM_PAROLA } = require("../scripts/lib/android-derleme.cjs");

const IMZA_BLOGU = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        // TeksERP Patron: release imzası — plugins/withPatronImza.js yazdı (anahtar repo dışında, parola ortamdan).
        release {
            def patronGorevler = gradle.startParameter.taskNames.collect { it.tokenize(':').last() }
            def patronRelease = patronGorevler.any { it ==~ /(?i)(assemble|bundle|install|package).*release.*/ }
            def patronDosya = System.getenv('${ORTAM_DOSYA}')
            def patronParola = System.getenv('${ORTAM_PAROLA}')
            if (patronDosya && patronParola) {
                storeFile file(patronDosya)
                storePassword patronParola
                keyAlias '${IMZA.alias}'
                keyPassword patronParola
            } else if (patronRelease) {
                throw new GradleException("TeksERP Patron: release paketi yalniz 'npm run build:aab' ile derlenir (yukleme anahtari + Anahtar Zinciri parolasi); debug muhrune dusulmez")
            }
        }
    }`;

/** `anahtar {` bloğunun tamamı (parantez sayarak; iç içe blokta tembel regex yarım keser). */
function blokBul(icerik, anahtar, baslangic = 0) {
  const bas = icerik.indexOf(anahtar, baslangic);
  if (bas < 0) return null;
  const acilis = icerik.indexOf("{", bas);
  let derinlik = 0;
  for (let i = acilis; i < icerik.length; i++) {
    if (icerik[i] === "{") derinlik++;
    else if (icerik[i] === "}" && --derinlik === 0) return { bas, son: i + 1 };
  }
  return null;
}

/** app/build.gradle metnine imzayı uygular (saf, idempotent; tanınmayan şablonda hata — sessiz atlama yok). */
function gradleImzala(girdi) {
  const blok = blokBul(girdi, "signingConfigs");
  if (!blok) throw new Error("withPatronImza: app/build.gradle içinde `signingConfigs` yok — Expo şablonu değişmiş, eklenti güncellenmeli");
  const girintiBas = girdi.lastIndexOf("\n", blok.bas) + 1;
  let gradle = girdi.slice(0, girintiBas) + IMZA_BLOGU + girdi.slice(blok.son);
  const tipler = blokBul(gradle, "buildTypes");
  if (!tipler) throw new Error("withPatronImza: `buildTypes` yok");
  const govde = gradle.slice(tipler.bas, tipler.son);
  const rel = blokBul(govde, "release");
  if (!rel) throw new Error("withPatronImza: release buildType yok");
  const relGovde = govde.slice(rel.bas, rel.son);
  if (relGovde.includes("signingConfig signingConfigs.release")) return gradle;
  if (!relGovde.includes("signingConfig signingConfigs.debug")) throw new Error("withPatronImza: release buildType'ta beklenen imza satırı yok — şablon tanınmıyor");
  const yeniGovde = govde.slice(0, rel.bas) + relGovde.replace("signingConfig signingConfigs.debug", "signingConfig signingConfigs.release") + govde.slice(rel.son);
  return gradle.slice(0, tipler.bas) + yeniGovde + gradle.slice(tipler.son);
}

module.exports = function withPatronImza(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = gradleImzala(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.gradleImzala = gradleImzala;
