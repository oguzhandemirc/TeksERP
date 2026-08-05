#!/usr/bin/env node
/**
 * TeksERP Mobil — sahaya kurulacak release APK derleyicisi (TEK GİRİŞ NOKTASI).
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
 * Kullanım:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.250:4000/api npm run build:apk
 *   npm run build:apk -- --api-url=http://192.168.1.250:4000/api
 *   npm run build:apk:check                 # yalnız adresi çöz + doğrula, derleme YOK
 *   npm run build:apk:verify                # mevcut APK'yı beklenen adrese karşı denetle
 */

import { spawnSync } from 'node:child_process';
// Buffer açıkça import ediliyor: proje ESLint yapılandırması RN/tarayıcı
// global'lerini varsayar, Node global'i `Buffer`'ı bilmez (no-undef).
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');
const ANDROID_DIR = path.join(PROJECT_ROOT, 'android');
const APK_PATH = path.join(ANDROID_DIR, 'app/build/outputs/apk/release/app-release.apk');
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
/** Sürüm kapısını bilinçli olarak geç (ASCII eşanlamlısı da kabul edilir). */
const SURUM_KAPISI_ATLA =
  argv.includes('--sürüm-farkını-biliyorum') || argv.includes('--surum-farkini-biliyorum');

/* ------------------------------------------------------------------ *
 * (a) + (b) + ek: sunucu adresini çöz ve DOĞRULA
 * ------------------------------------------------------------------ */

/** Basit `.env` ayrıştırıcı — dotenv'in bize lazım olan alt kümesi. */
function envDosyasiOku(dosya) {
  const sonuc = new Map();
  let icerik;
  try {
    icerik = fs.readFileSync(dosya, 'utf8');
  } catch {
    return sonuc;
  }
  for (const ham of icerik.split(/\r?\n/)) {
    const satir = ham.trim();
    if (!satir || satir.startsWith('#')) continue;
    const esitlik = satir.indexOf('=');
    if (esitlik < 0) continue;
    const anahtar = satir.slice(0, esitlik).trim().replace(/^export\s+/, '');
    let deger = satir.slice(esitlik + 1).trim();
    // Tırnaklı değerleri soy ("http://..." / 'http://...').
    if (
      (deger.startsWith('"') && deger.endsWith('"')) ||
      (deger.startsWith("'") && deger.endsWith("'"))
    ) {
      deger = deger.slice(1, -1);
    }
    sonuc.set(anahtar, deger);
  }
  return sonuc;
}

/**
 * `.env*` dosyalarını Expo'nun kendi öncelik sırasıyla tarar (@expo/env:
 * `.env.<mode>.local` → `.env.local` → `.env.<mode>` → `.env`). Release
 * derlemesinde mode = production.
 */
const ENV_DOSYALARI = ['.env.production.local', '.env.local', '.env.production', '.env'];

function adresiCoz() {
  // 1) Açık CLI argümanı — en yüksek öncelik, operatörün niyeti nettir.
  const cliDeger = arg('api-url');
  if (cliDeger) return { deger: cliDeger.trim(), kaynak: '--api-url argümanı' };

  // 2) Ortam değişkeni — CI ve "tek satır export" kullanımı.
  const envDeger = process.env.EXPO_PUBLIC_API_URL;
  if (envDeger && envDeger.trim()) {
    return { deger: envDeger.trim(), kaynak: 'EXPO_PUBLIC_API_URL ortam değişkeni' };
  }

  // 3) `.env*` dosyaları — Expo ile AYNI sırayla, ki script ile bundler
  //    farklı değer görmesin.
  for (const ad of ENV_DOSYALARI) {
    const yol = path.join(PROJECT_ROOT, ad);
    const deger = envDosyasiOku(yol).get('EXPO_PUBLIC_API_URL');
    if (deger && deger.trim()) return { deger: deger.trim(), kaynak: `${ad} dosyası` };
  }

  return { deger: null, kaynak: null };
}

/** Çözülen adresi kullanılabilirlik açısından denetler; sorun varsa DURUR. */
function adresiDogrula(adres, kaynak) {
  // (a) Tanımlı mı?
  if (!adres) {
    dur(
      'Sunucu adresi (EXPO_PUBLIC_API_URL) TANIMLI DEĞİL',
      'Tablete kurulacak APK backend adresini derleme anında GÖMER — sonradan',
      'değiştirilemez (uygulama içi "API Adresi" ayarı yalnız o cihazı düzeltir).',
      '',
      'Sahadaki gerçek sunucu için yetkili kaynak:',
      '  docs/ops/DEPLOY-RUNBOOK.md → "SAHADAKİ KURULUM — yetkili değerler"',
      '',
      'Örnek kullanım:',
      '  EXPO_PUBLIC_API_URL=http://192.168.1.250:4000/api npm run build:apk',
      '  npm run build:apk -- --api-url=http://192.168.1.250:4000/api',
    );
  }

  // Şema + biçim: `src/constants/api.ts` bu değeri OLDUĞU GİBİ API kökü sayar.
  let url;
  try {
    url = new URL(adres);
  } catch {
    dur(
      'Sunucu adresi geçerli bir URL değil',
      `Okunan değer : ${adres}`,
      `Kaynak       : ${kaynak}`,
      'Beklenen biçim: http://<ip-veya-host>:4000/api',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    dur(
      'Sunucu adresinin şeması http/https değil',
      `Okunan değer : ${adres}`,
      `Kaynak       : ${kaynak}`,
    );
  }

  // (b) localhost / 127.0.0.1 → tablette anlamsız. Tablet kendi üstünde
  //     backend çalıştırmıyor; bu değer yalnız `adb reverse` ile USB'ye bağlı
  //     geliştirme makinesinde iş görür, sahaya giden pakette DEĞİL.
  const host = url.hostname.toLowerCase();
  const yerelHostlar = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '10.0.2.2'];
  if (yerelHostlar.includes(host)) {
    dur(
      `Sunucu adresi yerel makineyi gösteriyor (${host})`,
      `Okunan değer : ${adres}`,
      `Kaynak       : ${kaynak}`,
      '',
      'Bu adres tablette ÇALIŞMAZ — tablet kendi üstünde backend koşturmuyor.',
      '(`.env.local` USB geliştirme içindir: `adb reverse tcp:4000 tcp:4000`.',
      ' Sahaya giden APK için sunucunun LAN adresini AÇIKÇA ver.)',
      '',
      'Örnek:',
      '  EXPO_PUBLIC_API_URL=http://192.168.1.250:4000/api npm run build:apk',
    );
  }

  // `/api` soneki: `API_URL` doğrudan axios baseURL'idir. Sonek unutulursa
  // uygulama açılır, login ekranı gelir ve HER istek 404 döner — yine sessiz
  // bir kırılma. Otomatik eklemiyoruz: operatör ne derlediğini bilmeli.
  const yol = url.pathname.replace(/\/+$/, '');
  if (yol !== '/api') {
    dur(
      'Sunucu adresi `/api` ile bitmiyor',
      `Okunan değer : ${adres}`,
      `Kaynak       : ${kaynak}`,
      '',
      'Mobil istemci bu değeri doğrudan axios baseURL olarak kullanır',
      '(`src/constants/api.ts`). `/api` yoksa tüm istekler 404 döner.',
      '',
      `Doğrusu: ${url.protocol}//${url.host}/api`,
    );
  }

  // Sonda `/` olursa `${API_URL}/auth/login` çift eğik çizgi üretir.
  if (adres.endsWith('/')) {
    dur(
      'Sunucu adresinin sonunda `/` var',
      `Okunan değer : ${adres}`,
      `Doğrusu      : ${adres.replace(/\/+$/, '')}`,
    );
  }

  return `${url.protocol}//${url.host}/api`;
}

/**
 * `.env*` dosyalarında FARKLI bir değer varsa söyle. Derlemeyi durdurmaz
 * (açık argüman/ortam değişkeni kasıtlı olarak kazanır) ama operatör
 * "ben .env'ye yazmıştım" diye yanılmasın.
 */
function celiskiliEnvUyar(secilen) {
  for (const ad of ENV_DOSYALARI) {
    const deger = envDosyasiOku(path.join(PROJECT_ROOT, ad)).get('EXPO_PUBLIC_API_URL');
    if (deger && deger.trim() && deger.trim() !== secilen) {
      uyari(
        `${ad} dosyasında FARKLI bir adres var: ${deger.trim()}\n` +
          `     Bu değer YOK SAYILDI — derleme "${secilen}" ile yapılıyor.\n` +
          '     (Açıkça verilen ortam değişkeni tüm .env dosyalarını yener.)',
      );
    }
  }
}

/**
 * Adresi biçimsel olarak doğrulamak "bu sunucu GERÇEKTEN orada mı" sorusunu
 * cevaplamaz — 192.168.1.50 da geçerli bir IP'ydi, sadece o makine yoktu.
 * Bu yüzden derlemeden önce backend'in `/health` ucu YOKLANIR.
 *
 * UYARIDIR, HATA DEĞİL: derleme yapılan Mac fabrika ağında olmayabilir
 * (VPN yok, ev ağı, vs.) ve bu tamamen meşru bir durumdur. Sessiz kalmak
 * yerine söyler, kararı operatöre bırakır.
 */
function sunucuyuYokla(adres) {
  const kok = new URL(adres);
  const url = `${kok.origin}/health`;
  const modul = kok.protocol === 'https:' ? https : http;

  // NOT: burada `fetch` KULLANILMIYOR. Ulaşılamayan bir IP'de `fetch` +
  // `AbortSignal.timeout` isteği 2,5 sn'de iptal ediyor ama undici'nin yarım
  // kalan bağlantısı olay döngüsünü açık tutuyor ve süreç ~10 sn boyunca
  // kapanmıyordu (ölçüldü). `http.get` + `destroy()` soketi anında bırakır.
  return new Promise((cozumle) => {
    const bitir = (mesaj, hataMi) => {
      if (hataMi) {
        uyari(
          `Sunucu yoklaması BAŞARISIZ: ${url} — ${mesaj}\n` +
            '     Derleme SÜRÜYOR (bu makine fabrika ağında olmayabilir), ama\n' +
            '     adres bayat/yanlış da olabilir. Kurulumdan ÖNCE teyit et:\n' +
            '     docs/ops/DEPLOY-RUNBOOK.md → "SAHADAKİ KURULUM — yetkili değerler"',
        );
      } else {
        bilgi(mesaj);
      }
      cozumle();
    };

    const istek = modul.get(url, { timeout: 2500 }, (yanit) => {
      yanit.resume(); // gövdeyi tüket → soket serbest kalsın
      if (yanit.statusCode && yanit.statusCode < 400) {
        bitir(`Sunucu yoklaması: ✔ ${url} yanıt verdi (HTTP ${yanit.statusCode})`, false);
      } else {
        uyari(
          `Sunucu yoklaması: ${url} → HTTP ${yanit.statusCode}\n` +
            '     Adres ayakta ama /health beklenen cevabı vermedi. Derleme SÜRÜYOR.',
        );
        cozumle();
      }
    });
    istek.on('timeout', () => istek.destroy(new Error('zaman aşımı (2,5 sn)')));
    istek.on('error', (e) => bitir(String(e?.message ?? e), true));
  });
}

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
}

/* ------------------------------------------------------------------ *
 * (d) assembleRelease
 * ------------------------------------------------------------------ */

function gradleKos(adres) {
  baslik('(2/4) DERLEME — ./gradlew assembleRelease');
  bilgi(`Gömülecek adres: ${adres}`);
  bilgi('(Bu adım birkaç dakika sürer; önbellek silindiği için bundle sıfırdan üretilir.)\n');

  const gradlew = path.join(ANDROID_DIR, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const sonuc = spawnSync(gradlew, ['assembleRelease'], {
    cwd: ANDROID_DIR,
    stdio: 'inherit',
    // Adres AÇIKÇA çocuk sürece geçiyor: @expo/env sistem ortamındaki
    // değişkenin üstüne YAZMAZ, dolayısıyla `.env.local` bunu ezemez.
    env: { ...process.env, EXPO_PUBLIC_API_URL: adres },
  });

  if (sonuc.error) {
    dur('Gradle çalıştırılamadı', String(sonuc.error.message), `Denenen komut: ${gradlew} assembleRelease`);
  }
  if (sonuc.status !== 0) {
    dur(
      `Gradle derlemesi başarısız (exit ${sonuc.status})`,
      'Yukarıdaki Gradle çıktısında ilk "FAILURE"/"error:" satırına bak.',
      'APK üretilmedi — sahaya kurulacak paket YOK.',
    );
  }
}

/* ------------------------------------------------------------------ *
 * (e) DERLEME SONRASI DOĞRULAMA — APK içindeki bundle'ı aç ve adresi ara
 * ------------------------------------------------------------------ */

/**
 * APK (=ZIP) içinden tek bir girdiyi saf Node ile çıkarır.
 * `unzip` ikilisine bağımlı olmuyoruz: komut bulunamazsa doğrulama SESSİZCE
 * atlanmış olurdu — düzeltmeye çalıştığımız hatanın ta kendisi.
 */
function zipGirdisiOku(zipYolu, girdiAdi) {
  const fd = fs.openSync(zipYolu, 'r');
  try {
    const boyut = fs.fstatSync(fd).size;
    // EOCD (End Of Central Directory) son 64KB + 22 bayt içinde olmak zorunda.
    const kuyrukUzunluk = Math.min(boyut, 0x10000 + 22);
    const kuyruk = Buffer.alloc(kuyrukUzunluk);
    fs.readSync(fd, kuyruk, 0, kuyrukUzunluk, boyut - kuyrukUzunluk);
    let eocd = -1;
    for (let i = kuyruk.length - 22; i >= 0; i--) {
      if (kuyruk.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return { hata: 'APK bir ZIP arşivi gibi okunamadı (EOCD bulunamadı).' };

    const girdiSayisi = kuyruk.readUInt16LE(eocd + 10);
    const cdBoyut = kuyruk.readUInt32LE(eocd + 12);
    const cdOfset = kuyruk.readUInt32LE(eocd + 16);
    if (cdOfset === 0xffffffff || cdBoyut === 0xffffffff) {
      return { hata: 'APK ZIP64 biçiminde — bu okuyucu desteklemiyor.' };
    }

    const cd = Buffer.alloc(cdBoyut);
    fs.readSync(fd, cd, 0, cdBoyut, cdOfset);

    let p = 0;
    for (let i = 0; i < girdiSayisi; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) break;
      const yontem = cd.readUInt16LE(p + 10);
      const sikBoyut = cd.readUInt32LE(p + 20);
      const adUzunluk = cd.readUInt16LE(p + 28);
      const ekUzunluk = cd.readUInt16LE(p + 30);
      const yorumUzunluk = cd.readUInt16LE(p + 32);
      const yerelOfset = cd.readUInt32LE(p + 42);
      const ad = cd.toString('utf8', p + 46, p + 46 + adUzunluk);

      if (ad === girdiAdi) {
        // Yerel başlıktaki ad/ek uzunlukları merkezî dizindekinden farklı olabilir.
        const yb = Buffer.alloc(30);
        fs.readSync(fd, yb, 0, 30, yerelOfset);
        if (yb.readUInt32LE(0) !== 0x04034b50) {
          return { hata: 'ZIP yerel başlığı bozuk.' };
        }
        const veriOfset = yerelOfset + 30 + yb.readUInt16LE(26) + yb.readUInt16LE(28);
        const ham = Buffer.alloc(sikBoyut);
        fs.readSync(fd, ham, 0, sikBoyut, veriOfset);
        if (yontem === 0) return { veri: ham };
        if (yontem === 8) return { veri: zlib.inflateRawSync(ham) };
        return { hata: `Desteklenmeyen ZIP sıkıştırma yöntemi: ${yontem}` };
      }
      p += 46 + adUzunluk + ekUzunluk + yorumUzunluk;
    }
    return { hata: `APK içinde "${girdiAdi}" bulunamadı.` };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Doğrulama başarısızsa APK'yı kanonik yolundan taşı: deploy notları
 * `app-release.apk` yolunu gösteriyor, güvenilmeyen paket orada DURMAMALI.
 * Silmiyoruz — kanıt incelenebilsin.
 */
function apkyiReddet(apkYolu) {
  if (!fs.existsSync(apkYolu)) return null;
  const hedef = apkYolu.replace(/\.apk$/i, '') + '.DOGRULANMADI.apk';
  try {
    fs.rmSync(hedef, { force: true });
    fs.renameSync(apkYolu, hedef);
    return hedef;
  } catch {
    return null;
  }
}

function apkDogrula(beklenenAdres, { derlemeBaslangici, apkYolu = APK_PATH } = {}) {
  baslik('(3/4) DOĞRULAMA — APK içindeki bundle');

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

  // NOT (tuzak): release bundle'ı Hermes bytecode'dur. SAF ASCII dizeler
  // string tablosunda düz metin durur ve aranabilir; Türkçe özel karakterli
  // dizeler UTF-16 tablosuna gider ve BULUNAMAZ. Bu yüzden doğrulama yalnız
  // ASCII olan URL üzerinden yapılır — Türkçe bir metni aramak yanlış alarm
  // üretir (2026-07-31 gecesi tam olarak bu yaşandı).
  const metin = veri.toString('latin1');

  const gecenSayi = metin.split(beklenenAdres).length - 1;
  bilgi(`Bundle boyutu   : ${(veri.length / 1024 / 1024).toFixed(1)} MB`);
  bilgi(`Aranan adres    : ${beklenenAdres}`);
  bilgi(`Bulunma sayısı  : ${gecenSayi}`);

  // Bundle içindeki tüm ".../api" biçimli adresleri topla — hem teşhis hem
  // "başka bir adres sızmış mı" kontrolü için.
  // NOT: Hermes string tablosunda dizeler UÇ UCA paketlenir (sonlandırıcı bayt
  // yok), yani "…/api" hemen ardından bambaşka bir dizenin harfleri gelebilir.
  // Bu yüzden "/api'den sonra harf/rakam GELMESİN" gibi bir sondaj (lookahead)
  // KULLANILMAZ — gerçek adresi bile eleyip "hiçbir adres yok" der (ilk
  // denemede tam olarak bu oldu).
  const bulunanlar = [
    ...new Set(metin.match(/https?:\/\/[A-Za-z0-9._-]+(?::\d{2,5})?\/api/g) ?? []),
  ];

  if (gecenSayi === 0) {
    apkyiReddet(apkYolu);
    dur(
      'APK BEKLENEN ADRESİ TAŞIMIYOR',
      `Beklenen : ${beklenenAdres}`,
      `Bulunan  : ${bulunanlar.length ? bulunanlar.join(', ') : '(hiçbir /api adresi yok)'}`,
      '',
      'Muhtemel sebep: bundle önbellekten geldi (bu script temizliyor olmalıydı)',
      'ya da derleme sırasında ortam değişkeni farklıydı.',
      '',
      'APK kanonik yolundan taşındı — SAHAYA KURMA.',
    );
  }

  // Sayısal IP taşıyan FARKLI bir /api adresi = bayat sunucu adresi sızıntısı.
  // (Host adı taşıyanlar bilgi olarak basılır, engellemez.)
  const yabanciIp = bulunanlar.filter(
    (u) => u !== beklenenAdres && /^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}/.test(u),
  );
  if (yabanciIp.length) {
    apkyiReddet(apkYolu);
    dur(
      'APK içinde BAŞKA bir sunucu adresi var',
      `Beklenen : ${beklenenAdres}`,
      `Yabancı  : ${yabanciIp.join(', ')}`,
      '',
      'Bayat bir adres bundle içinde kalmış — paket GÜVENİLMEZ.',
      'APK kanonik yolundan taşındı — SAHAYA KURMA.',
    );
  }

  const digerleri = bulunanlar.filter((u) => u !== beklenenAdres);
  if (digerleri.length) bilgi(`Diğer /api dizeleri (bilgi): ${digerleri.join(', ')}`);

  bilgi('✔ Gömülü sunucu adresi DOĞRULANDI.');
  return stat;
}

/* ------------------------------------------------------------------ *
 * Akış
 * ------------------------------------------------------------------ */

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
  baslik('(4/4) HAZIR');
  bilgi(`APK      : ${apkYolu}`);
  bilgi(`Boyut    : ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
  bilgi(`Sürüm    : ${s.gradleVersionName ?? '?'} (versionCode ${s.gradleVersionCode ?? '?'})`);
  bilgi(`Sunucu   : ${adres}   ← bundle içinde doğrulandı`);
  bilgi(`SHA-256  : ${sha}`);
  bilgi(`Zaman    : ${stat.mtime.toLocaleString('tr-TR')}`);
  console.log('');
  bilgi('Kurulum  : adb install -r "<apk yolu>"');
  bilgi('İmza uyuşmazlığı derse: tabletten kaldır + yeniden kur (operatör yeniden login olur).');
  console.log('');
}

async function main() {
  const { deger, kaynak } = adresiCoz();
  const adres = adresiDogrula(deger, kaynak);

  baslik('TeksERP Mobil — RELEASE APK');
  bilgi(`Sunucu adresi : ${adres}`);
  bilgi(`Kaynak        : ${kaynak}`);
  celiskiliEnvUyar(adres);
  await sunucuyuYokla(adres);

  if (SADECE_KONTROL) {
    // Sürüm kapısı UCUZ yolda da koşar. Eskiden yalnız gerçek derlemede
    // çalışıyordu; oysa `--check`'in varlık sebebi "sahaya paket hazırlamadan
    // önce saniyeler içinde doğrula" — sürüm kayması tam olarak orada
    // yakalanmalı, 70 saniyelik derlemenin ortasında değil.
    surumBas();
    console.log('\n  ✔ Ön kontrol tamam (--check): adres ve sürüm tutarlı. Derleme YAPILMADI.\n');
    return;
  }

  if (SADECE_DOGRULA) {
    // --verify-only[=<yol>] : derleme YOK, yalnız paketi denetle.
    const ozelYol = arg('verify-only');
    const hedef = ozelYol ? path.resolve(process.cwd(), ozelYol) : APK_PATH;
    if (!fs.existsSync(hedef)) {
      dur('Doğrulanacak APK bulunamadı', hedef, 'Önce derle: npm run build:apk');
    }
    if (hedef !== APK_PATH) uyari(`Kanonik yol dışındaki APK denetleniyor: ${hedef}`);
    const sVerify = surumBas();
    const stat = apkDogrula(adres, { apkYolu: hedef });
    ozet(adres, sVerify, stat, hedef);
    return;
  }

  androidVarMi();
  const s = surumBas();

  const derlemeBaslangici = Date.now();
  onbellekleriTemizle();
  gradleKos(adres);
  const stat = apkDogrula(adres, { derlemeBaslangici });
  ozet(adres, s, stat);
}

// Beklenmedik istisna da GÜRÜLTÜLÜ bitsin: çıplak yığın izi operatöre
// "derleme oldu mu, olmadı mı" sorusunu bıraktığı için önce net bir başlık,
// sonra teşhis için yığın izi basılır. Her hâlükârda exit 1.
main().catch((e) => {
  console.error(`\n${BAR}\n  ✖ HATA — Beklenmedik bir sorun oluştu, APK GÜVENİLMEZ\n${BAR}`);
  console.error(e?.stack ?? String(e));
  console.error(`${BAR}\n`);
  process.exit(1);
});
