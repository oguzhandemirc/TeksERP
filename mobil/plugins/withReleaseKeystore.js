// =============================================================================
// TeksERP Mobil — RELEASE imzasını (mühür) prebuild'e kalıcı bağlayan eklenti
// =============================================================================
// ⚠️ NEDEN EKLENTİ, NEDEN ELLE DÜZENLEME DEĞİL:
// `android/` git dışıdır ve `expo prebuild` ÇIKTISIDIR. `app/build.gradle`
// elle düzenlenseydi, bir sonraki prebuild imza yapılandırmasını SESSİZCE
// silerdi ve derleme yine "başarılı" olurdu — yalnız APK bu kez Android'in
// HERKESE AÇIK deneme mührüyle imzalanmış olurdu. O APK sahadaki tabletlere
// kurulmaz (imza uyuşmazlığı) ve tek çözüm uygulamayı silip yeniden kurmak,
// yani cihaz eşleşmesi + kayıtlı adres + bekleyen kayıtların kaybı olurdu.
// Aynı sınıf tuzak `usesCleartextTraffic`te 2026-08-15'te yaşandı.
//
// ⚠️ İKİ ANAHTAR, GÖREVDEN SEÇİLİR (K-14): `bundle*Release` (AAB, Google Play) → `keystore/play-yukleme/`,
// diğer release görevleri (yerel deneme APK'sı) → `keystore/deneme/`. Dizinler `scripts/lib/imza-anahtari.cjs`ten;
// `keystore/` kökündeki eski kanal mührü HİÇBİR görevde okunmaz. AAB ile APK aynı komutta istenirse DURUR.
// ⚠️ FAIL-CLOSED: seçilen anahtar yoksa release görevi AÇIK BİR HATAYLA DURUR — deneme (debug) mührüne
// sessizce düşmek en kötü sonuçtur. Paketleyen release görevi (assemble/bundle/install/package) istenmiyorsa
// (debug, clean, manifest birleştirme) eksik anahtar durdurmaz; imzası eksik release paketini AGP zaten reddeder.
//
// ⚠️ İDEMPOTENT OLMAK ZORUNDA (2026-08-26'da ısırdı): `prebuild` mevcut
// `android/` klasörünü KORUYARAK yeniden koşulabilir; ikinci koşumda dosya
// zaten bizim yapılandırmamızı taşır. "Beklediğim satırı bulamadım → hata"
// mantığı o durumda prebuild'i düşürür. Ayrım nettir: ZATEN UYGULANMIŞ olmak
// başarıdır, BEKLENMEYEN bir şablon bulmak hatadır.
//
// Anahtar dosyaları ve şifreleri repoda DEĞİL (`keystore/` gitignore'da); burada üretilmez.
// =============================================================================

const { withAppBuildGradle } = require('@expo/config-plugins');
const { IMZA_ANAHTARLARI } = require('../scripts/lib/imza-anahtari.cjs');

/** Yapılandırmanın bizim tarafımızdan yazıldığını gösteren imza. */
const MARKER = 'tekserpProps';
const PLAY_DIZINI = IMZA_ANAHTARLARI['play-yukleme'].dizin.replace(/^keystore\//, '');
const DENEME_DIZINI = IMZA_ANAHTARLARI.deneme.dizin.replace(/^keystore\//, '');

const IMZA_BLOGU = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        // TeksERP: RELEASE imzası — plugins/withReleaseKeystore.js yazdı (K-14).
        // bundle*Release → keystore/${PLAY_DIZINI}/ · diğer release görevleri → keystore/${DENEME_DIZINI}/
        release {
            def tekserpGorevler = gradle.startParameter.taskNames.collect { it.tokenize(':').last() }
            def tekserpRelease = tekserpGorevler.findAll { it ==~ /(?i)(assemble|bundle|install|package).*release.*/ }
            def tekserpPlay = tekserpRelease.any { it.startsWith('bundle') }
            if (tekserpPlay && tekserpRelease.any { !it.startsWith('bundle') }) {
                throw new GradleException("TeksERP: AAB (Play) ve yerel APK ayni komutta derlenmez: " + tekserpRelease)
            }
            def tekserpDizin = tekserpPlay ? '${PLAY_DIZINI}' : '${DENEME_DIZINI}'
            def ${MARKER} = new Properties()
            def tekserpFile = rootProject.file('../keystore/' + tekserpDizin + '/keystore.properties')
            if (tekserpFile.exists()) {
                tekserpFile.withInputStream { ${MARKER}.load(it) }
                def tekserpStore = String.valueOf(${MARKER}['storeFile'] ?: '')
                if (!tekserpStore || tekserpStore.contains('/') || tekserpStore.contains('\\\\') || tekserpStore.contains('..')) {
                    throw new GradleException("TeksERP: storeFile kendi dizininde olmali (keystore/" + tekserpDizin + "/): " + tekserpStore)
                }
                storeFile file('../../keystore/' + tekserpDizin + '/' + tekserpStore)
                storePassword ${MARKER}['storePassword']
                keyAlias ${MARKER}['keyAlias']
                keyPassword ${MARKER}['keyPassword']
            } else if (!tekserpRelease.isEmpty()) {
                throw new GradleException(
                    "TeksERP imza anahtari bulunamadi: " + tekserpFile.absolutePath + "\\n" +
                    "Release paketi deneme muhruyle imzalanmaz. Anahtari yedekten geri koyun ya da\\n" +
                    "anahtar toreninde uretin (npm run build:apk / build:aab komutu yolu basar)."
                )
            }
        }
    }`;

/**
 * `anahtar {` ile başlayan bloğun TAMAMINI parantez sayarak bulur.
 *
 * ⚠️ Regex ile yapılmıyor: `signingConfigs { debug { … } release { … } }`
 * iç içe bloklar taşır ve tembel bir regex ilk İÇ bloğun kapanışında durur —
 * blok yarım değiştirilir, dosya sessizce bozulur.
 */
function blokBul(icerik, anahtar) {
  const bas = icerik.indexOf(anahtar);
  if (bas < 0) return null;
  const acilis = icerik.indexOf('{', bas);
  if (acilis < 0) return null;
  let derinlik = 0;
  for (let i = acilis; i < icerik.length; i++) {
    if (icerik[i] === '{') derinlik++;
    else if (icerik[i] === '}') {
      derinlik--;
      if (derinlik === 0) return { bas, son: i + 1 };
    }
  }
  return null;
}

/** app/build.gradle metnine imza yapılandırmasını uygular (saf; bekçi `play-dagitim.guard.test.ts` doğrudan çağırır). */
function gradleImzala(girdi) {
  let gradle = girdi;

  // (1) signingConfigs bloğu — bizimkiyle değiştir (idempotent: yeniden yazar).
  const blok = blokBul(gradle, 'signingConfigs');
  if (!blok) {
    throw new Error(
      'withReleaseKeystore: app/build.gradle içinde `signingConfigs` bloğu bulunamadı. ' +
        'Expo şablonu değişmiş olabilir — eklenti güncellenmeli. Sessizce atlamak, ' +
        'deneme mührüyle imzalanmış bir release APK üretirdi.',
    );
  }
  // Bloğun başındaki girintiyi koru.
  const girintiBas = gradle.lastIndexOf('\n', blok.bas) + 1;
  gradle = gradle.slice(0, girintiBas) + IMZA_BLOGU + gradle.slice(blok.son);

  // (2) release buildType'ı release mührüne bağla.
  const buildTypes = blokBul(gradle, 'buildTypes');
  if (!buildTypes) {
    throw new Error('withReleaseKeystore: `buildTypes` bloğu bulunamadı.');
  }
  const govde = gradle.slice(buildTypes.bas, buildTypes.son);

  if (govde.includes('signingConfig signingConfigs.release')) {
    // ZATEN UYGULANMIŞ — ikinci prebuild koşumu. Hata değil.
    return gradle;
  }
  if (!govde.includes('signingConfig signingConfigs.debug')) {
    throw new Error(
      'withReleaseKeystore: buildTypes içinde ne `signingConfigs.release` ne de ' +
        '`signingConfigs.debug` var. Şablon tanınmıyor — eklenti sessizce atlarsa ' +
        'APK imzasız/yanlış mühürle çıkar.',
    );
  }
  // release bloğu içindeki debug referansını değiştir (debug buildType'ınki kalır).
  const releaseBlok = blokBul(govde, 'release');
  if (!releaseBlok) throw new Error('withReleaseKeystore: `release` buildType bulunamadı.');
  const yeniRelease = govde
    .slice(releaseBlok.bas, releaseBlok.son)
    .replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.release');
  const yeniGovde =
    govde.slice(0, releaseBlok.bas) + yeniRelease + govde.slice(releaseBlok.son);

  return gradle.slice(0, buildTypes.bas) + yeniGovde + gradle.slice(buildTypes.son);
}

module.exports = function withReleaseKeystore(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = gradleImzala(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.gradleImzala = gradleImzala;
