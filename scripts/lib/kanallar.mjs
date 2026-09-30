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
  uretim: ['tur', 'terfiKaynagi', 'ad', 'gorunurEtiket', 'yayin', 'panel', 'tablet', 'backend'],
  hazirlik: ['tur', 'ayna', 'ad', 'gorunurEtiket', 'yayin', 'panel', 'tablet', 'backend'],
};
export const YAYIN_ANAHTARLARI = [
  'panelFeed', 'panelManifest', 'mobilFeed', 'otaManifest', 'apkKunye', 'vdsPanel', 'vdsMobil', 'panelDefter',
  // Dağıtım v2 — backend kanal yayını (docs/design/GUNCELLEYICI.md §1): feed · en yeni sürüm işaretçisi · VDS · defter.
  'backendFeed', 'backendManifest', 'vdsBackend', 'backendDefter',
];
export const PANEL_ANAHTARLARI = ['appId', 'urunAdi', 'paketAdi', 'erpAdresi'];
export const TABLET_ANAHTARLARI = ['androidPaket', 'gorunenAd', 'erpAdresi', 'runtimeVersion', 'otaSertifika'];
/**
 * Backend paketinin (paketle.ps1 -Musteri <kod>) müşteriye özel dağıtım kimliği. Faz 2b:
 *   · urunAdi — /health + PAKET.json'da görünen backend adı (filigran; her kanalda AYRIK);
 *   · pm2Ad   — sunucudaki pm2 süreç adı (TEKSERP_PM2_AD; iki kurulum çakışmasın — her kanalda AYRIK).
 * DAVRANIŞ TAŞIMAZ: bayrak/ayar değil, dağıtım kimliği (feed'ler gibi). Backend YAYIN yolları
 * (feed · son.json · VDS · defter) panel/tablet gibi `yayin` bloğundadır (Dağıtım v2, `deploy/backend-yayinla.mjs`).
 */
export const BACKEND_ANAHTARLARI = ['urunAdi', 'pm2Ad'];

/**
 * İki kanal arasında AYNI OLAMAYAN alanlar. `runtimeVersion` bilerek YOK: uyum
 * kimliğidir, kanal kimliği değil (iki kanal aynı native'i taşır ki OTA↔APK
 * kararı birebir prova edilsin). Boş/null değer karşılaştırılmaz.
 */
export const AYRIK_ALANLAR = [
  'ad', 'gorunurEtiket',
  ...YAYIN_ANAHTARLARI.map((a) => `yayin.${a}`),
  'panel.appId', 'panel.urunAdi', 'panel.paketAdi', 'panel.erpAdresi',
  'tablet.androidPaket', 'tablet.gorunenAd', 'tablet.erpAdresi', 'tablet.otaSertifika',
  'backend.urunAdi', 'backend.pm2Ad',
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
      // K5 (terfi) yapısal: aynası olduğu üretim kanalı yalnız BU kanaldan terfi alır. Anahtarı
      // silmek ya da null'lamak terfi kapısını sessizce kapatırdı — burada kırmızıdır.
      else if (ayna.terfiKaynagi !== kod) {
        h.push(`${on}: aynası "${k.ayna}" terfiKaynagi "${ayna.terfiKaynagi}" — "${kod}" olmalı (üretim kanalı yalnız hazırlık aynasından terfi alır; K5)`);
      }
    }
    // terfiKaynagi: null (terfi yok — tek kanallı kurulum) ya da aynası bu kanal olan HAZIRLIK kanalı.
    if (k.tur === 'uretim' && k.terfiKaynagi !== null) {
      const kaynak = typeof k.terfiKaynagi === 'string' ? kanallar[k.terfiKaynagi] : undefined;
      if (!kaynak || kaynak.tur !== 'hazirlik' || kaynak.ayna !== kod) {
        h.push(`${on}: terfiKaynagi "${k.terfiKaynagi}" aynası "${kod}" olan kayıtlı bir hazırlık kanalı değil (null ya da hazırlık kanal kodu)`);
      }
    }

    for (const [blok, anahtarlar] of [['yayin', YAYIN_ANAHTARLARI], ['panel', PANEL_ANAHTARLARI], ['tablet', TABLET_ANAHTARLARI], ['backend', BACKEND_ANAHTARLARI]]) {
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
        if (typeof v !== 'string' || !v.trim()) h.push(`${on}: ${blok}.${a} boş ya da metin değil`);
      }
    }
    // pm2 adı sunucuda süreç/servis kimliğidir: boşluk/ters bölü/kabuk taşıyamaz.
    const pm2 = k.backend?.pm2Ad;
    if (typeof pm2 === 'string' && !/^[a-zA-Z0-9._-]{2,60}$/.test(pm2)) {
      h.push(`${on}: backend.pm2Ad "${pm2}" biçimi tutmuyor (harf/rakam/nokta/tire/alt çizgi, 2-60)`);
    }
    const erp = k.tablet?.erpAdresi;
    if (typeof erp === 'string' && !/^https?:\/\/[^/\s]+\/api$/.test(erp)) {
      h.push(`${on}: tablet.erpAdresi "${erp}" biçimi tutmuyor (http(s)://<host>[:port]/api)`);
    }
    if (typeof erp === 'string' && /(localhost|127\.0\.0\.1)/i.test(erp)) h.push(`${on}: tablet.erpAdresi localhost olamaz`);
    // Keşif sonuç vermezse panelin bağlandığı sunucu — tabletin `/api`li adresinin panel karşılığı.
    const panelErp = k.panel?.erpAdresi;
    if (typeof panelErp === 'string' && panelErp !== '' && !/^https?:\/\/[^/\s]+$/.test(panelErp)) {
      h.push(`${on}: panel.erpAdresi "${panelErp}" biçimi tutmuyor (http(s)://<host>[:port], /api yok, sonda / yok)`);
    }
    if (typeof panelErp === 'string' && /(localhost|127\.0\.0\.1)/i.test(panelErp)) h.push(`${on}: panel.erpAdresi localhost olamaz`);
  }

  // İKİLİ FARK — iki kanal hiçbir dağıtım kimliğini paylaşamaz.
  for (const alan of AYRIK_ALANLAR) {
    const sahip = new Map();
    for (const kod of kodlar) {
      const v = al(kanallar[kod], alan);
      if (bosMu(v)) continue;
      const anahtar = alan.endsWith('erpAdresi') ? adresNormal(v) : v;
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

/**
 * Panel kimliğinin çalışma ağacındaki izleri. Kimlik ağaca YAZILMAZ: paketleme onu
 * derleme ANINDA enjekte eder (`panelDerlemeAyarlari` → electron-builder `-c.*`,
 * `Electron/build-channel.ts` → Vite sanal modülü). Ağaçta iki tür iz kalır:
 *   · package.json alanları — ezilen TABAN, dinlenmede `varsayilan` kanalın değeri;
 *   · kaynak dosyalar — kimliği kanaldan ALIR, literal taşımaz (literal ezmeyi görmez).
 */
export const PANEL_SABIT_DOSYALAR = [
  'Electron/package.json', 'Electron/electron/main.ts', 'Electron/index.html', 'Electron/resources/splash.html',
  'Electron/shared/musteri.json', 'Electron/shared/channel.ts', 'Electron/build-channel.ts',
];

/** index.html `<title>` yer tutucusu — `Electron/build-channel.ts` derlemede pencere başlığıyla değiştirir. */
export const PANEL_BASLIK_YER_TUTUCU = '%TEKSERP_WINDOW_TITLE%';
/** Derleme kanalını electron-vite'a (Vite sanal modülü) taşıyan ortam değişkeni. */
export const PANEL_KANAL_ORTAMI = 'TEKSERP_KANAL';
/** Paket açıklaması (NSIS kurulum dosyasının FileDescription'ı) ürün adından türer. */
export const panelAciklamasi = (kanal) => `${kanal.panel.urunAdi} — Admin Panel by Etkili Yazılım`;

/** Dinlenmedeki package.json kimlik alanları ↔ kanal (bekçi: `varsayilan`; paketleme: taban temiz mi). */
export function panelSabitKimlikFarki(kanal, dosyalar) {
  const f = [];
  const p = json(dosyalar, 'Electron/package.json');
  fark(f, 'Electron/package.json name', p.name, kanal.panel.paketAdi);
  fark(f, 'Electron/package.json productName', p.productName, kanal.panel.urunAdi);
  fark(f, 'Electron/package.json description', p.description, panelAciklamasi(kanal));
  fark(f, 'Electron/package.json build.productName', p.build?.productName, kanal.panel.urunAdi);
  fark(f, 'Electron/package.json build.appId', p.build?.appId, kanal.panel.appId);
  fark(f, 'Electron/package.json build.nsis.shortcutName', p.build?.nsis?.shortcutName, kanal.panel.urunAdi);
  fark(f, 'Electron/package.json build.nsis.uninstallDisplayName', p.build?.nsis?.uninstallDisplayName, kanal.panel.urunAdi);
  return f;
}

const yorumsuz = (m) => m.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Metinde `değer` TIRNAKLI bir dize olarak geçiyor mu (önek/alt dize eşleşmesi değil). */
export const tirnakliGecer = (metin, deger) => new RegExp(`(["'\`])${esc(deger)}\\1`).test(metin);

/**
 * Kaynak dosyalar kimliği KANALDAN alıyor mu — hiçbir kanalın literal kimliği yok, bağ noktaları yerinde.
 * Bağ noktası bulunamazsa ÖLÇÜLEMEDİ (yer/biçim değişti); literal ya da yanlış bağ KIRMIZI.
 */
export function panelKaynakFarki(kayit, dosyalar) {
  const f = [];
  const kanallar = Object.entries(kayit?.kanallar ?? {});
  const oku = (rel) => {
    if (typeof dosyalar[rel] !== 'string') throw new Olculemedi(`${rel} okunamadı`);
    return dosyalar[rel];
  };
  const main = yorumsuz(oku('Electron/electron/main.ts'));
  if (!/setAppUserModelId\(/.test(main)) throw new Olculemedi('Electron/electron/main.ts: setAppUserModelId çağrısı bulunamadı (yeri değişti — bekçiyi güncelle)');
  if (!/\bnew BrowserWindow\(\{[\s\S]*?\btitle:/.test(main)) throw new Olculemedi('Electron/electron/main.ts: BrowserWindow `title:` bulunamadı');
  if (!/from\s+["']@shared\/channel["']/.test(main)) f.push('Electron/electron/main.ts kimliği @shared/channel\'dan almıyor');
  if (!/setAppUserModelId\(\s*APP_ID\s*\)/.test(main)) f.push('Electron/electron/main.ts setAppUserModelId kanaldan değil (`APP_ID` bekleniyor)');
  if (!/\btitle:\s*WINDOW_TITLE\s*,/.test(main)) f.push('Electron/electron/main.ts pencere başlığı kanaldan değil (`title: WINDOW_TITLE` bekleniyor)');
  if (!/"page-title-updated"[\s\S]{0,120}?preventDefault\(\)/.test(main)) {
    f.push('Electron/electron/main.ts sayfa <title>\'ının pencere başlığını ezmesini engellemiyor (`page-title-updated` → preventDefault)');
  }
  for (const [kod, k] of kanallar) {
    for (const [alan, v] of [['appId', k?.panel?.appId], ['urunAdi', k?.panel?.urunAdi]]) {
      if (typeof v === 'string' && v && tirnakliGecer(main, v)) f.push(`Electron/electron/main.ts "${kod}" kanalının ${alan} literalini taşıyor ("${v}") — kimlik kanaldan gelir`);
    }
  }
  const baslik = yakala(dosyalar, 'Electron/index.html', /<title>([^<]*)<\/title>/, '<title>');
  if (baslik !== PANEL_BASLIK_YER_TUTUCU) f.push(`Electron/index.html <title> = "${baslik}" — yer tutucu ${PANEL_BASLIK_YER_TUTUCU} bekleniyor (başlık derlemede kanaldan)`);
  const splash = yakala(dosyalar, 'Electron/resources/splash.html', /<title>([^<]*)<\/title>/, '<title>');
  for (const [kod, k] of kanallar) {
    if (k?.panel?.urunAdi && splash.includes(k.panel.urunAdi)) f.push(`Electron/resources/splash.html <title> "${kod}" kanalının ürün adını taşıyor — kanaldan bağımsız olmalı`);
  }
  if (!/from\s+["']virtual:tekserp-channel["']/.test(oku('Electron/shared/channel.ts'))) {
    f.push('Electron/shared/channel.ts kimliği derleme sanal modülünden (virtual:tekserp-channel) almıyor');
  }
  const derleme = oku('Electron/build-channel.ts');
  for (const [ne, iz] of [['kayıt defteri', 'deploy/kanallar.json'], ['kanal ortamı', PANEL_KANAL_ORTAMI], ['başlık yer tutucusu', PANEL_BASLIK_YER_TUTUCU]]) {
    if (!derleme.includes(iz)) f.push(`Electron/build-channel.ts ${ne} izini (${iz}) taşımıyor`);
  }
  return f;
}

/** Dinlenmedeki panel işaretçileri — `varsayilan` kanalı göstermeli (musteri.json yalnız KOD taşır). */
export function panelIsaretciFarki(kod, kanal, dosyalar) {
  const f = [];
  const p = json(dosyalar, 'Electron/package.json');
  const m = json(dosyalar, 'Electron/shared/musteri.json');
  const anahtar = esitKumeler(Object.keys(m), ['kod']);
  if (anahtar.fazla.length || anahtar.eksik.length) {
    f.push(`Electron/shared/musteri.json yalnız {kod} taşır — kimlik kayıt defterinden (fazla: ${anahtar.fazla.join(',') || '-'} · eksik: ${anahtar.eksik.join(',') || '-'})`);
  }
  fark(f, 'Electron/shared/musteri.json kod', m.kod, kod);
  fark(f, 'Electron/package.json build.publish[0].url', p.build?.publish?.[0]?.url, kanal.yayin.panelFeed);
  fark(f, 'Electron/package.json build.directories.output', p.build?.directories?.output, panelCiktiDeseni(kod));
  return f;
}

/** `release/<kod>/${version}` — electron-builder makrosu `${version}` harfiyen. */
export const panelCiktiDeseni = (kod) => `release/${kod}/\${version}`;

/**
 * electron-builder'a derleme ANINDA verilen kimlik (`-c.<anahtar>=<değer>`). package.json'daki
 * taban ne olursa olsun paketin kimliği buradan doğar; `varsayilan` kanal için taban ile birebir.
 * `extraMetadata` paketin İÇİNDEKİ package.json'dır: `name` → güncelleyici önbelleği,
 * `productName` → çalışma anı adı ve userData dizini.
 */
export function panelDerlemeAyarlari(kod, kanal) {
  return {
    appId: kanal.panel.appId,
    productName: kanal.panel.urunAdi,
    'extraMetadata.name': kanal.panel.paketAdi,
    'extraMetadata.productName': kanal.panel.urunAdi,
    'extraMetadata.description': panelAciklamasi(kanal),
    'nsis.shortcutName': kanal.panel.urunAdi,
    'nsis.uninstallDisplayName': kanal.panel.urunAdi,
    'publish.url': kanal.yayin.panelFeed,
    'directories.output': panelCiktiDeseni(kod),
  };
}
export const panelDerlemeArgumanlari = (kod, kanal) =>
  Object.entries(panelDerlemeAyarlari(kod, kanal)).map(([k, v]) => `-c.${k}=${v}`);

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

/* ------------------------------------------------------------------ *
 * BACKEND paketinin kimliği — paketle.ps1 -Musteri <kod> derleme anında enjekte eder
 * ------------------------------------------------------------------ */

/**
 * Backend paketinin bu kanala göre alacağı kimlik değerleri. paketle.ps1 bunları
 * ecosystem env'ine (TEKSERP_PM2_AD) ve PAKET.json'a yazar; panel/tablet kimliği gibi
 * ağaca YAZILMAZ, paket ANINDA enjekte edilir. Backend'de literal iz taşıyan kaynak
 * yoktur (kimlik çalışma anında env/manifest'ten okunur), o yüzden yalnız değer üretir.
 */
export function backendPaketleAyarlari(kod, kanal) {
  return {
    TEKSERP_PM2_AD: kanal.backend.pm2Ad,
    TEKSERP_BACKEND_URUN: kanal.backend.urunAdi,
  };
}

/* ------------------------------------------------------------------ *
 * Commit kapısı tetiği — kanal bekçilerinin OKUDUĞU küme (elle sayılmaz, sabitlerden türer)
 * ------------------------------------------------------------------ */

/** Yayın yolu keşfi (check-kanallar §5): deploy/ kökünde yayinla|paketle · mobil/scripts'te yayinla|apk. */
export const YAYIN_YOLU_DESENLERI = [
  { dizin: 'deploy', ad: /(yayinla|paketle)/i },
  { dizin: 'mobil/scripts', ad: /(yayinla|apk)/i },
];
/**
 * İki kanal bekçisinin (check-kanallar · test_kanal_yayin_kapisi) okuduğu açık dosyalar: kimlik
 * kaynakları + koşturulan betiklerin KOD kapanışı (veri dosyalarının kendi kapısı var, örn. sürüm notu).
 */
export const KANAL_BEKCI_DOSYALARI = [...new Set([
  KAYIT_REL, 'scripts/lib/kanallar.mjs', 'scripts/kanal-kapisi.mjs', 'scripts/check-kanallar.mjs',
  'scripts/test_kanal_yayin_kapisi.mjs', 'scripts/lib/surum.mjs', 'scripts/lib/surum-notu-tavan.mjs', 'scripts/lib/terfi.mjs',
  'scripts/lib/yayin-okuma.mjs',
  'scripts/check-surum-notlari.mjs', 'scripts/hooks/pre-commit.mjs',
  ...PANEL_SABIT_DOSYALAR, ...TABLET_SABIT_DOSYALAR,
  'Electron/shared/update-feed.ts', 'mobil/scripts/lib/feed.cjs', 'mobil/scripts/lib/adres.mjs', 'mobil/scripts/lib/zip.mjs',
  'mobil/scripts/lib/manifest.mjs', 'mobil/scripts/lib/apk-kimlik.mjs', 'mobil/scripts/lib/kanal.cjs', 'mobil/app.config.js',
  'scripts/lib/yayin-bildirim.mjs', 'scripts/lib/backend-yayin.mjs',
])];
/** Bu yola dokunan commit kanal bekçilerini koşar (`scripts/hooks/pre-commit.mjs`). */
export function kanalBekcisiTetigi(rel) {
  if (KANAL_BEKCI_DOSYALARI.includes(rel)) return true;
  const i = rel.lastIndexOf('/');
  const dizin = rel.slice(0, i);
  return YAYIN_YOLU_DESENLERI.some((d) => d.dizin === dizin && d.ad.test(rel.slice(i + 1)));
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
 * Asar arşivinden seçilen dosyaları okur (zero-dep). Biçim: [u32 4][u32 başlık turşusu boyu]
 * [u32 yük boyu][u32 JSON boyu][JSON başlık]…; veri 8 + turşu boyundan başlar, girdi
 * `{size, offset}` (offset dize). `unpacked` girdi arşivde değildir, okunmaz.
 */
export function asarOku(yol, sec) {
  let fd;
  try {
    fd = fs.openSync(yol, 'r');
  } catch {
    throw new Olculemedi(`paket arşivi okunamadı: ${yol}`);
  }
  try {
    const bas = Buffer.alloc(16);
    if (fs.readSync(fd, bas, 0, 16, 0) !== 16 || bas.readUInt32LE(0) !== 4) throw new Error('asar başlığı değil');
    const tursu = bas.readUInt32LE(4);
    const uzunluk = bas.readUInt32LE(12);
    if (uzunluk <= 0 || uzunluk > tursu) throw new Error('başlık boyu tutarsız');
    const hb = Buffer.alloc(uzunluk);
    fs.readSync(fd, hb, 0, uzunluk, 16);
    const baslik = JSON.parse(hb.toString('utf8'));
    const taban = 8 + tursu;
    const cikti = {};
    const gez = (n, on) => {
      for (const [ad, alt] of Object.entries(n.files ?? {})) {
        const p = `${on}${ad}`;
        if (alt.files) gez(alt, `${p}/`);
        else if (sec(p) && !alt.unpacked && typeof alt.size === 'number') {
          const b = Buffer.alloc(alt.size);
          fs.readSync(fd, b, 0, alt.size, taban + Number(alt.offset));
          cikti[p] = b;
        }
      }
    };
    gez(baslik, '');
    return cikti;
  } catch (e) {
    throw new Olculemedi(`paket arşivi (${yol}) çözülemedi: ${e.message}`);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * `release/<kod>/<sürüm>` dizinindeki derlemenin kendi kimliği.
 *   · `win-unpacked/resources/app-update.yml` — güncelleme adresi + updater önbellek adı;
 *   · `win-unpacked/<ürün adı>.exe` — kurulum dizini, kısayol, görev çubuğu adı;
 *   · `resources/app.asar` → paketin package.json'ı (`name`, `productName` → userData) ile
 *     derlenmiş ana süreç/arayüz: çalışma anında KULLANILAN adres/AUMID oradadır
 *     (updater `setFeedURL`le app-update.yml'i ezer — yalnız yml'e bakan kapı kör kalırdı).
 * Aynı dizindeki Setup.exe aynı derlemenin çıktısıdır (paketleme dizini derlemeden önce siler).
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
  const asarYol = path.join(dizin, 'win-unpacked', 'resources', 'app.asar');
  const icerik = asarOku(asarYol, (p) => p === 'package.json' || p === 'out/main/main.js' ||
    (p.startsWith('out/renderer/') && /\.(js|html)$/.test(p)));
  if (!icerik['package.json'] || !icerik['out/main/main.js'] || !icerik['out/renderer/index.html']) {
    throw new Olculemedi(`${asarYol}: package.json / out/main/main.js / out/renderer/index.html yok — paket kimliği çözülemedi`);
  }
  let paket;
  try {
    paket = JSON.parse(icerik['package.json'].toString('utf8'));
  } catch (e) {
    throw new Olculemedi(`${asarYol} package.json ayrıştırılamadı: ${e.message}`);
  }
  const arayuzJs = Object.keys(icerik).filter((p) => p.startsWith('out/renderer/') && p.endsWith('.js')).sort();
  return {
    url,
    updaterCacheDirName,
    exeler,
    paket: { name: paket.name, productName: paket.productName },
    anaSurec: icerik['out/main/main.js'].toString('utf8'),
    arayuz: arayuzJs.map((p) => icerik[p].toString('utf8')).join('\n'),
    arayuzBasligi: /<title>([^<]*)<\/title>/.exec(icerik['out/renderer/index.html'].toString('utf8'))?.[1] ?? null,
  };
}

/** Artefakt ↔ kanal. Boş dizi = paket bu kanalındır (ve başka hiçbir kanalın kimliğini taşımaz). */
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
  fark(f, 'paketin package.json name (updater önbelleği)', artefakt.paket.name, kanal.panel.paketAdi);
  fark(f, 'paketin package.json productName (çalışma anı adı · userData)', artefakt.paket.productName, kanal.panel.urunAdi);
  for (const [ne, v] of [['appId (AUMID)', kanal.panel.appId], ['güncelleme adresi', kanal.yayin.panelFeed]]) {
    if (!tirnakliGecer(artefakt.anaSurec, v)) f.push(`ana süreçte (out/main/main.js) bu kanalın ${ne} "${v}" yok — kanal derlemeye enjekte edilmemiş`);
  }
  if (!tirnakliGecer(artefakt.arayuz, kanal.panel.erpAdresi)) f.push(`arayüzde bu kanalın varsayılan sunucusu "${kanal.panel.erpAdresi}" yok`);
  if (kanal.gorunurEtiket && !tirnakliGecer(artefakt.arayuz, kanal.gorunurEtiket)) f.push(`arayüzde görünür etiket "${kanal.gorunurEtiket}" yok`);
  const baslik = artefakt.arayuzBasligi ?? '';
  if (!baslik.includes(kanal.panel.urunAdi) || (kanal.gorunurEtiket && !baslik.includes(kanal.gorunurEtiket))) {
    f.push(`arayüz <title> "${baslik}" bu kanalın ürün adını${kanal.gorunurEtiket ? '/etiketini' : ''} taşımıyor`);
  }
  for (const [diger, d] of Object.entries(kayit.kanallar)) {
    if (diger === kod) continue;
    const yabanci = [
      ['ana süreç', artefakt.anaSurec, 'appId', d.panel.appId], ['ana süreç', artefakt.anaSurec, 'güncelleme adresi', d.yayin.panelFeed],
      ['ana süreç', artefakt.anaSurec, 'ürün adı', d.panel.urunAdi],
      ['arayüz', artefakt.arayuz, 'appId', d.panel.appId], ['arayüz', artefakt.arayuz, 'ürün adı', d.panel.urunAdi],
      ['arayüz', artefakt.arayuz, 'varsayılan sunucu', d.panel.erpAdresi],
      ['arayüz', artefakt.arayuz, 'görünür etiket', d.gorunurEtiket],
    ];
    for (const [yer, metin, ne, v] of yabanci) {
      if (typeof v === 'string' && v && tirnakliGecer(metin, v)) f.push(`${yer} "${diger}" kanalının ${ne} "${v}" değerini taşıyor — bu paket karışık kimlikli`);
    }
    if (d.panel.urunAdi && baslik.includes(d.panel.urunAdi)) f.push(`arayüz <title> "${diger}" kanalının ürün adını taşıyor`);
  }
  return f;
}
