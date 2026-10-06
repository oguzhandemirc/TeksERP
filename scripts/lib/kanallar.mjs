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

import { KOK, Olculemedi } from './dagitim.mjs';
import { PANEL_BASLIK_YER_TUTUCU, asarOku, panelArtefaktKimligi, panelKaynakFarki, tirnakliGecer } from './panel-kimlik.mjs';

// Ortak yolun da kullandığı ölçüm araçları dağıtım/panel kitaplıklarında yaşar; burada yalnız yeniden dışa aktarılır.
export { KOK, Olculemedi, PANEL_BASLIK_YER_TUTUCU, asarOku, panelArtefaktKimligi, panelKaynakFarki, tirnakliGecer };
export const KAYIT_REL = 'deploy/kanallar.json';

/** URL yol segmenti olacak: küçük harf, rakam, tire (paketle regex'i ∩ feed.cjs regex'i). */
export const KOD_DESENI = /^[a-z0-9][a-z0-9-]{1,30}$/;


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
 *   · pm2Ad   — sunucudaki pm2 süreç adı (TEKSERP_PM2_AD; iki kurulum çakışmasın — her kanalda AYRIK);
 *   · hizmetAdi — backend'in Windows hizmet adı (Dağıtım v2, TEKSERP_HIZMET_ADI — hizmet konağının ortam adıyla aynı; aynı makinede iki kanal yan yana —
 *     her kanalda AYRIK, Windows hizmet adı büyük/küçük harf duyarsız olduğu için duyarsız ölçülür);
 *   · guvenCapasi — kanalın lisans satıcısı/kök bağı (`uretim` | `hazirlik`): paket YALNIZ o kipin kök + PAKET
 *     anahtarlarına güvenir (build-korumali derleme sabiti + native/güncelleyici `hazirlik-capasi` özelliği). Üretim
 *     kanalı daima `uretim`. OTA sertifikası gibi bir güven BAĞIDIR, çalışma anı bayrağı değil.
 *   · lisansSunucusu — kanalın lisans satıcısının kökeni (`https://host[:port]`; backend `LICENSE_SERVER_URL`):
 *     güven çapasının aynası — `uretim` çapalı her kanal ÜRETİM satıcısı (= backend varsayılanı,
 *     `vendor-url.ts` DEFAULT_LICENSE_SERVER_URL; check-kanallar ölçer), `hazirlik` çapalı her kanal hazırlık
 *     satıcısı; iki kip aynı adresi paylaşamaz. Paket PAKET.json'a taşır (backendLisansSunucusu), pm2 → hizmet
 *     geçişi (deploy/gecis/gecis.ps1) kurulumun etkin değerini buna karşı ölçer.
 * DAVRANIŞ TAŞIMAZ: bayrak/ayar değil, dağıtım kimliği (feed'ler gibi). Backend YAYIN yolları
 * (feed · son.json · VDS · defter) panel/tablet gibi `yayin` bloğundadır (Dağıtım v2, `deploy/backend-yayinla.mjs`).
 */
export const BACKEND_ANAHTARLARI = ['urunAdi', 'pm2Ad', 'hizmetAdi', 'guvenCapasi', 'lisansSunucusu'];
/** Lisans satıcısı kökeni: yalnız https, küçük harf host, isteğe bağlı port; yol/sonda `/` yok (backend çözücüsünün kabul ettiği biçim). */
export const LISANS_SUNUCUSU_DESENI = /^https:\/\/[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::[0-9]{1,5})?$/;
/** Backend'in varsayılan (ÜRETİM) lisans satıcısı — TEK kaynak `vendor-url.ts`; burada yalnız METİNDEN okunur. */
export const VENDOR_URL_REL = 'Teks-Erp/src/lib/license/vendor-url.ts';
export function varsayilanLisansSunucusu(metin) {
  const m = /^export const DEFAULT_LICENSE_SERVER_URL = "([^"]+)";$/m.exec(typeof metin === 'string' ? metin : '');
  return m && LISANS_SUNUCUSU_DESENI.test(m[1]) ? m[1] : null;
}
/** Backend güven çapası kipleri — Teks-Erp `protocol/kok-anahtarlar.ts` `TRUST_ANCHOR_MODES` ile aynı küme. */
export const GUVEN_CAPASI_KIPLERI = ['uretim', 'hazirlik'];

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
  'backend.urunAdi', 'backend.pm2Ad', 'backend.hizmetAdi',
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
    // `ayna: null` = AYNASIZ hazırlık kanalı (demo/deneme müşterisi): hiçbir üretim kanalına terfi kaynağı olmaz.
    if (k.tur === 'hazirlik' && k.ayna !== null) {
      const ayna = kanallar[k.ayna];
      if (!ayna || ayna.tur !== 'uretim') h.push(`${on}: ayna "${k.ayna}" kayıtlı bir üretim kanalı değil (aynasız hazırlık kanalı için null)`);
      // K5 (terfi) yapısal: aynası olduğu üretim kanalı yalnız BU kanaldan terfi alır. Anahtarı
      // silmek ya da null'lamak terfi kapısını sessizce kapatırdı — burada kırmızıdır.
      else if (ayna.terfiKaynagi !== kod) {
        h.push(`${on}: aynası "${k.ayna}" terfiKaynagi "${ayna.terfiKaynagi}" — "${kod}" olmalı (üretim kanalı yalnız hazırlık aynasından terfi alır; K5)`);
      }
    }
    // terfiKaynagi ZORUNLU (yönetici kararı 2026-10-01; kök kural "üretim kanalına yalnız terfi etiketli commit"):
    // kayıtlı AYNALI bir HAZIRLIK kanalı — aynasız (demo/deneme) kanal terfi kaynağı olamaz. Aynalı bir hazırlık
    // kanalı birden çok üretim kanalının kaynağı olabilir (aynası yine TEK üretim kanalıdır).
    if (k.tur === 'uretim') {
      const kaynak = typeof k.terfiKaynagi === 'string' ? kanallar[k.terfiKaynagi] : undefined;
      if (!kaynak || kaynak.tur !== 'hazirlik') {
        h.push(`${on}: terfiKaynagi "${k.terfiKaynagi}" kayıtlı bir hazırlık kanalı değil — üretim kanalının terfi kaynağı ZORUNLU (K5)`);
      } else if (kaynak.ayna === null) {
        h.push(`${on}: terfiKaynagi "${k.terfiKaynagi}" AYNASIZ (demo/deneme) hazırlık kanalı — terfi kaynağı aynalı bir hazırlık kanalı olmalı (K5)`);
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
    // Windows hizmet adı: harfle başlar, boşluk/bölü/kabuk yok (sc.exe ve hizmet konağı argümanı).
    const hizmet = k.backend?.hizmetAdi;
    if (typeof hizmet === 'string' && !/^[A-Za-z][A-Za-z0-9._-]{1,59}$/.test(hizmet)) {
      h.push(`${on}: backend.hizmetAdi "${hizmet}" biçimi tutmuyor (harfle başlar; harf/rakam/nokta/tire/alt çizgi, 2-60)`);
    }
    // Güven çapası: tanınmayan kip fail-closed RED; üretim kanalı hazırlık köküne bağlanamaz (hazırlık kökü
    // ÜRETİM sınıfını imzalayamaz ve daha az korunur — üretim paketi ona hiç güvenmemeli).
    const capa = k.backend?.guvenCapasi;
    if (typeof capa === 'string' && !GUVEN_CAPASI_KIPLERI.includes(capa)) h.push(`${on}: backend.guvenCapasi "${capa}" tanınmıyor (${GUVEN_CAPASI_KIPLERI.join(' | ')})`);
    if (k.tur === 'uretim' && typeof capa === 'string' && capa !== 'uretim') h.push(`${on}: üretim kanalı backend.guvenCapasi "${capa}" — yalnız uretim (hazırlık çapası üretim paketine giremez)`);
    const lisans = k.backend?.lisansSunucusu;
    if (typeof lisans === 'string' && lisans && !LISANS_SUNUCUSU_DESENI.test(lisans)) h.push(`${on}: backend.lisansSunucusu "${lisans}" biçimi tutmuyor (https://<küçük harf host>[:port], yol ve sonda / yok)`);
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

  // Lisans satıcısı güven çapasının aynası: aynı çapa → aynı satıcı; iki çapa aynı satıcıyı paylaşamaz
  // (hazırlık satıcısı ÜRETİM sınıfını imzalayamaz, üretim satıcısının imzası hazırlık paketinde geçersizdir).
  const capaSatici = new Map();
  for (const kod of kodlar) {
    const b = kanallar[kod]?.backend;
    if (typeof b?.guvenCapasi !== 'string' || typeof b?.lisansSunucusu !== 'string' || !b.lisansSunucusu) continue;
    const onceki = capaSatici.get(b.guvenCapasi);
    if (onceki && onceki.url !== b.lisansSunucusu) {
      h.push(`ÇAKIŞMA: "${b.guvenCapasi}" çapalı iki kanal farklı lisans satıcısı gösteriyor: ${onceki.kod} "${onceki.url}" · ${kod} "${b.lisansSunucusu}" (satıcı çapanın aynasıdır)`);
    } else if (!onceki) capaSatici.set(b.guvenCapasi, { kod, url: b.lisansSunucusu });
  }
  const uretimSatici = capaSatici.get('uretim'), hazirlikSatici = capaSatici.get('hazirlik');
  if (uretimSatici && hazirlikSatici && uretimSatici.url === hazirlikSatici.url) {
    h.push(`ÇAKIŞMA: üretim ve hazırlık çapası AYNI lisans satıcısını gösteriyor ("${uretimSatici.url}") — iki kök iki satıcıdır`);
  }

  // Windows hizmet adları büyük/küçük harf DUYARSIZDIR: ikili fark (tam eşitlik) onları kaçırırdı.
  const hizmetler = new Map();
  for (const kod of kodlar) {
    const v = kanallar[kod]?.backend?.hizmetAdi;
    if (typeof v !== 'string' || !v) continue;
    const a = v.toLowerCase();
    if (hizmetler.has(a) && kanallar[hizmetler.get(a)]?.backend?.hizmetAdi !== v) {
      h.push(`ÇAKIŞMA: backend.hizmetAdi "${v}" ile "${kanallar[hizmetler.get(a)].backend.hizmetAdi}" (${hizmetler.get(a)}) yalnız harf büyüklüğünde ayrışıyor — Windows'ta AYNI hizmet`);
    } else hizmetler.set(a, kod);
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

const fark = (liste, neresi, gercek, beklenen) => {
  if (gercek !== beklenen) liste.push(`${neresi} = "${gercek}" — kanal "${beklenen}" bekliyor`);
};

/**
 * Panel kimliğinin çalışma ağacındaki izleri. Kimlik ağaca YAZILMAZ: paketleme onu derleme ANINDA
 * enjekte eder (eski kanal yolunda `panelDerlemeAyarlari` → electron-builder `-c.*`,
 * `Electron/build-identity.ts` → Vite sanal modülü). Ağaçta iki tür iz kalır:
 *   · package.json alanları — ezilen TABAN; dinlenmede TEK ORTAK kimlik (dağıtım kaydı, O5) —
 *     ölçümü `scripts/lib/panel-kimlik.mjs` `panelDinlenmeFarki`;
 *   · kaynak dosyalar — kimliği kayıttan ALIR, literal taşımaz (literal ezmeyi görmez).
 * Dağıtım kaydı ve kitaplıkları da listededir: eski kanal derlemesi aynı çözücüden geçer.
 */
export const PANEL_SABIT_DOSYALAR = [
  'Electron/package.json', 'Electron/electron/main.ts', 'Electron/index.html', 'Electron/resources/splash.html',
  'Electron/shared/channel.ts', 'Electron/build-identity.ts',
  'deploy/dagitim.json', 'scripts/lib/dagitim.mjs', 'scripts/lib/panel-kimlik.mjs', 'scripts/panel-kimlik-kapisi.mjs',
];

/** Eski kanal derlemesini electron-vite'a (Vite sanal modülü) taşıyan ortam değişkeni. */
export const PANEL_KANAL_ORTAMI = 'TEKSERP_KANAL';
/** Paket açıklaması (NSIS kurulum dosyasının FileDescription'ı) ürün adından türer. */
export const panelAciklamasi = (kanal) => `${kanal.panel.urunAdi} — Admin Panel by Etkili Yazılım`;

/** `release/<kod>/${version}` — electron-builder makrosu `${version}` harfiyen. */
export const panelCiktiDeseni = (kod) => `release/${kod}/\${version}`;

/**
 * electron-builder'a derleme ANINDA verilen kimlik (`-c.<anahtar>=<değer>`). package.json'daki
 * taban (O5: tek ortak kimlik) ne olursa olsun eski kanal paketinin kimliği buradan doğar.
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
export function backendPaketleAyarlari(kod, kanal, lisansVarsayilan) {
  return {
    TEKSERP_PM2_AD: kanal.backend.pm2Ad,
    TEKSERP_BACKEND_URUN: kanal.backend.urunAdi,
    TEKSERP_HIZMET_ADI: kanal.backend.hizmetAdi,
    TEKSERP_GUVEN_CAPASI: kanal.backend.guvenCapasi,
    // Kanalın lisans satıcısı + bu derlemenin varsayılanı (LICENSE_SERVER_URL satırı yoksa backend'in gittiği yer):
    // paketle.ps1 ikisini PAKET.json'a yazar; geçiş kurulumun etkin değerini bunlarla ölçer.
    TEKSERP_LISANS_SUNUCUSU: kanal.backend.lisansSunucusu,
    TEKSERP_LISANS_VARSAYILAN: lisansVarsayilan,
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
  'scripts/test_kanal_yayin_kapisi.mjs', 'scripts/lib/surum.mjs', 'scripts/lib/surum-notu-tavan.mjs', 'scripts/lib/terfi.mjs', 'scripts/lib/kullanici-cumlesi.mjs',
  'scripts/lib/yayin-okuma.mjs', 'scripts/lib/yayin-hedefi.mjs', 'scripts/lib/derleme-bagi.mjs', 'deploy/vds-dogrula.sh',
  'scripts/check-surum-notlari.mjs', 'scripts/hooks/pre-commit.mjs', VENDOR_URL_REL,
  ...PANEL_SABIT_DOSYALAR, ...TABLET_SABIT_DOSYALAR,
  'Electron/shared/update-feed.ts', 'mobil/scripts/lib/feed.cjs', 'mobil/scripts/lib/adres.mjs', 'mobil/scripts/lib/zip.mjs',
  'mobil/scripts/lib/manifest.mjs', 'mobil/scripts/lib/apk-kimlik.mjs', 'mobil/scripts/lib/kanal.cjs', 'mobil/app.config.js',
  'scripts/lib/yayin-bildirim.mjs', 'scripts/lib/backend-yayin.mjs',
  'scripts/lib/panel-imza-kapisi.mjs', 'Electron/electron/guncelleme/kunye-jws.mjs', 'Electron/electron/guncelleme/panel-kunye.mjs',
  'Electron/electron/guncelleme/latest-yml.mjs',
  'mobil/scripts/lib/apk-kunye.mjs', 'mobil/src/lib/apk-imza-capasi.json',
  // Tek ortak paket O7: app.config.js'in argümansız yolu ve build-apk'nın ortak yolu (kanal bekçileri onları da koşturur).
  'mobil/scripts/lib/ortak-kimlik.cjs', 'scripts/lib/dagitim.mjs',
])];
/** YOKLUĞU ölçülen dosyalar (O5: kalkmış panel müşteri işaretçisi) — geri gelirse (A) bekçiler koşar; diskte olmaları beklenmez. */
export const KANAL_BEKCI_YOKLUK_DOSYALARI = ['Electron/shared/musteri.json'];
/** Bu yola dokunan commit kanal bekçilerini koşar (`scripts/hooks/pre-commit.mjs`). */
export function kanalBekcisiTetigi(rel) {
  if (KANAL_BEKCI_DOSYALARI.includes(rel) || KANAL_BEKCI_YOKLUK_DOSYALARI.includes(rel)) return true;
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
