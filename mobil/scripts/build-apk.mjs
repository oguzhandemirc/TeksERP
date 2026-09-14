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
import {
  adresiCoz as adresiCozPaylasilan,
  envDosyasiOku,
  ENV_DOSYALARI,
  guncellemeAdresiCoz,
  manifestUrl,
  musteriOku,
  feedUrl,
} from './lib/adres.mjs';

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
// Adres çözümü ARTIK PAYLAŞILAN MODÜLDE: `scripts/lib/adres.mjs`.
// Sebep: uzaktan güncelleme paketini üreten `yayinla-ota.mjs` de AYNI adresi
// çözmek zorunda. İki kopya, aynı gün üretilen APK ile paketin farklı sunucuya
// bakmasına yol açardı — ve bu ayrışma hiçbir hata basmaz.

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
 * (f2) Sürüm notu kapısı — APK yolunun OTA ikizi
 * ------------------------------------------------------------------ */

/**
 * Not yazılmadan sürüm çıkmaz (kök CLAUDE.md). OTA yolu (`yayinla-ota.mjs`) bu
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
}

/* ------------------------------------------------------------------ *
 * (d) assembleRelease
 * ------------------------------------------------------------------ */

function gradleKos(adres) {
  const ortam = derlemeOrtami();
  baslik('(2/4) DERLEME — ./gradlew assembleRelease');
  bilgi(`Gömülecek adres: ${adres}`);
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
  const sonuc = spawnSync(komut, ['assembleRelease'], {
    cwd: ANDROID_DIR,
    stdio: 'inherit',
    shell: win,
    // Adres AÇIKÇA çocuk sürece geçiyor: @expo/env sistem ortamındaki
    // değişkenin üstüne YAZMAZ, dolayısıyla `.env.local` bunu ezemez.
    // ⚠️ SDK ve JDK AÇIKÇA geçiyor: kabuk profilinde `export` olmasa da derleme
    // koşar. Kullanıcının `.zshrc`ine bağımlı bir derleme, yeni makinede ve
    // otomasyonda sessizce düşer.
    env: {
      ...process.env,
      EXPO_PUBLIC_API_URL: adres,
      ANDROID_HOME: ortam.sdk,
      ANDROID_SDK_ROOT: ortam.sdk,
      JAVA_HOME: ortam.jdk,
      PATH: `${path.join(ortam.jdk, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
    },
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
function guncellemeKapisi() {
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

  const appCfg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8')).expo;
  const rvBeklenen = String(appCfg.runtimeVersion ?? '');

  // ⚠️⚠️ BEKLENEN ADRES `musteri.json`DAN DEĞİL, KOMUT ARGÜMANINDAN TÜRETİLİR.
  //
  // Bu, kapının çalışmasının TEK sebebi. Eski hâlinde beklenen adres
  // `feed.cjs`ten geliyordu — ama `app.config.js` de adresi AYNI dosyadan
  // türetiyor. Yani müşteri kodu yanlışsa ikisi de aynı yanlışı söyler ve kapı
  // GEÇERDİ. Tek müşteriyle görünmez; ikinci fabrikada onun tabletleri birinci
  // müşterinin güncellemesini çeker (sessiz, geri dönüşü elle tur).
  //
  // GENEL KURAL: beklenen değeri, gerçek değerle AYNI kaynaktan alan bir kapı,
  // o kaynağın yanlış olmasını yakalayamaz. Beklenen değer bağımsız bir NİYET
  // BEYANINDAN gelmeli — burada operatörün yazdığı `--musteri`.
  const musteriArg = arg('musteri');
  const dosyadaki = musteriOku();
  if (!musteriArg) {
    dur(
      'HANGİ MÜŞTERİ İÇİN DERLENİYOR?',
      '`--musteri=<kod>` zorunludur. Bu bir formalite değil: adres pakete',
      'gömülür ve yanlış müşteri kodu, o fabrikanın tabletlerine BAŞKA bir',
      'fabrikanın güncellemesini çektirir.',
      '',
      `Bu ağaç şu an "${dosyadaki.kod}" (${dosyadaki.ad}) için yapılandırılmış.`,
      `Örnek:  npm run build:apk -- --musteri=${dosyadaki.kod}`,
    );
  }
  if (musteriArg !== dosyadaki.kod) {
    dur(
      'MÜŞTERİ UYUŞMAZLIĞI',
      `komutta      : ${musteriArg}`,
      `musteri.json : ${dosyadaki.kod}`,
      '',
      'Ağaç başka bir müşteri için yapılandırılmış. Değiştirmek bilinçli ve',
      'kayıtlı bir hamle olmalı:',
      `  1) musteri.json → { "kod": "${musteriArg}", "ad": "…" }`,
      '  2) npx expo prebuild --platform android   (adres manifeste yeniden yazılır)',
      '  3) tekrar: npm run build:apk -- --musteri=' + musteriArg,
    );
  }
  const beklenenUrl = manifestUrl(feedUrl(musteriArg), rvBeklenen);

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
  bilgi(`Manifest KOD İMZASI     : ${sertifika ? 'sertifika gömülü' : '(YOK)'}`);
  bilgi(`Beklenen müşteri        : ${musteriArg} (komut argümanından)`);

  const sorunlar = [];
  if (acik !== 'true') sorunlar.push(`ENABLED "${acik ?? 'yok'}" (beklenen: true)`);
  // ⚠️ Paket internetten geliyor: imzasız bir APK, sunucuya sızan birinin
  // sahadaki HER tablete istediği kodu göndermesi demektir. Sertifika APK'ya
  // gömülü DEĞİLSE istemci imzayı hiç KONTROL ETMEZ (FileDownloader.kt:559).
  if (!sertifika) sorunlar.push('CODE_SIGNING_CERTIFICATE yok — istemci imzayı hiç kontrol etmez');
  if (!imzaMeta) sorunlar.push('CODE_SIGNING_METADATA yok');
  if (url !== beklenenUrl) sorunlar.push(`EXPO_UPDATE_URL "${url ?? 'yok'}" ≠ "${beklenenUrl}"`);
  if (rvBeklenen && rv !== rvBeklenen)
    sorunlar.push(`EXPO_RUNTIME_VERSION "${rv ?? 'yok'}" ≠ app.json "${rvBeklenen}"`);

  if (sorunlar.length) {
    dur(
      'ANDROIDMANIFEST UZAKTAN GÜNCELLEMEYE HAZIR DEĞİL',
      ...sorunlar.map((x) => `• ${x}`),
      '',
      'Sebep neredeyse her zaman aynı: `expo prebuild` bu adresle koşulmadı.',
      'android/ klasörü git dışıdır ve prebuild ÇIKTISIDIR — elde kalan eski',
      'klasör doğru görünür ama eski (ya da hiç) güncelleme adresi taşır.',
      '',
      'Çözüm (aynı adresle):',
      `  EXPO_PUBLIC_API_URL=<erp adresi> npx expo prebuild --platform android`,
      '  sonra tekrar: npm run build:apk',
      '',
      '⚠️ prebuild sonrası cleartext bayrağını da doğrula:',
      "  grep -o 'usesCleartextTraffic=\"[^\"]*\"' android/app/src/main/AndroidManifest.xml",
    );
  }
  bilgi('✔ Uzaktan güncelleme yapılandırması APK ile tutarlı.');
}

/**
 * MÜHÜR KAPISI — üretilen APK bizim imza anahtarımızla mı imzalandı?
 *
 * ⚠️ NEDEN: `android/` prebuild çıktısıdır ve imza yapılandırması bir eklentiyle
 * (plugins/withReleaseKeystore.js) her prebuild'de yeniden yazılır. Eklenti
 * bozulur/atlanırsa React Native şablonunun varsayılanı devreye girer ve release
 * APK **Android'in herkese açık DENEME mührüyle** imzalanır. O APK sorunsuz
 * derlenir, kurulur, çalışır — tek farkı sahadaki tabletlere KURULAMAMASIDIR
 * (imza uyuşmazlığı), ve o noktada tek çare uygulamayı silip yeniden kurmaktır.
 *
 * Beklenen parmak izi ayrı bir dosyada TUTULMAZ, mührün kendisinden okunur:
 * ikinci bir kaynak, mühür değiştiğinde bayatlayıp yanlış alarm üretirdi.
 */
function imzaKapisi(apkYolu) {
  const propYol = path.join(PROJECT_ROOT, 'keystore/keystore.properties');
  if (!fs.existsSync(propYol)) {
    dur(
      'RELEASE MÜHRÜ BULUNAMADI',
      `Beklenen: ${propYol}`,
      'Bu dosya olmadan APK deneme mührüyle imzalanır ve sahadaki tabletlere',
      'KURULAMAZ. Mührü yedekten geri koy (şifresiyle birlikte).',
    );
  }
  const props = Object.fromEntries(
    fs
      .readFileSync(propYol, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );

  /** `AB:CD:...` ya da `abcd...` → karşılaştırılabilir düz küçük harf hex. */
  const duzHex = (x) => (x ?? '').replace(/:/g, '').toLowerCase();

  /**
   * ⚠️ ARAÇ SEÇİMİ ÖLÇÜLDÜ (2026-08-26): `keytool -printcert -jarfile` yalnız
   * **v1 (jar)** imzasını okur. minSdk 26 olduğu için AGP v1'i KAPATIR ve APK
   * yalnız v2/v3 şemasıyla imzalanır → keytool hiçbir çıktı vermez. Doğru araç
   * `apksigner`dır (Android SDK build-tools). keytool yalnız yedek yoldur.
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
        .filter((d) => fs.existsSync(path.join(bt, d, ad)))
        .sort();
      if (surumler.length) return path.join(bt, surumler[surumler.length - 1], ad);
    }
    return null;
  };

  // ⚠️ `keytool` JDK'DAN GELİR — Gradle'a JDK vermek YETMEZ, bu adım ayrı bir
  // süreçtir ve PATH'ten arar. Kabuk profilinde JAVA_HOME yoksa derleme geçer
  // ama doğrulama "Mühür okunamadı" ile düşer ve hata, sebebi (yanlış şifre mi,
  // eksik JDK mi) AYIRT ETMEZ — 2026-09-04'te temiz kabukta birebir yaşandı.
  const jdkKok = jdkKokBul();
  const javaOrtam = jdkKok
    ? { ...process.env, JAVA_HOME: jdkKok, PATH: `${path.join(jdkKok, 'bin')}${path.delimiter}${process.env.PATH ?? ''}` }
    : process.env;

  const magaza = spawnSync(
    'keytool',
    [
      '-list', '-v',
      '-keystore', path.join(PROJECT_ROOT, 'keystore', props.storeFile),
      '-alias', props.keyAlias,
      '-storepass', props.storePassword,
    ],
    { encoding: 'utf8', env: javaOrtam },
  );
  const beklenen = duzHex(/SHA256:\s*([0-9A-F:]+)/i.exec(magaza.stdout ?? '')?.[1] ?? '');

  let bulunan = '';
  let aracHatasi = '';
  const apksigner = apksignerBul();
  if (apksigner) {
    // apksigner bir kabuk betiğidir ve içeriden `java` çağırır → JDK ortamı ŞART.
    const r = spawnSync(apksigner, ['verify', '--print-certs', apkYolu], { encoding: 'utf8', env: javaOrtam });
    // v1/v2/v3 imzacılarının HEPSİ aynı sertifikayı taşır; ilk eşleşme yeter.
    bulunan = duzHex(/certificate SHA-256 digest:\s*([0-9a-f]+)/i.exec(r.stdout ?? '')?.[1] ?? '');
    if (!bulunan) aracHatasi = (r.stderr || r.stdout || '').trim().split('\n')[0] ?? '';
  } else {
    aracHatasi = 'apksigner bulunamadı (Android SDK build-tools).';
  }
  if (!bulunan) {
    // Yedek yol: v1 imzalı APK'lar için keytool.
    const r = spawnSync('keytool', ['-printcert', '-jarfile', apkYolu], { encoding: 'utf8', env: javaOrtam });
    bulunan = duzHex(/SHA256:\s*([0-9A-F:]+)/i.exec(r.stdout ?? '')?.[1] ?? '');
  }

  baslik('MÜHÜR (İMZA) DOĞRULAMASI');
  if (!beklenen) {
    dur('Mühür okunamadı', 'keytool `keystore/` altındaki anahtarı açamadı — şifre/alias yanlış olabilir.');
  }
  if (!bulunan) {
    // keytool APK imzasını okuyamadıysa SESSİZCE GEÇME: doğrulanamayan imza,
    // doğrulanmış imza değildir.
    dur(
      'APK imzası okunamadı',
      aracHatasi || '(araç çıktı vermedi)',
      'Elle doğrula:',
      `  apksigner verify --print-certs "${apkYolu}"`,
    );
  }
  bilgi(`Mühür  : ${beklenen}`);
  bilgi(`APK    : ${bulunan}`);
  if (beklenen !== bulunan) {
    apkyiReddet(apkYolu);
    dur(
      'APK YANLIŞ MÜHÜRLE İMZALANMIŞ',
      'Üretilen paket bizim imza anahtarımızı taşımıyor — büyük olasılıkla',
      'deneme (debug) mührüyle imzalandı ve sahadaki tabletlere KURULAMAZ.',
      '',
      'Kontrol et: plugins/withReleaseKeystore.js eklentisi app.json `plugins`',
      'listesinde mi ve prebuild bu eklentiyle koştu mu?',
    );
  }
  bilgi('✔ APK bizim mührümüzle imzalanmış.');
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
  const { deger, kaynak } = adresiCozPaylasilan(arg('api-url'), PROJECT_ROOT);
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
    surumNotuKapisi(surumBas());
    // Güncelleme kapısı ucuz yolda da koşar — "prebuild'i unuttum" hatası
    // 70 saniyelik derlemenin sonunda değil, saniyeler içinde görünsün.
    // android/ henüz üretilmemişse kapı atlanır (androidVarMi zaten söyler).
    if (fs.existsSync(path.join(ANDROID_DIR, 'app/src/main/AndroidManifest.xml'))) {
      guncellemeKapisi();
    } else {
      uyari('android/ klasörü yok — uzaktan güncelleme yapılandırması denetlenemedi.');
    }
    // ⚠️ ORTAM DENETİMİ EN SONDA VE --check'İN PARÇASI: derleme ortamı eksikse
    // bunu 6 dakikalık bir Gradle koşumunun ORTASINDA değil, ön kontrolde
    // öğrenmek gerekir. `derlemeOrtami()` eksikte kurulum komutuyla DURDURUR.
    baslik('DERLEME ORTAMI');
    const ortamCheck = derlemeOrtami();
    bilgi(`Android SDK : ${ortamCheck.sdk}`);
    bilgi(`Java (JDK)  : ${ortamCheck.jdk}`);
    console.log('\n  ✔ Ön kontrol tamam (--check): adres, sürüm, güncelleme yapılandırması ve derleme ortamı tutarlı. Derleme YAPILMADI.\n');
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
    imzaKapisi(hedef);
    ozet(adres, sVerify, stat, hedef);
    return;
  }

  androidVarMi();
  const s = surumBas();
  surumNotuKapisi(s);
  guncellemeKapisi();

  const derlemeBaslangici = Date.now();
  onbellekleriTemizle();
  gradleKos(adres);
  const stat = apkDogrula(adres, { derlemeBaslangici });
  imzaKapisi(APK_PATH);
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
