#!/usr/bin/env node
/**
 * TeksERP Mobil — UZAKTAN GÜNCELLEME paketi üreticisi (TEK GİRİŞ NOKTASI).
 *
 * Ne yapar: uygulamanın yeni halini paketler, İÇİNE HANGİ ERP ADRESİNİN
 * gömüldüğünü doğrular, manifest'i DONDURUP İMZALAR ve yayına hazır bir klasör
 * üretir. Yükleme ayrı adımdır: `deploy/mobil-yayinla.mjs`.
 * Kurulum dosyası (APK) ÜRETMEZ.
 *
 * ⚠️ ÜÇÜNCÜ KAPI — İMZA: paket internet üzerinden (VPS) dağıtılır. İmzasız bir
 * paket, sunucuya sızan birinin sahadaki HER tablete istediği kodu göndermesi
 * demektir. Anahtar `keystore/ota-keys/` altındadır ve SUNUCUYA GİTMEZ.
 *
 * ⚠️ BU SCRIPT'İN VAR OLMA SEBEBİ — "bayat bundle" tuzağının OTA ikizi:
 * `build-apk.mjs` başlığındaki iki tuzak (Gradle görevinin env değişikliğiyle
 * geçersiz kılınmaması + Metro transform önbelleğinin env'i anahtara almaması)
 * `expo export` yolunda da GEÇERLİDİR. Orada bedeli bir cihazdı; BURADA bedeli
 * SAHADAKİ HER TABLETTİR — yanlış adresi taşıyan bir paket, uzaktan güncelleme
 * mekanizmasının kendisi tarafından tüm cihazlara dağıtılır.
 *
 * ⚠️ İKİNCİ KAPI — `runtimeVersion`: paket yalnız aynı runtimeVersion'ı taşıyan
 * APK'lara gider. Native bir şey değiştiyse (yeni modül/izin/SDK) runtimeVersion
 * ARTIRILMALIDIR; artırılmazsa yeni JS eski native'i çağırır ve sahadaki tüm
 * tabletler açılışta çöker. Script native parmak izini hesaplayıp bir öncekiyle
 * karşılaştırır ve fark varsa DURUR.
 *
 * ⚠️ KANAL (2026-09-27): `--musteri=<kod>` hedef kanaldır; paketin gömdüğü kimlik
 * (manifestin `extra.expoClient`i: ad · paket adı · güncelleme adresi · görünür etiket),
 * ERP adresi ve İMZA ANAHTARI `deploy/kanallar.json`dan. Her kanalın OTA anahtarı AYRIDIR:
 * başka kanalın sertifikasıyla doğrulanan imza = paylaşılan anahtar = DUR.
 *
 * Kullanım:
 *   npm run yayinla -- --musteri=<kod>                     # ERP adresi kanal kaydından
 *   npm run yayinla -- --musteri=<kod> --api-url=<adres>   # açık adres kanalınkiyle EŞİT olmalı
 *   npm run yayinla -- --check          # yalnız adres + parmak izi kontrolü
 *   npm run yayinla -- --parmak-izini-kabul-et   # native değişikliği bilinçli onayla
 *   npm run yayinla -- --update-url=https://…/mobil/   # feed adresini ez
 *   npm run yayinla -- --musteri=<kod> --terfi-atla="<kullanıcının cümlesi>"   # K5 acil kaçışı (S4)
 *
 * ⚠️ TERFİ (K5): `terfiKaynagi` olan kanala (adnansahin) paket yalnız terfi etiketli commit'ten,
 * hazırlık kanalında yayınlanmış sürümle üretilir — scripts/lib/terfi.mjs.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  adresiCoz,
  bundleAdresOlcumu,
  guncellemeAdresiCoz,
  manifestUrl,
  normalizeFeed,
} from './lib/adres.mjs';
import { imzaBasligi, imzayiKabulEdenler, manifestKur, multipartDogrula, multipartKur } from './lib/manifest.mjs';
import {
  etiketDefteriKiyasla,
  sonrakiSurumEtiketten,
  yayindakiApkKunyesi,
  yayindakiTabletSurumu,
} from '../../scripts/lib/surum.mjs';
import { surumNotlariniOku, tavanUyarisi } from '../../scripts/lib/surum-notu-tavan.mjs';
import {
  KAYIT_REL,
  Olculemedi,
  TABLET_SABIT_DOSYALAR,
  dosyalariOku,
  erpAdresiEsit,
  kanalCoz,
  tabletSabitKimlikFarki,
} from '../../scripts/lib/kanallar.mjs';
import { KANAL_ORTAM, otaImzaYollari, tabletYapilandirmaFarki } from './lib/kanal.cjs';
import { terfiKapisi, terfiRaporu } from '../../scripts/lib/terfi.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = path.resolve(HERE, '..');
const CIKTI_KOK = path.join(PROJECT_ROOT, 'ota-cikti');
const PARMAK_IZI_DOSYA = path.join(PROJECT_ROOT, '.ota-parmak-izi.json');

const BAR = '='.repeat(72);
const baslik = (m) => console.log(`\n${BAR}\n  ${m}\n${BAR}`);
const bilgi = (m) => console.log(`  ${m}`);
const uyari = (m) => console.log(`\n  ⚠  ${m}\n`);

function dur(basligi, ...satirlar) {
  console.error(`\n${BAR}`);
  console.error(`  ✖ HATA — ${basligi}`);
  console.error(BAR);
  for (const s of satirlar) console.error(`  ${s}`);
  console.error(`${BAR}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = (ad) => {
  const e = argv.find((a) => a === `--${ad}` || a.startsWith(`--${ad}=`));
  if (!e) return undefined;
  const [, d] = e.split(/=(.*)/s);
  return d ?? '';
};
const SADECE_KONTROL = argv.includes('--check');
const PARMAK_IZI_KABUL = argv.includes('--parmak-izini-kabul-et');
/** İmzasız yayın — YALNIZ imzasız bir APK'ya (eski kurulum) yayın yaparken. */
const IMZASIZ = argv.includes('--imzasiz');
/** Yama hanesini otomatik artırma — `--surum=X.Y.Z` ya da `--surum-artirma` ile kapanır. */
const SURUM_ELLE = arg('surum');
const SURUM_ARTIRMA_YOK = argv.includes('--surum-artirma');
/** S4 kaçışı — yalnız kullanıcının cümlesiyle; verilmediyse undefined (boş verilmesi RED). */
const TERFI_ATLA = argv.some((a) => a === '--terfi-atla' || a.startsWith('--terfi-atla=')) ? (arg('terfi-atla') ?? '') : undefined;

/* ------------------------------------------------------------------ *
 * (a) Adres
 * ------------------------------------------------------------------ */

function adresCoz(kod, kanal) {
  const { deger, kaynak } = adresiCoz(arg('api-url'), PROJECT_ROOT, { kod, erpAdresi: kanal.tablet.erpAdresi });
  if (!deger) {
    dur(
      'Sunucu adresi çözülemedi',
      'Uzaktan güncelleme paketi de tıpkı APK gibi sunucu adresini İÇİNE gömer.',
      'Adressiz paket, sahadaki tabletleri hiçbir yere bağlanamaz hale getirir.',
      '',
      'Örnek: EXPO_PUBLIC_API_URL=http://192.168.1.250:4000/api npm run yayinla',
    );
  }
  if (!/^https?:\/\//i.test(deger)) {
    dur('Adres http:// veya https:// ile başlamalı', `Çözülen: ${deger}`);
  }
  if (!/\/api\/?$/i.test(deger)) {
    dur('Adres `/api` ile bitmeli', `Çözülen: ${deger}`, 'Örnek: http://192.168.1.250:4000/api');
  }
  if (/(localhost|127\.0\.0\.1)/i.test(deger)) {
    dur(
      'localhost sahada anlamsızdır',
      `Çözülen: ${deger} (kaynak: ${kaynak})`,
      'Tablet "localhost" dediğinde KENDİNİ kasteder; fabrika sunucusunu değil.',
    );
  }
  return { deger, kaynak };
}

/* ------------------------------------------------------------------ *
 * (a2) KANAL KAPISI — paket hangi kanalın ERP sunucusuna bağlanacak?
 * ------------------------------------------------------------------ */

/** Kayıt defterinden kanal — bilinmeyen kod / kırmızı kayıt: hiçbir şey yapılmadan DUR. */
function kanalCozVeyaDur(musteri) {
  try {
    return kanalCoz(musteri);
  } catch (e) {
    if (e instanceof Olculemedi) dur(`KANAL KAYIT DEFTERİ ÖLÇÜLEMEDİ (${KAYIT_REL})`, e.message);
    dur(e.message, ...(e.satirlar ?? []));
  }
}

/**
 * ⚠️ BİÇİM DOĞRU DİYE ADRES DOĞRU DEĞİLDİR: `adresCoz` "bu bir ERP adresi mi" sorar,
 * "bu KANALIN adresi mi" sormaz. Başka kanalın adresini taşıyan paket bu kanalın
 * güncelleme adresleriyle üretilir, yüklenir ve o kanalın tabletlerini başka bir
 * sunucuya yazdırır — hata vermeden. Beklenen değer kayıt defterinden, ağdan ÖNCE;
 * eşit değilse kaçış YOK.
 */
function kanalKapisi(musteri, kayit, kanal, adres, kaynak) {
  if (!erpAdresiEsit(adres, kanal.tablet.erpAdresi)) {
    dur(
      `ERP ADRESİ "${musteri}" KANALININ DEĞİL`,
      `çözülen adres : ${adres}  (kaynak: ${kaynak})`,
      `kanalın adresi: ${kanal.tablet.erpAdresi}  (${KAYIT_REL})`,
      '',
      'Bu paket bu kanalın tabletlerini BAŞKA bir sunucuya bağlardı — ve bu sessizdir.',
      'Adres gerçekten değiştiyse önce kayıt defteri değişir (üretim kanalında bu bir GÖÇTÜR).',
    );
  }
  // PARMAK İZİ KİMLİKTEN BAĞIMSIZ: parmak izi app.json'un android bloğunu (paket adı dahil)
  // hash'ler. app.json DİNLENME (varsayilan) kimliğini taşımalı; bir kanal için yeniden
  // yazılmışsa kanal değişimi sahte "NATIVE DEĞİŞTİ" üretir — kimlik app.config.js'te.
  let farklar;
  try {
    farklar = tabletSabitKimlikFarki(kayit.kanallar[kayit.varsayilan], dosyalariOku(TABLET_SABIT_DOSYALAR));
  } catch (e) {
    if (e instanceof Olculemedi) dur('TABLET KİMLİĞİ ÖLÇÜLEMEDİ', e.message);
    throw e;
  }
  if (farklar.length) {
    dur(
      `app.json DİNLENME KİMLİĞİNİ ("${kayit.varsayilan}") TAŞIMIYOR`,
      ...farklar,
      '',
      "Kanal kimliği app.json'a YAZILMAZ: native parmak izinin girdisidir ve kanal değişimi",
      `sahte "NATIVE DEĞİŞTİ" üretirdi. Kimlik derleme anında ${KANAL_ORTAM} ile app.config.js'ten gelir.`,
    );
  }
  // Yapılandırma bu kanalın kimliğini ÜRETİYOR mu (ağdan önce, süreç içinde).
  let cf;
  try {
    const cfg = require(path.join(PROJECT_ROOT, 'app.config.js'))({ config: appJson() });
    cf = tabletYapilandirmaFarki(kanal, cfg, String(appJson().runtimeVersion ?? ''));
  } catch (e) {
    dur('ÖLÇÜLEMEDİ — app.config.js değerlendirilemedi', String(e?.message ?? e));
  }
  if (cf.length) dur(`app.config.js "${musteri}" KANALININ KİMLİĞİNİ ÜRETMİYOR`, ...cf);
  bilgi(`Kanal             : ${musteri} (${kanal.tur}) — ERP adresi ve tablet kimliği kayıtla birebir`);
}

/* ------------------------------------------------------------------ *
 * (b) runtimeVersion + native parmak izi
 * ------------------------------------------------------------------ */

function appJson() {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8')).expo;
}

/**
 * `app.json > expo.version` alanını yazar.
 *
 * ⚠️ Dosyanın TAMAMI yeniden yazılır ama yalnız tek alan değişir: biçim
 * (2 boşluk + sondaki satır sonu) korunur, yoksa her yayın turu app.json'da
 * gürültülü bir diff bırakır.
 */
function surumuYaz(yeniSurum) {
  const yol = path.join(PROJECT_ROOT, 'app.json');
  const tam = JSON.parse(fs.readFileSync(yol, 'utf8'));
  tam.expo.version = yeniSurum;
  fs.writeFileSync(yol, `${JSON.stringify(tam, null, 2)}\n`);
}

/**
 * Native tarafı ETKİLEYEN girdilerin özeti.
 *
 * Kapsam bilinçli olarak DAR ve AÇIK: bağımlılık listesi (yeni native modül),
 * `plugins` (derleme yapılandırması), `android` bloğu (izinler, paket adı, SDK).
 * Bunların dışındaki değişiklikler (ekran kodu, iş kuralı) uzaktan gönderilebilir.
 *
 * ⚠️ Bu tam bir `expo-fingerprint` DEĞİLDİR (transitif native bağımlılıkları
 * göremez). Amacı kesin kanıt değil, EN SIK yapılan hatayı — "yeni modül
 * kurdum, runtimeVersion'ı unuttum" — yakalamaktır. Şüphede kalırsan
 * runtimeVersion'ı ARTIR; fazladan artırmanın bedeli bir APK turudur, eksik
 * bırakmanın bedeli sahadaki tüm tabletlerdir.
 */
/**
 * Parmak izi ALGORİTMASININ sürümü.
 *
 * ⚠️ KAPSAM DEĞİŞİNCE ARTIR. Sebep 2026-08-27'de ölçüldü: kapsamdan
 * `versionCode` çıkarıldı ve kayıtlı taban ESKİ algoritmayla hesaplanmış
 * olduğu için karşılaştırma "native değişti" dedi — oysa hiçbir şey
 * değişmemişti (ölçüm: vc 54'e geri sarılınca hash kayıtla birebir eşleşti).
 * Bu yanlış alarm zararsız DEĞİL: operatörü gereksiz bir runtimeVersion
 * artışına zorlar, o da sahadaki TÜM tabletleri uzaktan güncellemeden koparır
 * (yeni APK elle kurulana dek paket alamazlar). Yani kapı, önlemek için var
 * olduğu zararı üretirdi.
 */
const PARMAK_IZI_ALG = 2;

function nativeParmakIzi() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const e = appJson();

  // ⚠️ SÜRÜM NUMARALARI PARMAK İZİNE GİRMEZ (2026-08-27'de ısırdı):
  // `version`/`versionCode` her APK yayınında artar ama JS ↔ native UYUMUNU
  // ETKİLEMEZ. Parmak izine dahil edilseydi her kurulum dosyası sürümü sahte
  // bir "native değişti" alarmı üretir, bu da gereksiz bir runtimeVersion
  // artışına zorlardı — ve runtimeVersion artışı sahadaki TÜM tabletleri
  // uzaktan güncellemeden koparır (yeni APK kurulana dek paket almazlar).
  // Yani yanlış tasarlanmış bir kapı, korumaya çalıştığı şeyin tam tersini
  // yaptırırdı. Kapsam: gerçekten native'i etkileyen alanlar.
  const { versionCode: _vc, ...androidKalan } = e.android ?? {};
  const girdi = JSON.stringify({
    bagimliliklar: pkg.dependencies,
    plugins: e.plugins,
    android: androidKalan,
  });
  return crypto.createHash('sha256').update(girdi).digest('hex').slice(0, 16);
}

function parmakIziKapisi(runtimeVersion) {
  const simdiki = nativeParmakIzi();
  let onceki = null;
  try {
    onceki = JSON.parse(fs.readFileSync(PARMAK_IZI_DOSYA, 'utf8'));
  } catch {
    /* ilk koşum */
  }

  bilgi(`Native parmak izi : ${simdiki}`);
  bilgi(`runtimeVersion    : ${runtimeVersion}`);

  if (!onceki) {
    bilgi('(ilk koşum — karşılaştırılacak önceki kayıt yok)');
    return { simdiki, yaz: true };
  }

  bilgi(`Önceki kayıt      : ${onceki.parmakIzi} · runtimeVersion ${onceki.runtimeVersion}`);

  // ⚠️ ALGORİTMA SÜRÜMÜ ÖNCE: taban başka bir kapsamla hesaplanmışsa iki hash
  // KARŞILAŞTIRILAMAZ. Bunu "native değişti" diye okumak, operatörü zararlı
  // bir runtimeVersion artışına iterdi — teşhis yanlış, sonucu ağır.
  if ((onceki.alg ?? 1) !== PARMAK_IZI_ALG && !PARMAK_IZI_KABUL) {
    dur(
      'PARMAK İZİ KARŞILAŞTIRILAMIYOR (algoritma değişti)',
      `kayıtlı taban : alg ${onceki.alg ?? 1}`,
      `bu sürüm      : alg ${PARMAK_IZI_ALG}`,
      '',
      'Bu, "native değişti" DEMEK DEĞİLDİR — iki hash farklı kapsamla',
      'hesaplandığı için kıyaslanamıyor. runtimeVersion ARTIRMA.',
      '',
      'Son APK derlemesinden bu yana yeni native modül / izin / Expo',
      'yükseltmesi OLMADIĞINDAN eminsen tabanı yenile:',
      '  npm run yayinla -- --parmak-izini-kabul-et',
    );
  }

  const nativeDegisti = onceki.parmakIzi !== simdiki;
  const rvDegisti = onceki.runtimeVersion !== runtimeVersion;

  if (nativeDegisti && !rvDegisti && !PARMAK_IZI_KABUL) {
    dur(
      'NATIVE DEĞİŞTİ ama runtimeVersion AYNI KALDI',
      'Bu paketi yayınlamak, sahadaki tabletlere KENDİ NATIVE SÜRÜMLERİYLE',
      'UYUMSUZ bir JS paketi göndermek demektir — hepsi açılışta çöker.',
      '',
      'Yapılacak: app.json → expo.runtimeVersion değerini artır ve YENİ APK derle.',
      `  şimdiki: "${runtimeVersion}"  →  örn. "${sonrakiRv(runtimeVersion)}"`,
      '',
      'Değişiklik native tarafı GERÇEKTEN etkilemiyorsa (örn. yalnız bir dev',
      'bağımlılığı) bilinçli olarak geç:  npm run yayinla -- --parmak-izini-kabul-et',
    );
  }

  if (rvDegisti) {
    uyari(
      `runtimeVersion değişti (${onceki.runtimeVersion} → ${runtimeVersion}). ` +
        'Bu paket YALNIZ yeni APK kurulmuş tabletlere gider; eskiler güncelleme almaz.',
    );
  }

  return { simdiki, yaz: true };
}

function sonrakiRv(rv) {
  const m = /^(\d+)\.(\d+)$/.exec(String(rv));
  return m ? `${m[1]}.${Number(m[2]) + 1}` : `${rv}-2`;
}

/* ------------------------------------------------------------------ *
 * (c) Önbellek + export
 * ------------------------------------------------------------------ */

function sil(yol, aciklama) {
  if (!fs.existsSync(yol)) return;
  fs.rmSync(yol, { recursive: true, force: true });
  bilgi(`silindi: ${aciklama}`);
}

function onbellegiTemizle() {
  baslik('(1/4) BUNDLE ÖNBELLEĞİ TEMİZLENİYOR');
  // Metro transform önbelleği env değerlerini anahtarına ALMAZ; sıcak
  // önbellekle koşulan export ESKİ adresi gömülü çıktı verir. Ölçüldü
  // (2026-08-01, APK yolunda): sıcak 17,9 sn → eski adres · temiz 69,9 sn →
  // doğru adres. "Hızlı biten export" iyi haber değildir.
  sil(path.join(os.tmpdir(), 'metro-cache'), 'Metro transform önbelleği');
  sil(path.join(PROJECT_ROOT, '.expo', 'cache'), 'Expo cache');
}

function exportKos(adres, hedefDizin) {
  baslik('(2/4) PAKET ÜRETİLİYOR — expo export');
  const sonuc = spawnSync(
    'npx',
    ['expo', 'export', '--platform', 'android', '--output-dir', hedefDizin, '--clear'],
    {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      // Adres AÇIKÇA geçilir: @expo/env sistem ortamının ÜSTÜNE YAZMAZ, yani
      // `.env.local`'daki localhost bu değeri sessizce yenemez.
      env: { ...process.env, EXPO_PUBLIC_API_URL: adres },
    },
  );
  if (sonuc.error) dur('expo export çalıştırılamadı', String(sonuc.error.message));
  if (sonuc.status !== 0) dur('expo export başarısız', `Çıkış kodu: ${sonuc.status}`);
}

/**
 * Manifestin `extra.expoClient`i — tablette `Constants.expoConfig` budur (görünen ad, APK
 * künyesinin adresi, görünür etiket). ⚠️ FAIL-CLOSED: eskiden okunamazsa uyarıp alansız
 * paket üretiyordu; kanal kimliği bu alanda yaşadığı için ölçülemeyen yapılandırma = DUR.
 */
function expoConfigYaz(adres, hedefDizin, musteri, kanal, runtimeVersion) {
  const sonuc = spawnSync('npx', ['expo', 'config', '--json', '--type', 'public'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: { ...process.env, EXPO_PUBLIC_API_URL: adres },
  });
  let cfg = null;
  try {
    if (sonuc.status === 0 && sonuc.stdout) cfg = JSON.parse(sonuc.stdout);
  } catch {
    cfg = null;
  }
  if (!cfg) {
    dur(
      'ÖLÇÜLEMEDİ — expo config okunamadı',
      (sonuc.stderr || '').trim().split('\n').slice(-3).join(' · ') || `çıkış ${sonuc.status}`,
      'Paket kimliği (extra.expoClient) ölçülemeden paket üretilmez.',
    );
  }
  const f = tabletYapilandirmaFarki(kanal, cfg, runtimeVersion, { herkese: true });
  if (f.length) dur(`PAKETİN YAPILANDIRMASI "${musteri}" KANALININ DEĞİL`, ...f);
  fs.writeFileSync(path.join(hedefDizin, 'expoConfig.json'), JSON.stringify(cfg));
  return cfg;
}

/* ------------------------------------------------------------------ *
 * (d) DOĞRULAMA — üretilen bundle hangi adresi taşıyor?
 * ------------------------------------------------------------------ */

function paketiDogrula(hedefDizin, beklenenAdres) {
  baslik('(3/4) DOĞRULAMA — pakete gömülen adres okunuyor');

  const meta = JSON.parse(fs.readFileSync(path.join(hedefDizin, 'metadata.json'), 'utf8'));
  const bundleRel = meta?.fileMetadata?.android?.bundle;
  if (!bundleRel) dur('metadata.json android bundle yolu taşımıyor');

  const bundleYol = path.join(hedefDizin, bundleRel);
  const icerik = fs.readFileSync(bundleYol);

  // ⚠️ Release bundle Hermes bytecode'dur: ASCII dizeler string tablosunda düz
  // durur ve aranabilir (Türkçe karakterli dizeler UTF-16 tablosuna gider ve
  // BULUNAMAZ — bu yüzden aranan şey her zaman URL gibi ASCII bir sabittir).
  const metin = icerik.toString('latin1');

  const { gecenSayi, bulunanlar } = bundleAdresOlcumu(metin, beklenenAdres);
  if (gecenSayi === 0) {
    // Ne bulduğumuzu söyle — "yok" demek teşhis için yetmez.
    dur(
      'PAKET BEKLENEN ADRESİ TAŞIMIYOR',
      `Beklenen : ${beklenenAdres}`,
      `Bulunan  : ${bulunanlar.length ? bulunanlar.join(', ') : '(hiç adres bulunamadı)'}`,
      '',
      'Bu, önbellekten gelen BAYAT bir bundle olabilir. Paket YAYINLANMADI.',
      'Tekrar dene; sürerse: rm -rf $TMPDIR/metro-cache .expo/cache node_modules/.cache',
    );
  }

  const kotuAdresler = [...new Set(metin.match(/https?:\/\/(?:localhost|127\.0\.0\.1)[^\s"']*/g) ?? [])];
  if (kotuAdresler.length) {
    uyari(`Pakette localhost geçen dizeler de var: ${kotuAdresler.slice(0, 3).join(', ')}`);
  }

  const varlikSayisi = (meta.fileMetadata.android.assets ?? []).length;
  bilgi(`✔ Gömülü adres doğrulandı: ${beklenenAdres}`);
  bilgi(`  bundle  : ${bundleRel} (${(icerik.length / 1048576).toFixed(1)} MB)`);
  bilgi(`  varlık  : ${varlikSayisi} dosya`);
  return { bundleRel, boyut: icerik.length, varlikSayisi };
}

/**
 * ÇAPRAZ RED — imza BAŞKA bir kanalın sertifikasıyla da doğrulanıyorsa iki kanal aynı OTA
 * anahtarını paylaşıyor demektir: yanlış klasöre yüklenen paketi o kanalın tabletleri KABUL
 * ederdi. Sertifikası bu makinede olmayan kanal ölçülmedi diye söylenir (sessiz geçmez).
 */
function capraziRed(govde, kayit, musteri, imzaYollari) {
  const digerleri = {};
  for (const [digerKod, diger] of Object.entries(kayit.kanallar)) {
    if (digerKod === musteri) continue;
    const yol = path.join(PROJECT_ROOT, diger.tablet.otaSertifika);
    if (fs.existsSync(yol)) digerleri[digerKod] = fs.readFileSync(yol, 'utf8');
    else bilgi(`  · "${digerKod}" sertifikası bu makinede yok — çapraz red ÖLÇÜLMEDİ`);
  }
  const kabul = imzayiKabulEdenler(govde, digerleri);
  if (kabul.length) {
    dur(
      `İMZA "${kabul.join('", "')}" KANALININ SERTİFİKASIYLA DA DOĞRULANIYOR`,
      `imzalayan anahtar: ${imzaYollari.anahtar}`,
      'Kanallar aynı OTA anahtarını paylaşıyor — her kanalın anahtarı ayrı üretilir.',
    );
  }
  for (const kod of Object.keys(digerleri)) bilgi(`✔ "${kod}" kanalının sertifikası bu imzayı REDDEDİYOR`);
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  baslik('TeksERP Mobil — UZAKTAN GÜNCELLEME PAKETİ');

  // ⚠️ KANAL, KOMUTTAN. Paketin varlık URL'leri, gömdüğü kimlik ve imza anahtarı kanaldan;
  // beklenen değer ağaçtaki `musteri.json`dan (dinlenme işaretçisi) alınsaydı kapı dairesel
  // olurdu (bkz. build-apk.mjs `guncellemeKapisi`).
  const musteri = arg('musteri');
  if (!musteri) {
    dur(
      'HANGİ KANAL İÇİN YAYINLANIYOR?',
      '`--musteri=<kod>` zorunludur — paketin içindeki adresler, kimlik ve imza o kanaldan.',
      `Kanallar: ${KAYIT_REL}`,
      'Örnek:  npm run yayinla -- --musteri=<kod>',
    );
  }
  const { kayit, kanal } = kanalCozVeyaDur(musteri);
  const ortamdaki = String(process.env[KANAL_ORTAM] ?? '').trim();
  if (ortamdaki && ortamdaki !== musteri) {
    dur('KANAL ÇELİŞKİSİ', `komutta           : ${musteri}`, `${KANAL_ORTAM} ortamı : ${ortamdaki}`);
  }
  // expo export / expo config / app.config.js bu kanalın kimliğiyle değerlendirilir.
  process.env[KANAL_ORTAM] = musteri;

  const { deger: adres, kaynak } = adresCoz(musteri, kanal);
  kanalKapisi(musteri, kayit, kanal, adres, kaynak);

  const { deger: feed, kaynak: feedKaynak } = guncellemeAdresiCoz(
    arg('update-url') || kanal.yayin.mobilFeed,
  );
  let e = appJson();
  const runtimeVersion = String(e.runtimeVersion ?? '').trim();
  if (!runtimeVersion) {
    dur(
      'app.json → expo.runtimeVersion tanımlı değil',
      'Bu değer olmadan sunucu paketi hangi APK\'lara göndereceğini bilemez.',
    );
  }

  bilgi(`Müşteri           : ${musteri} (${kanal.ad})`);
  bilgi(`ERP adresi        : ${adres}`);
  bilgi(`  kaynak          : ${kaynak}`);
  bilgi(`Güncelleme kanalı : ${manifestUrl(feed, runtimeVersion)}`);
  bilgi(`  kaynak          : ${feedKaynak}`);
  bilgi(`Uygulama sürümü   : ${e.version} (vc ${e.android?.versionCode})`);
  console.log('');

  // --- SÜRÜM NUMARASI -----------------------------------------------------
  // Uzaktan güncelleme eskiden sürüm numarasını HİÇ değiştirmiyordu: tablette
  // haftalarca "1.0.0" yazıyor, içindeki JS ise bambaşka oluyordu. Ayrım
  // görünmezdi — sahada "hangi sürümdesin" sorusunun cevabı yoktu ve sürüm
  // notu kapısı da tek numaraya yığılıyordu.
  //
  // ⚠️ Numara APK'dan DEĞİL, PAKETTEN okunuyor: `kuruluVersionName()` →
  // `Constants.expoConfig.version` → manifestin `extra.expoClient`i. Yani bu
  // satırı artırmak, native tarafa dokunmadan tablette görünen sürümü
  // değiştirir (bkz. appUpdate.service.ts).
  //
  // ⚠️ TABAN GİT ETİKETİDİR (`tablet-v*`), yerel app.json ya da yayın sunucusu
  // DEĞİL — gerekçe: scripts/lib/surum.mjs başlığı. Etiketi bu script atmaz;
  // yayın başarılı olunca `deploy/mobil-yayinla.mjs` atar.
  let hedefSurum = e.version;
  if (SURUM_ELLE) {
    hedefSurum = SURUM_ELLE;
    bilgi(`Sürüm             : ${hedefSurum} (elle verildi)`);
  } else if (SURUM_ARTIRMA_YOK) {
    bilgi(`Sürüm             : ${hedefSurum} (--surum-artirma: dokunulmadı)`);
  } else {
    const karar = sonrakiSurumEtiketten('tablet');
    if (!karar.surum) {
      dur(
        'Sıradaki sürüm belirlenemedi',
        karar.gerekce,
        '',
        `İlk sürümü elle ver:            npm run yayinla -- --musteri=${musteri} --surum=1.0.1`,
        `ya da yayındaki sürümü etiketle: git tag -a tablet-v${e.version} -m tablet`,
      );
    }
    // Etiket KARAR verir, sunucu DOĞRULAR — gerekçe: scripts/lib/surum.mjs.
    const yayinda = await yayindakiTabletSurumu(manifestUrl(feed, runtimeVersion), runtimeVersion);
    const kiyas = etiketDefteriKiyasla(karar.surum, yayinda);
    if (kiyas.durum === 'zaten-yayinda') {
      dur(
        `${karar.surum} ZATEN YAYINDA`,
        karar.gerekce,
        '',
        'Son yayından beri yeni commit yok, yani çıkacak bir değişiklik de yok.',
        'Aynı numaranın üstüne farklı kod yazmak sahada iki ayrı programı aynı',
        'isimle dolaştırır — kapı bunun için var.',
        '',
        'Yeni iş varsa commit et; yarım kalan yayını tamamlıyorsan:',
        `  npm run yayinla -- --musteri=${musteri} --surum=${karar.surum}`,
      );
    }
    if (kiyas.durum === 'bayat') {
      dur(
        'ETİKET DEFTERİ BAYAT',
        `hesaplanan: ${karar.surum}`,
        `yayında   : ${kiyas.yayinda}`,
        '',
        'Bu numarayla yayınlamak, sahadakinden ESKİ bir paketi güncel gösterir.',
        'Muhtemel sebep: yayın başka bir makineden yapıldı, etiket itilmedi.',
        `Çözüm: git fetch --tags   ya da   git tag -a tablet-v${kiyas.yayinda} -m tablet`,
      );
    }
    if (kiyas.durum === 'olculemedi') {
      uyari('Yayındaki sürüm okunamadı (ssh tekserp-yayin, VDS diski); etiket defteri DOĞRULANMADI.');
    }
    // Yayınlanmamış tur sayısı açılış modalinin tavanını aşıyorsa söyle (uyarı, blok değil).
    const tavan = tavanUyarisi(surumNotlariniOku(), 'tablet', yayinda, karar.surum);
    if (tavan) uyari(tavan);
    hedefSurum = karar.surum;
    bilgi(`Sürüm             : ${karar.surum} — ${karar.gerekce}`);
  }
  // --- TERFİ KAPISI (K5) — app.json'a yazılmadan ÖNCE, --check'te de -------------
  // Üretim kanalına (`terfiKaynagi` olan) yalnız hazırlık kanalında yayınlanmış ve kullanıcının
  // terfi etiketiyle onayladığı commit paketlenir. Yüklem: scripts/lib/terfi.mjs.
  {
    const h = terfiKapisi({ kod: musteri, urun: 'tablet', surum: hedefSurum, atla: TERFI_ATLA });
    const satirlar = terfiRaporu(h, { kod: musteri, urun: 'tablet', surum: hedefSurum });
    if (h.sonuc !== 'uyumlu') {
      dur(satirlar[0].replace(/^✖ /, ''), ...satirlar.slice(1).map((s) => s.trim()),
        h.sonuc === 'ihlal' ? 'Acil kaçış yalnız kullanıcının cümlesiyle: --terfi-atla="<cümle>" (yayın komutu da aynı cümleyi ister).' : 'Ölçülemeyen şart geçmiş şart değildir.');
    }
    for (const s of satirlar) bilgi(s);
  }
  // ⚠️ `--check` YAN ETKİSİZ OLMALI. Ön kontrol, dosyayı değiştirmeden "bu tur
  // ne olurdu"yu göstermek içindir; app.json'a yazsaydı yalnız bakmak için
  // koşan biri sürümü sessizce ilerletir ve fark etmezdi. Aşağıdaki kapılar
  // yine HEDEF sürümü ölçer — yani ön kontrol gerçek turun sorusunu sorar.
  if (hedefSurum !== e.version && !SADECE_KONTROL) {
    surumuYaz(hedefSurum);
    // Yazımdan sonra yeniden oku: `e` bayat kalırsa nota bakılan sürüm ile
    // pakete gömülen sürüm ayrışır ve kapı kendi doğrulamadığı bir numarayı
    // yayınlar.
    e = appJson();
  } else {
    e = { ...e, version: hedefSurum };
  }

  // --- versionCode KAPISI -------------------------------------------------
  // ⚠️ OTA paketi `android.versionCode`u DA taşır ve tablet onu KURULU APK'nın
  // sürümü sanar (`kuruluVersionCode()` → `Constants.expoConfig.android
  // .versionCode`). Uzaktan güncellemeyle yükseltilirse tablet kendini
  // olmadığı bir APK sürümünde sanar ve gerçek kurulum dosyası güncellemesini
  // BİR DAHA teklif etmez — sessiz ve kalıcı bir arıza.
  {
    const kunye = await yayindakiApkKunyesi(feed);
    const yayindakiVc = kunye?.versionCode;
    const yereldekiVc = e.android?.versionCode;
    if (typeof yayindakiVc === 'number' && yayindakiVc !== yereldekiVc) {
      dur(
        'versionCode yayındaki APK ile UYUŞMUYOR',
        `app.json     : ${yereldekiVc}`,
        `yayındaki APK: ${yayindakiVc} (${kunye?.versionName ?? '?'})`,
        '',
        'Uzaktan güncelleme paketi bu değeri de taşır ve tablet onu KURULU',
        'sürümü sanar. Farklı gönderilirse tablet gerçek APK güncellemesini',
        'bir daha teklif etmez.',
        '',
        'Yapılacak: native değişmediyse app.json > android.versionCode değerini',
        `yayındaki ${yayindakiVc} değerine geri al; gerçekten yeni bir APK`,
        'çıkıyorsa ÖNCE onu yayınla (deploy/mobil-yayinla.mjs), sonra OTA gönder.',
      );
    }
    if (typeof yayindakiVc !== 'number') {
      uyari('Yayında kurulum dosyası künyesi yok — versionCode kapısı atlandı.');
    }
  }

  // --- SÜRÜM NOTU KAPISI --------------------------------------------------
  // Not yazılmadan sürüm çıkmaz (kullanıcı kararı). Bekçi ayrıca kopyaların
  // taze olduğunu ve dilin operatör dili kaldığını da denetler.
  //
  // ⚠️ DAİRESEL DEĞİL: beklenen sürüm app.json'dan OKUNUP bekçiye ARGÜMAN
  // olarak verilir; not dosyası onu üretmez, yalnız doğrular. Hiçbir script
  // `surumler.tablet` alanını app.json'dan okuyup YAZMAMALI — yazsaydı kapı
  // kendi yazdığını doğrular, yani hiçbir şey doğrulamazdı.
  {
    const bekci = path.join(PROJECT_ROOT, '..', 'scripts', 'check-surum-notlari.mjs');
    const r = spawnSync(process.execPath, [bekci, `--tablet=${e.version}`], { stdio: 'inherit' });
    if (r.status !== 0) {
      dur(`Sürüm notu kapısı kırmızı.
  ${e.version} için operatör notu yok ya da not kuralları ihlal edilmiş.
  1) surum-notlari.json'a bu sürüm için kayıt ekle
  2) node scripts/surum-notlari-kopyala.mjs
  3) komutu tekrarla`);
    }
  }

  const { simdiki: parmakIzi } = parmakIziKapisi(runtimeVersion);

  if (SADECE_KONTROL) {
    console.log('\n  ✔ Ön kontrol tamam (--check): adres ve native parmak izi tutarlı.\n');
    return;
  }

  const damga = String(Date.now());
  // ⚠️ Çıktı MÜŞTERİYE AYRILIR: aynı klasörde dursalardı A'nın paketini B'ye
  // yüklemek tek bir yanlış yol yazımı kadar yakın olurdu.
  const hedefDizin = path.join(CIKTI_KOK, musteri, runtimeVersion, damga);
  fs.mkdirSync(hedefDizin, { recursive: true });

  onbellegiTemizle();
  exportKos(adres, hedefDizin);
  const expoConfig = expoConfigYaz(adres, hedefDizin, musteri, kanal, runtimeVersion);

  const olcum = paketiDogrula(hedefDizin, adres);

  /* ---------------------------------------------------------------- *
   * MANIFEST — burada DONDURULUR ve İMZALANIR
   * ---------------------------------------------------------------- */
  baslik('(4/5) MANIFEST DONDURULUYOR VE İMZALANIYOR');

  // Varlık URL'leri damgayı taşır: istemci manifest'i aldıktan sonra varlıkları
  // indirirken YENİ bir yayın yapılırsa, damgasız URL'ler yeni paketten servis
  // edilir, hash tutmaz ve indirme patlar. Damga URL'de olduğu için o yarış yok.
  const varlikTabani = `${normalizeFeed(feed)}ota/${runtimeVersion}/${damga}`;

  const manifest = manifestKur({
    paketDizin: hedefDizin,
    runtimeVersion,
    damga,
    varlikTabani,
    expoConfig,
  });

  let imzaDegeri = null;
  let sertifikaPem = null;
  // Kanalın KENDİ anahtarı: başka kanalın tabletleri bu imzayı reddeder (yanlış klasöre
  // yüklenen paket "başka sunucuya bağlanır" yerine "güncelleme gelmez"e iner).
  let imzaYollari;
  try {
    imzaYollari = otaImzaYollari(kanal);
  } catch (e) {
    dur('KANALIN OTA İMZA YOLU ÇÖZÜLEMEDİ', e.message);
  }
  const anahtarYol = path.join(PROJECT_ROOT, imzaYollari.anahtar);
  const sertifikaYol = path.join(PROJECT_ROOT, imzaYollari.sertifika);

  if (IMZASIZ) {
    uyari(
      'İMZASIZ yayın (--imzasiz). Kod imzalama açık bir APK bu paketi REDDEDER. ' +
        'Yalnız imzalamadan önce derlenmiş eski bir kurulum için kullan.',
    );
  } else {
    if (!fs.existsSync(anahtarYol)) {
      dur(
        'İMZA ANAHTARI BULUNAMADI',
        `Beklenen: ${anahtarYol}`,
        '',
        'Paket internet üzerinden dağıtılıyor: imzasız bir paketi yayınlamak,',
        'sunucuya sızan birinin sahadaki HER tablete istediği kodu göndermesi',
        'demektir. Anahtar yedekten geri konmalı.',
        '',
        'Bilinçli olarak imzasız yayınlamak için: npm run yayinla -- --imzasiz',
      );
    }
    const privateKey = fs.readFileSync(anahtarYol, 'utf8');
    const keyid = appJson().updates?.codeSigningMetadata?.keyid ?? 'main';
    imzaDegeri = imzaBasligi(JSON.stringify(manifest), privateKey, keyid);
    if (!fs.existsSync(sertifikaYol)) {
      dur(
        'KANALIN OTA SERTİFİKASI BULUNAMADI',
        `Beklenen: ${sertifikaYol}`,
        'İmza, kanalın tabletlerine gömülü sertifikayla doğrulanmadan yayınlanmaz.',
      );
    }
    sertifikaPem = fs.readFileSync(sertifikaYol, 'utf8');
    bilgi(`✔ İmzalandı (keyid="${keyid}", RSA-SHA256, ${imzaYollari.anahtar})`);
  }

  const govde = multipartKur({ manifest, imzaBasligiDegeri: imzaDegeri });

  // Üretileni İSTEMCİNİN yaptığı gibi ayrıştır ve imzayı SERTİFİKAYLA doğrula.
  // İmzalı ama doğrulanmamış bir paket yayınlamak, imzasız yayınlamaktan
  // KÖTÜDÜR: sahada sessizce reddedilir ve sebebi sunucuda görünmez.
  const dogrulama = multipartDogrula(govde, sertifikaPem);
  bilgi(`✔ Gövde ayrıştırıldı — manifest id ${dogrulama.manifest.id}`);
  if (sertifikaPem) bilgi('✔ İmza SERTİFİKAYLA doğrulandı (istemcinin yaptığı işin aynısı)');
  if (sertifikaPem) capraziRed(govde, kayit, musteri, imzaYollari);
  if (dogrulama.manifest.runtimeVersion !== runtimeVersion) {
    dur('Manifest runtimeVersion tutmuyor', `beklenen ${runtimeVersion}`);
  }

  fs.writeFileSync(path.join(hedefDizin, 'manifest'), govde);
  fs.writeFileSync(path.join(hedefDizin, `manifest-${damga}`), govde);

  // Yayın künyesi.
  fs.writeFileSync(
    path.join(hedefDizin, 'yayin.json'),
    JSON.stringify(
      {
        createdAt: new Date(Number(damga)).toISOString(),
        musteri,
        runtimeVersion,
        damga,
        adres,
        feed: normalizeFeed(feed),
        manifestId: dogrulama.manifest.id,
        imzali: !!imzaDegeri,
        uygulamaSurumu: e.version,
        versionCode: e.android?.versionCode ?? null,
        parmakIzi,
        bundle: olcum.bundleRel,
        varlikSayisi: olcum.varlikSayisi,
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    PARMAK_IZI_DOSYA,
    JSON.stringify(
      { alg: PARMAK_IZI_ALG, parmakIzi, runtimeVersion, damga, tarih: new Date().toISOString() },
      null,
      2,
    ),
  );

  baslik('(5/5) HAZIR');
  bilgi(`Paket klasörü : ${hedefDizin}`);
  bilgi(`Damga         : ${damga}`);
  bilgi(`Manifest id   : ${dogrulama.manifest.id}`);
  console.log('');
  bilgi('Yayınlamak için:');
  bilgi(`    node ../deploy/mobil-yayinla.mjs --musteri=${musteri} --paket=${hedefDizin}`);
  console.log('');
  bilgi('Geri alma: sunucuda ota/<sürüm>/manifest üzerine ESKİ damganın');
  bilgi('           manifest-<damga> kopyasını koy.');
  console.log('');
}

main().catch((e) => {
  dur('Beklenmeyen hata', e?.stack ?? String(e));
});
