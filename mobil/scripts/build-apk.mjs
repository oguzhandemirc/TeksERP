#!/usr/bin/env node
/**
 * TeksERP Mobil — release derleyicisi (TEK GİRİŞ NOKTASI): Google Play AAB'si ve yerel deneme APK'sı.
 *
 * K-14: ortak tablet YALNIZ Google Play gizli yayınıyla dağıtılır. `--aab` Play'e yüklenecek paketi Play
 * YÜKLEME anahtarıyla (`keystore/play-yukleme/`) üretir; argümansız derleme yalnız yerel deneme APK'sıdır
 * (emülatör, prova), TEST anahtarıyla (`keystore/deneme/`) imzalanır ve sahaya/fabrikaya DAĞITILMAZ.
 * Eski kanal mührü (`keystore/` kökü) hiçbir yolda okunmaz; anahtarlar burada üretilmez
 * (`scripts/lib/imza-anahtari.cjs` yalnız komutu basar).
 *
 * NEDEN BU SCRIPT VAR (2026-08-01 — iki kez ısırdı, ikisi de SESSİZ):
 *
 *  1) "Bayat adres" — deploy notunda yazan sunucu IP'si eskimişti (192.168.1.50)
 *     ama gerçek sunucu 192.168.1.250 idi. APK ölü adrese gömülü derlendi;
 *     hiçbir hata çıkmadı, tablet sahada "bağlanamıyor" dedi.
 *
 *  2) "Bayat bundle" — `EXPO_PUBLIC_API_URL` değişikliği Gradle'ın
 *     `createBundleReleaseJsAndAssets` görevini GEÇERSİZ KILMIYOR. Görevin
 *     girdileri JS kaynakları + gradle ayarlarıdır; ortam değişkeni girdi
 *     DEĞİL. Env'i değiştirip `assembleRelease` koşmak yetmiyor — Gradle
 *     görevi UP-TO-DATE sayıp eski bundle'ı yeniden paketliyor ve APK ESKİ
 *     adresi taşıyor (29 saniyede biten bir build tam olarak bunu yaşattı —
 *     bu katman SAHA RAPORUDUR, aşağıdaki Metro katmanı ise ÖLÇÜLDÜ).
 *
 *     Aynı tuzağın İKİNCİ katmanı: Metro'nun transform önbelleği
 *     (`os.tmpdir()/metro-cache`). Production'da `process.env.EXPO_PUBLIC_*`
 *     babel tarafından SABİT olarak koda gömülür
 *     (babel-preset-expo → inline-env-vars.js), ama Metro'nun önbellek
 *     anahtarında env değerleri YOKTUR (@expo/metro-config →
 *     metro-transform-worker.js `getCacheKey`: dosya listesi + transformer
 *     yapılandırması; env yok). Yani Gradle görevi yeniden koşsa bile Metro
 *     `src/constants/api.ts` için ESKİ adresi gömülü transform çıktısını
 *     önbellekten verir.
 *
 *     BU TEORİ DEĞİL — 2026-08-01'de ölçüldü (`expo export:embed`, aynı
 *     bayraklar, yalnız env değişti):
 *       · sıcak önbellek + env `…1.252` → bundle'da `…1.251` çıktı  (17,9 sn)
 *       · önbellek silindi + env `…1.252` → bundle'da `…1.252` çıktı (69,9 sn)
 *     Yani "hızlı biten build" = önbellekten gelen ESKİ adres. Bu yüzden
 *     metro-cache de siliniyor; bedeli ~1 dk, alternatifi ölü adresli APK.
 *
 *  3) Kaynak karmaşası — repodaki `.env.local` `localhost` diyor, dokümanlarda
 *     iki farklı IP dolaşıyordu. Bu script adresi KENDİSİ çözer ve Gradle'a
 *     ortam değişkeni olarak AÇIKÇA geçirir. @expo/env sistem ortamındaki
 *     değişkenin ÜSTÜNE YAZMAZ ("won't override existing environment
 *     variables"), dolayısıyla açıkça geçirilen değer tüm `.env*` dosyalarını
 *     yener — `.env.local`'daki localhost sessizce kazanamaz.
 *
 * SÖZLEŞME: bu script ya DOĞRU adresi taşıyan bir APK üretir ya da exit 1 ile
 * gürültülü biçimde durur. "Belki doğrudur" diye APK bırakmaz — doğrulama
 * başarısızsa üretilen dosya kanonik yolundan taşınır (aşağıya bkz.).
 *
 * TEK ORTAK PAKET (O7): kimlik dağıtım kaydından (`scripts/lib/ortak-kimlik.cjs`), ERP adresi GÖMÜLMEZ
 * (tablet sunucuyu çalışma anında bulur), güncelleme adresi grup-nötr Worker takma adı. Terfi bu derlemede
 * değil, grup yayınında (`deploy/mobil-grup-yayinla.mjs`). OTA sertifikası yoksa (anahtar töreni
 * yapılmadıysa) derleme DURUR ve üretim komutunu basar. Müşteri kodlu derleme (`--musteri`) emekli:
 * `eski-kanal-son` etiketi, docs/ops/ESKI-KANAL-ACIL.md.
 *
 * Kullanım:
 *   npm run build:aab                                       # Google Play AAB'si (yükleme anahtarı)
 *   npm run build:aab -- --verify-only=<aab>                # mevcut AAB'yi ortak kimliğe karşı denetle
 *   npm run build:apk                                       # yerel deneme APK'sı (test anahtarı; dağıtılmaz)
 *   npm run build:apk:check                                 # ön kontrol, derleme YOK
 *   npm run build:apk:verify                                # mevcut APK'yı ortak kimliğe karşı denetle
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ortakBundleAdresleri } from './lib/adres.mjs';
import { zipGirdisiOku } from './lib/zip.mjs';
import { ApkOlculemedi, apkKimligi, metaHaritasi, protoManifestOgeleri, sertifikaParmakIzi } from './lib/apk-kimlik.mjs';
import { ZINCIR_META, kokHatalari } from './lib/ota-zinciri.cjs';
import { otaTorenYonergesi, ortakKaydiOku, ortakKimlik, ortakYapilandirmaFarki } from './lib/ortak-kimlik.cjs';
import { IMZA_ANAHTARLARI, IMZA_PAROLA_ORTAMI, anahtarUretimKomutu, imzaAnahtariDenetimi } from './lib/imza-anahtari.cjs';
import { KasaHatasi, kasaIpucu, kasadanAl } from '../../scripts/lib/parola-kasasi.mjs';
import { PLAY_EN_DUSUK_HEDEF_SDK, YON_OZELLIGI } from './lib/buyuk-ekran.cjs';
import { NSC_ADI, agGuvenligiSorunlari, playManifestSorunlari } from './lib/play-manifest.cjs';
import { kayitHatalari, KAYIT_REL as DAGITIM_REL, turet } from '../../scripts/lib/dagitim.mjs';
import { apkKunyeYolu, derlemeKunyesiYaz, temizAgacDenetimi } from '../../scripts/lib/derleme-bagi.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');
const ANDROID_DIR = path.join(PROJECT_ROOT, 'android');
const APK_PATH = path.join(ANDROID_DIR, 'app/build/outputs/apk/release/app-release.apk');
const AAB_PATH = path.join(ANDROID_DIR, 'app/build/outputs/bundle/release/app-release.aab');
/** Play'in yasakladığı izin: uygulama kendi APK'sını kuramaz (K-14); paket bu izni taşırsa DUR. */
const YASAK_IZIN = 'android.permission.REQUEST_INSTALL_PACKAGES';
/** Release bundle'ın APK içindeki yolu — doğrulama bunu açar. */
const BUNDLE_ENTRY = 'assets/index.android.bundle';

/* ------------------------------------------------------------------ *
 * Konsol yardımcıları — operatör terminale bakıyor, mesajlar Türkçe.
 * ------------------------------------------------------------------ */

const BAR = '='.repeat(72);

function baslik(metin) {
  console.log(`\n${BAR}\n  ${metin}\n${BAR}`);
}

function bilgi(metin) {
  console.log(`  ${metin}`);
}

function uyari(metin) {
  console.log(`\n  ⚠  ${metin}\n`);
}

/** Gürültülü ölüm: çerçeveli Türkçe hata + exit 1. Sessiz başarısızlık YOK. */
function dur(baslikMetni, ...satirlar) {
  console.error(`\n${BAR}`);
  console.error(`  ✖ HATA — ${baslikMetni}`);
  console.error(BAR);
  for (const s of satirlar) console.error(`  ${s}`);
  console.error(`${BAR}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Argümanlar
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const arg = (ad) => {
  const esles = argv.find((a) => a === `--${ad}` || a.startsWith(`--${ad}=`));
  if (!esles) return undefined;
  const [, deger] = esles.split(/=(.*)/s);
  return deger ?? '';
};
const SADECE_KONTROL = argv.includes('--check');
const SADECE_DOGRULA = arg('verify-only') !== undefined;
/** Google Play AAB'si (bundleRelease + yükleme anahtarı); yoksa yerel deneme APK'sı (assembleRelease + test anahtarı). */
const AAB = argv.includes('--aab');
const IMZA_TURU = AAB ? 'play-yukleme' : 'deneme';
/** Sürüm kapısını bilinçli olarak geç (ASCII eşanlamlısı da kabul edilir). */
const SURUM_KAPISI_ATLA =
  argv.includes('--sürüm-farkını-biliyorum') || argv.includes('--surum-farkini-biliyorum');
/** Emekli eski kanal yolunun ortam değişkeni — ortamda görülürse derleme DURUR (bkz. ortakHedefCoz). */
const KANAL_ORTAM = 'TEKSERP_KANAL';
/** Emekli eski kanal argümanları — verilirse hiçbir şey yapılmadan DURUR. */
const EMEKLI_ARGUMANLAR = ['musteri', 'terfi-atla', 'yoklama-yok'];

/* ------------------------------------------------------------------ *
 * (f) Sürüm bilgisi
 * ------------------------------------------------------------------ */

function surumBilgisi() {
  let appJson = {};
  try {
    appJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8'))?.expo ?? {};
  } catch {
    /* app.json okunamazsa sürüm bilgisi eksik basılır, derlemeyi engellemez. */
  }
  let gradleVersionName = null;
  let gradleVersionCode = null;
  try {
    const gradle = fs.readFileSync(path.join(ANDROID_DIR, 'app/build.gradle'), 'utf8');
    gradleVersionName = /versionName\s+["']([^"']+)["']/.exec(gradle)?.[1] ?? null;
    gradleVersionCode = /versionCode\s+(\d+)/.exec(gradle)?.[1] ?? null;
  } catch {
    /* android/ yoksa aşağıdaki kontrol zaten durduruyor. */
  }
  return {
    appVersion: appJson.version ?? null,
    appVersionCode: appJson.android?.versionCode != null ? String(appJson.android.versionCode) : null,
    gradleVersionName,
    gradleVersionCode,
  };
}

function surumBas() {
  const s = surumBilgisi();
  baslik('SÜRÜM');
  bilgi(`APK'ya giren (android/app/build.gradle) : ${s.gradleVersionName ?? '?'} (versionCode ${s.gradleVersionCode ?? '?'})`);
  bilgi(`Expo yapılandırması (app.json)          : ${s.appVersion ?? '?'} (versionCode ${s.appVersionCode ?? '?'})`);
  // Sürüm kayması sessiz bir tuzaktır: deploy notuna app.json'daki sürümü
  // yazarsınız ama tablete gradle'daki sürüm kurulur.
  //
  // 2026-08-05: UYARI → FATAL. Gerekçe ölçülen bir veri kaybı yolu:
  // `android/` **git dışıdır** (`.gitignore`) ve `expo prebuild` çıktısıdır. Bu
  // makinede gradle 28 iken app.json 12 diyordu; paket BAŞKA bir makinede ya da
  // `prebuild --clean` sonrası derlenirse versionCode 28 → 12'ye DÜŞER. Android
  // downgrade kurulumunu reddeder (INSTALL_FAILED_VERSION_DOWNGRADE), operatör
  // "kaldır-kur" yapar ve AsyncStorage silinir — yani offline kuyruktaki GERÇEK
  // toplar yok olur. `PERSIST_BUSTER`'ı bump etmemeye gösterilen tüm özen tam
  // buradan by-pass edilirdi.
  if (
    s.gradleVersionName &&
    s.appVersion &&
    (s.gradleVersionName !== s.appVersion || s.gradleVersionCode !== s.appVersionCode)
  ) {
    if (SURUM_KAPISI_ATLA) {
      uyari(
        'SÜRÜM UYUŞMAZLIĞI — --sürüm-farkını-biliyorum ile GEÇİLDİ.\n' +
          "     Tablete kurulan sürüm GRADLE'dakidir; deploy notuna onu yaz.",
      );
    } else {
      dur(
        'SÜRÜM UYUŞMAZLIĞI (app.json ↔ android/app/build.gradle)',
        `app.json  : ${s.appVersion} (versionCode ${s.appVersionCode})`,
        `build.gradle: ${s.gradleVersionName} (versionCode ${s.gradleVersionCode})`,
        '',
        "Tablete kurulan sürüm GRADLE'dakidir. `android/` git dışıdır ve prebuild",
        'çıktısıdır → başka bir makinede derlenirse versionCode DÜŞEBİLİR.',
        'Android downgrade kurulumunu REDDEDER; operatör kaldır-kur yapar ve',
        'offline kuyruktaki gerçek toplar AsyncStorage ile birlikte SİLİNİR.',
        '',
        'Yapılacak: ikisini elle eşitle (ve yeni paket için ikisini de BUMP et).',
        'Bilinçli olarak geçmek istiyorsan: --sürüm-farkını-biliyorum',
      );
    }
  }
  return s;
}

/* ------------------------------------------------------------------ *
 * (f2) Sürüm notu kapısı — APK yolunun OTA ikizi
 * ------------------------------------------------------------------ */

/**
 * Not yazılmadan sürüm çıkmaz (kök CLAUDE.md). OTA yolu (o gün `yayinla-ota.mjs`) bu
 * kapıyı taşıyordu, APK yolu TAŞIMIYORDU (ölçüldü 2026-09-14, `docs/RECETELER.md`
 * boşluk listesi): native değişiklikle çıkan bir sürüm notsuz sahaya gidebiliyor,
 * eksiklik ancak bir sonraki OTA turunda görülüyordu.
 *
 * ⚠️ ÜÇ SONUÇ: yeşil · kırmızı · ÖLÇÜLEMEDİ (app.json'dan sürüm okunamadı).
 * Üçüncüsü de DURDURUR — sürümü okunamayan paket için "notu var" denemez ve
 * sessiz atlama bu kapıyı süse çevirirdi.
 *
 * ⚠️ DAİRESEL DEĞİL: beklenen sürüm app.json'dan OKUNUP bekçiye ARGÜMAN verilir;
 * not dosyası onu üretmez, yalnız doğrular (OTA yolundaki emsalin aynısı).
 */
function surumNotuKapisi(s) {
  baslik('SÜRÜM NOTU KAPISI');
  if (!s?.appVersion) {
    dur(
      'SÜRÜM NOTU KAPISI ÖLÇÜLEMEDİ',
      'app.json okunamadı ya da `expo.version` yok — hangi sürümün notunu arayacağımız belirsiz.',
      'Kapı sessizce atlanmaz: önce app.json sürümünü düzelt, sonra komutu tekrarla.',
    );
  }
  const bekci = path.join(PROJECT_ROOT, '..', 'scripts', 'check-surum-notlari.mjs');
  const r = spawnSync(process.execPath, [bekci, `--tablet=${s.appVersion}`], { stdio: 'inherit' });
  if (r.error) {
    dur('SÜRÜM NOTU KAPISI ÖLÇÜLEMEDİ', `Bekçi çalıştırılamadı: ${r.error.message}`, `Denenen: ${bekci}`);
  }
  if (r.status !== 0) {
    dur(
      'SÜRÜM NOTU KAPISI KIRMIZI',
      `${s.appVersion} için operatör notu yok ya da not kuralları ihlal edilmiş.`,
      "1) surum-notlari.json'a bu sürüm için kayıt ekle",
      '2) node scripts/surum-notlari-kopyala.mjs',
      '3) komutu tekrarla',
    );
  }
  bilgi(`Sürüm notu kapısı: ✔ ${s.appVersion} için operatör notu var`);
}

/* ------------------------------------------------------------------ *
 * (c) Bundle önbelleğini ZORLA temizle
 * ------------------------------------------------------------------ */

function sil(yol, aciklama) {
  if (!fs.existsSync(yol)) return false;
  fs.rmSync(yol, { recursive: true, force: true });
  bilgi(`silindi: ${aciklama}`);
  return true;
}

function onbellekleriTemizle() {
  baslik('(1/4) BUNDLE ÖNBELLEĞİ TEMİZLENİYOR');
  const appBuild = path.join(ANDROID_DIR, 'app/build');

  // Gradle bundle görevinin ÇIKTI dizinleri. Çıktı yoksa Gradle görevi
  // UP-TO-DATE sayamaz ve yeniden koşmak ZORUNDA kalır — env değişikliğinin
  // görevi geçersiz kılmamasının tek güvenilir panzehiri budur.
  sil(path.join(appBuild, 'generated/assets/createBundleReleaseJsAndAssets'), 'JS bundle çıktısı');
  sil(path.join(appBuild, 'generated/res/createBundleReleaseJsAndAssets'), 'bundle drawable çıktısı');
  sil(path.join(appBuild, 'generated/sourcemaps/react/release'), 'release source map');

  // Bundle'ı ileri taşıyan ara ürünler — bunlar kalırsa paketleme adımı eski
  // bundle'ı APK'ya yeniden koyabilir.
  sil(path.join(appBuild, 'intermediates/assets/release'), 'birleştirilmiş asset (release)');
  sil(path.join(appBuild, 'intermediates/compressed_assets/release'), 'sıkıştırılmış asset (release)');
  sil(path.join(appBuild, 'intermediates/merged_assets/release'), 'merged_assets (release)');

  // Metro transform önbelleği: production'da EXPO_PUBLIC_* değerleri koda
  // GÖMÜLÜR ama önbellek anahtarında env yoktur → eski adres önbellekten
  // geri gelebilir. 40-50 MB'lık bu dizini silmenin bedeli ~1 dk bundle
  // süresidir; yanlış adresli APK'nın bedeli bir saha günüdür.
  sil(path.join(os.tmpdir(), 'metro-cache'), 'Metro transform önbelleği (os tmp)');

  // Eski APK: derleme yarıda kalırsa operatör eski dosyayı yeni sanmasın.
  sil(APK_PATH, 'önceki release APK');
  sil(path.join(path.dirname(APK_PATH), 'output-metadata.json'), 'önceki output-metadata.json');
  sil(AAB_PATH, 'önceki release AAB');
}

/* ------------------------------------------------------------------ *
 * (d) assembleRelease
 * ------------------------------------------------------------------ */

function gradleKos(adres, gorev = 'assembleRelease') {
  const ortam = derlemeOrtami();
  baslik(`(2/4) DERLEME — ./gradlew ${gorev}`);
  bilgi(`Gömülecek adres: ${adres ?? '(YOK — ortak paket ERP adresi gömmez; .env* dosyaları okunmaz)'}`);
  bilgi('(Bu adım birkaç dakika sürer; önbellek silindiği için bundle sıfırdan üretilir.)\n');

  const win = process.platform === 'win32';
  const gradlew = path.join(ANDROID_DIR, win ? 'gradlew.bat' : 'gradlew');
  // WINDOWS: `.bat`/`.cmd` Node 20+ ile `shell` OLMADAN spawn EDİLEMEZ — spawnSync
  // `EINVAL` döner ve derleme daha başlamadan düşer (CVE-2024-27980 sonrası kapatılan
  // yol; Node 26'da da geçerli). 2026-08-15'te bu makinede birebir gözlendi ve APK'nın
  // neden hep Mac'te alındığının sebebiydi. macOS/Linux'ta `gradlew` düz bir betik,
  // shell GEREKMEZ ve açılması gereksiz bir ayrıştırma katmanı ekler → yalnız Windows.
  // ⚠️ shell:true komutu cmd'ye METİN olarak geçirir: yol TIRNAKLANMAK ZORUNDA, yoksa
  // boşluk içeren bir kurulum dizini ("C:\Program Files\...") sessizce bölünür.
  const komut = win ? `"${gradlew}"` : gradlew;
  // Play yükleme parolası yalnız BU alt sürecin ortamına gider (Anahtar Zinciri'nden); daemon'da kalmasın diye --no-daemon.
  const parola = imzaParolasi(IMZA_TURU);
  const env = derlemeEnv(adres, ortam);
  if (parola) env[IMZA_PAROLA_ORTAMI] = parola.toString('utf8');
  parola?.fill(0);
  const sonuc = spawnSync(komut, parola ? ['--no-daemon', gorev] : [gorev], {
    cwd: ANDROID_DIR,
    stdio: 'inherit',
    shell: win,
    // Adres AÇIKÇA çocuk sürece geçiyor: @expo/env sistem ortamındaki
    // değişkenin üstüne YAZMAZ, dolayısıyla `.env.local` bunu ezemez.
    // ⚠️ SDK ve JDK AÇIKÇA geçiyor: kabuk profilinde `export` olmasa da derleme
    // koşar. Kullanıcının `.zshrc`ine bağımlı bir derleme, yeni makinede ve
    // otomasyonda sessizce düşer.
    env,
  });
  delete env[IMZA_PAROLA_ORTAMI];

  if (sonuc.error) {
    dur('Gradle çalıştırılamadı', String(sonuc.error.message), `Denenen komut: ${gradlew} ${gorev}`);
  }
  if (sonuc.status !== 0) {
    dur(
      `Gradle derlemesi başarısız (exit ${sonuc.status})`,
      'Yukarıdaki Gradle çıktısında ilk "FAILURE"/"error:" satırına bak.',
      'Paket üretilmedi.',
    );
  }
}

/**
 * Gradle'ın ortamı. Ortak pakette (`adres` null) ERP adresi ortamdan SİLİNİR ve `EXPO_NO_DOTENV=1`
 * ile `.env*` dosyaları hiç yüklenmez — `.env.local`daki geliştirme adresi bundle'a inline olamaz.
 */
function derlemeEnv(adres, ortam) {
  const env = {
    ...process.env,
    EXPO_PUBLIC_API_URL: adres,
    ANDROID_HOME: ortam.sdk,
    ANDROID_SDK_ROOT: ortam.sdk,
    JAVA_HOME: ortam.jdk,
    PATH: `${path.join(ortam.jdk, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
  };
  if (adres === null) {
    delete env.EXPO_PUBLIC_API_URL;
    env.EXPO_NO_DOTENV = '1';
  }
  return env;
}

/* ------------------------------------------------------------------ *
 * (e) DERLEME SONRASI DOĞRULAMA — APK içindeki bundle'ı aç ve adresi ara
 * ------------------------------------------------------------------ */

// APK içinden tek girdi okuyucusu `./lib/zip.mjs`te (mobil-yayinla ile ortak).

/**
 * Doğrulama başarısızsa APK'yı kanonik yolundan taşı: deploy notları
 * `app-release.apk` yolunu gösteriyor, güvenilmeyen paket orada DURMAMALI.
 * Silmiyoruz — kanıt incelenebilsin.
 */
function apkyiReddet(apkYolu) {
  if (!fs.existsSync(apkYolu)) return null;
  const hedef = apkYolu.replace(/\.(apk|aab)$/i, '.DOGRULANMADI.$1');
  try {
    fs.rmSync(hedef, { force: true });
    fs.renameSync(apkYolu, hedef);
    return hedef;
  } catch {
    return null;
  }
}

/** APK'daki release bundle'ı okur (yok/eski/okunamaz → APK taşınır, DUR). Metin `latin1` (Hermes ASCII dizeleri). */
function bundleOku(apkYolu, derlemeBaslangici) {
  if (!fs.existsSync(apkYolu)) {
    dur('APK üretilmedi', `Beklenen yol: ${apkYolu}`, 'Gradle "BUILD SUCCESSFUL" dese bile paket yok — çıktıyı incele.');
  }

  const stat = fs.statSync(apkYolu);
  // Gradle paketleme adımını atlarsa dosya eski kalır. Önbellek temizliğinde
  // APK'yı sildiğimiz için buraya normalde düşülmez; yine de bekçi duruyor.
  if (derlemeBaslangici && stat.mtimeMs < derlemeBaslangici) {
    apkyiReddet(apkYolu);
    dur(
      'Üretilen APK bu derlemeden ESKİ',
      `APK zaman damgası : ${stat.mtime.toLocaleString('tr-TR')}`,
      'Gradle paketleme adımını atlamış olmalı — paket GÜVENİLMEZ.',
    );
  }

  // Okuma İSTİSNA atarsa da (bozuk arşiv, inflate hatası) sessiz geçmesin:
  // doğrulanamayan paket = güvenilmez paket.
  let veri;
  let hata;
  try {
    ({ veri, hata } = zipGirdisiOku(apkYolu, BUNDLE_ENTRY));
  } catch (e) {
    hata = String(e?.message ?? e);
  }
  if (hata || !veri) {
    apkyiReddet(apkYolu);
    dur('APK içindeki JS bundle okunamadı', hata ?? 'bilinmeyen sebep', `APK: ${apkYolu}`);
  }
  return { stat, veri };
}

/* ------------------------------------------------------------------ *
 * Akış
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Uzaktan güncelleme kapısı — AndroidManifest gerçekten yapılandırıldı mı?
 * ------------------------------------------------------------------ */

/**
 * ⚠️ NEDEN AYRI BİR KAPI: güncelleme adresi ve `runtimeVersion` APK'ya
 * `expo prebuild` sırasında AndroidManifest'e yazılır. Bu script prebuild
 * KOŞMAZ (`android/` zaten var kabul edilir), yani prebuild atlanırsa:
 *
 *   • `EXPO_UPDATE_URL` hiç yazılmaz → APK uzaktan güncelleme ALMAZ, ama
 *     her şey normal görünür. Sahaya bir daha ulaşamayacağınız bir paket
 *     kurmuş olursunuz ve bunu ancak ilk güncellemeyi göndermeye çalışınca
 *     anlarsınız.
 *   • Ya da manifest ESKİ adresi taşır → yeni sunucuya kurulan tabletler
 *     eski sunucudan güncelleme arar (sessiz).
 *
 * Bu, `usesCleartextTraffic`in 2026-08-15'te ısırdığı tuzağın birebir aynısı:
 * "prebuild çıktısı git dışıdır, elde kalan klasör doğru görünür".
 */
function prebuildKimligiOku() {
  const manifestYol = path.join(ANDROID_DIR, 'app/src/main/AndroidManifest.xml');
  let manifest;
  try {
    manifest = fs.readFileSync(manifestYol, 'utf8');
  } catch {
    dur('AndroidManifest.xml okunamadı', `Beklenen: ${manifestYol}`);
  }

  const oku = (ad) => {
    const re = new RegExp(
      `<meta-data[^>]*android:name="${ad.replace(/\./g, '\\.')}"[^>]*android:value="([^"]*)"`,
    );
    const m = re.exec(manifest);
    if (m) return m[1];
    // Öznitelik sırası ters de yazılabilir.
    const re2 = new RegExp(
      `<meta-data[^>]*android:value="([^"]*)"[^>]*android:name="${ad.replace(/\./g, '\\.')}"`,
    );
    return re2.exec(manifest)?.[1] ?? null;
  };

  // ⚠️ Manifest değeri LİTERAL OLMAYABİLİR: expo-updates `runtimeVersion`i
  // `@string/expo_runtime_version` kaynak referansı olarak yazar. Doğrudan
  // karşılaştırma yapan bir kapı burada HER ZAMAN kırmızı verir ve bir süre
  // sonra "bu kapı zaten hep bağırıyor" diye devre dışı bırakılır — yani
  // gerçek bir sapmada da susar. Referansı çöz.
  const stringKaynagiCoz = (deger) => {
    if (!deger || !deger.startsWith('@string/')) return deger;
    const ad = deger.slice('@string/'.length);
    try {
      const xml = fs.readFileSync(
        path.join(ANDROID_DIR, 'app/src/main/res/values/strings.xml'),
        'utf8',
      );
      const m = new RegExp(`<string name="${ad}"[^>]*>([^<]*)</string>`).exec(xml);
      return m ? m[1].trim() : deger;
    } catch {
      return deger;
    }
  };

  const url = stringKaynagiCoz(oku('expo.modules.updates.EXPO_UPDATE_URL'));
  const rv = stringKaynagiCoz(oku('expo.modules.updates.EXPO_RUNTIME_VERSION'));
  const acik = oku('expo.modules.updates.ENABLED');

  baslik('UZAKTAN GÜNCELLEME YAPILANDIRMASI');
  bilgi(`Manifest ENABLED        : ${acik ?? '(yok)'}`);
  bilgi(`Manifest EXPO_UPDATE_URL: ${url ?? '(yok)'}`);
  bilgi(`Manifest RUNTIME_VERSION: ${rv ?? '(yok)'}`);

  const sertifika = oku('expo.modules.updates.CODE_SIGNING_CERTIFICATE');
  const imzaMeta = oku('expo.modules.updates.CODE_SIGNING_METADATA');
  const zincir = oku(ZINCIR_META);
  bilgi(`Manifest KOD İMZASI     : ${sertifika ? 'sertifika gömülü' : '(YOK)'}`);
  bilgi(`Manifest OTA ZİNCİRİ    : ${zincir ?? '(yok)'}`);

  // Prebuild çıktısının KİMLİĞİ: paket adı + görünen ad + gömülü OTA sertifikası.
  // Kanal değişince `android/` yeniden üretilmeden derlenen APK eski kanalın kimliğiyle doğardı.
  const xmlCoz = (v) => String(v ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const dosyadan = (rel, desen) => {
    try {
      return desen.exec(fs.readFileSync(path.join(ANDROID_DIR, rel), 'utf8'))?.[1] ?? null;
    } catch {
      return null;
    }
  };
  const paket = dosyadan('app/build.gradle', /applicationId\s+['"]([^'"]+)['"]/);
  const uygulamaAdi = dosyadan('app/src/main/res/values/strings.xml', /<string name="app_name"[^>]*>([^<]*)<\/string>/);
  bilgi(`Prebuild paket adı      : ${paket ?? '(yok)'}`);
  bilgi(`Prebuild görünen ad     : ${uygulamaAdi ?? '(yok)'}`);
  const gomuluIz = sertifika ? sertifikaParmakIzi(xmlCoz(sertifika)) : null;
  const kokSorunlari = sertifika ? kokHatalari(xmlCoz(sertifika)) : [];
  return { url, rv, acik, sertifika, imzaMeta, paket, uygulamaAdi, gomuluIz, zincir, kokSorunlari };
}

/** Prebuild kimliğinin ORTAK sorunları (kimlikten bağımsız): güncelleme açık + imza gömülü. */
function prebuildTemelSorunlari(p) {
  const sorunlar = [];
  if (p.acik !== 'true') sorunlar.push(`ENABLED "${p.acik ?? 'yok'}" (beklenen: true)`);
  // ⚠️ Paket internetten geliyor: imzasız bir APK, sunucuya sızan birinin
  // sahadaki HER tablete istediği kodu göndermesi demektir. Sertifika APK'ya
  // gömülü DEĞİLSE istemci imzayı hiç KONTROL ETMEZ (FileDownloader.kt:559).
  if (!p.sertifika) sorunlar.push('CODE_SIGNING_CERTIFICATE yok — istemci imzayı hiç kontrol etmez');
  if (!p.imzaMeta) sorunlar.push('CODE_SIGNING_METADATA yok');
  return sorunlar;
}

/**
 * İMZA KAPISI — paket türünün KENDİ anahtarıyla mı imzalandı (AAB → Play yükleme, APK → test)?
 *
 * ⚠️ NEDEN: `android/` prebuild çıktısıdır ve imza yapılandırması bir eklentiyle
 * (plugins/withReleaseKeystore.js) her prebuild'de yeniden yazılır. Eklenti bozulur/atlanırsa
 * şablonun varsayılanı devreye girer ve release paketi **Android'in herkese açık DENEME
 * mührüyle** imzalanır; ya da görev yanlış seçilirse AAB test anahtarını taşır ve Play onu
 * reddeder. Beklenen parmak izi ayrı bir dosyada TUTULMAZ, anahtarın kendisinden okunur.
 */
function imzaKapisi(paketYolu, tur = IMZA_TURU) {
  const d = imzaAnahtariHazir(tur);
  const props = d.props;
  /** `AB:CD:...` ya da `abcd...` → karşılaştırılabilir düz küçük harf hex. */
  const duzHex = (x) => (x ?? '').replace(/:/g, '').toLowerCase();
  const aab = /\.aab$/i.test(paketYolu);

  /**
   * ⚠️ ARAÇ SEÇİMİ ÖLÇÜLDÜ (2026-08-26): `keytool -printcert -jarfile` yalnız
   * **v1 (jar)** imzasını okur. minSdk 26 olduğu için AGP v1'i KAPATIR ve APK
   * yalnız v2/v3 şemasıyla imzalanır → keytool hiçbir çıktı vermez. Doğru araç
   * `apksigner`dır (Android SDK build-tools). AAB ise jarsigner (v1) ile imzalanır:
   * onda apksigner değil keytool okur.
   */
  const apksignerBul = () => {
    // Kök çözümü TEK KAYNAKTAN (`sdkKokBul`) — iki liste ayrışmasın.
    const kokler = [sdkKokBul()].filter(Boolean);
    const ad = process.platform === 'win32' ? 'apksigner.bat' : 'apksigner';
    for (const kok of kokler) {
      const bt = path.join(kok, 'build-tools');
      if (!fs.existsSync(bt)) continue;
      const surumler = fs
        .readdirSync(bt)
        .filter((x) => fs.existsSync(path.join(bt, x, ad)))
        .sort();
      if (surumler.length) return path.join(bt, surumler[surumler.length - 1], ad);
    }
    return null;
  };

  // ⚠️ `keytool` JDK'DAN GELİR — Gradle'a JDK vermek YETMEZ, bu adım ayrı bir
  // süreçtir ve PATH'ten arar. Kabuk profilinde JAVA_HOME yoksa derleme geçer
  // ama doğrulama "anahtar okunamadı" ile düşer ve hata, sebebi (yanlış şifre mi,
  // eksik JDK mi) AYIRT ETMEZ — 2026-09-04'te temiz kabukta birebir yaşandı.
  const jdkKok = jdkKokBul();
  const javaOrtam = jdkKok
    ? { ...process.env, JAVA_HOME: jdkKok, PATH: `${path.join(jdkKok, 'bin')}${path.delimiter}${process.env.PATH ?? ''}` }
    : process.env;

  // Parola argv'ye GİRMEZ (süreç listesi): keytool `-storepass:env` ile yalnız bu alt sürecin ortamından okur.
  const parola = imzaParolasi(tur);
  const keytoolOrtami = { ...javaOrtam, [IMZA_PAROLA_ORTAMI]: parola ? parola.toString('utf8') : String(props.storePassword ?? '') };
  parola?.fill(0);
  const magaza = spawnSync(
    'keytool',
    ['-list', '-v', '-keystore', d.storeYolu, '-alias', props.keyAlias, '-storepass:env', IMZA_PAROLA_ORTAMI],
    { encoding: 'utf8', env: keytoolOrtami },
  );
  delete keytoolOrtami[IMZA_PAROLA_ORTAMI];
  const beklenen = duzHex(/SHA256:\s*([0-9A-F:]+)/i.exec(magaza.stdout ?? '')?.[1] ?? '');

  let bulunan = '';
  let aracHatasi = '';
  const apksigner = aab ? null : apksignerBul();
  if (apksigner) {
    // apksigner bir kabuk betiğidir ve içeriden `java` çağırır → JDK ortamı ŞART.
    const r = spawnSync(apksigner, ['verify', '--print-certs', paketYolu], { encoding: 'utf8', env: javaOrtam });
    // v1/v2/v3 imzacılarının HEPSİ aynı sertifikayı taşır; ilk eşleşme yeter.
    bulunan = duzHex(/certificate SHA-256 digest:\s*([0-9a-f]+)/i.exec(r.stdout ?? '')?.[1] ?? '');
    if (!bulunan) aracHatasi = (r.stderr || r.stdout || '').trim().split('\n')[0] ?? '';
  } else if (!aab) {
    aracHatasi = 'apksigner bulunamadı (Android SDK build-tools).';
  }
  if (!bulunan) {
    // AAB'nin yolu ve APK için yedek yol: v1 (jar) imzası keytool ile.
    const r = spawnSync('keytool', ['-printcert', '-jarfile', paketYolu], { encoding: 'utf8', env: javaOrtam });
    bulunan = duzHex(/SHA256:\s*([0-9A-F:]+)/i.exec(r.stdout ?? '')?.[1] ?? '');
  }

  baslik(`İMZA DOĞRULAMASI — ${IMZA_ANAHTARLARI[tur].ad}`);
  if (!beklenen) {
    dur('İmza anahtarı okunamadı', `keytool ${d.storeYolu} deposunu açamadı — şifre/alias yanlış ya da JDK yok.`);
  }
  if (!bulunan) {
    // Araç imzayı okuyamadıysa SESSİZCE GEÇME: doğrulanamayan imza, doğrulanmış imza değildir.
    dur(
      'Paket imzası okunamadı',
      aracHatasi || '(araç çıktı vermedi)',
      'Elle doğrula:',
      aab ? `  keytool -printcert -jarfile "${paketYolu}"` : `  apksigner verify --print-certs "${paketYolu}"`,
    );
  }
  bilgi(`Anahtar: ${beklenen}`);
  bilgi(`Paket  : ${bulunan}`);
  if (beklenen !== bulunan) {
    apkyiReddet(paketYolu);
    dur(
      'PAKET YANLIŞ ANAHTARLA İMZALANMIŞ',
      `Beklenen: ${IMZA_ANAHTARLARI[tur].ad} (${IMZA_ANAHTARLARI[tur].dizin}/)`,
      'Büyük olasılıkla deneme (debug) mührü ya da öbür anahtar kullanıldı.',
      '',
      'Kontrol et: plugins/withReleaseKeystore.js app.json `plugins` listesinde mi,',
      'prebuild bu eklentiyle koştu mu, gradle görevi doğru mu (AAB = bundleRelease)?',
    );
  }
  bilgi(`✔ Paket ${IMZA_ANAHTARLARI[tur].dizin}/ anahtarıyla imzalanmış.`);
}

/**
 * Kasalı anahtar türünün (Play yükleme) parolası: Anahtar Zinciri'nden, sorusuz. Kayıt yoksa GÜRÜLTÜLÜ DUR (deneme
 * mührüne ya da dosyadaki parolaya düşülmez). Kasasız tür (deneme) → null: parola keystore.properties'ten.
 */
function imzaParolasi(tur) {
  const ad = IMZA_ANAHTARLARI[tur].kasa;
  if (!ad) return null;
  let p;
  try {
    p = kasadanAl(ad);
  } catch (e) {
    if (e instanceof KasaHatasi) dur(`${IMZA_ANAHTARLARI[tur].ad}: parola okunamadı`, e.message);
    throw e;
  }
  if (!p) dur(`${IMZA_ANAHTARLARI[tur].ad}: parola Anahtar Zinciri'nde YOK`, kasaIpucu(ad), 'Paket üretilmedi.');
  return p;
}

/**
 * İmza anahtarı hazır mı — yoksa ya da başka bir anahtarın (öbür tür, `keystore/` kökündeki eski mühür) kopyasıysa
 * GÜRÜLTÜLÜ DUR ve üretim komutunu bas (anahtar burada üretilmez; kullanıcı anahtar töreninde üretir).
 */
function imzaAnahtariHazir(tur = IMZA_TURU) {
  const t = IMZA_ANAHTARLARI[tur];
  const d = imzaAnahtariDenetimi(PROJECT_ROOT, tur);
  if (d.sonuc === 'hazir') return d;
  if (d.sonuc === 'ihlal') {
    dur(`${t.ad} GEÇERSİZ`, ...d.satirlar, '', 'Her derleme türü KENDİ anahtarını taşır; eski kanal mührü ortak pakete girmez.');
  }
  dur(
    `${t.ad} YOK`,
    ...d.satirlar,
    '',
    tur === 'play-yukleme'
      ? "Yükleme anahtarını kullanıcı Mac'te BİR KEZ üretir, şifreli yedeğe alır; ilk AAB'de Play Console'a tanıtılır."
      : 'Test anahtarı yalnız yerel deneme APK\'sını imzalar; kullanıcı anahtar töreninde BİR KEZ üretir.',
    'Bu komut anahtar ÜRETMEZ. Üretim (anahtar töreninde):',
    ...anahtarUretimKomutu(tur).map((x) => `  ${x}`),
  );
  return d;
}

/**
 * Android SDK kökü — ortam değişkeni YOKSA bilinen kurulum yerlerinden bulunur.
 *
 * ⚠️ NEDEN SCRIPT ÇÖZÜYOR: Gradle `ANDROID_HOME` ya da `android/local.properties`
 * ister; ikisi de MAKİNEYE ÖZGÜdür ve git'te tutulmaz (`local.properties`
 * .gitignore'da). Yani her yeni makinede — ve her yeni kabuk oturumunda — elle
 * `export` yazmak gerekiyordu; unutulunca Gradle "SDK location not found" ile
 * düşüyordu ve hata, sebebi (kurulum eksik mi, sadece değişken mi yok) ayırt
 * etmiyordu. Aynı liste `apksignerBul`da zaten vardı; TEK KAYNAĞA alındı.
 */
function sdkKokBul() {
  const adaylar = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), 'Library/Android/sdk'),
    path.join(os.homedir(), 'Android/Sdk'),
    path.join(os.homedir(), 'AppData/Local/Android/Sdk'),
    'C:\\Android\\Sdk',
  ].filter(Boolean);
  // "Kök var" YETMEZ: boş bir klasör de var sayılır. `platform-tools` SDK'nın
  // gerçekten kurulu olduğunun en ucuz kanıtı.
  return adaylar.find((k) => fs.existsSync(path.join(k, 'platform-tools'))) ?? null;
}

/**
 * JDK kökü — Gradle 8.x JDK 17+ ister.
 *
 * ⚠️ macOS'ta `java` KOMUTU HER ZAMAN VARDIR ama kurulu JDK yoksa çalıştırıldığında
 * "Unable to locate a Java Runtime" der (sistem saplaması). Yani `which java` ile
 * kontrol etmek YANILTICIDIR — 2026-09-03'te tam bu şekilde yanıldık. Bu yüzden
 * kökler DOSYA SİSTEMİNDEN doğrulanır.
 */
function jdkKokBul() {
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin', 'java'))) {
    return process.env.JAVA_HOME;
  }
  const adaylar = [
    '/opt/homebrew/opt/openjdk@17',
    '/opt/homebrew/opt/openjdk@21',
    '/opt/homebrew/opt/openjdk',
    '/usr/local/opt/openjdk@17',
    '/usr/local/opt/openjdk@21',
    '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home',
    '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
  ];
  const bulunan = adaylar.find((k) => fs.existsSync(path.join(k, 'bin', 'java')));
  if (bulunan) return bulunan;
  // macOS'un kendi çözücüsü — kurulu bir JDK varsa yolunu verir, yoksa hata döner.
  if (process.platform === 'darwin') {
    const r = spawnSync('/usr/libexec/java_home', ['-v', '17+'], { encoding: 'utf8' });
    const yol = (r.stdout ?? '').trim();
    if (r.status === 0 && yol && fs.existsSync(path.join(yol, 'bin', 'java'))) return yol;
  }
  return null;
}

/** Gradle'a geçirilecek ortam — eksikse KURULUM KOMUTUYLA BİRLİKTE durur. */
function derlemeOrtami() {
  const sdk = sdkKokBul();
  if (!sdk) {
    dur(
      'Android SDK bulunamadı',
      'Gradle SDK olmadan derleyemez. Android Studio kuruluysa SDK genelde şuradadır:',
      '  macOS : ~/Library/Android/sdk',
      '  Windows: %LOCALAPPDATA%\\Android\\Sdk',
      'Kuruluysa yolu bildir:  export ANDROID_HOME=<yol>',
    );
  }
  const jdk = jdkKokBul();
  if (!jdk) {
    dur(
      'Java (JDK 17+) bulunamadı',
      'Gradle 8.x JDK 17 ya da üstünü ister. Kurulum:',
      '  macOS : brew install openjdk@17     (yönetici parolası İSTEMEZ)',
      '  Windows: winget install EclipseAdoptium.Temurin.17.JDK',
      'Kuruluysa yolu bildir:  export JAVA_HOME=<yol>',
    );
  }
  return { sdk, jdk };
}

function androidVarMi() {
  if (!fs.existsSync(path.join(ANDROID_DIR, 'gradlew'))) {
    dur(
      'android/ native projesi yok',
      `Beklenen: ${path.join(ANDROID_DIR, 'gradlew')}`,
      'Bu klasör prebuild çıktısıdır ve git ile takip edilmez.',
      'Üret: npx expo prebuild --platform android   (ya da: npx expo run:android)',
    );
  }
}

function ozet(adres, s, stat, apkYolu = APK_PATH) {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(apkYolu)).digest('hex');
  const aab = /\.aab$/i.test(apkYolu);
  baslik('(4/4) HAZIR');
  bilgi(`${aab ? 'AAB' : 'APK'}      : ${apkYolu}`);
  bilgi('Kimlik   : ORTAK PAKET (dağıtım kaydından)');
  bilgi(`Boyut    : ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
  bilgi(`Sürüm    : ${s.gradleVersionName ?? '?'} (versionCode ${s.gradleVersionCode ?? '?'})`);
  bilgi(adres ? `Sunucu   : ${adres}   ← bundle içinde doğrulandı` : 'Sunucu   : (yok — ortak paket; bundle\'da ERP adresi olmadığı doğrulandı)');
  bilgi(`SHA-256  : ${sha}`);
  bilgi(`Zaman    : ${stat.mtime.toLocaleString('tr-TR')}`);
  console.log('');
  if (aab) {
    bilgi('Yükleme  : Play Console → Test ve yayınla → kapalı test (gizli yayın) → yeni sürüm → bu AAB');
    bilgi('           versionCode Play\'de bir kez kullanılır; OTA turunda versionCode\'a DOKUNULMAZ.');
  } else {
    bilgi('Kurulum  : adb install -r "<apk yolu>"   (yalnız emülatör / prova cihazı)');
    bilgi('⚠ Bu APK TEST anahtarıyla imzalı ve sahaya DAĞITILMAZ — ortak tablet yalnız Google Play\'den kurulur (npm run build:aab).');
  }
  console.log('');
}

/* ------------------------------------------------------------------ *
 * ORTAK PAKET (tek ortak paket O7)
 * ------------------------------------------------------------------ */

/**
 * Ortak kimlik: kayıt TAM doğrulamadan (dagitim.mjs) geçer, kimlik ortak-kimlik.cjs'ten türer ve
 * güncelleme adresi kaydın kendi türetimiyle (Worker takma adı) eşit olmalı. Ortamda emekli eski kanal
 * değişkeni (`TEKSERP_KANAL`) varsa operatör eski yolu bekliyordur → DUR (sessizce ortak derlenmez).
 */
function ortakHedefCoz() {
  const ortamdaki = String(process.env[KANAL_ORTAM] ?? '').trim();
  if (ortamdaki) {
    dur('EMEKLİ ESKİ KANAL ORTAMI', `${KANAL_ORTAM} ortamı : ${ortamdaki}`,
      `Eski kanal derlemesi emekli (eski-kanal-son etiketi, docs/ops/ESKI-KANAL-ACIL.md); ortamdan ${KANAL_ORTAM}'ı kaldır.`);
  }
  let kayit;
  let k;
  try {
    kayit = ortakKaydiOku();
    const h = kayitHatalari(kayit);
    if (h.length) dur(`DAĞITIM KAYDI GEÇERSİZ (${DAGITIM_REL})`, ...h);
    k = ortakKimlik(kayit);
  } catch (e) {
    dur(`ÖLÇÜLEMEDİ — ortak paket kimliği çözülemedi (${DAGITIM_REL})`, String(e?.message ?? e));
  }
  const takmaAd = turet(kayit).otaTakmaAd;
  if (k.guncellemeUrl !== takmaAd) {
    dur('ORTAK GÜNCELLEME ADRESİ KAYDIN TÜRETİMİYLE AYRIŞTI', `ortak-kimlik.cjs : ${k.guncellemeUrl}`, `dagitim.mjs      : ${takmaAd}`);
  }
  return k;
}

/** Ortak paket ERP adresi taşımaz: açık verilen adres bir niyet hatasıdır (sessizce yok sayılmaz). */
function ortakAdresKapisi() {
  const verilen = [
    arg('api-url') !== undefined ? `--api-url=${arg('api-url')}` : null,
    process.env.EXPO_PUBLIC_API_URL?.trim() ? `EXPO_PUBLIC_API_URL=${process.env.EXPO_PUBLIC_API_URL.trim()}` : null,
  ].filter(Boolean);
  if (verilen.length) {
    dur('ORTAK PAKET ERP ADRESİ GÖMMEZ', ...verilen.map((x) => `verilen: ${x}`), '',
      'Tek paket her fabrikaya gider; tablet sunucuyu çalışma anında bulur (keşif / elle adres).',
      'Paketin içine fabrika adresi gömülmez (eski kanal derlemesi emekli).');
  }
}

/** Ortak OTA sertifikasının DER parmak izi; yoksa tören yönergesiyle DUR (fail-closed). */
function ortakSertifikaIzi(k) {
  const yol = path.join(PROJECT_ROOT, k.otaSertifika);
  let iz = null;
  let pem = null;
  try {
    pem = fs.readFileSync(yol, 'utf8');
    iz = sertifikaParmakIzi(pem);
  } catch {
    iz = null;
  }
  if (!iz) {
    dur('ORTAK OTA SERTİFİKASI YOK — OTA kökü üretilmedi ya da APK kopyası keystore/\'a konmadı',
      `Beklenen: ${yol}`, '',
      'Sertifikasız APK güncelleme imzasını doğrulayamaz; derleme bu yüzden DURUR.',
      'OTA kökü ve yaprağı tören araçlarıyla üretilir (elle openssl yok):',
      ...otaTorenYonergesi(k).map((x) => `  ${x}`));
  }
  // K-2: gömülen sertifika OTA KÖKÜ olmalı (CA, pathLen 0, EKU yok); eski öz-imzalı yaprak gömülürse zincir işlemez.
  const h = kokHatalari(pem);
  if (h.length) {
    dur('ORTAK OTA SERTİFİKASI OTA KÖKÜ DEĞİL — APK sertifika zincirini doğrulayamaz', `Dosya: ${yol}`, ...h.map((x) => `• ${x}`), '',
      'Kök ve yaprak törende ayrı üretilir:', ...otaTorenYonergesi(k).map((x) => `  ${x}`));
  }
  return iz;
}

/** Paketten okunan zincir meta-data'sı + gömülü sertifika OTA kökü mü (K-2; APK · AAB · prebuild ortak). */
function zincirSorunlari(zincirDegeri, sertifikaPem) {
  const f = [];
  if (zincirDegeri !== 'true') f.push(`${ZINCIR_META} "${zincirDegeri ?? 'yok'}" (beklenen true) — tablet zincir parçasını okumaz, her OTA RED (plugins/withOtaZinciri)`);
  if (sertifikaPem) f.push(...kokHatalari(sertifikaPem).map((x) => `gömülü sertifika: ${x}`));
  return f;
}

/** Prebuild çıktısı (android/) ortak kimliği mi taşıyor — beklenen değer kayıttan, ağaçtan değil. */
function ortakGuncellemeKapisi(k) {
  const { url, rv, paket, uygulamaAdi, sertifika, gomuluIz, zincir, kokSorunlari, ...p } = prebuildKimligiOku();
  bilgi('Beklenen kimlik         : ORTAK PAKET (dağıtım kaydından)');
  const beklenenIz = ortakSertifikaIzi(k);
  const sorunlar = prebuildTemelSorunlari({ ...p, sertifika });
  if (url !== k.guncellemeUrl) sorunlar.push(`EXPO_UPDATE_URL "${url ?? 'yok'}" ≠ "${k.guncellemeUrl}"`);
  if (paket !== k.androidPaket) sorunlar.push(`applicationId "${paket ?? 'yok'}" ≠ "${k.androidPaket}"`);
  if (uygulamaAdi !== k.gorunenAd) sorunlar.push(`app_name "${uygulamaAdi ?? 'yok'}" ≠ "${k.gorunenAd}"`);
  if (sertifika && gomuluIz !== beklenenIz) sorunlar.push(`gömülü OTA sertifikası ortak paketinki değil (${k.otaSertifika})`);
  if (rv !== k.runtimeVersion) sorunlar.push(`EXPO_RUNTIME_VERSION "${rv ?? 'yok'}" ≠ dağıtım kaydı "${k.runtimeVersion}"`);
  sorunlar.push(...zincirSorunlari(zincir, null), ...kokSorunlari.map((x) => `gömülü sertifika: ${x}`));
  if (sorunlar.length) {
    dur('ANDROIDMANIFEST ORTAK PAKETE HAZIR DEĞİL', ...sorunlar.map((x) => `• ${x}`), '',
      'Sebep neredeyse her zaman: android/ eski bir kanalla (TEKSERP_KANAL) ya da eski kayıtla üretildi.',
      'Çözüm (kimlik değişiminde --clean şart: paket adı Kotlin dizinlerini de değiştirir):',
      '  npx expo prebuild --platform android --clean --no-install   (ortamda TEKSERP_KANAL OLMADAN)',
      '  sonra tekrar: npm run build:apk');
  }
  bilgi('✔ Uzaktan güncelleme yapılandırması ortak paketle tutarlı.');
}

/** APK'nın KENDİSİ ortak paketin mi (paket adı · güncelleme adresi · sertifika · çalışma anı yapılandırması). */
function ortakApkKimlikKapisi(apkYolu, k) {
  baslik("ORTAK PAKET KİMLİĞİ — APK'nın kendisinden");
  let a;
  try {
    a = apkKimligi(apkYolu);
  } catch (e) {
    if (!(e instanceof ApkOlculemedi)) throw e;
    apkyiReddet(apkYolu);
    dur('ÖLÇÜLEMEDİ — APK kimliği okunamadı', e.message, 'Kimliği ölçülemeyen paket sahaya kurulmaz.');
  }
  const beklenenIz = ortakSertifikaIzi(k);
  bilgi(`Paket adı (applicationId): ${a.paket}`);
  bilgi(`Güncelleme adresi        : ${a.guncellemeAdresi ?? '(yok)'}`);
  bilgi(`OTA sertifikası          : ${a.sertifikaPem ? 'gömülü' : '(YOK)'}`);
  bilgi(`OTA sertifika zinciri    : ${a.zincirAcik ?? '(yok)'}`);
  const sorunlar = [];
  if (a.paket !== k.androidPaket) sorunlar.push(`paket adı "${a.paket}" ≠ "${k.androidPaket}"`);
  if (a.guncellemeAcik !== 'true') sorunlar.push(`expo-updates ENABLED "${a.guncellemeAcik ?? 'yok'}" (beklenen true)`);
  if (a.guncellemeAdresi !== k.guncellemeUrl) sorunlar.push(`EXPO_UPDATE_URL "${a.guncellemeAdresi ?? 'yok'}" ≠ "${k.guncellemeUrl}"`);
  if (!a.sertifikaPem || sertifikaParmakIzi(a.sertifikaPem) !== beklenenIz) sorunlar.push(`gömülü OTA sertifikası ortak paketinki değil (${k.otaSertifika})`);
  sorunlar.push(...zincirSorunlari(a.zincirAcik, a.sertifikaPem));
  if ((a.izinler ?? []).includes(YASAK_IZIN)) sorunlar.push(`${YASAK_IZIN} izni var — ortak tablet kendi APK'sını kuramaz (K-14, app.json blockedPermissions)`);
  if (!a.appConfig) sorunlar.push('assets/app.config yok ya da okunamadı — çalışma anı kimliği ÖLÇÜLEMEDİ');
  else sorunlar.push(...ortakYapilandirmaFarki(a.appConfig, { herkese: true }, k).map((x) => `assets/app.config ${x}`));
  if (sorunlar.length) {
    apkyiReddet(apkYolu);
    dur('APK ORTAK PAKETİN KİMLİĞİNİ TAŞIMIYOR', ...sorunlar.map((x) => `• ${x}`), '',
      'android/ eski bir kimlikle üretilmiş olabilir: npx expo prebuild --platform android --clean --no-install',
      'APK kanonik yolundan taşındı — SAHAYA KURMA.');
  }
  bilgi("✔ APK ortak paketin kimliğini taşıyor.");
}

function ortakApkAdresDogrula(apkYolu, derlemeBaslangici) {
  baslik('(3/4) DOĞRULAMA — APK içindeki bundle (ortak paket: ERP adresi YOK)');
  const { stat, veri } = bundleOku(apkYolu, derlemeBaslangici);
  const { gomulu, diger } = ortakBundleAdresleri(veri.toString('latin1'));
  bilgi(`Bundle boyutu   : ${(veri.length / 1024 / 1024).toFixed(1)} MB`);
  if (gomulu.length) {
    apkyiReddet(apkYolu);
    dur('ORTAK PAKETİN BUNDLE\'INDA ERP ADRESİ VAR', `Gömülü : ${gomulu.join(', ')}`, '',
      'Tek paket her fabrikaya gider; bir fabrikanın adresi bundle\'a inline olmuş (ortam ya da .env sızıntısı).',
      'APK kanonik yolundan taşındı — SAHAYA KURMA.');
  }
  if (diger.length) bilgi(`Diğer /api dizeleri (bilgi): ${diger.join(', ')}`);
  bilgi('✔ Bundle\'da ERP adresi yok.');
  return stat;
}

/**
 * Play'in kabul ettiği en düşük hedef SDK ve API 36'nın büyük ekran yön kilidi çıkışı (plugins/withBuyukEkranYonu):
 * hedef düşükse Play reddeder; özellik yoksa tablette yatay kilit Android 16+'da yok sayılır.
 */
function buyukEkranSorunlari(ogeler) {
  const f = [];
  const hedef = Number(ogeler.find((o) => o.ad === 'uses-sdk')?.oznitelik?.targetSdkVersion);
  const ozellik = ogeler.find((o) => o.ad === 'property' && o.oznitelik?.name === YON_OZELLIGI);
  bilgi(`Hedef SDK (targetSdk)    : ${Number.isFinite(hedef) ? hedef : '(okunamadı)'}`);
  bilgi(`Büyük ekran yön kilidi   : ${ozellik?.oznitelik?.value ?? '(yok)'}`);
  if (!(hedef >= PLAY_EN_DUSUK_HEDEF_SDK)) f.push(`targetSdkVersion ${Number.isFinite(hedef) ? hedef : 'okunamadı'} < ${PLAY_EN_DUSUK_HEDEF_SDK} — Play yeni sürümü reddeder (app.json expo-build-properties)`);
  if (ozellik?.oznitelik?.value !== 'true') f.push(`${YON_OZELLIGI} yok — tablette yatay kilit Android 16+'da yok sayılır (plugins/withBuyukEkranYonu)`);
  return f;
}

/**
 * AAB'nin KENDİSİ ortak paketin mi: `base/manifest/AndroidManifest.xml` protobuf'tur (AXML değil) — kimlik
 * dizeleri bayt aramasıyla, OTA sertifikası PEM olarak okunur; `base/assets/app.config` çalışma anı kimliği;
 * bundle'da ERP adresi yok; Play'in yasakladığı kurulum izni yok.
 */
function ortakAabDogrula(aabYolu, k, derlemeBaslangici) {
  baslik("(3/4) DOĞRULAMA — AAB'nin kendisinden (kimlik · ERP adresi · yasak izin · düz HTTP · hizmet)");
  if (!fs.existsSync(aabYolu)) dur('AAB üretilmedi', `Beklenen yol: ${aabYolu}`, 'Gradle "BUILD SUCCESSFUL" dese bile paket yok — çıktıyı incele.');
  const stat = fs.statSync(aabYolu);
  if (derlemeBaslangici && stat.mtimeMs < derlemeBaslangici) {
    apkyiReddet(aabYolu);
    dur('Üretilen AAB bu derlemeden ESKİ', 'Gradle paketleme adımını atlamış olmalı — paket GÜVENİLMEZ.');
  }
  const oku = (ad) => {
    try {
      const r = zipGirdisiOku(aabYolu, ad);
      return r.hata ? null : r.veri;
    } catch {
      return null;
    }
  };
  const sorunlar = [];
  const manifest = oku('base/manifest/AndroidManifest.xml');
  if (!manifest) sorunlar.push('base/manifest/AndroidManifest.xml okunamadı — kimlik ÖLÇÜLEMEDİ');
  else {
    const m = manifest.toString('utf8');
    if (!m.includes(k.androidPaket)) sorunlar.push(`manifestte ortak paket adı "${k.androidPaket}" yok`);
    if (!m.includes(k.guncellemeUrl)) sorunlar.push(`manifestte ortak güncelleme adresi "${k.guncellemeUrl}" yok`);
    if (m.includes(YASAK_IZIN)) sorunlar.push(`${YASAK_IZIN} izni var — ortak tablet kendi APK'sını kuramaz (K-14, app.json blockedPermissions)`);
    // Meta-data öğe düzeyinde: protobuf manifest (aapt2 Resources.proto) çözülür; bayt araması boolean'ı ayırt edemez.
    let meta = null;
    let ogeler = null;
    try {
      ogeler = protoManifestOgeleri(manifest);
      meta = metaHaritasi(ogeler);
    } catch (e) {
      sorunlar.push(`base/manifest/AndroidManifest.xml protobuf olarak çözülemedi (${e.message}) — zincir ÖLÇÜLEMEDİ`);
    }
    if (ogeler) sorunlar.push(...buyukEkranSorunlari(ogeler), ...playManifestSorunlari(ogeler));
    if (ogeler) {
      const nscHam = oku(`base/res/xml/${NSC_ADI}.xml`);
      let nsc = null;
      try {
        nsc = nscHam ? protoManifestOgeleri(nscHam, 'network-security-config') : null;
      } catch (e) {
        sorunlar.push(`base/res/xml/${NSC_ADI}.xml çözülemedi (${e.message})`);
      }
      sorunlar.push(...agGuvenligiSorunlari(ogeler, nsc));
    }
    if (meta) {
      const pem = meta['expo.modules.updates.CODE_SIGNING_CERTIFICATE'];
      bilgi(`OTA sertifika zinciri    : ${meta[ZINCIR_META] ?? '(yok)'}`);
      if (!pem || sertifikaParmakIzi(pem) !== ortakSertifikaIzi(k)) sorunlar.push(`gömülü OTA sertifikası ortak paketinki değil (${k.otaSertifika})`);
      sorunlar.push(...zincirSorunlari(meta[ZINCIR_META], pem));
    }
  }
  const cfgHam = oku('base/assets/app.config');
  if (!cfgHam) sorunlar.push('base/assets/app.config yok — çalışma anı kimliği ÖLÇÜLEMEDİ');
  else {
    try {
      sorunlar.push(...ortakYapilandirmaFarki(JSON.parse(cfgHam.toString('utf8')), { herkese: true }, k).map((x) => `assets/app.config ${x}`));
    } catch {
      sorunlar.push('base/assets/app.config ayrıştırılamadı');
    }
  }
  const bundle = oku(`base/${BUNDLE_ENTRY}`);
  if (!bundle) sorunlar.push(`base/${BUNDLE_ENTRY} okunamadı — ERP adresi ÖLÇÜLEMEDİ`);
  else {
    const { gomulu } = ortakBundleAdresleri(bundle.toString('latin1'));
    if (gomulu.length) sorunlar.push(`bundle'da ERP adresi var: ${gomulu.join(', ')}`);
  }
  if (sorunlar.length) {
    apkyiReddet(aabYolu);
    dur('AAB ORTAK PAKETİN KİMLİĞİNİ TAŞIMIYOR', ...sorunlar.map((x) => `• ${x}`), '', "AAB kanonik yolundan taşındı — Play'e YÜKLEME.");
  }
  bilgi("✔ AAB ortak paketin kimliğini taşıyor; bundle'da ERP adresi, manifestte kurulum izni yok.");
  return stat;
}

async function ortakMain() {
  const k = ortakHedefCoz();
  ortakAdresKapisi();
  baslik(`TeksERP Mobil — ${AAB ? 'RELEASE AAB' : 'RELEASE APK'} (ORTAK PAKET)`);
  bilgi(AAB ? 'Paket         : Google Play AAB — Play YÜKLEME anahtarıyla imzalanır'
    : "Paket         : YEREL DENEME APK'SI — TEST anahtarıyla imzalanır, sahaya DAĞITILMAZ (saha = Google Play)");
  bilgi(`Kimlik        : ${k.androidPaket} · "${k.gorunenAd}" · runtimeVersion ${k.runtimeVersion}`);
  bilgi(`Güncelleme    : ${k.guncellemeUrl}  (Worker belirtecin grubuna yönlendirir)`);
  bilgi(`OTA imzası    : ${k.otaSertifika} · kid "${k.anahtarKimligi}"`);
  bilgi('ERP adresi    : GÖMÜLMEZ (tablet sunucuyu çalışma anında bulur)');
  ortakSertifikaIzi(k);

  if (SADECE_KONTROL) {
    const sCheck = surumBas();
    surumNotuKapisi(sCheck);
    const agacCheck = temizAgacDenetimi();
    if (agacCheck.sonuc === 'temiz') bilgi(agacCheck.satirlar[0]);
    else uyari(`${agacCheck.satirlar.join('\n     ')}\n     (--check: uyarı — gerçek derleme bu ağaçta APK ÜRETMEZ)`);
    if (fs.existsSync(path.join(ANDROID_DIR, 'app/src/main/AndroidManifest.xml'))) ortakGuncellemeKapisi(k);
    else uyari('android/ klasörü yok — uzaktan güncelleme yapılandırması denetlenemedi.');
    baslik('DERLEME ORTAMI');
    const ortamCheck = derlemeOrtami();
    bilgi(`Android SDK : ${ortamCheck.sdk}`);
    bilgi(`Java (JDK)  : ${ortamCheck.jdk}`);
    bilgi(imzaAnahtariHazir().satirlar[0]);
    console.log('\n  ✔ Ön kontrol tamam (--check): ortak kimlik, sürüm, güncelleme yapılandırması, imza anahtarı ve derleme ortamı tutarlı. Derleme YAPILMADI.\n');
    return;
  }

  if (SADECE_DOGRULA) {
    const ozelYol = arg('verify-only');
    const kanonik = AAB ? AAB_PATH : APK_PATH;
    const hedef = ozelYol ? path.resolve(process.cwd(), ozelYol) : kanonik;
    if (!fs.existsSync(hedef)) dur('Doğrulanacak paket bulunamadı', hedef, `Önce derle: npm run ${AAB ? 'build:aab' : 'build:apk'}`);
    if (hedef !== kanonik) uyari(`Kanonik yol dışındaki paket denetleniyor: ${hedef}`);
    if (AAB !== /\.aab$/i.test(hedef)) dur('Paket türü komutla uyuşmuyor', `${hedef}`, 'AAB: npm run build:aab -- --verify-only=<aab> · APK: npm run build:apk:verify');
    if (AAB) {
      const sAab = surumBas();
      const statAab = ortakAabDogrula(hedef, k);
      imzaKapisi(hedef);
      ozet(null, sAab, statAab, hedef);
      return;
    }
    ortakApkKimlikKapisi(hedef, k);
    const sVerify = surumBas();
    const stat = ortakApkAdresDogrula(hedef);
    imzaKapisi(hedef);
    ozet(null, sVerify, stat, hedef);
    return;
  }

  // İmza anahtarı android/ denetiminden ÖNCE: anahtarsız derleme dakikalarca sürüp sonda düşmesin.
  imzaAnahtariHazir();
  androidVarMi();
  const s = surumBas();
  surumNotuKapisi(s);
  ortakGuncellemeKapisi(k);
  const agac = temizAgacDenetimi();
  if (agac.sonuc !== 'temiz') {
    dur(agac.sonuc === 'kirli' ? 'PAKET DERLENMEZ — çalışma ağacı temiz değil' : 'ÖLÇÜLEMEDİ — çalışma ağacı okunamadı', ...agac.satirlar);
  }
  bilgi(agac.satirlar[0]);
  const hedef = AAB ? AAB_PATH : APK_PATH;
  fs.rmSync(apkKunyeYolu(hedef), { force: true });

  const derlemeBaslangici = Date.now();
  onbellekleriTemizle();
  gradleKos(null, AAB ? 'bundleRelease' : 'assembleRelease');
  let stat;
  if (AAB) {
    stat = ortakAabDogrula(AAB_PATH, k, derlemeBaslangici);
  } else {
    stat = ortakApkAdresDogrula(APK_PATH, derlemeBaslangici);
    ortakApkKimlikKapisi(APK_PATH, k);
  }
  imzaKapisi(hedef);
  derlemeKunyesiBirak(agac.commit, hedef, s);
  ozet(null, s, stat, hedef);
}

async function main() {
  const emekli = EMEKLI_ARGUMANLAR.filter((ad) => arg(ad) !== undefined);
  if (emekli.length) {
    dur('EMEKLİ ESKİ KANAL ARGÜMANI', ...emekli.map((ad) => `verilen: --${ad}`), '',
      'Müşteri kodlu APK derlemesi emekli (eski-kanal-son etiketi, docs/ops/ESKI-KANAL-ACIL.md).',
      'Ortak paket: npm run build:aab (Google Play) · npm run build:apk (yerel deneme; kimlik dağıtım kaydından, ERP adresi gömülmez).');
  }
  return ortakMain();
}

/**
 * Derleme künyesi (G22): bütün kapılardan geçen APK'nın yanına commit + özet + APK'nın KENDİ sürümü. Derleme
 * sırasında ağaç ya da HEAD değiştiyse künye YAZILMAZ — yayıncı künyesiz APK'yı reddeder.
 */
function derlemeKunyesiBirak(commit, paketYolu, s) {
  const son = temizAgacDenetimi();
  if (son.sonuc !== 'temiz' || son.commit !== commit) {
    dur('Derleme sırasında çalışma ağacı ya da HEAD değişti — paket güvenilmez, künye YAZILMADI', ...son.satirlar);
  }
  const aab = /\.aab$/i.test(paketYolu);
  let k;
  try {
    // AAB'nin manifesti protobuf'tur: sürüm derlemeye giren gradle değerlerinden (surumBas sapmayı zaten durdurur).
    const { surumAdi, surumKodu } = aab
      ? { surumAdi: s.gradleVersionName, surumKodu: Number(s.gradleVersionCode) }
      : apkKimligi(paketYolu);
    k = derlemeKunyesiYaz(apkKunyeYolu(paketYolu), {
      urun: aab ? 'tablet-aab' : 'tablet-apk', kanal: null, surum: surumAdi, commit, dosyaYolu: paketYolu, ek: { versionCode: surumKodu },
    });
  } catch (e) {
    dur('Derleme künyesi yazılamadı', String(e?.message ?? e));
  }
  bilgi(`Derleme künyesi: ${path.basename(apkKunyeYolu(paketYolu))} · commit ${k.commit.slice(0, 12)} · ${k.surum} (vc ${k.versionCode})`);
}

// Beklenmedik istisna da GÜRÜLTÜLÜ bitsin: çıplak yığın izi operatöre
// "derleme oldu mu, olmadı mı" sorusunu bıraktığı için önce net bir başlık,
// sonra teşhis için yığın izi basılır. Her hâlükârda exit 1.
main().catch((e) => {
  console.error(`\n${BAR}\n  ✖ HATA — Beklenmedik bir sorun oluştu, paket GÜVENİLMEZ\n${BAR}`);
  console.error(e?.stack ?? String(e));
  console.error(`${BAR}\n`);
  process.exit(1);
});
