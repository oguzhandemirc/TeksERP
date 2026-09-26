// =============================================================================
// TeksERP — DAĞITIM KANALI KAYIT DEFTERİ (deploy/kanallar.json) — TEK YÜKLEM
// =============================================================================
// Aynı soruyu dört betik soruyor: "bu komut hangi kanala, hangi kimlikle gidiyor
// ve paket gerçekten o kanalın mı?" Cevap tek yerde yaşar; bekçi
// (`scripts/check-kanallar.mjs`) ile yayın betikleri AYNI fonksiyonları çağırır.
//
// ⚠️ ÜÇ SONUÇ, İKİ DEĞİL: yeşil · kırmızı · ÖLÇÜLEMEDİ. Okunamayan kayıt defteri,
// çözülemeyen artefakt ya da yeri değişmiş bir kaynak sabiti "ihlal yok" DEMEK
// DEĞİLDİR — `Olculemedi` fırlatılır ve çağıran DURUR.
//
// ⚠️ DAVRANIŞ TAŞIMAZ: kayıt yalnız dağıtım kimliğidir. Şema KAPALI anahtar
// kümesidir; bayrak/ayar anahtarı girerse kırmızı (kanal kodu fork'un tohumu
// olamaz — kök CLAUDE.md § Dallanma).
//
// Kabuk betikleri bu dosyayı DOĞRUDAN çağırmaz: CLI `scripts/kanal-kapisi.mjs`tedir
// (burada "doğrudan mı çalıştırıldım" tespiti sembolik bağlı yolda susup 0 dönüyordu).
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KAYIT_REL = 'deploy/kanallar.json';

/** URL yol segmenti olacak: küçük harf, rakam, tire (paketle regex'i ∩ feed.cjs regex'i). */
export const KOD_DESENI = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** Okunamadı / çözülemedi — "ihlal yok" ile karışmasın diye ayrı tip. */
export class Olculemedi extends Error {}

const TURLER = new Set(['uretim', 'hazirlik']);
const KOK_ANAHTARLARI = ['_aciklama', 'varsayilan', 'kanallar'];
const KANAL_ANAHTARLARI = {
  uretim: ['tur', 'ad', 'gorunurEtiket', 'yayin', 'panel', 'tablet'],
  hazirlik: ['tur', 'ayna', 'ad', 'gorunurEtiket', 'yayin', 'panel', 'tablet'],
};
export const YAYIN_ANAHTARLARI = [
  'panelFeed', 'panelManifest', 'mobilFeed', 'otaManifest', 'apkKunye', 'vdsPanel', 'vdsMobil', 'panelDefter',
];
export const PANEL_ANAHTARLARI = ['appId', 'urunAdi', 'paketAdi', 'erpDisAdresi'];
export const TABLET_ANAHTARLARI = ['androidPaket', 'gorunenAd', 'erpAdresi', 'runtimeVersion', 'otaSertifika'];

/**
 * İki kanal arasında AYNI OLAMAYAN alanlar. `runtimeVersion` bilerek YOK: uyum
 * kimliğidir, kanal kimliği değil (iki kanal aynı native'i taşır ki OTA↔APK
 * kararı birebir prova edilsin). Boş/null değer karşılaştırılmaz (ör. uzak
 * erişimi olmayan kanalın dış adresi).
 */
export const AYRIK_ALANLAR = [
  'ad', 'gorunurEtiket',
  ...YAYIN_ANAHTARLARI.map((a) => `yayin.${a}`),
  'panel.appId', 'panel.urunAdi', 'panel.paketAdi', 'panel.erpDisAdresi',
  'tablet.androidPaket', 'tablet.gorunenAd', 'tablet.erpAdresi', 'tablet.otaSertifika',
];

const al = (nesne, yol) => yol.split('.').reduce((o, k) => (o == null ? undefined : o[k]), nesne);
const bosMu = (v) => v === null || v === undefined || v === '';
const esitKumeler = (gercek, beklenen) => {
  const eksik = beklenen.filter((k) => !gercek.includes(k));
  const fazla = gercek.filter((k) => !beklenen.includes(k));
  return { eksik, fazla };
};

/** Sondaki `/`ları atar — `http://x/api` ile `http://x/api/` aynı adrestir. */
export const adresNormal = (a) => String(a ?? '').trim().replace(/\/+$/, '');
export const erpAdresiEsit = (a, b) => adresNormal(a) !== '' && adresNormal(a) === adresNormal(b);

/* ------------------------------------------------------------------ *
 * Okuma
 * ------------------------------------------------------------------ */

/** Kayıt metnini ayrıştırır; bozuksa ÖLÇÜLEMEDİ. */
export function kayitAyristir(metin) {
  if (typeof metin !== 'string') throw new Olculemedi(`${KAYIT_REL} okunamadı (dosya yok)`);
  try {
    return JSON.parse(metin);
  } catch (e) {
    throw new Olculemedi(`${KAYIT_REL} JSON olarak ayrıştırılamadı: ${e.message}`);
  }
}

/** Diskten okur. */
export function kayitOku(kok = KOK) {
  let metin;
  try {
    metin = fs.readFileSync(path.join(kok, KAYIT_REL), 'utf8');
  } catch (e) {
    throw new Olculemedi(`${KAYIT_REL} okunamadı: ${e.message}`);
  }
  return kayitAyristir(metin);
}

/* ------------------------------------------------------------------ *
 * Kayıt defterinin KENDİSİ — yapı · kodlar · ikili fark
 * ------------------------------------------------------------------ */

/** Kayıt defterinin iç tutarlılığı. Dosyaya/koda bakmaz (çalışma anı kapıları da çağırır). */
export function kayitHatalari(kayit) {
  const h = [];
  if (!kayit || typeof kayit !== 'object' || Array.isArray(kayit)) return ['kayıt defteri bir nesne değil'];

  const kk = esitKumeler(Object.keys(kayit), KOK_ANAHTARLARI);
  if (kk.fazla.length) h.push(`kök düzeyde tanınmayan anahtar (şema kapalı): ${kk.fazla.join(', ')}`);
  for (const k of ['varsayilan', 'kanallar']) if (!(k in kayit)) h.push(`kök düzeyde zorunlu anahtar yok: ${k}`);

  const kanallar = kayit.kanallar;
  if (!kanallar || typeof kanallar !== 'object' || Array.isArray(kanallar)) {
    h.push('`kanallar` bir nesne değil');
    return h;
  }
  const kodlar = Object.keys(kanallar);
  if (kodlar.length === 0) h.push('hiç kanal yok');

  for (const kod of kodlar) {
    if (!KOD_DESENI.test(kod)) h.push(`kanal kodu URL segmenti olamaz: "${kod}" (küçük harf/rakam/tire, 2-31)`);
  }
  // Önek-bağımsızlık: `adnansahin` ↔ `adnansahin-test` gibi bir çift, önekle
  // eşleşen her aramayı (startsWith, grep, göz) iki kanala birden açar.
  for (const a of kodlar) {
    for (const b of kodlar) {
      if (a !== b && b.startsWith(a)) h.push(`kanal kodu "${a}", "${b}" kodunun ÖNEKİ — kodlar önek-bağımsız olmalı`);
    }
  }
  if (typeof kayit.varsayilan !== 'string' || !kodlar.includes(kayit.varsayilan)) {
    h.push(`varsayilan "${kayit.varsayilan}" kayıtlı bir kanal değil`);
  }

  for (const kod of kodlar) {
    const k = kanallar[kod];
    const on = `kanal "${kod}"`;
    if (!k || typeof k !== 'object' || Array.isArray(k)) {
      h.push(`${on}: nesne değil`);
      continue;
    }
    if (!TURLER.has(k.tur)) {
      h.push(`${on}: tur "${k.tur}" tanınmıyor (uretim | hazirlik)`);
      continue;
    }
    const sk = esitKumeler(Object.keys(k), KANAL_ANAHTARLARI[k.tur]);
    if (sk.fazla.length) h.push(`${on}: tanınmayan anahtar (şema kapalı — kayıt DAVRANIŞ taşımaz): ${sk.fazla.join(', ')}`);
    if (sk.eksik.length) h.push(`${on}: eksik anahtar: ${sk.eksik.join(', ')}`);

    if (typeof k.ad !== 'string' || !k.ad.trim()) h.push(`${on}: ad boş`);
    // S9: hazırlık kanalı GÖRÜNÜR bir işaret taşır (gerçek verinin kopyasına gerçek iş
    // girilmesin); üretim kanalı bugün hiçbir işaret göstermez ve öyle kalır.
    if (k.tur === 'uretim' && k.gorunurEtiket !== null) h.push(`${on}: üretim kanalı görünür etiket taşımaz (null olmalı)`);
    if (k.tur === 'hazirlik' && (typeof k.gorunurEtiket !== 'string' || !k.gorunurEtiket.trim())) {
      h.push(`${on}: hazırlık kanalı görünür etiket taşımalı (S9)`);
    }
    if (k.tur === 'hazirlik') {
      const ayna = kanallar[k.ayna];
      if (!ayna || ayna.tur !== 'uretim') h.push(`${on}: ayna "${k.ayna}" kayıtlı bir üretim kanalı değil`);
    }

    for (const [blok, anahtarlar] of [['yayin', YAYIN_ANAHTARLARI], ['panel', PANEL_ANAHTARLARI], ['tablet', TABLET_ANAHTARLARI]]) {
      const b = k[blok];
      if (!b || typeof b !== 'object' || Array.isArray(b)) {
        h.push(`${on}: ${blok} bloğu yok`);
        continue;
      }
      const bk = esitKumeler(Object.keys(b), anahtarlar);
      if (bk.fazla.length) h.push(`${on}: ${blok} bloğunda tanınmayan anahtar (şema kapalı): ${bk.fazla.join(', ')}`);
      if (bk.eksik.length) h.push(`${on}: ${blok} bloğunda eksik anahtar: ${bk.eksik.join(', ')}`);
      for (const a of anahtarlar) {
        const v = b[a];
        const bosOlabilir = blok === 'panel' && a === 'erpDisAdresi';
        if (typeof v !== 'string' || (!bosOlabilir && !v.trim())) h.push(`${on}: ${blok}.${a} boş ya da metin değil`);
      }
    }
    const erp = k.tablet?.erpAdresi;
    if (typeof erp === 'string' && !/^https?:\/\/[^/\s]+\/api$/.test(erp)) {
      h.push(`${on}: tablet.erpAdresi "${erp}" biçimi tutmuyor (http(s)://<host>[:port]/api)`);
    }
    if (typeof erp === 'string' && /(localhost|127\.0\.0\.1)/i.test(erp)) h.push(`${on}: tablet.erpAdresi localhost olamaz`);
    const dis = k.panel?.erpDisAdresi;
    if (typeof dis === 'string' && dis !== '' && !/^https?:\/\/[^/\s]+$/.test(dis)) {
      h.push(`${on}: panel.erpDisAdresi "${dis}" biçimi tutmuyor (http(s)://<host>[:port], sonda / yok)`);
    }
  }

  // İKİLİ FARK — iki kanal hiçbir dağıtım kimliğini paylaşamaz.
  for (const alan of AYRIK_ALANLAR) {
    const sahip = new Map();
    for (const kod of kodlar) {
      const v = al(kanallar[kod], alan);
      if (bosMu(v)) continue;
      const anahtar = alan.endsWith('erpAdresi') || alan.endsWith('erpDisAdresi') ? adresNormal(v) : v;
      if (sahip.has(anahtar)) h.push(`ÇAKIŞMA: ${alan} = "${v}" hem "${sahip.get(anahtar)}" hem "${kod}" kanalında`);
      else sahip.set(anahtar, kod);
    }
  }
  return h;
}

/**
 * Çalışma anı kapısı: kayıt geçerli ve `kod` kayıtlı mı. Geçersizse DUR sebebi.
 * @returns {{ kayit: object, kanal: object }}
 * @throws {Olculemedi} okunamazsa · {Error} kırmızıysa (`.satirlar` teşhis)
 */
export function kanalCoz(kod, { kok = KOK, kayit } = {}) {
  const k = kayit ?? kayitOku(kok);
  const hatalar = kayitHatalari(k);
  if (hatalar.length) {
    const e = new Error('KANAL KAYIT DEFTERİ KIRMIZI');
    e.satirlar = [...hatalar, `Önce düzelt: node scripts/check-kanallar.mjs`];
    throw e;
  }
  if (!kod || !Object.prototype.hasOwnProperty.call(k.kanallar, kod)) {
    const e = new Error(`BİLİNMEYEN KANAL: "${kod ?? ''}"`);
    e.satirlar = [
      `Kayıtlı kanallar: ${Object.keys(k.kanallar).join(', ')}`,
      `Yeni kanal ${KAYIT_REL} kaydına eklenir (bekçi: scripts/check-kanallar.mjs); yazım hatası hiçbir dosya yazılmadan durur.`,
    ];
    throw e;
  }
  return { kayit: k, kanal: k.kanallar[kod] };
}

/* ------------------------------------------------------------------ *
 * Çalışma ağacının kimliği ↔ kanal (işaretçiler ve sabit kimlik)
 * ------------------------------------------------------------------ */

function json(dosyalar, rel) {
  const m = dosyalar[rel];
  if (typeof m !== 'string') throw new Olculemedi(`${rel} okunamadı`);
  try {
    return JSON.parse(m);
  } catch (e) {
    throw new Olculemedi(`${rel} JSON olarak ayrıştırılamadı: ${e.message}`);
  }
}

function yakala(dosyalar, rel, desen, neyi) {
  const m = dosyalar[rel];
  if (typeof m !== 'string') throw new Olculemedi(`${rel} okunamadı`);
  const r = desen.exec(m);
  if (!r) throw new Olculemedi(`${rel}: ${neyi} bulunamadı (yeri/biçimi değişti — bekçiyi güncelle)`);
  return r[1];
}

const fark = (liste, neresi, gercek, beklenen) => {
  if (gercek !== beklenen) liste.push(`${neresi} = "${gercek}" — kanal "${beklenen}" bekliyor`);
};

/** Paketlemenin YAZMADIĞI panel kimliği — ağaç bu kanalın kimliğini taşımıyorsa paket yanlış kimlikle doğar. */
export const PANEL_SABIT_DOSYALAR = [
  'Electron/package.json', 'Electron/electron/main.ts', 'Electron/index.html', 'Electron/resources/splash.html',
  'Electron/shared/musteri.json',
];
export function panelSabitKimlikFarki(kanal, dosyalar) {
  const f = [];
  const p = json(dosyalar, 'Electron/package.json');
  const m = json(dosyalar, 'Electron/shared/musteri.json');
  fark(f, 'Electron/package.json name', p.name, kanal.panel.paketAdi);
  fark(f, 'Electron/package.json productName', p.productName, kanal.panel.urunAdi);
  fark(f, 'Electron/package.json build.productName', p.build?.productName, kanal.panel.urunAdi);
  fark(f, 'Electron/package.json build.appId', p.build?.appId, kanal.panel.appId);
  fark(f, 'Electron/package.json build.nsis.shortcutName', p.build?.nsis?.shortcutName, kanal.panel.urunAdi);
  fark(f, 'Electron/package.json build.nsis.uninstallDisplayName', p.build?.nsis?.uninstallDisplayName, kanal.panel.urunAdi);
  fark(f, 'Electron/electron/main.ts pencere title',
    yakala(dosyalar, 'Electron/electron/main.ts', /\btitle:\s*"([^"]*)"/, 'BrowserWindow `title: "…"` literal'), kanal.panel.urunAdi);
  fark(f, 'Electron/electron/main.ts setAppUserModelId',
    yakala(dosyalar, 'Electron/electron/main.ts', /setAppUserModelId\(\s*"([^"]*)"\s*\)/, '`setAppUserModelId("…")` literal'),
    kanal.panel.appId);
  fark(f, 'Electron/index.html <title>',
    yakala(dosyalar, 'Electron/index.html', /<title>([^<]*)<\/title>/, '<title>'), kanal.panel.urunAdi);
  fark(f, 'Electron/resources/splash.html <title>',
    yakala(dosyalar, 'Electron/resources/splash.html', /<title>([^<]*)<\/title>/, '<title>'), kanal.panel.urunAdi);
  fark(f, 'Electron/shared/musteri.json ad', m.ad, kanal.ad);
  fark(f, 'Electron/shared/musteri.json erpAdresi', m.erpAdresi ?? '', kanal.panel.erpDisAdresi);
  return f;
}

/** Paketlemenin YAZDIĞI panel işaretçileri — dinlenmede `varsayilan` kanalı göstermeli. */
export function panelIsaretciFarki(kod, kanal, dosyalar) {
  const f = [];
  const p = json(dosyalar, 'Electron/package.json');
  const m = json(dosyalar, 'Electron/shared/musteri.json');
  const anahtar = esitKumeler(Object.keys(m), ['kod', 'ad', 'erpAdresi']);
  if (anahtar.fazla.length || anahtar.eksik.length) {
    f.push(`Electron/shared/musteri.json anahtarları {kod, ad, erpAdresi} değil (fazla: ${anahtar.fazla.join(',') || '-'} · eksik: ${anahtar.eksik.join(',') || '-'})`);
  }
  fark(f, 'Electron/shared/musteri.json kod', m.kod, kod);
  fark(f, 'Electron/package.json build.publish[0].url', p.build?.publish?.[0]?.url, kanal.yayin.panelFeed);
  fark(f, 'Electron/package.json build.directories.output', p.build?.directories?.output, panelCiktiDeseni(kod));
  return f;
}

/** `release/<kod>/${version}` — electron-builder makrosu `${version}` harfiyen. */
export const panelCiktiDeseni = (kod) => `release/${kod}/\${version}`;

export const TABLET_SABIT_DOSYALAR = ['mobil/app.json', 'mobil/musteri.json'];
/**
 * Tablet kimliği: app.json'daki paket adı/görünen ad/OTA sertifikası + müşteri adı.
 * `runtimeVersion` burada YOK: paketin gideceği rv app.json'dan okunur (gerçeğin
 * kaynağı o); kaydın rv'si ile eşitliği dinlenmede bekçi ölçer — rv yükseltme turunu
 * çalışma anında ikinci kez durdurmak güvenlik kazandırmaz, yalnız sürtünme ekler.
 */
export function tabletSabitKimlikFarki(kanal, dosyalar) {
  const f = [];
  const e = json(dosyalar, 'mobil/app.json').expo ?? {};
  const m = json(dosyalar, 'mobil/musteri.json');
  fark(f, 'mobil/app.json expo.name', e.name, kanal.tablet.gorunenAd);
  fark(f, 'mobil/app.json expo.android.package', e.android?.package, kanal.tablet.androidPaket);
  fark(f, 'mobil/app.json expo.updates.codeSigningCertificate',
    String(e.updates?.codeSigningCertificate ?? '').replace(/^\.\//, ''), kanal.tablet.otaSertifika);
  fark(f, 'mobil/musteri.json ad', m.ad, kanal.ad);
  return f;
}

export function tabletIsaretciFarki(kod, dosyalar) {
  const f = [];
  const m = json(dosyalar, 'mobil/musteri.json');
  const anahtar = esitKumeler(Object.keys(m), ['kod', 'ad']);
  if (anahtar.fazla.length || anahtar.eksik.length) {
    f.push(`mobil/musteri.json anahtarları {kod, ad} değil (fazla: ${anahtar.fazla.join(',') || '-'} · eksik: ${anahtar.eksik.join(',') || '-'})`);
  }
  fark(f, 'mobil/musteri.json kod', m.kod, kod);
  return f;
}

/** Verilen göreli yolları diskten okur; yoksa değer `undefined` kalır (tüketici ÖLÇÜLEMEDİ der). */
export function dosyalariOku(yollar, kok = KOK) {
  const d = {};
  for (const rel of yollar) {
    try {
      d[rel] = fs.readFileSync(path.join(kok, rel), 'utf8');
    } catch {
      d[rel] = undefined;
    }
  }
  return d;
}

/* ------------------------------------------------------------------ *
 * PANEL ARTEFAKTININ kimliği — yayıncı çalışma ağacına değil pakete bakar
 * ------------------------------------------------------------------ */

/**
 * `release/<kod>/<sürüm>` dizinindeki derlemenin kendi kimliği.
 * Otorite `win-unpacked/resources/app-update.yml`dir: kurulu uygulamanın GERÇEKTEN
 * baktığı güncelleme adresi ve updater önbellek adı (= package.json `name`) oradadır;
 * exe adı `productName`den doğar. Aynı dizindeki Setup.exe aynı derlemenin çıktısıdır
 * (paketleme dizini derlemeden önce siler).
 */
export function panelArtefaktKimligi(dizin) {
  const yml = path.join(dizin, 'win-unpacked', 'resources', 'app-update.yml');
  let metin;
  try {
    metin = fs.readFileSync(yml, 'utf8');
  } catch {
    throw new Olculemedi(`paketin gömülü güncelleme yapılandırması okunamadı: ${yml}`);
  }
  const satir = (ad) => {
    const r = new RegExp(`^${ad}:[ \\t]*(.+?)[ \\t\\r]*$`, 'm').exec(metin);
    return r ? r[1].replace(/^['"]|['"]$/g, '') : null;
  };
  const url = satir('url');
  const updaterCacheDirName = satir('updaterCacheDirName');
  if (!url || !updaterCacheDirName) {
    throw new Olculemedi(`${yml}: url / updaterCacheDirName satırı yok — paket kimliği çözülemedi`);
  }
  let exeler;
  try {
    exeler = fs.readdirSync(path.join(dizin, 'win-unpacked')).filter((f) => f.toLowerCase().endsWith('.exe'));
  } catch {
    throw new Olculemedi(`${path.join(dizin, 'win-unpacked')} okunamadı`);
  }
  return { url, updaterCacheDirName, exeler };
}

/** Artefakt ↔ kanal. Boş dizi = paket bu kanalındır. */
export function panelArtefaktFarki(kayit, kod, artefakt) {
  const kanal = kayit.kanallar[kod];
  const f = [];
  if (artefakt.url !== kanal.yayin.panelFeed) {
    const sahibi = Object.entries(kayit.kanallar).find(([, k]) => k.yayin.panelFeed === artefakt.url)?.[0];
    f.push(`paketin güncelleme adresi ${artefakt.url} — "${kod}" kanalı ${kanal.yayin.panelFeed} bekliyor` +
      (sahibi ? ` (bu paket "${sahibi}" kanalının)` : ' (hiçbir kayıtlı kanalın değil)'));
  }
  fark(f, 'paketin updaterCacheDirName', artefakt.updaterCacheDirName, `${kanal.panel.paketAdi}-updater`);
  const beklenenExe = `${kanal.panel.urunAdi}.exe`;
  if (!artefakt.exeler.includes(beklenenExe)) {
    f.push(`win-unpacked içinde "${beklenenExe}" yok (bulunan: ${artefakt.exeler.join(', ') || '-'})`);
  }
  return f;
}
