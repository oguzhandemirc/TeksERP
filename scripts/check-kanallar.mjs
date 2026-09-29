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
//      mobil/app.json `varsayilan` kanalla birebir; panel kaynağı (main.ts,
//      index.html, splash.html, shared/channel.ts, build-channel.ts) kimliği KANALDAN
//      alır, hiçbir kanalın literal kimliğini taşımaz; bilinmeyen kanal kodu KIRMIZI
//   §5 yayın yolu ENVANTERİ: yayın/paketleme yapan her dosya beyanlı ve kapılı
//      (kapısız ikinci yol = kırmızı; kapanmış borç beyanı da kırmızı — iki yönlü);
//      `terfi` beyanlı yol terfi kapısını (K5, scripts/lib/terfi.mjs) da çağırır
//   §6 commit kapısı tetiği (`kanalBekcisiTetigi`) bu bekçinin okuduğu HER dosyayı
//      kapsar ve açık listesinin her dosyası diskte vardır (tetik okunandan dar ya da ölü olamaz)
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
  KANAL_BEKCI_DOSYALARI,
  KAYIT_REL,
  KOK,
  Olculemedi,
  PANEL_SABIT_DOSYALAR,
  TABLET_SABIT_DOSYALAR,
  YAYIN_ANAHTARLARI,
  YAYIN_YOLU_DESENLERI,
  dosyalariOku,
  kanalBekcisiTetigi,
  kayitAyristir,
  kayitHatalari,
  panelIsaretciFarki,
  panelKaynakFarki,
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
    // Electron/.env.production (a84fa180) VITE_API_BASE_URL — paketin arayüzüne gömülü (ölçüldü: 1.3.3 derlemesi).
    'panel.erpAdresi': 'http://192.168.1.250:4000',
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
  'deploy/electron-paketle.sh': { sinif: 'kapili', terfi: true },
  'deploy/electron-yayinla.sh': { sinif: 'kapili', terfi: true },
  'deploy/mobil-yayinla.mjs': { sinif: 'kapili', terfi: true },
  'mobil/scripts/yayinla-ota.mjs': { sinif: 'kapili', terfi: true },
  'mobil/scripts/build-apk.mjs': { sinif: 'kapili', terfi: true },
  'deploy/electron-yayinla.ps1': { sinif: 'saplama' },
  // Backend zip: -Musteri <kod> ile kanal kimliği (pm2Ad/urunAdi) alır → 'kapılı'
  //   (Faz 2b: müşteri kodu argümandan, kök kuralı backend'e genişledi). TERFİ YOK:
  //   backend'in HTTP yayın feed'i Faz 3 dağıtım kapısına kadar yok — üretim kanalına
  //   HTTP terfisi ölçülemez, o yüzden terfi kapısı burada aranmaz.
  'deploy/paketle.ps1': { sinif: 'kapili' },
};
const KAPI_IZI = 'scripts/lib/kanallar.mjs';
/** Kapı izi: .mjs yayıncı kitaplığı import eder, kabuk yayıncı CLI'yi çağırır. */
const KAPI_DESENI = /scripts\/(lib\/kanallar|kanal-kapisi)\.mjs/;
const KAPI_CLI = 'scripts/kanal-kapisi.mjs';
/**
 * Terfi kapısı (K5) izi: .mjs yayıncı `terfiKapisi(` çağırır, kabuk yayıncı CLI'nin `terfi` komutunu.
 * Yüklemin salt import'u ya da kaçış kaydı (`terfi-atla-kaydi`) kapı sayılmaz.
 */
const TERFI_DESENI = /\bterfiKapisi\(|kanal-kapisi\.mjs"? terfi "/;

const KOD_KAYNAKLARI = [
  'Electron/shared/update-feed.ts',
  'mobil/scripts/lib/feed.cjs',
  'deploy/electron-paketle.sh',
  'deploy/electron-yayinla.sh',
  'deploy/mobil-yayinla.mjs',
];
const KAPI_KANCASI = 'scripts/hooks/pre-commit.mjs';
const OKUNAN = [...new Set([KAYIT_REL, KAPI_CLI, KAPI_KANCASI, ...PANEL_SABIT_DOSYALAR, ...TABLET_SABIT_DOSYALAR, ...KOD_KAYNAKLARI, ...Object.keys(YAYIN_YOLLARI)])];

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
  return YAYIN_YOLU_DESENLERI.flatMap((d) => bul(d.dizin, d.ad)).sort();
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
  // Panelin çalışma anı adresi kaydın kendisidir (derleme anında); biçimini aşağıdaki türetim ölçer.
  yakala(d, 'Electron/shared/update-feed.ts',
    /export const DEFAULT_UPDATE_FEED_URL: string = UPDATE_FEED_URL;/, 'panel feed kayıttan (UPDATE_FEED_URL)');
  const kokFeed = yakala(d, 'mobil/scripts/lib/feed.cjs', /const YAYIN_KOKU = '([^']+)';/, 'YAYIN_KOKU');
  yakala(d, 'mobil/scripts/lib/feed.cjs', /return `\$\{YAYIN_KOKU\}\$\{musteriKodu\}\/mobil\/`;/, 'feedUrl biçimi');
  yakala(d, 'mobil/scripts/lib/feed.cjs', /return `\$\{normalizeFeed\(feed\)\}ota\/\$\{runtimeVersion\}\/manifest`;/, 'manifestUrl biçimi');
  yakala(d, 'mobil/scripts/lib/feed.cjs', /return `\$\{normalizeFeed\(feed\)\}apk\/surum\.json`;/, 'apkKunyeUrl biçimi');
  const kokPaketle = yakala(d, 'deploy/electron-paketle.sh', /^BASE_URL="([^"]+)"$/m, 'BASE_URL');
  yakala(d, 'deploy/electron-paketle.sh', /^beklenen_url="\$\{BASE_URL\}\$\{musteri\}\/electron\/"$/m, 'beklenen adres türetimi');
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
function olc(d, yayinDosyalari, yayinYollari = YAYIN_YOLLARI) {
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
    dene(() => kirmizi.push(...panelKaynakFarki(kayit, d).map((x) => `§4 panel kaynağı: ${x}`)));
    dene(() => kirmizi.push(...tabletSabitKimlikFarki(varsayilan, d).map(on)));
    dene(() => kirmizi.push(...tabletIsaretciFarki(vk, d).map(on)));
  }

  // §5
  const beyanli = Object.keys(yayinYollari);
  for (const f of yayinDosyalari) {
    if (!beyanli.includes(f)) kirmizi.push(`§5 BEYANSIZ YAYIN YOLU: ${f} — kanal kapısı ölçülmemiş yeni bir yol (YAYIN_YOLLARI'na sınıfıyla ekle)`);
  }
  for (const [f, beyan] of Object.entries(yayinYollari)) {
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
    if (beyan.terfi && !TERFI_DESENI.test(m)) kirmizi.push(`§5 ${f} terfi kapılı beyanlı ama terfi kapısı (scripts/lib/terfi.mjs / ${KAPI_CLI} terfi) çağrısı YOK — üretim kanalına onaysız yol`);
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

  // §6 — tetik okunandan DAR olamaz (kapsanmayan okuma = kapıda görülmeyen değişiklik) ve ölü girdi taşımaz.
  for (const f of [...OKUNAN, ...yayinDosyalari, 'scripts/check-kanallar.mjs']) {
    if (!kanalBekcisiTetigi(f)) kirmizi.push(`§6 commit kapısı tetiği ${f} dosyasını KAPSAMIYOR — bekçi onu okuyor ama ona dokunan commit bekçiyi koşmaz`);
  }
  for (const f of KANAL_BEKCI_DOSYALARI) {
    if (!fs.existsSync(path.join(KOK, f))) kirmizi.push(`§6 tetik listesinde ÖLÜ girdi: ${f} diskte yok`);
  }
  // Tetik kablolanmış mı: kanca tetiği kullanıyor ve İKİ bekçiyi de koşuyor (tanımlı ama bağlanmamış tetik kapı değildir).
  const kanca = d[KAPI_KANCASI];
  if (typeof kanca !== 'string') olculemedi.push(`${KAPI_KANCASI} okunamadı`);
  else {
    for (const [ne, iz] of [['tetik', 'staged.some(kanalBekcisiTetigi)'], ['kayıt bekçisi', '"scripts/check-kanallar.mjs"'],
      ['yayın kapıları bekçisi', '"scripts/test_kanal_yayin_kapisi.mjs"']]) {
      if (!kanca.includes(iz)) kirmizi.push(`§6 commit kancası kanal ${ne} kablosunu taşımıyor (${iz})`);
    }
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
    k.terfiKaynagi = null;
    k.ad = `Kanal ${kod}`;
    for (const a of Object.keys(k.yayin)) k.yayin[a] = k.yayin[a].replaceAll('/adnansahin', `/${kod}`);
    k.panel = { appId: `com.ornek.${kod}`, urunAdi: `Urun ${kod}`, paketAdi: `urun-${kod}`, erpDisAdresi: '', erpAdresi: `http://10.9.8.${kod.length}:4000` };
    k.tablet = { ...k.tablet, androidPaket: `com.ornek.${kod}`, gorunenAd: `Tablet ${kod}`,
      erpAdresi: `http://10.9.9.${kod.length}:4000/api`, otaSertifika: `keystore/ota-certs-${kod}/certificate.pem` };
    // Backend kimliği de AYRIK (urunAdi/pm2Ad her kanalda benzersiz — Faz 2b).
    k.backend = { urunAdi: `Urun ${kod} Backend`, pm2Ad: `tekserp-backend-${kod}` };
    o.kanallar[kod] = k;
  };
  const kayitta = (fn) => (d) => jd(d, KAYIT_REL, fn);
  const S = [
    // [ad, beklenen, mutasyon(d, yollar, beyanlar), iz?]
    ['P0 gerçek ağaç YEŞİL', 'yesil', () => {}],
    ['P1 üçüncü üretim kanalı (aynasız, terfiKaynagi null) benzersiz kimliklerle YEŞİL (kapı aşırı sert değil)', 'yesil', kayitta((o) => yeniKanal(o, 'yenifabrika'))],
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
    ['N20 kapısı olan yayıncı hâlâ borç beyanlı (build-apk) → KIRMIZI (iki yönlü)', 'kirmizi', (d, y, b) => {
      b['mobil/scripts/build-apk.mjs'] = { sinif: 'borc', gerekce: 'sonda', kapanir: 'sonda' };
    }],
    ['N21 kabuk yayıncıdan kanal kapısı çağrısı silindi (electron-yayinla.sh) → KIRMIZI', 'kirmizi', (d) => { d['deploy/electron-yayinla.sh'] = d['deploy/electron-yayinla.sh'].replaceAll(KAPI_CLI, 'scripts/baska.mjs'); }],
    ['N22 kapı CLI dosyasına giriş tespiti geri döndü (fail-open sınıfı) → KIRMIZI', 'kirmizi', (d) => { d[KAPI_CLI] = d[KAPI_CLI].replace('main(process.argv.slice(2));', 'if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));'); }],
    ['N23 main.ts AUMID yeniden literal (kanaldan değil) → KIRMIZI', 'kirmizi', (d) => { d['Electron/electron/main.ts'] = d['Electron/electron/main.ts'].replace('setAppUserModelId(APP_ID)', 'setAppUserModelId("com.etkiliyazilim.adnan-sahin-erp")'); }],
    ['N24 main.ts pencere başlığı yeniden literal → KIRMIZI', 'kirmizi', (d) => { d['Electron/electron/main.ts'] = d['Electron/electron/main.ts'].replace('title: WINDOW_TITLE,', 'title: "Adnan Şahin ERP",'); }],
    ['N25 main.ts sayfa başlığının pencere başlığını ezmesi açıldı (page-title-updated kalktı) → KIRMIZI', 'kirmizi', (d) => { d['Electron/electron/main.ts'] = d['Electron/electron/main.ts'].replace('mainWindow.on("page-title-updated", (event) => event.preventDefault());', ''); }],
    ['N26 index.html <title> yeniden literal ürün adı → KIRMIZI', 'kirmizi', (d) => { d['Electron/index.html'] = d['Electron/index.html'].replace('<title>%TEKSERP_WINDOW_TITLE%</title>', '<title>Adnan Şahin ERP</title>'); }],
    ['N27 musteri.json yeniden kimlik kopyası taşıyor (ad) → KIRMIZI', 'kirmizi', (d) => jd(d, 'Electron/shared/musteri.json', (o) => { o.ad = 'Adnan Şahin Tekstil'; })],
    ['N28 iki kanal aynı panel.erpAdresi (varsayılan sunucu) → KIRMIZI', 'kirmizi', kayitta((o) => { tf(o).panel.erpAdresi = 'http://192.168.1.250:4000'; })],
    ['N29 adnansahin panel.erpAdresi kayıtta "düzeltildi" → KIRMIZI (DONMUŞ)', 'kirmizi', kayitta((o) => { as(o).panel.erpAdresi = 'http://192.168.1.251:4000'; })],
    ['N30 build-channel.ts kayıt defterini okumuyor → KIRMIZI', 'kirmizi', (d) => { d['Electron/build-channel.ts'] = d['Electron/build-channel.ts'].replaceAll('deploy/kanallar.json', 'shared/baska.json'); }],
    ['N31 splash.html <title> yeniden kanal ürün adı taşıyor → KIRMIZI', 'kirmizi', (d) => { d['Electron/resources/splash.html'] = d['Electron/resources/splash.html'].replace('<title>TeksERP</title>', '<title>TeksERP Test Fabrika</title>'); }],
    ['N32 shared/channel.ts kimliği sanal modülden değil (elle yazılmış) → KIRMIZI', 'kirmizi', (d) => { d['Electron/shared/channel.ts'] = d['Electron/shared/channel.ts'].replace('from "virtual:tekserp-channel"', 'from "./elle-kimlik"'); }],
    ['N33 bekçinin okuduğu bir yayın yolu commit tetiğinin DIŞINDA → KIRMIZI (§6)', 'kirmizi', (d, y) => { y.push('Electron/yayinla-panel.sh'); }, '§6'],
    ['N34 commit kancasından kanal adımı söküldü → KIRMIZI (§6)', 'kirmizi', (d) => { d[KAPI_KANCASI] = d[KAPI_KANCASI].replace('staged.some(kanalBekcisiTetigi)', 'false'); }, '§6'],
    ['N35 build-apk kanal kapısı silindi → KIRMIZI', 'kirmizi', (d) => { d['mobil/scripts/build-apk.mjs'] = d['mobil/scripts/build-apk.mjs'].replaceAll(KAPI_IZI, 'scripts/lib/baska.mjs'); }],
    ['N36 adnansahin terfiKaynagi anahtarı silindi (K5 sessizce kapanırdı) → KIRMIZI', 'kirmizi', kayitta((o) => { delete as(o).terfiKaynagi; }), 'terfiKaynagi'],
    ['N37 adnansahin terfiKaynagi null, testfabrika hâlâ aynası → KIRMIZI', 'kirmizi', kayitta((o) => { as(o).terfiKaynagi = null; }), 'terfiKaynagi'],
    ['N38 terfiKaynagi bir ÜRETİM kanalını gösteriyor → KIRMIZI', 'kirmizi', kayitta((o) => { yeniKanal(o, 'yenifabrika'); as(o).terfiKaynagi = 'yenifabrika'; }), 'terfiKaynagi'],
    ['N39 hazırlık kanalında terfiKaynagi anahtarı → KIRMIZI (şema kapalı)', 'kirmizi', kayitta((o) => { tf(o).terfiKaynagi = 'adnansahin'; }), 'tanınmayan anahtar'],
    ['N40 kabuk yayıncıdan terfi kapısı çağrısı silindi (electron-yayinla.sh) → KIRMIZI', 'kirmizi', (d) => { d['deploy/electron-yayinla.sh'] = d['deploy/electron-yayinla.sh'].replaceAll('kanal-kapisi.mjs" terfi', 'kanal-kapisi.mjs" kanal'); }, 'terfi kapısı'],
    ['N41 mjs yayıncıdan terfi yüklemi çağrısı silindi, import kaldı (mobil-yayinla.mjs) → KIRMIZI', 'kirmizi', (d) => { d['deploy/mobil-yayinla.mjs'] = d['deploy/mobil-yayinla.mjs'].replaceAll('terfiKapisi(', 'baskaKapi('); }, 'terfi kapısı'],
    ['N42 build-apk terfi kapısı çağrısı silindi → KIRMIZI', 'kirmizi', (d) => { d['mobil/scripts/build-apk.mjs'] = d['mobil/scripts/build-apk.mjs'].replaceAll('terfiKapisi(', 'baskaKapi('); }, 'terfi kapısı'],
    ['N43 backend paketleyiciden (paketle.ps1) kanal kapısı çağrısı silindi → KIRMIZI', 'kirmizi', (d) => { d['deploy/paketle.ps1'] = d['deploy/paketle.ps1'].replaceAll('kanal-kapisi.mjs', 'baska.mjs'); }],
    ['O1 kayıt defteri bozuk JSON → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[KAYIT_REL] = d[KAYIT_REL].slice(0, 40); }],
    ['O2 update-feed.ts UPDATE_BASE_URL adı değişti → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d['Electron/shared/update-feed.ts'] = d['Electron/shared/update-feed.ts'].replace('export const UPDATE_BASE_URL', 'export const YAYIN_KOKU_URL'); }],
    ['O3 main.ts setAppUserModelId çağrısı kalktı → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d['Electron/electron/main.ts'] = d['Electron/electron/main.ts'].replace('app.setAppUserModelId(APP_ID);', 'void 0;'); }],
    ['O4 mobil/musteri.json yok → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d['mobil/musteri.json'] = undefined; }],
  ];

  let gecti = 0;
  const kaldi = [];
  for (const [ad, beklenen, mutasyon, iz] of S) {
    const d = { ...taban };
    const y = [...tabanYollar];
    const b = JSON.parse(JSON.stringify(YAYIN_YOLLARI));
    mutasyon(d, y, b);
    const degisti = ad.startsWith('P0') || Object.keys(taban).some((k) => d[k] !== taban[k]) || y.length !== tabanYollar.length ||
      JSON.stringify(b) !== JSON.stringify(YAYIN_YOLLARI);
    const s = olc(d, y, b);
    const h = hukum(s);
    // `iz`: hüküm DOĞRU bölümden gelmeli (başka bir kolun kırmızısı sondayı sahte geçirmesin).
    const ok = degisti && h === beklenen && (!iz || [...s.kirmizi, ...s.olculemedi].some((x) => x.includes(iz)));
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
