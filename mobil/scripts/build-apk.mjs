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
 * ORTAK PAKET (tek ortak paket O7): `--musteri` VERİLMEZSE derlenen TEK ORTAK PAKETTİR — kimlik
 * dağıtım kaydından (`scripts/lib/ortak-kimlik.cjs`), ERP adresi GÖMÜLMEZ (tablet sunucuyu çalışma
 * anında bulur), güncelleme adresi grup-nötr Worker takma adı. Terfi bu derlemede değil, grup yayınında.
 * OTA sertifikası yoksa (anahtar töreni yapılmadıysa) derleme DURUR ve üretim komutunu basar.
 *
 * KANAL (2026-09-27): `--musteri=<kod>` hedef kanaldır (niyet); kimlik — paket adı,
 * görünen ad, güncelleme adresi, OTA sertifikası, ERP adresi — `deploy/kanallar.json`dan.
 * Çocuk süreçlere `TEKSERP_KANAL` geçer (app.config.js kimliği onunla uygular); APK'nın
 * kendi kimliği derlemeden SONRA ölçülür, hedef kanalınki değilse paket reddedilir.
 *
 * Kullanım:
 *   npm run build:apk                                       # ORTAK PAKET (argümansız)
 *   npm run build:apk:check                                 # ortak paket ön kontrolü, derleme YOK
 *   npm run build:apk:verify                                # mevcut APK'yı ortak kimliğe karşı denetle
 *   npm run build:apk -- --musteri=<kod>                    # ESKİ KANAL; ERP adresi kanal kaydından
 *   npm run build:apk -- --musteri=<kod> --api-url=<adres>  # açık adres kanalınkiyle EŞİT olmalı
 *   npm run build:apk:check -- --musteri=<kod>              # yalnız ön kontrol, derleme YOK
 *   npm run build:apk:verify -- --musteri=<kod>             # mevcut APK'yı kanala karşı denetle
 *   … --yoklama-yok                                         # /health yoklamasını atla (ağa çıkma)
 *   … --terfi-atla="<kullanıcının cümlesi>"                 # K5 acil kaçışı (S4) — terfi kapısını atla
 *
 * TERFİ (K5): `terfiKaynagi` olan kanala (adnansahin) APK yalnız terfi etiketli commit'ten,
 * hazırlık kanalında yayınlanmış sürümle derlenir (scripts/lib/terfi.mjs). `--yoklama-yok`
 * terfi kapısının kaynak kanal okumasını ATLAMAZ: o bir uyarı değil kapıdır.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  adresiCoz as adresiCozPaylasilan,
  envDosyasiOku,
  ENV_DOSYALARI,
  manifestUrl,
  bundleAdresOlcumu,
  ortakBundleAdresleri,
} from './lib/adres.mjs';
import { zipGirdisiOku } from './lib/zip.mjs';
import { ApkOlculemedi, apkKimligi, sertifikaParmakIzi } from './lib/apk-kimlik.mjs';
import { KANAL_ORTAM, tabletYapilandirmaFarki } from './lib/kanal.cjs';
import { anahtarToreniKomutu, ortakKaydiOku, ortakKimlik, ortakYapilandirmaFarki } from './lib/ortak-kimlik.cjs';
import { kayitHatalari, KAYIT_REL as DAGITIM_REL, turet } from '../../scripts/lib/dagitim.mjs';
import { KAYIT_REL, Olculemedi, erpAdresiEsit, kanalCoz } from '../../scripts/lib/kanallar.mjs';
import { terfiKapisi, terfiRaporu } from '../../scripts/lib/terfi.mjs';
import { apkKunyeYolu, derlemeKunyesiYaz, temizAgacDenetimi } from '../../scripts/lib/derleme-bagi.mjs';

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
/** `/health` yoklaması UYARIDIR, kapı değil; derleyen makinenin ağa çıkmaması gerekiyorsa atlanır. */
const YOKLAMA_YOK = argv.includes('--yoklama-yok');

/* ------------------------------------------------------------------ *
 * KANAL KAPISI (K2) — hangi kanalın kimliğiyle derleniyor?
 * ------------------------------------------------------------------ */

/**
 * Beklenen kimlik NİYETTEN (`--musteri`) çözülür, ağaçtan değil: `musteri.json` dinlenme
 * işaretçisidir ve app.config.js de ondan türettiği için ikisi aynı yanlışı söylerdi.
 * Bilinmeyen kod / kırmızı kayıt hiçbir şey yapılmadan DURUR.
 */
function kanalKapisi() {
  const kod = arg('musteri');
  if (!kod) {
    dur(
      'HANGİ KANAL İÇİN DERLENİYOR?',
      '`--musteri=<kod>` zorunludur. Paket adı, güncelleme adresi, OTA sertifikası ve',
      'ERP adresi pakete gömülür; yanlış kanal, o kanalın tabletlerine BAŞKA bir kanalın',
      'kimliğini taşır (sessiz).',
      '',
      `Kanallar: ${KAYIT_REL}`,
      'Örnek:  npm run build:apk -- --musteri=<kod>',
    );
  }
  let kanal;
  try {
    ({ kanal } = kanalCoz(kod));
  } catch (e) {
    if (e instanceof Olculemedi) dur(`KANAL KAYIT DEFTERİ ÖLÇÜLEMEDİ (${KAYIT_REL})`, e.message);
    dur(e.message, ...(e.satirlar ?? []));
  }
  const ortamdaki = String(process.env[KANAL_ORTAM] ?? '').trim();
  if (ortamdaki && ortamdaki !== kod) {
    dur('KANAL ÇELİŞKİSİ', `komutta           : ${kod}`, `${KANAL_ORTAM} ortamı : ${ortamdaki}`, 'İkisi aynı kanalı söylemeli.');
  }
  // Gradle'ın koşturduğu expo-constants / expo-updates adımları yapılandırmayı bu kanalla gömer.
  process.env[KANAL_ORTAM] = kod;
  return { kod, kanal };
}

/** Çözülen ERP adresi kanalın adresi mi (açık verilen adres de kanalınkiyle EŞİT olmalı). */
function erpKanalKapisi(adres, kaynak, kod, kanal) {
  if (!erpAdresiEsit(adres, kanal.tablet.erpAdresi)) {
    dur(
      `ERP ADRESİ "${kod}" KANALININ DEĞİL`,
      `çözülen adres : ${adres}  (kaynak: ${kaynak})`,
      `kanalın adresi: ${kanal.tablet.erpAdresi}  (${KAYIT_REL})`,
      '',
      'Bu APK bu kanalın tabletlerini BAŞKA bir sunucuya bağlardı — ve bu sessizdir.',
      'Adres gerçekten değiştiyse önce kayıt defteri değişir (üretim kanalında bu bir GÖÇTÜR).',
    );
  }
}

/** Uygulamanın `runtimeVersion`ı — app.json kanaldan bağımsızdır (uyum kimliği). */
function rvOku() {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8')).expo?.runtimeVersion ?? '');
  } catch {
    return '';
  }
}

/** Kanalın OTA sertifikasının DER parmak izi; dosya yoksa null (çağıran ölçülemedi der). */
function kanalSertifikaIzi(kanal) {
  try {
    return sertifikaParmakIzi(fs.readFileSync(path.join(PROJECT_ROOT, kanal.tablet.otaSertifika), 'utf8'));
  } catch {
    return null;
  }
}

/** Kanal derlemesi için prebuild komutu — mesajlarda tek yazım. */
const prebuildKomutu = (kod) => `${KANAL_ORTAM}=${kod} npx expo prebuild --platform android --clean --no-install`;

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
  const sonuc = spawnSync(komut, ['assembleRelease'], {
    cwd: ANDROID_DIR,
    stdio: 'inherit',
    shell: win,
    // Adres AÇIKÇA çocuk sürece geçiyor: @expo/env sistem ortamındaki
    // değişkenin üstüne YAZMAZ, dolayısıyla `.env.local` bunu ezemez.
    // ⚠️ SDK ve JDK AÇIKÇA geçiyor: kabuk profilinde `export` olmasa da derleme
    // koşar. Kullanıcının `.zshrc`ine bağımlı bir derleme, yeni makinede ve
    // otomasyonda sessizce düşer.
    env: derlemeEnv(adres, ortam),
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
  const hedef = apkYolu.replace(/\.apk$/i, '') + '.DOGRULANMADI.apk';
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

function apkDogrula(beklenenAdres, { derlemeBaslangici, apkYolu = APK_PATH } = {}) {
  baslik('(3/4) DOĞRULAMA — APK içindeki bundle');
  const { stat, veri } = bundleOku(apkYolu, derlemeBaslangici);

  // NOT (tuzak): release bundle'ı Hermes bytecode'dur. SAF ASCII dizeler
  // string tablosunda düz metin durur ve aranabilir; Türkçe özel karakterli
  // dizeler UTF-16 tablosuna gider ve BULUNAMAZ. Bu yüzden doğrulama yalnız
  // ASCII olan URL üzerinden yapılır — Türkçe bir metni aramak yanlış alarm
  // üretir (2026-07-31 gecesi tam olarak bu yaşandı).
  const metin = veri.toString('latin1');

  // Ölçüm TEK yardımcıda (lib/adres.mjs) — OTA üretimi ve yayın kapısı da onu kullanır.
  const { gecenSayi, bulunanlar, yabanciIp } = bundleAdresOlcumu(metin, beklenenAdres);
  bilgi(`Bundle boyutu   : ${(veri.length / 1024 / 1024).toFixed(1)} MB`);
  bilgi(`Aranan adres    : ${beklenenAdres}`);
  bilgi(`Bulunma sayısı  : ${gecenSayi}`);

  // Hermes dizeleri uç uca paketler; lookahead YOK (gerekçe: bundleAdresOlcumu).
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
  bilgi(`Manifest KOD İMZASI     : ${sertifika ? 'sertifika gömülü' : '(YOK)'}`);

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
  return { url, rv, acik, sertifika, imzaMeta, paket, uygulamaAdi, gomuluIz };
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

function guncellemeKapisi(kod, kanal) {
  const { url, rv, paket, uygulamaAdi, sertifika, gomuluIz, ...p } = prebuildKimligiOku();
  bilgi(`Beklenen kanal          : ${kod} (komut argümanından)`);
  const appCfg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8')).expo;
  const rvBeklenen = String(appCfg.runtimeVersion ?? '');

  // ⚠️⚠️ BEKLENEN KİMLİK AĞAÇTAN DEĞİL, KOMUT ARGÜMANINDAN (kanal kaydı) GELİR.
  //
  // Bu, kapının çalışmasının TEK sebebi: `app.config.js` adresi aynı kaynaktan
  // türetseydi ve beklenen de oradan gelseydi, yanlış kanal ikisinde de aynı yanlışı
  // söyler ve kapı geçerdi. GENEL KURAL: beklenen değeri, gerçek değerle AYNI
  // kaynaktan alan bir kapı, o kaynağın yanlış olmasını yakalayamaz — beklenen değer
  // bağımsız bir NİYETTEN (`--musteri`) çözülür.
  const beklenenUrl = manifestUrl(kanal.yayin.mobilFeed, rvBeklenen);
  const beklenenIz = kanalSertifikaIzi(kanal);

  const sorunlar = prebuildTemelSorunlari({ ...p, sertifika });
  if (url !== beklenenUrl) sorunlar.push(`EXPO_UPDATE_URL "${url ?? 'yok'}" ≠ "${beklenenUrl}"`);
  if (paket !== kanal.tablet.androidPaket) sorunlar.push(`applicationId "${paket ?? 'yok'}" ≠ "${kanal.tablet.androidPaket}"`);
  if (uygulamaAdi !== kanal.tablet.gorunenAd) sorunlar.push(`app_name "${uygulamaAdi ?? 'yok'}" ≠ "${kanal.tablet.gorunenAd}"`);
  if (!beklenenIz) sorunlar.push(`kanalın OTA sertifikası okunamadı: ${kanal.tablet.otaSertifika} (keystore/ git dışıdır — yedekten geri koy)`);
  else if (sertifika && gomuluIz !== beklenenIz) {
    sorunlar.push(`gömülü OTA sertifikası "${kod}" kanalınınki değil (${kanal.tablet.otaSertifika})`);
  }
  if (rvBeklenen && rv !== rvBeklenen)
    sorunlar.push(`EXPO_RUNTIME_VERSION "${rv ?? 'yok'}" ≠ app.json "${rvBeklenen}"`);

  if (sorunlar.length) {
    dur(
      'ANDROIDMANIFEST UZAKTAN GÜNCELLEMEYE HAZIR DEĞİL',
      ...sorunlar.map((x) => `• ${x}`),
      '',
      `Sebep neredeyse her zaman aynı: \`expo prebuild\` "${kod}" kanalıyla koşulmadı.`,
      'android/ klasörü git dışıdır ve prebuild ÇIKTISIDIR — elde kalan eski',
      'klasör doğru görünür ama eski (ya da başka kanalın) kimliğini taşır.',
      '',
      'Çözüm (kanal değişiminde --clean şart: paket adı Kotlin dizinlerini de değiştirir):',
      `  ${prebuildKomutu(kod)}`,
      `  sonra tekrar: npm run build:apk -- --musteri=${kod}`,
      '',
      '⚠️ prebuild sonrası cleartext bayrağını da doğrula:',
      "  grep -o 'usesCleartextTraffic=\"[^\"]*\"' android/app/src/main/AndroidManifest.xml",
    );
  }
  bilgi('✔ Uzaktan güncelleme yapılandırması APK ile tutarlı.');
}

/**
 * KANAL KİMLİĞİ (K3) — APK'nın KENDİSİ hedef kanalın mı?
 *
 * ⚠️ Prebuild çıktısını (guncellemeKapisi) ölçmek YETMEZ: Gradle yapılandırmayı derleme
 * anında YENİDEN değerlendirir (expo-constants `assets/app.config`, expo-updates gömülü
 * manifest) ve ortamda kanal yoksa dinlenme kimliğini gömer. O APK testfabrika paket
 * adıyla kurulur ama APK künyesini FABRİKA kanalından okur — sessiz. Otorite paketin
 * kendisidir: paket adı + güncelleme adresi + OTA sertifikası + çalışma anı yapılandırması.
 */
function apkKanalKapisi(apkYolu, kod, kanal) {
  baslik(`KANAL KİMLİĞİ — APK'nın kendisinden ("${kod}")`);
  let k;
  try {
    k = apkKimligi(apkYolu);
  } catch (e) {
    if (!(e instanceof ApkOlculemedi)) throw e;
    apkyiReddet(apkYolu);
    dur('ÖLÇÜLEMEDİ — APK kimliği okunamadı', e.message, 'Kimliği ölçülemeyen paket sahaya kurulmaz.');
  }
  const rv = rvOku();
  const beklenenUrl = manifestUrl(kanal.yayin.mobilFeed, rv);
  const beklenenIz = kanalSertifikaIzi(kanal);
  bilgi(`Paket adı (applicationId): ${k.paket}`);
  bilgi(`Güncelleme adresi        : ${k.guncellemeAdresi ?? '(yok)'}`);
  bilgi(`OTA sertifikası          : ${k.sertifikaPem ? 'gömülü' : '(YOK)'}`);
  bilgi(`Çalışma anı yapılandırması: ${k.appConfig ? `"${k.appConfig.name}" · ${k.appConfig.updates?.url ?? '(adres yok)'}` : '(yok)'}`);

  const sorunlar = [];
  if (k.paket !== kanal.tablet.androidPaket) sorunlar.push(`paket adı "${k.paket}" ≠ "${kanal.tablet.androidPaket}"`);
  if (k.guncellemeAcik !== 'true') sorunlar.push(`expo-updates ENABLED "${k.guncellemeAcik ?? 'yok'}" (beklenen true)`);
  if (k.guncellemeAdresi !== beklenenUrl) sorunlar.push(`EXPO_UPDATE_URL "${k.guncellemeAdresi ?? 'yok'}" ≠ "${beklenenUrl}"`);
  if (!beklenenIz) sorunlar.push(`kanalın OTA sertifikası okunamadı: ${kanal.tablet.otaSertifika} — kıyas ÖLÇÜLEMEDİ`);
  else if (!k.sertifikaPem || sertifikaParmakIzi(k.sertifikaPem) !== beklenenIz) {
    sorunlar.push(`gömülü OTA sertifikası "${kod}" kanalınınki değil (${kanal.tablet.otaSertifika})`);
  }
  if (!k.appConfig) sorunlar.push('assets/app.config yok ya da okunamadı — çalışma anı kimliği ÖLÇÜLEMEDİ');
  else sorunlar.push(...tabletYapilandirmaFarki(kanal, k.appConfig, rv, { herkese: true }).map((x) => `assets/app.config ${x}`));

  if (sorunlar.length) {
    apkyiReddet(apkYolu);
    dur(
      `APK "${kod}" KANALININ KİMLİĞİNİ TAŞIMIYOR`,
      ...sorunlar.map((x) => `• ${x}`),
      '',
      `Derleme ortamında ${KANAL_ORTAM} yoktu ya da android/ başka kanalla üretildi.`,
      `Çözüm: ${prebuildKomutu(kod)}  →  npm run build:apk -- --musteri=${kod}`,
      'APK kanonik yolundan taşındı — SAHAYA KURMA.',
    );
  }
  bilgi(`✔ APK "${kod}" kanalının kimliğini taşıyor.`);
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

/**
 * (f3) TERFİ KAPISI (K5) — üretim kanalına (`terfiKaynagi` olan) APK yalnız hazırlık kanalında
 * yayınlanmış ve kullanıcının terfi etiketiyle onayladığı commit'ten derlenir; sürüm app.json'dan
 * (APK'nın versionName'i). --check'te de koşar; --verify-only derleme/yayın değildir, koşmaz.
 */
function terfiKapisiUygula(kod, s) {
  const TERFI_ATLA = argv.some((a) => a === '--terfi-atla' || a.startsWith('--terfi-atla=')) ? (arg('terfi-atla') ?? '') : undefined;
  const h = terfiKapisi({ kod, urun: 'tablet', surum: s?.appVersion, atla: TERFI_ATLA });
  const satirlar = terfiRaporu(h, { kod, urun: 'tablet', surum: s?.appVersion });
  if (h.sonuc !== 'uyumlu') {
    dur(satirlar[0].replace(/^✖ /, ''), ...satirlar.slice(1).map((x) => x.trim()),
      h.sonuc === 'ihlal' ? 'Acil kaçış yalnız kullanıcının cümlesiyle: --terfi-atla="<cümle>" (yayın komutu da aynı cümleyi ister).' : 'Ölçülemeyen şart geçmiş şart değildir.');
  }
  if (satirlar.length) {
    baslik('TERFİ KAPISI');
    for (const x of satirlar) bilgi(x);
  }
}

function ozet(adres, s, stat, apkYolu = APK_PATH, { kod, kanal } = {}) {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(apkYolu)).digest('hex');
  baslik('(4/4) HAZIR');
  bilgi(`APK      : ${apkYolu}`);
  if (kanal) bilgi(`Kanal    : ${kod} — ${kanal.tablet.androidPaket} · "${kanal.tablet.gorunenAd}"`);
  else bilgi('Kimlik   : ORTAK PAKET (dağıtım kaydından)');
  bilgi(`Boyut    : ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
  bilgi(`Sürüm    : ${s.gradleVersionName ?? '?'} (versionCode ${s.gradleVersionCode ?? '?'})`);
  bilgi(adres ? `Sunucu   : ${adres}   ← bundle içinde doğrulandı` : 'Sunucu   : (yok — ortak paket; bundle\'da ERP adresi olmadığı doğrulandı)');
  bilgi(`SHA-256  : ${sha}`);
  bilgi(`Zaman    : ${stat.mtime.toLocaleString('tr-TR')}`);
  console.log('');
  bilgi('Kurulum  : adb install -r "<apk yolu>"');
  bilgi('İmza uyuşmazlığı derse: tabletten kaldır + yeniden kur (operatör yeniden login olur).');
  console.log('');
}

/* ------------------------------------------------------------------ *
 * ORTAK PAKET (tek ortak paket O7) — `--musteri` yoksa
 * ------------------------------------------------------------------ */

/**
 * Ortak kimlik: kayıt TAM doğrulamadan (dagitim.mjs) geçer, kimlik ortak-kimlik.cjs'ten türer ve
 * güncelleme adresi kaydın kendi türetimiyle (Worker takma adı) eşit olmalı. Ortamda eski kanal
 * varsa (`TEKSERP_KANAL`) app.config.js eski kimliği gömerdi → DUR.
 */
function ortakHedefCoz() {
  const ortamdaki = String(process.env[KANAL_ORTAM] ?? '').trim();
  if (ortamdaki) {
    dur('KANAL ÇELİŞKİSİ', 'komutta           : (yok — ortak paket)', `${KANAL_ORTAM} ortamı : ${ortamdaki}`,
      `Ortak paket derlenirken ${KANAL_ORTAM} olamaz: app.config.js eski kanalın kimliğini gömerdi.`,
      `Eski kanal derlemesi isteniyorsa: npm run build:apk -- --musteri=${ortamdaki}`);
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
      'Bir kanalın adresini gömmek isteniyorsa eski kanal derlemesi: --musteri=<kod>.');
  }
}

/** Ortak OTA sertifikasının DER parmak izi; yoksa anahtar töreni komutuyla DUR (fail-closed). */
function ortakSertifikaIzi(k) {
  const yol = path.join(PROJECT_ROOT, k.otaSertifika);
  let iz = null;
  try {
    iz = sertifikaParmakIzi(fs.readFileSync(yol, 'utf8'));
  } catch {
    iz = null;
  }
  if (!iz) {
    dur('ORTAK OTA SERTİFİKASI YOK — anahtar töreni yapılmadı ya da keystore/ geri konmadı',
      `Beklenen: ${yol}`, '',
      'Sertifikasız APK güncelleme imzasını doğrulayamaz; derleme bu yüzden DURUR.',
      'Anahtar çifti Mac\'te BİR KEZ, kullanıcıyla üretilir (şifreli yedeğin parolası kullanıcıda):',
      ...anahtarToreniKomutu(k).map((x) => `  ${x}`),
      'Sonra şifreli yedeği yenile (mobil/keystore-yedek.README.md).');
  }
  return iz;
}

/** Prebuild çıktısı (android/) ortak kimliği mi taşıyor — beklenen değer kayıttan, ağaçtan değil. */
function ortakGuncellemeKapisi(k) {
  const { url, rv, paket, uygulamaAdi, sertifika, gomuluIz, ...p } = prebuildKimligiOku();
  bilgi('Beklenen kimlik         : ORTAK PAKET (dağıtım kaydından)');
  const beklenenIz = ortakSertifikaIzi(k);
  const sorunlar = prebuildTemelSorunlari({ ...p, sertifika });
  if (url !== k.guncellemeUrl) sorunlar.push(`EXPO_UPDATE_URL "${url ?? 'yok'}" ≠ "${k.guncellemeUrl}"`);
  if (paket !== k.androidPaket) sorunlar.push(`applicationId "${paket ?? 'yok'}" ≠ "${k.androidPaket}"`);
  if (uygulamaAdi !== k.gorunenAd) sorunlar.push(`app_name "${uygulamaAdi ?? 'yok'}" ≠ "${k.gorunenAd}"`);
  if (sertifika && gomuluIz !== beklenenIz) sorunlar.push(`gömülü OTA sertifikası ortak paketinki değil (${k.otaSertifika})`);
  if (rv !== k.runtimeVersion) sorunlar.push(`EXPO_RUNTIME_VERSION "${rv ?? 'yok'}" ≠ dağıtım kaydı "${k.runtimeVersion}"`);
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
  const sorunlar = [];
  if (a.paket !== k.androidPaket) sorunlar.push(`paket adı "${a.paket}" ≠ "${k.androidPaket}"`);
  if (a.guncellemeAcik !== 'true') sorunlar.push(`expo-updates ENABLED "${a.guncellemeAcik ?? 'yok'}" (beklenen true)`);
  if (a.guncellemeAdresi !== k.guncellemeUrl) sorunlar.push(`EXPO_UPDATE_URL "${a.guncellemeAdresi ?? 'yok'}" ≠ "${k.guncellemeUrl}"`);
  if (!a.sertifikaPem || sertifikaParmakIzi(a.sertifikaPem) !== beklenenIz) sorunlar.push(`gömülü OTA sertifikası ortak paketinki değil (${k.otaSertifika})`);
  if (!a.appConfig) sorunlar.push('assets/app.config yok ya da okunamadı — çalışma anı kimliği ÖLÇÜLEMEDİ');
  else sorunlar.push(...ortakYapilandirmaFarki(a.appConfig, { herkese: true }, k).map((x) => `assets/app.config ${x}`));
  if (sorunlar.length) {
    apkyiReddet(apkYolu);
    dur('APK ORTAK PAKETİN KİMLİĞİNİ TAŞIMIYOR', ...sorunlar.map((x) => `• ${x}`), '',
      `Derleme ortamında ${KANAL_ORTAM} vardı ya da android/ eski kanalla üretildi.`,
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

async function ortakMain() {
  const k = ortakHedefCoz();
  ortakAdresKapisi();
  baslik('TeksERP Mobil — RELEASE APK (ORTAK PAKET)');
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
    console.log('\n  ✔ Ön kontrol tamam (--check): ortak kimlik, sürüm, güncelleme yapılandırması ve derleme ortamı tutarlı. Derleme YAPILMADI.\n');
    return;
  }

  if (SADECE_DOGRULA) {
    const ozelYol = arg('verify-only');
    const hedef = ozelYol ? path.resolve(process.cwd(), ozelYol) : APK_PATH;
    if (!fs.existsSync(hedef)) dur('Doğrulanacak APK bulunamadı', hedef, 'Önce derle: npm run build:apk');
    if (hedef !== APK_PATH) uyari(`Kanonik yol dışındaki APK denetleniyor: ${hedef}`);
    ortakApkKimlikKapisi(hedef, k);
    const sVerify = surumBas();
    const stat = ortakApkAdresDogrula(hedef);
    imzaKapisi(hedef);
    ozet(null, sVerify, stat, hedef);
    return;
  }

  androidVarMi();
  const s = surumBas();
  surumNotuKapisi(s);
  ortakGuncellemeKapisi(k);
  const agac = temizAgacDenetimi();
  if (agac.sonuc !== 'temiz') {
    dur(agac.sonuc === 'kirli' ? 'APK DERLENMEZ — çalışma ağacı temiz değil' : 'ÖLÇÜLEMEDİ — çalışma ağacı okunamadı', ...agac.satirlar);
  }
  bilgi(agac.satirlar[0]);
  fs.rmSync(apkKunyeYolu(APK_PATH), { force: true });

  const derlemeBaslangici = Date.now();
  onbellekleriTemizle();
  gradleKos(null);
  const stat = ortakApkAdresDogrula(APK_PATH, derlemeBaslangici);
  ortakApkKimlikKapisi(APK_PATH, k);
  imzaKapisi(APK_PATH);
  // Künyenin kanalı null = ortak paket; grup yayında bağlanır (O10b).
  derlemeKunyesiBirak(null, agac.commit);
  ozet(null, s, stat, APK_PATH);
}

async function main() {
  // Niyet: `--musteri` yoksa ortak paket (eski kanal yolu aşağıda, değişmedi).
  if (arg('musteri') === undefined) return ortakMain();
  const { kod, kanal } = kanalKapisi();
  const { deger, kaynak } = adresiCozPaylasilan(arg('api-url'), PROJECT_ROOT, {
    kod,
    erpAdresi: kanal.tablet.erpAdresi,
  });
  const adres = adresiDogrula(deger, kaynak);
  erpKanalKapisi(adres, kaynak, kod, kanal);

  baslik('TeksERP Mobil — RELEASE APK');
  bilgi(`Kanal         : ${kod} (${kanal.tur}) — paket ${kanal.tablet.androidPaket} · "${kanal.tablet.gorunenAd}"`);
  bilgi(`Sunucu adresi : ${adres}`);
  bilgi(`Kaynak        : ${kaynak}`);
  celiskiliEnvUyar(adres);
  if (YOKLAMA_YOK) bilgi('Sunucu yoklaması: ATLANDI (--yoklama-yok) — adres kanal kaydıyla kıyaslandı, erişim ölçülmedi.');
  else await sunucuyuYokla(adres);

  if (SADECE_KONTROL) {
    // Sürüm kapısı UCUZ yolda da koşar. Eskiden yalnız gerçek derlemede
    // çalışıyordu; oysa `--check`'in varlık sebebi "sahaya paket hazırlamadan
    // önce saniyeler içinde doğrula" — sürüm kayması tam olarak orada
    // yakalanmalı, 70 saniyelik derlemenin ortasında değil.
    const sCheck = surumBas();
    surumNotuKapisi(sCheck);
    terfiKapisiUygula(kod, sCheck);
    // Temiz ağaç (G22) ön kontrolde yalnız SÖYLENİR; gerçek derleme kirli ağaçta DURUR.
    const agacCheck = temizAgacDenetimi();
    if (agacCheck.sonuc === 'temiz') bilgi(agacCheck.satirlar[0]);
    else uyari(`${agacCheck.satirlar.join('\n     ')}\n     (--check: uyarı — gerçek derleme bu ağaçta APK ÜRETMEZ)`);
    // Güncelleme kapısı ucuz yolda da koşar — "prebuild'i unuttum" hatası
    // 70 saniyelik derlemenin sonunda değil, saniyeler içinde görünsün.
    // android/ henüz üretilmemişse kapı atlanır (androidVarMi zaten söyler).
    if (fs.existsSync(path.join(ANDROID_DIR, 'app/src/main/AndroidManifest.xml'))) {
      guncellemeKapisi(kod, kanal);
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
    // Kimlik ÖNCE (ucuz, ağsız): yanlış kanalın paketi sürüm/mühür sorusuna gelmeden durur.
    apkKanalKapisi(hedef, kod, kanal);
    const sVerify = surumBas();
    const stat = apkDogrula(adres, { apkYolu: hedef });
    imzaKapisi(hedef);
    ozet(adres, sVerify, stat, hedef, { kod, kanal });
    return;
  }

  androidVarMi();
  const s = surumBas();
  surumNotuKapisi(s);
  terfiKapisiUygula(kod, s);
  guncellemeKapisi(kod, kanal);

  // (f4) TEMİZ AĞAÇ (G22) — APK commit'lenmemiş/izlenmeyen kaynak taşımaz; derleme commit'i APK'nın yanındaki
  // künyeye (`<apk>.derleme.json`) yazılır, yayıncı onu HEAD'e ve terfi etiketine bağlar (android/ prebuild
  // çıktısı git dışıdır, bu kapının kapsamında DEĞİLDİR). İstisna yalnız app.json sürüm alanları.
  const agac = temizAgacDenetimi();
  if (agac.sonuc !== 'temiz') {
    dur(agac.sonuc === 'kirli' ? 'APK DERLENMEZ — çalışma ağacı temiz değil' : 'ÖLÇÜLEMEDİ — çalışma ağacı okunamadı', ...agac.satirlar);
  }
  bilgi(agac.satirlar[0]);
  fs.rmSync(apkKunyeYolu(APK_PATH), { force: true });

  const derlemeBaslangici = Date.now();
  onbellekleriTemizle();
  gradleKos(adres);
  const stat = apkDogrula(adres, { derlemeBaslangici });
  apkKanalKapisi(APK_PATH, kod, kanal);
  imzaKapisi(APK_PATH);
  derlemeKunyesiBirak(kod, agac.commit);
  ozet(adres, s, stat, APK_PATH, { kod, kanal });
}

/**
 * Derleme künyesi (G22): bütün kapılardan geçen APK'nın yanına commit + özet + APK'nın KENDİ sürümü. Derleme
 * sırasında ağaç ya da HEAD değiştiyse künye YAZILMAZ — yayıncı künyesiz APK'yı reddeder.
 */
function derlemeKunyesiBirak(kod, commit) {
  const son = temizAgacDenetimi();
  if (son.sonuc !== 'temiz' || son.commit !== commit) {
    dur('Derleme sırasında çalışma ağacı ya da HEAD değişti — APK güvenilmez, künye YAZILMADI', ...son.satirlar);
  }
  let k;
  try {
    const { surumAdi, surumKodu } = apkKimligi(APK_PATH);
    k = derlemeKunyesiYaz(apkKunyeYolu(APK_PATH), {
      urun: 'tablet-apk', kanal: kod, surum: surumAdi, commit, dosyaYolu: APK_PATH, ek: { versionCode: surumKodu },
    });
  } catch (e) {
    dur('Derleme künyesi yazılamadı — APK yayınlanamaz', String(e?.message ?? e));
  }
  bilgi(`Derleme künyesi: ${path.basename(apkKunyeYolu(APK_PATH))} · commit ${k.commit.slice(0, 12)} · ${k.surum} (vc ${k.versionCode}) — APK'yla BİRLİKTE taşı`);
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
