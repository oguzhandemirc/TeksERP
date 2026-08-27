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
 * Kullanım:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.250:4000/api npm run yayinla
 *   npm run yayinla -- --api-url=http://192.168.1.250:4000/api
 *   npm run yayinla -- --check          # yalnız adres + parmak izi kontrolü
 *   npm run yayinla -- --parmak-izini-kabul-et   # native değişikliği bilinçli onayla
 *   npm run yayinla -- --update-url=https://…/mobil/   # feed adresini ez
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  adresiCoz,
  feedUrl,
  guncellemeAdresiCoz,
  manifestUrl,
  musteriOku,
  normalizeFeed,
} from './lib/adres.mjs';
import { imzaBasligi, manifestKur, multipartDogrula, multipartKur } from './lib/manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
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

/* ------------------------------------------------------------------ *
 * (a) Adres
 * ------------------------------------------------------------------ */

function adresCoz() {
  const { deger, kaynak } = adresiCoz(arg('api-url'), PROJECT_ROOT);
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
 * (b) runtimeVersion + native parmak izi
 * ------------------------------------------------------------------ */

function appJson() {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8')).expo;
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

function expoConfigYaz(adres, hedefDizin) {
  const sonuc = spawnSync('npx', ['expo', 'config', '--json', '--type', 'public'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: { ...process.env, EXPO_PUBLIC_API_URL: adres },
  });
  if (sonuc.status !== 0 || !sonuc.stdout) {
    uyari('expo config okunamadı — expoConfig.json yazılmadı (paket yine geçerli).');
    return null;
  }
  const cfg = JSON.parse(sonuc.stdout);
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

  if (!metin.includes(beklenenAdres)) {
    // Ne bulduğumuzu söyle — "yok" demek teşhis için yetmez.
    const bulunanlar = [...new Set(metin.match(/https?:\/\/[\w.-]+(?::\d+)?\/api/g) ?? [])];
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

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

function main() {
  baslik('TeksERP Mobil — UZAKTAN GÜNCELLEME PAKETİ');

  const { deger: adres, kaynak } = adresCoz();

  // ⚠️ MÜŞTERİ, KOMUTTAN. Paketin varlık URL'leri müşteri segmentini taşır;
  // yanlış müşteriyle üretilen paket, o fabrikanın tabletlerine BAŞKA bir
  // fabrikanın adreslerini gösterir. Beklenen değer dosyadan alınsaydı kapı
  // dairesel olurdu (bkz. build-apk.mjs `guncellemeKapisi`).
  const dosyadaki = musteriOku();
  const musteri = arg('musteri');
  if (!musteri) {
    dur(
      'HANGİ MÜŞTERİ İÇİN YAYINLANIYOR?',
      '`--musteri=<kod>` zorunludur — paketin içindeki adresler o koda göre kurulur.',
      `Bu ağaç şu an "${dosyadaki.kod}" (${dosyadaki.ad}) için yapılandırılmış.`,
      `Örnek:  npm run yayinla -- --musteri=${dosyadaki.kod}`,
    );
  }
  if (musteri !== dosyadaki.kod) {
    dur(
      'MÜŞTERİ UYUŞMAZLIĞI',
      `komutta      : ${musteri}`,
      `musteri.json : ${dosyadaki.kod}`,
      'Ağaç başka bir müşteri için yapılandırılmış; önce musteri.json + prebuild.',
    );
  }

  const { deger: feed, kaynak: feedKaynak } = guncellemeAdresiCoz(
    arg('update-url') || feedUrl(musteri),
  );
  const e = appJson();
  const runtimeVersion = String(e.runtimeVersion ?? '').trim();
  if (!runtimeVersion) {
    dur(
      'app.json → expo.runtimeVersion tanımlı değil',
      'Bu değer olmadan sunucu paketi hangi APK\'lara göndereceğini bilemez.',
    );
  }

  bilgi(`Müşteri           : ${musteri} (${dosyadaki.ad})`);
  bilgi(`ERP adresi        : ${adres}`);
  bilgi(`  kaynak          : ${kaynak}`);
  bilgi(`Güncelleme kanalı : ${manifestUrl(feed, runtimeVersion)}`);
  bilgi(`  kaynak          : ${feedKaynak}`);
  bilgi(`Uygulama sürümü   : ${e.version} (vc ${e.android?.versionCode})`);
  console.log('');

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
  const expoConfig = expoConfigYaz(adres, hedefDizin);

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
  const anahtarYol = path.join(PROJECT_ROOT, 'keystore/ota-keys/private-key.pem');
  const sertifikaYol = path.join(PROJECT_ROOT, 'keystore/ota-certs/certificate.pem');

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
    sertifikaPem = fs.existsSync(sertifikaYol) ? fs.readFileSync(sertifikaYol, 'utf8') : null;
    bilgi(`✔ İmzalandı (keyid="${keyid}", RSA-SHA256)`);
  }

  const govde = multipartKur({ manifest, imzaBasligiDegeri: imzaDegeri });

  // Üretileni İSTEMCİNİN yaptığı gibi ayrıştır ve imzayı SERTİFİKAYLA doğrula.
  // İmzalı ama doğrulanmamış bir paket yayınlamak, imzasız yayınlamaktan
  // KÖTÜDÜR: sahada sessizce reddedilir ve sebebi sunucuda görünmez.
  const dogrulama = multipartDogrula(govde, sertifikaPem);
  bilgi(`✔ Gövde ayrıştırıldı — manifest id ${dogrulama.manifest.id}`);
  if (sertifikaPem) bilgi('✔ İmza SERTİFİKAYLA doğrulandı (istemcinin yaptığı işin aynısı)');
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

main();
