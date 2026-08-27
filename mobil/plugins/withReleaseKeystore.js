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
// ⚠️ FAIL-CLOSED: `keystore/keystore.properties` yoksa release derlemesi
// AÇIK BİR HATAYLA DURUR. Deneme mührüne sessizce düşmek en kötü sonuçtur —
// ortaya çıkan APK çalışır ve fark yalnız sahada, kurulum reddedilince anlaşılır.
//
// ⚠️ İDEMPOTENT OLMAK ZORUNDA (2026-08-26'da ısırdı): `prebuild` mevcut
// `android/` klasörünü KORUYARAK yeniden koşulabilir; ikinci koşumda dosya
// zaten bizim yapılandırmamızı taşır. "Beklediğim satırı bulamadım → hata"
// mantığı o durumda prebuild'i düşürür. Ayrım nettir: ZATEN UYGULANMIŞ olmak
// başarıdır, BEKLENMEYEN bir şablon bulmak hatadır.
//
// Mühür dosyası ve şifresi repoda DEĞİL (`keystore/` gitignore'da). Kaybı
// telafi edilemez; yedeği şifreyle birlikte repo dışında tutulur.
// =============================================================================

const { withAppBuildGradle } = require('@expo/config-plugins');

/** Yapılandırmanın bizim tarafımızdan yazıldığını gösteren imza. */
const MARKER = 'tekserpProps';

const IMZA_BLOGU = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        // TeksERP: RELEASE mührü — plugins/withReleaseKeystore.js yazdı.
        // Kimlik bilgileri repo DIŞINDA: <proje>/keystore/keystore.properties
        release {
            def ${MARKER} = new Properties()
            def tekserpFile = rootProject.file('../keystore/keystore.properties')
            if (!tekserpFile.exists()) {
                throw new GradleException(
                    "TeksERP RELEASE muhru bulunamadi: " + tekserpFile.absolutePath + "\\n" +
                    "Bu dosya olmadan release APK deneme muhruyle imzalanirdi ve sahadaki\\n" +
                    "tabletlere KURULAMAZDI. Muhru yedekten geri koyun."
                )
            }
            tekserpFile.withInputStream { ${MARKER}.load(it) }
            storeFile file('../../keystore/' + ${MARKER}['storeFile'])
            storePassword ${MARKER}['storePassword']
            keyAlias ${MARKER}['keyAlias']
            keyPassword ${MARKER}['keyPassword']
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

module.exports = function withReleaseKeystore(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;

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
      cfg.modResults.contents = gradle;
      return cfg;
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

    cfg.modResults.contents =
      gradle.slice(0, buildTypes.bas) + yeniGovde + gradle.slice(buildTypes.son);
    return cfg;
  });
};
