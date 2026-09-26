#!/usr/bin/env node
// =============================================================================
// BEKÇİ — DAĞITIM KANALI ÇAKIŞMA KAPISI (K1) · zero-dep, DB'siz, ağsız
// =============================================================================
// Kayıt defteri `deploy/kanallar.json`; yüklemler `scripts/lib/kanallar.mjs`te
// (yayın betikleri AYNI fonksiyonları çağırır — ikinci kopya yok).
//
// NE ÖLÇER (hepsi DİNLENME durumu, yani commit edilen ağaç):
//   §1 kayıt defteri: kapalı şema · kod biçimi + önek-bağımsızlık · İKİLİ FARK
//      (iki kanal hiçbir dağıtım kimliğini paylaşamaz) · S9 görünür etiket
//   §2 DONMUŞ kimlik: sahadaki üretim kanalının kimliği literal olarak burada;
//      değişimi GÖÇTÜR (yeni uygulama · kayıp userData · kopan güncelleme kanalı)
//   §3 türetilmiş `yayin` alanları koddaki sabitlerle birebir (yayın kökü, VDS
//      kökü, feed/manifest/künye yolu biçimi) + kaynak sabitler birbirleriyle aynı
//   §4 işaretçiler + sabit kimlik: iki musteri.json, Electron/package.json,
//      main.ts, index.html, splash.html, mobil/app.json `varsayilan` kanalla birebir;
//      bilinmeyen kanal kodu KIRMIZI
//   §5 yayın yolu ENVANTERİ: yayın/paketleme yapan her dosya beyanlı ve kapılı
//      (kapısız ikinci yol = kırmızı; kapanmış borç beyanı da kırmızı — iki yönlü)
//
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ (okunamayan dosya, yeri değişmiş
// sabit). Ölçülemeyen kapı geçmiş kapı değildir — 2 de sıfır-dışıdır.
//
// Cırcır DEĞİL (taban yok): saf durum tutarlılığı; doğduğu gün ısırabilir.
// Kalıcı sonda: `--sonda` (✓K — dosyada yaşar, bellekteki kopyalara karşı koşar,
// her sondanın mutasyonunun UYGULANDIĞINI da ölçer).
//
//   node scripts/check-kanallar.mjs          # dinlenme durumu
//   node scripts/check-kanallar.mjs --sonda  # kalıcı negatif + pozitif sondalar
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import {
  KAYIT_REL,
  KOK,
  Olculemedi,
  PANEL_SABIT_DOSYALAR,
  TABLET_SABIT_DOSYALAR,
  YAYIN_ANAHTARLARI,
  dosyalariOku,
  kayitAyristir,
  kayitHatalari,
  panelIsaretciFarki,
  panelSabitKimlikFarki,
  tabletIsaretciFarki,
  tabletSabitKimlikFarki,
} from './lib/kanallar.mjs';

/**
 * SAHADAKİ kimlik — ölçüldü 2026-09-27 (Electron/package.json · main.ts ·
 * mobil/app.json · musteri.json; tablet ERP adresi b425d3af "tablet 1.0.8
 * yayınlandı" gömülü adres ölçümü). Bu tablo kayıt defterinin İKİNCİ kopyası
 * DEĞİL, sabitlenmiş ölçümüdür: kayıt + ağaç birlikte "düzeltilirse" ikisi
 * birbirini doğrular ve yalnız bu tablo sahayı hatırlar.
 */
const DONMUS = {
  adnansahin: {
    'panel.appId': 'com.etkiliyazilim.adnan-sahin-erp',
    'panel.urunAdi': 'Adnan Şahin ERP',
    'panel.paketAdi': 'adnan-sahin-erp-admin',
    'panel.erpDisAdresi': 'https://adnansahin-erp.etkiliyazilim.com',
    'tablet.androidPaket': 'com.teks.erp.mobil',
    'tablet.erpAdresi': 'http://192.168.1.250:4000/api',
    'tablet.otaSertifika': 'keystore/ota-certs/certificate.pem',
  },
};

/**
 * Yayın/paketleme yapan her dosya. Keşif deseni (§5) bu kümeden geniş olamaz:
 * desene uyan beyansız dosya = kapısı ölçülmemiş yeni bir yol.
 *   kapili     — `scripts/lib/kanallar.mjs`i çağırır
 *   saplama    — hiçbir şey yüklemez, sıfır-dışı çıkar
 *   kanal-disi — kanal kimliği taşımaz (gerekçe beyanlı)
 *   borc       — kapısız, gerekçe + kapanma koşulu beyanlı; kapı gelirse beyan KIRMIZI
 */
const YAYIN_YOLLARI = {
  'deploy/electron-paketle.sh': { sinif: 'kapili' },
  'deploy/electron-yayinla.sh': { sinif: 'kapili' },
  'deploy/mobil-yayinla.mjs': { sinif: 'kapili' },
  'mobil/scripts/yayinla-ota.mjs': { sinif: 'kapili' },
  'deploy/electron-yayinla.ps1': { sinif: 'saplama' },
  'deploy/paketle.ps1': {
    sinif: 'kanal-disi',
    gerekce: 'backend zip — kanal kimliği taşımaz (S8: ilk tur tek zip; dist-web dış adresi beyanlı fark)',
  },
  'mobil/scripts/build-apk.mjs': {
    sinif: 'borc',
    gerekce: 'APK ÜRETİMİ kanal kapısız; APK sahaya yalnız deploy/mobil-yayinla.mjs --apk ile çıkar ve o yol kapılı',
    kapanir: 'build-apk.mjs scripts/lib/kanallar.mjs kapısını çağırdığında (D3) — o gün sınıf `kapili` olur',
  },
};
const KAPI_IZI = 'scripts/lib/kanallar.mjs';
/** Kapı izi: .mjs yayıncı kitaplığı import eder, kabuk yayıncı CLI'yi çağırır. */
const KAPI_DESENI = /scripts\/(lib\/kanallar|kanal-kapisi)\.mjs/;
const KAPI_CLI = 'scripts/kanal-kapisi.mjs';

const KOD_KAYNAKLARI = [
  'Electron/shared/update-feed.ts',
  'mobil/scripts/lib/feed.cjs',
  'deploy/electron-paketle.sh',
  'deploy/electron-yayinla.sh',
  'deploy/mobil-yayinla.mjs',
];
const OKUNAN = [...new Set([KAYIT_REL, KAPI_CLI, ...PANEL_SABIT_DOSYALAR, ...TABLET_SABIT_DOSYALAR, ...KOD_KAYNAKLARI, ...Object.keys(YAYIN_YOLLARI)])];

/** Diskte yayın yolu keşfi — desen: deploy/ kökünde yayinla|paketle · mobil/scripts'te yayinla|apk. */
function yayinDosyalariniBul(kok = KOK) {
  const bul = (dizin, desen) => {
    try {
      return fs.readdirSync(path.join(kok, dizin), { withFileTypes: true })
        .filter((g) => g.isFile() && desen.test(g.name))
        .map((g) => `${dizin}/${g.name}`);
    } catch {
      throw new Olculemedi(`${dizin} listelenemedi`);
    }
  };
  return [...bul('deploy', /(yayinla|paketle)/i), ...bul('mobil/scripts', /(yayinla|apk)/i)].sort();
}

function yakala(d, rel, desen, neyi) {
  if (typeof d[rel] !== 'string') throw new Olculemedi(`${rel} okunamadı`);
  const r = desen.exec(d[rel]);
  if (!r) throw new Olculemedi(`${rel}: ${neyi} bulunamadı (yeri/biçimi değişti — bekçiyi güncelle)`);
  return r[1] ?? r[0];
}

/** Koddaki kaynak sabitler + yol BİÇİMLERİ. Biçim değiştiyse ÖLÇÜLEMEDİ (türetim sessizce kaymasın). */
function sabitleriOlc(d, kirmizi) {
  const kokUF = yakala(d, 'Electron/shared/update-feed.ts', /export const UPDATE_BASE_URL = "([^"]+)";/, 'UPDATE_BASE_URL');
  yakala(d, 'Electron/shared/update-feed.ts',
    /export const DEFAULT_UPDATE_FEED_URL = `\$\{UPDATE_BASE_URL\}\$\{MUSTERI_KODU\}\/electron\/`;/, 'panel feed biçimi');
  const kokFeed = yakala(d, 'mobil/scripts/lib/feed.cjs', /const YAYIN_KOKU = '([^']+)';/, 'YAYIN_KOKU');
  yakala(d, 'mobil/scripts/lib/feed.cjs', /return `\$\{YAYIN_KOKU\}\$\{musteriKodu\}\/mobil\/`;/, 'feedUrl biçimi');
  yakala(d, 'mobil/scripts/lib/feed.cjs', /return `\$\{normalizeFeed\(feed\)\}ota\/\$\{runtimeVersion\}\/manifest`;/, 'manifestUrl biçimi');
  yakala(d, 'mobil/scripts/lib/feed.cjs', /return `\$\{normalizeFeed\(feed\)\}apk\/surum\.json`;/, 'apkKunyeUrl biçimi');
  const kokPaketle = yakala(d, 'deploy/electron-paketle.sh', /^BASE_URL="([^"]+)"$/m, 'BASE_URL');
  yakala(d, 'deploy/electron-paketle.sh', /url: base \+ kod \+ '\/electron\/'/, 'publish adresi yazımı');
  const kokYayinla = yakala(d, 'deploy/electron-yayinla.sh', /^BASE_URL="\$\{BASE_URL:-([^}]+)\}"$/m, 'BASE_URL');
  const vdsYayinla = yakala(d, 'deploy/electron-yayinla.sh', /^YAYIN_KOK="\$\{YAYIN_KOK:-([^}]+)\}"$/m, 'YAYIN_KOK');
  yakala(d, 'deploy/electron-yayinla.sh', /UZAK_DIZIN="\$\{UZAK_DIZIN:-\$YAYIN_KOK\/\$musteri\/electron\}"/, 'UZAK_DIZIN biçimi');
  yakala(d, 'deploy/electron-yayinla.sh', /YAYIN_URL="\$\{YAYIN_URL:-\$BASE_URL\/\$musteri\/electron\}"/, 'YAYIN_URL biçimi');
  yakala(d, 'deploy/electron-yayinla.sh', /DEFTER_DIZIN="\$\(dirname "\$YAYIN_KOK"\)\/defter"/, 'DEFTER_DIZIN biçimi');
  yakala(d, 'deploy/electron-yayinla.sh', /\$DEFTER_DIZIN\/\$musteri-YAYIN-DEFTERI\.tsv/, 'defter dosya adı biçimi');
  const vdsMobil = yakala(d, 'deploy/mobil-yayinla.mjs', /`([^`$]+)\/\$\{MUSTERI\}\/mobil`/, 'mobil uzak kök biçimi');

  const koklar = { 'update-feed.ts UPDATE_BASE_URL': kokUF, 'feed.cjs YAYIN_KOKU': kokFeed,
    'electron-paketle.sh BASE_URL': kokPaketle, 'electron-yayinla.sh BASE_URL + "/"': `${kokYayinla}/` };
  if (new Set(Object.values(koklar)).size !== 1) {
    kirmizi.push(`yayın kökü kaynaklar arasında AYRIŞMIŞ: ${Object.entries(koklar).map(([k, v]) => `${k}="${v}"`).join(' · ')}`);
  }
  if (vdsYayinla !== vdsMobil) {
    kirmizi.push(`VDS kökü AYRIŞMIŞ: electron-yayinla.sh "${vdsYayinla}" · mobil-yayinla.mjs "${vdsMobil}"`);
  }
  return { yayinKoku: kokUF, vdsKok: vdsYayinla, defterKok: `${path.posix.dirname(vdsYayinla)}/defter` };
}

/** Bir kanalın `yayin` bloğu koddan böyle TÜRER (feed.cjs · update-feed.ts · iki yayıncı). */
function turet(kod, rv, s) {
  const panelFeed = `${s.yayinKoku}${kod}/electron/`;
  const mobilFeed = `${s.yayinKoku}${kod}/mobil/`;
  return {
    panelFeed,
    panelManifest: `${panelFeed}latest.yml`,
    mobilFeed,
    otaManifest: `${mobilFeed}ota/${rv}/manifest`,
    apkKunye: `${mobilFeed}apk/surum.json`,
    vdsPanel: `${s.vdsKok}/${kod}/electron`,
    vdsMobil: `${s.vdsKok}/${kod}/mobil`,
    panelDefter: `${s.defterKok}/${kod}-YAYIN-DEFTERI.tsv`,
  };
}

const al = (nesne, yol) => yol.split('.').reduce((o, k) => (o == null ? undefined : o[k]), nesne);

/** Bütün ölçüm. d: göreli yol → içerik; yayinDosyalari: keşfedilen yayın yolları. */
function olc(d, yayinDosyalari) {
  const kirmizi = [];
  const olculemedi = [];
  const bilgi = [];
  const dene = (fn) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof Olculemedi) olculemedi.push(e.message);
      else throw e;
    }
  };

  let kayit;
  try {
    kayit = kayitAyristir(d[KAYIT_REL]);
  } catch (e) {
    olculemedi.push(e.message);
    return { kirmizi, olculemedi, bilgi };
  }

  // §1
  kirmizi.push(...kayitHatalari(kayit).map((h) => `§1 ${h}`));
  const kanallar = kayit && typeof kayit.kanallar === 'object' && kayit.kanallar ? kayit.kanallar : {};

  // §2
  for (const [kod, alanlar] of Object.entries(DONMUS)) {
    const k = kanallar[kod];
    if (!k) {
      kirmizi.push(`§2 sahadaki üretim kanalı "${kod}" kayıt defterinden DÜŞTÜ — kanal silinmez, emekliye ayrılır (göç)`);
      continue;
    }
    if (k.tur !== 'uretim') kirmizi.push(`§2 "${kod}" üretim kanalıdır, tur "${k.tur}" olamaz`);
    for (const [alan, deger] of Object.entries(alanlar)) {
      const v = al(k, alan);
      if (v !== deger) {
        kirmizi.push(`§2 DONMUŞ KİMLİK DEĞİŞTİ: ${kod}.${alan} = "${v}" — sahadaki değer "${deger}". ` +
          'Bu bir GÖÇTÜR (sahadaki kurulumlar yeni uygulama/kanal görür): kullanıcı kararı + arşiv notu + bu tablonun bilinçli güncellenmesi.');
      }
    }
  }

  // §3
  dene(() => {
    const s = sabitleriOlc(d, kirmizi);
    let rv = null;
    try {
      rv = String(JSON.parse(d['mobil/app.json']).expo?.runtimeVersion ?? '');
    } catch {
      throw new Olculemedi('mobil/app.json okunamadı/ayrıştırılamadı');
    }
    for (const [kod, k] of Object.entries(kanallar)) {
      if (!k?.yayin || !k?.tablet) continue;
      if (k.tablet.runtimeVersion !== rv) {
        kirmizi.push(`§3 ${kod}.tablet.runtimeVersion "${k.tablet.runtimeVersion}" ↔ mobil/app.json "${rv}" — rv ortak çizgidir, kayıt app.json'la birlikte değişir`);
      }
      const bek = turet(kod, k.tablet.runtimeVersion, s);
      for (const a of YAYIN_ANAHTARLARI) {
        if (k.yayin[a] !== bek[a]) kirmizi.push(`§3 ${kod}.yayin.${a} = "${k.yayin[a]}" — koddan türeyen "${bek[a]}" (elle düzeltme, türet)`);
      }
    }
  });

  // §4
  const vk = kayit?.varsayilan;
  const varsayilan = typeof vk === 'string' ? kanallar[vk] : undefined;
  dene(() => {
    for (const rel of ['Electron/shared/musteri.json', 'mobil/musteri.json']) {
      let kod;
      try {
        kod = JSON.parse(d[rel]).kod;
      } catch {
        throw new Olculemedi(`${rel} okunamadı/ayrıştırılamadı`);
      }
      if (!Object.prototype.hasOwnProperty.call(kanallar, kod)) {
        kirmizi.push(`§4 BİLİNMEYEN KANAL KODU: ${rel} kod "${kod}" kayıt defterinde yok`);
      }
    }
  });
  if (varsayilan?.panel && varsayilan?.tablet && varsayilan?.yayin) {
    const on = (x) => `§4 ağaç ↔ varsayilan "${vk}": ${x}`;
    dene(() => kirmizi.push(...panelSabitKimlikFarki(varsayilan, d).map(on)));
    dene(() => kirmizi.push(...panelIsaretciFarki(vk, varsayilan, d).map(on)));
    dene(() => kirmizi.push(...tabletSabitKimlikFarki(varsayilan, d).map(on)));
    dene(() => kirmizi.push(...tabletIsaretciFarki(vk, d).map(on)));
  }

  // §5
  const beyanli = Object.keys(YAYIN_YOLLARI);
  for (const f of yayinDosyalari) {
    if (!beyanli.includes(f)) kirmizi.push(`§5 BEYANSIZ YAYIN YOLU: ${f} — kanal kapısı ölçülmemiş yeni bir yol (YAYIN_YOLLARI'na sınıfıyla ekle)`);
  }
  for (const [f, beyan] of Object.entries(YAYIN_YOLLARI)) {
    if (!yayinDosyalari.includes(f)) {
      kirmizi.push(`§5 ÖLÜ BEYAN: ${f} artık yok — YAYIN_YOLLARI'ndan çıkar`);
      continue;
    }
    const m = d[f];
    if (typeof m !== 'string') {
      olculemedi.push(`${f} okunamadı`);
      continue;
    }
    if (beyan.sinif === 'kapili' && !KAPI_DESENI.test(m)) kirmizi.push(`§5 ${f} kapılı beyanlı ama kanal kapısı (${KAPI_IZI} / ${KAPI_CLI}) çağrısı YOK`);
    if (beyan.sinif === 'saplama') {
      const kod = m.replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '');
      if (/\b(scp|ssh|rsync|Invoke-WebRequest|Invoke-RestMethod|Start-Process)\b/i.test(kod)) {
        kirmizi.push(`§5 ${f} saplama beyanlı ama yükleme/ağ komutu taşıyor`);
      }
      if (!/\bexit 1\b/.test(m)) kirmizi.push(`§5 ${f} saplama beyanlı ama sıfır-dışı çıkış (exit 1) yok`);
    }
    if (beyan.sinif === 'borc') {
      if (KAPI_DESENI.test(m)) kirmizi.push(`§5 ${f} borcu KAPANMIŞ (kapı çağrısı var) — beyanı \`kapili\` yap`);
      else bilgi.push(`ℹ️  §5 beyanlı borç: ${f} — ${beyan.gerekce} · kapanır: ${beyan.kapanir}`);
    }
    if (beyan.sinif === 'kanal-disi') bilgi.push(`ℹ️  §5 kanal dışı: ${f} — ${beyan.gerekce}`);
  }

  // Kabuk kapısının gövdesi KOŞULSUZ koşmalı: "doğrudan mı çağrıldım" tespiti sembolik
  // bağlı yolda (macOS /var, /tmp) susup 0 döndü — fail-open. Tripwire: koşulsuz çağrı satırı.
  const cliKod = typeof d[KAPI_CLI] === 'string' ? d[KAPI_CLI].replace(/^\s*\/\/.*$/gm, '') : null;
  if (cliKod === null) olculemedi.push(`${KAPI_CLI} okunamadı`);
  else if (!/^main\(process\.argv\.slice\(2\)\);\s*$/m.test(cliKod) || /import\.meta\.url|process\.argv\[1\]/.test(cliKod)) {
    kirmizi.push(`§5 ${KAPI_CLI} gövdesi KOŞULSUZ değil (giriş tespiti fail-open üretir) — tek satır \`main(process.argv.slice(2));\``);
  }

  return { kirmizi, olculemedi, bilgi };
}

const hukum = (s) => (s.olculemedi.length ? 'olculemedi' : s.kirmizi.length ? 'kirmizi' : 'yesil');

/* ------------------------------------------------------------------ *
 * Kalıcı sondalar — bellekteki kopyalara karşı
 * ------------------------------------------------------------------ */

function sondalar(taban, tabanYollar) {
  const jd = (d, rel, fn) => {
    const o = JSON.parse(d[rel]);
    fn(o);
    d[rel] = `${JSON.stringify(o, null, 2)}\n`;
  };
  const tf = (o) => o.kanallar.testfabrika;
  const as = (o) => o.kanallar.adnansahin;
  const yeniKanal = (o, kod, tur = 'uretim') => {
    const k = JSON.parse(JSON.stringify(as(o)));
    k.tur = tur;
    k.ad = `Kanal ${kod}`;
    for (const a of Object.keys(k.yayin)) k.yayin[a] = k.yayin[a].replaceAll('/adnansahin', `/${kod}`);
    k.panel = { appId: `com.ornek.${kod}`, urunAdi: `Urun ${kod}`, paketAdi: `urun-${kod}`, erpDisAdresi: '' };
    k.tablet = { ...k.tablet, androidPaket: `com.ornek.${kod}`, gorunenAd: `Tablet ${kod}`,
      erpAdresi: `http://10.9.9.${kod.length}:4000/api`, otaSertifika: `keystore/ota-certs-${kod}/certificate.pem` };
    o.kanallar[kod] = k;
  };
  const kayitta = (fn) => (d) => jd(d, KAYIT_REL, fn);
  const S = [
    // [ad, beklenen, mutasyon(d, yollar)]
    ['P0 gerçek ağaç YEŞİL', 'yesil', () => {}],
    ['P1 üçüncü üretim kanalı benzersiz kimliklerle YEŞİL (kapı aşırı sert değil)', 'yesil', kayitta((o) => yeniKanal(o, 'yenifabrika'))],
    ['P2 runtimeVersion doğru yükseltme (app.json + her kanalın rv + otaManifest) YEŞİL', 'yesil', (d) => {
      jd(d, 'mobil/app.json', (o) => { o.expo.runtimeVersion = '54.3'; });
      jd(d, KAYIT_REL, (o) => {
        for (const k of Object.values(o.kanallar)) {
          k.tablet.runtimeVersion = '54.3';
          k.yayin.otaManifest = k.yayin.otaManifest.replace('/ota/54.2/', '/ota/54.3/');
        }
      });
    }],
    ['P3 uzak erişimsiz kanal (erpDisAdresi boş) YEŞİL', 'yesil', kayitta((o) => { tf(o).panel.erpDisAdresi = ''; })],
    ['N1 iki kanal aynı androidPaket → KIRMIZI', 'kirmizi', kayitta((o) => { tf(o).tablet.androidPaket = 'com.teks.erp.mobil'; })],
    ['N2 iki kanal aynı tablet erpAdresi → KIRMIZI', 'kirmizi', kayitta((o) => { tf(o).tablet.erpAdresi = 'http://192.168.1.250:4000/api'; })],
    ['N3 iki kanal aynı panel appId → KIRMIZI', 'kirmizi', kayitta((o) => { tf(o).panel.appId = 'com.etkiliyazilim.adnan-sahin-erp'; })],
    ['N4 önek-çakışan kod (adnansahin-test) → KIRMIZI', 'kirmizi', kayitta((o) => yeniKanal(o, 'adnansahin-test'))],
    ['N5 kanala davranış anahtarı (financeEnabled) → KIRMIZI', 'kirmizi', kayitta((o) => { tf(o).financeEnabled = true; })],
    ['N6 kök düzeyde bilinmeyen anahtar (bayraklar) → KIRMIZI', 'kirmizi', kayitta((o) => { o.bayraklar = {}; })],
    ['N7 adnansahin appId kayıt + package.json + main.ts BİRLİKTE "düzeltildi" → KIRMIZI (DONMUŞ)', 'kirmizi', (d) => {
      const yeni = 'com.etkiliyazilim.teks-erp';
      jd(d, KAYIT_REL, (o) => { as(o).panel.appId = yeni; });
      jd(d, 'Electron/package.json', (o) => { o.build.appId = yeni; });
      d['Electron/electron/main.ts'] = d['Electron/electron/main.ts'].replace('com.etkiliyazilim.adnan-sahin-erp', yeni);
    }],
    ['N8 mobil/musteri.json işaretçisi testfabrika commit edildi → KIRMIZI', 'kirmizi', (d) => jd(d, 'mobil/musteri.json', (o) => { o.kod = 'testfabrika'; })],
    ['N9 Electron/shared/musteri.json bilinmeyen kod (testfabirka) → KIRMIZI', 'kirmizi', (d) => jd(d, 'Electron/shared/musteri.json', (o) => { o.kod = 'testfabirka'; })],
    ['N10 varsayilan bilinmeyen kanal → KIRMIZI', 'kirmizi', kayitta((o) => { o.varsayilan = 'yok'; })],
    ['N11 app.json runtimeVersion yükseldi, kayıt yükselmedi → KIRMIZI', 'kirmizi', (d) => jd(d, 'mobil/app.json', (o) => { o.expo.runtimeVersion = '54.3'; })],
    ['N12 türetilmiş alan bayat (testfabrika otaManifest 54.3) → KIRMIZI', 'kirmizi', kayitta((o) => { tf(o).yayin.otaManifest = tf(o).yayin.otaManifest.replace('54.2', '54.3'); })],
    ['N13 ps1 saplamasına scp geri döndü → KIRMIZI', 'kirmizi', (d) => { d['deploy/electron-yayinla.ps1'] += '\n& scp $setup "x:/y"\n'; }],
    ['N14 hazırlık kanalında görünür etiket yok → KIRMIZI', 'kirmizi', kayitta((o) => { tf(o).gorunurEtiket = null; })],
    ['N15 package.json publish adresi testfabrika commit edildi → KIRMIZI', 'kirmizi', (d) => jd(d, 'Electron/package.json', (o) => { o.build.publish[0].url = 'https://guncelleme.etkiliyazilim.com/testfabrika/electron/'; })],
    ['N16 beyansız yeni yayıncı (deploy/tablet-yayinla.sh) → KIRMIZI', 'kirmizi', (d, y) => { y.push('deploy/tablet-yayinla.sh'); }],
    ['N17 kapılı yayıncıdan kanal kapısı silindi (yayinla-ota.mjs) → KIRMIZI', 'kirmizi', (d) => { d['mobil/scripts/yayinla-ota.mjs'] = d['mobil/scripts/yayinla-ota.mjs'].replaceAll(KAPI_IZI, 'scripts/lib/baska.mjs'); }],
    ['N18 app.json android.package değişti (ağaç ↔ kayıt) → KIRMIZI', 'kirmizi', (d) => jd(d, 'mobil/app.json', (o) => { o.expo.android.package = 'com.teks.erp.mobil2'; })],
    ['N19 yayın kökü kaynaklar arasında ayrıştı (paketle BASE_URL) → KIRMIZI', 'kirmizi', (d) => { d['deploy/electron-paketle.sh'] = d['deploy/electron-paketle.sh'].replace('BASE_URL="https://guncelleme.etkiliyazilim.com/"', 'BASE_URL="https://guncelleme2.etkiliyazilim.com/"'); }],
    ['N20 build-apk borcu kapandı ama beyan kaldı → KIRMIZI (iki yönlü)', 'kirmizi', (d) => { d['mobil/scripts/build-apk.mjs'] += `\n// ${KAPI_IZI}\n`; }],
    ['N21 kabuk yayıncıdan kanal kapısı çağrısı silindi (electron-yayinla.sh) → KIRMIZI', 'kirmizi', (d) => { d['deploy/electron-yayinla.sh'] = d['deploy/electron-yayinla.sh'].replaceAll(KAPI_CLI, 'scripts/baska.mjs'); }],
    ['N22 kapı CLI dosyasına giriş tespiti geri döndü (fail-open sınıfı) → KIRMIZI', 'kirmizi', (d) => { d[KAPI_CLI] = d[KAPI_CLI].replace('main(process.argv.slice(2));', 'if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));'); }],
    ['O1 kayıt defteri bozuk JSON → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[KAYIT_REL] = d[KAYIT_REL].slice(0, 40); }],
    ['O2 update-feed.ts UPDATE_BASE_URL adı değişti → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d['Electron/shared/update-feed.ts'] = d['Electron/shared/update-feed.ts'].replace('export const UPDATE_BASE_URL', 'export const YAYIN_KOKU_URL'); }],
    ['O3 main.ts setAppUserModelId literal kalktı → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d['Electron/electron/main.ts'] = d['Electron/electron/main.ts'].replace('setAppUserModelId("com.etkiliyazilim.adnan-sahin-erp")', 'setAppUserModelId(APP_ID)'); }],
    ['O4 mobil/musteri.json yok → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d['mobil/musteri.json'] = undefined; }],
  ];

  let gecti = 0;
  const kaldi = [];
  for (const [ad, beklenen, mutasyon] of S) {
    const d = { ...taban };
    const y = [...tabanYollar];
    mutasyon(d, y);
    const degisti = ad.startsWith('P0') || Object.keys(taban).some((k) => d[k] !== taban[k]) || y.length !== tabanYollar.length;
    const s = olc(d, y);
    const h = hukum(s);
    const ok = degisti && h === beklenen;
    if (ok) gecti += 1;
    else kaldi.push(ad);
    const neden = [...s.olculemedi, ...s.kirmizi][0];
    console.log(`${ok ? '✅' : '❌'} ${ad}${degisti ? '' : ' — MUTASYON UYGULANMADI'} · hüküm ${h}${neden && beklenen !== 'yesil' ? ` · ${neden.slice(0, 140)}` : ''}`);
    if (!ok && h !== beklenen) for (const x of [...s.olculemedi, ...s.kirmizi].slice(0, 5)) console.log(`     · ${x}`);
  }
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi.length} başarısız ===`);
  return kaldi.length === 0;
}

/* ------------------------------------------------------------------ */

function main() {
  const d = dosyalariOku(OKUNAN);
  let yollar;
  try {
    yollar = yayinDosyalariniBul();
  } catch (e) {
    console.log(`⛔ ÖLÇÜLEMEDİ — ${e.message}`);
    process.exit(2);
  }

  if (process.argv.includes('--sonda')) {
    console.log('check-kanallar — kalıcı sondalar (bellekteki kopyalara karşı)\n');
    process.exit(sondalar(d, yollar) ? 0 : 1);
  }

  const s = olc(d, yollar);
  console.log('check-kanallar — dağıtım kanalı çakışma kapısı (K1)\n');
  for (const x of s.bilgi) console.log(x);
  for (const x of s.olculemedi) console.log(`⛔ ÖLÇÜLEMEDİ — ${x}`);
  for (const x of s.kirmizi) console.log(`❌ ${x}`);
  const h = hukum(s);
  if (h === 'yesil') {
    const kayit = JSON.parse(d[KAYIT_REL]);
    console.log(`✅ ${Object.keys(kayit.kanallar).length} kanal (${Object.keys(kayit.kanallar).join(' · ')}) · ikili fark temiz · DONMUŞ kimlik korunuyor · ağaç "${kayit.varsayilan}" ile birebir · ${yollar.length} yayın yolu beyanlı`);
    console.log('\n=== Sonuç: yeşil ===');
    process.exit(0);
  }
  console.log(`\n=== Sonuç: ${h === 'olculemedi' ? 'ÖLÇÜLEMEDİ' : 'KIRMIZI'} (${s.kirmizi.length} kırmızı, ${s.olculemedi.length} ölçülemedi) ===`);
  process.exit(h === 'olculemedi' ? 2 : 1);
}

main();
