// =============================================================================
// DAĞITIM KAYDI — `deploy/dagitim.json` yüklemleri (tek ortak paket, TEK-ORTAK-PAKET.md §2.1)
// =============================================================================
// Kayıt davranış ve müşteri taşımaz; yayın adresleri ve VDS yolları kayda yazılmaz,
// burada kök + grup + üründen TÜRETİLİR. Grup listesi terfi zinciridir (test → oncu → genel).
// Bekçi `scripts/check-dagitim.mjs`; tüketiciler (O2+) AYNI fonksiyonları çağırır — ikinci kopya yok.
// Eski kanal kaydı (`deploy/kanallar.json`) bu modülce yalnız OKUNUR (ayrılık denetimi); onu
// değiştiren hiçbir yol yoktur, donukluğunu `scripts/test_eski_kanal_donuk.mjs` ölçer.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KAYIT_REL = 'deploy/dagitim.json';
export const ESKI_KAYIT_REL = 'deploy/kanallar.json';

/** Okunamayan/ayrıştırılamayan girdi: kapı geçmiş sayılmaz (çıkış 2). */
export class Olculemedi extends Error {}

/** Grup kodu = belirtecin yol öneki (`/<grup>/<ürün>/`); satıcı `Kanal.kod` biçim seddiyle aynı. */
export const GRUP_KODU_DESENI = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** `ota`: Worker'ın grup-nötr OTA takma adı (`/ota/<rv>/manifest`, §3.3) — grup olursa yol çakışır. */
export const AYRILMIS_GRUP_KODLARI = Object.freeze(['ota']);
export const URUNLER = Object.freeze(['panel', 'tablet', 'backend']);
/** Ürünün indirme yolundaki dizini — satıcı `DOWNLOAD_PRODUCTS` ve Worker `URUN_DIZINLERI` ile aynı küme (bekçi ölçer). */
export const URUN_DIZINI = Object.freeze({ panel: 'electron', tablet: 'mobil', backend: 'backend' });

const SEMA = {
  kok: { zorunlu: ['urun', 'indirmeKoku', 'vdsKoku', 'defterKoku', 'lisansSunucusu', 'gruplar'], secimli: ['_aciklama'] },
  urun: { zorunlu: URUNLER, secimli: [] },
  panel: { zorunlu: ['appId', 'urunAdi', 'paketAdi'], secimli: [] },
  tablet: { zorunlu: ['androidPaket', 'gorunenAd', 'runtimeVersion', 'otaSertifika'], secimli: [] },
  backend: { zorunlu: ['urunAdi', 'hizmetAdi'], secimli: [] },
  grup: { zorunlu: ['kod', 'ad', 'terfiKaynagi'], secimli: [] },
};

const BICIM = {
  appId: /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/,
  androidPaket: /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/,
  paketAdi: /^[a-z0-9][a-z0-9-]{0,213}$/,
  runtimeVersion: /^[0-9]+\.[0-9]+$/,
  otaSertifika: /^keystore\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.pem$/,
  hizmetAdi: /^[A-Za-z][A-Za-z0-9-]{0,79}$/,
  indirmeKoku: /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+\/$/,
  mutlakYol: /^(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/,
  lisansSunucusu: /^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?$/,
};

const nesneMi = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const adMi = (v) => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 60 && !/[\u0000-\u001f\u007f]/.test(v);

function anahtarHatalari(o, sema, yer) {
  if (!nesneMi(o)) return [`${yer}: nesne olmalı`];
  const h = [];
  const izinli = new Set([...sema.zorunlu, ...sema.secimli]);
  for (const a of Object.keys(o)) if (!izinli.has(a)) h.push(`${yer}: tanınmayan anahtar "${a}" (şema KAPALI)`);
  for (const a of sema.zorunlu) if (!Object.hasOwn(o, a)) h.push(`${yer}: eksik anahtar "${a}"`);
  return h;
}

/** Metni ayrıştırır; bozuk JSON → Olculemedi. */
export function kayitAyristir(metin) {
  if (typeof metin !== 'string') throw new Olculemedi(`${KAYIT_REL} okunamadı`);
  try {
    return JSON.parse(metin);
  } catch (e) {
    throw new Olculemedi(`${KAYIT_REL} ayrıştırılamadı: ${e.message}`);
  }
}

/**
 * Terfi zinciri: tek kök (`terfiKaynagi: null`), her kaynak kayıtlı ve en çok bir grubun kaynağı
 * (doğrusal), döngü yok, her grup kökten erişilir. Sıra kökten sona.
 */
export function grupZinciri(gruplar) {
  const hatalar = [];
  if (!Array.isArray(gruplar) || gruplar.length === 0) return { zincir: [], hatalar: ['gruplar: boş olmayan dizi olmalı'] };
  const kodlar = gruplar.map((g) => g?.kod);
  const kumesi = new Set(kodlar);
  const kokler = gruplar.filter((g) => g?.terfiKaynagi === null).map((g) => g.kod);
  if (kokler.length !== 1) hatalar.push(`grup zinciri: tam bir kök (terfiKaynagi: null) olmalı, ${kokler.length} var${kokler.length ? ` (${kokler.join(', ')})` : ''}`);
  const ardil = new Map();
  for (const g of gruplar) {
    const k = g?.terfiKaynagi;
    if (k === null) continue;
    if (typeof k !== 'string' || !kumesi.has(k)) { hatalar.push(`grup zinciri: "${g?.kod}" terfi kaynağı "${k}" kayıtlı bir grup değil`); continue; }
    if (k === g.kod) { hatalar.push(`grup zinciri: "${g.kod}" kendi kendisinin terfi kaynağı (döngü)`); continue; }
    if (ardil.has(k)) { hatalar.push(`grup zinciri: "${k}" iki grubun terfi kaynağı ("${ardil.get(k)}", "${g.kod}") — zincir doğrusal olmalı`); continue; }
    ardil.set(k, g.kod);
  }
  const zincir = [];
  if (kokler.length === 1) {
    const gorulen = new Set();
    for (let g = kokler[0]; g !== undefined && !gorulen.has(g); g = ardil.get(g)) { gorulen.add(g); zincir.push(g); }
  }
  const erisilmeyen = kodlar.filter((k) => !zincir.includes(k));
  if (erisilmeyen.length && kokler.length === 1) hatalar.push(`grup zinciri: kökten erişilmeyen grup(lar) ${[...new Set(erisilmeyen)].join(', ')} (döngü ya da kopuk zincir)`);
  return { zincir, hatalar };
}

/** Kapalı şema + biçim + grup zinciri hataları (boş dizi = geçerli). */
export function kayitHatalari(o) {
  const h = anahtarHatalari(o, SEMA.kok, 'kök');
  if (!nesneMi(o)) return h;
  if (Object.hasOwn(o, '_aciklama') && !(Array.isArray(o._aciklama) && o._aciklama.every((s) => typeof s === 'string'))) h.push('_aciklama: metin dizisi olmalı');

  if (nesneMi(o.urun)) {
    h.push(...anahtarHatalari(o.urun, SEMA.urun, 'urun'));
    for (const u of URUNLER) if (Object.hasOwn(o.urun, u)) h.push(...anahtarHatalari(o.urun[u], SEMA[u], `urun.${u}`));
    const p = o.urun.panel ?? {}, t = o.urun.tablet ?? {}, b = o.urun.backend ?? {};
    const bicim = (yer, v, re) => { if (v !== undefined && !(typeof v === 'string' && re.test(v))) h.push(`${yer}: biçimsiz değer ${JSON.stringify(v)}`); };
    bicim('urun.panel.appId', p.appId, BICIM.appId);
    bicim('urun.panel.paketAdi', p.paketAdi, BICIM.paketAdi);
    bicim('urun.tablet.androidPaket', t.androidPaket, BICIM.androidPaket);
    bicim('urun.tablet.runtimeVersion', t.runtimeVersion, BICIM.runtimeVersion);
    bicim('urun.tablet.otaSertifika', t.otaSertifika, BICIM.otaSertifika);
    bicim('urun.backend.hizmetAdi', b.hizmetAdi, BICIM.hizmetAdi);
    for (const [yer, v] of [['urun.panel.urunAdi', p.urunAdi], ['urun.tablet.gorunenAd', t.gorunenAd], ['urun.backend.urunAdi', b.urunAdi]]) {
      if (v !== undefined && !adMi(v)) h.push(`${yer}: 1–60 karakter, baş/son boşluksuz metin olmalı`);
    }
  } else if (Object.hasOwn(o, 'urun')) h.push('urun: nesne olmalı');

  if (Object.hasOwn(o, 'indirmeKoku') && !(typeof o.indirmeKoku === 'string' && BICIM.indirmeKoku.test(o.indirmeKoku))) {
    h.push(`indirmeKoku: "https://<ana makine>/" biçiminde olmalı (yol yok, sonda /), gelen ${JSON.stringify(o.indirmeKoku)}`);
  }
  for (const a of ['vdsKoku', 'defterKoku']) {
    if (Object.hasOwn(o, a) && !(typeof o[a] === 'string' && BICIM.mutlakYol.test(o[a]))) h.push(`${a}: mutlak yol olmalı (sonda / yok, ".." yok), gelen ${JSON.stringify(o[a])}`);
  }
  if (typeof o.vdsKoku === 'string' && typeof o.defterKoku === 'string' && altinda(o.defterKoku, o.vdsKoku)) {
    h.push(`defterKoku vdsKoku ile aynı ya da onun altında — yayın defteri internetten okunur olurdu`);
  }
  if (Object.hasOwn(o, 'lisansSunucusu') && !(typeof o.lisansSunucusu === 'string' && BICIM.lisansSunucusu.test(o.lisansSunucusu))) {
    h.push(`lisansSunucusu: "https://host[:port]" biçiminde olmalı (sonda / yok), gelen ${JSON.stringify(o.lisansSunucusu)}`);
  }

  if (Object.hasOwn(o, 'gruplar')) {
    if (!Array.isArray(o.gruplar)) h.push('gruplar: dizi olmalı');
    else {
      const kodlar = new Set();
      const adlar = new Set();
      o.gruplar.forEach((g, i) => {
        h.push(...anahtarHatalari(g, SEMA.grup, `gruplar[${i}]`));
        if (!nesneMi(g)) return;
        if (!(typeof g.kod === 'string' && GRUP_KODU_DESENI.test(g.kod))) h.push(`gruplar[${i}].kod: biçimsiz ${JSON.stringify(g.kod)} (${GRUP_KODU_DESENI})`);
        else if (AYRILMIS_GRUP_KODLARI.includes(g.kod)) h.push(`gruplar[${i}].kod: "${g.kod}" ayrılmış (Worker OTA takma adı /${g.kod}/<rv>/manifest)`);
        if (kodlar.has(g.kod)) h.push(`gruplar: mükerrer kod "${g.kod}"`);
        kodlar.add(g.kod);
        if (!adMi(g.ad)) h.push(`gruplar[${i}].ad: 1–60 karakter metin olmalı`);
        else if (adlar.has(g.ad)) h.push(`gruplar: mükerrer ad "${g.ad}"`);
        adlar.add(g.ad);
        if (!(g.terfiKaynagi === null || typeof g.terfiKaynagi === 'string')) h.push(`gruplar[${i}].terfiKaynagi: null ya da grup kodu olmalı`);
      });
      h.push(...grupZinciri(o.gruplar).hatalar);
    }
  }
  return h;
}

/** `a`, `b` ile aynı yol ya da onun altında mı (bölü sınırında). */
export function altinda(a, b) {
  return a === b || a.startsWith(`${b}/`);
}

/** Geçerli kayıt şart; geçersizse atar (tüketici önce `kayitHatalari` ile denetler). */
function gecerliKayit(o) {
  const h = kayitHatalari(o);
  if (h.length) throw new Error(`${KAYIT_REL} geçersiz: ${h[0]}${h.length > 1 ? ` (+${h.length - 1})` : ''}`);
  return o;
}

/**
 * Grup × ürün yayın adresleri, VDS yolları ve defter dosyaları (§2.1); `otaTakmaAd` gömülü
 * grup-nötr OTA adresidir (Worker belirtecin grubuna yönlendirir, §3.3).
 */
export function turet(kayit) {
  const o = gecerliKayit(kayit);
  const k = o.indirmeKoku;
  const rv = o.urun.tablet.runtimeVersion;
  const gruplar = {};
  for (const g of grupZinciri(o.gruplar).zincir) {
    const d = (u) => `${k}${g}/${URUN_DIZINI[u]}/`;
    const vds = (u) => `${o.vdsKoku}/${g}/${URUN_DIZINI[u]}`;
    const defter = (u) => `${o.defterKoku}/${g}-${u}-YAYIN-DEFTERI.tsv`;
    gruplar[g] = {
      panel: { feed: d('panel'), manifest: `${d('panel')}latest.yml`, vds: vds('panel'), defter: defter('panel') },
      tablet: {
        feed: d('tablet'),
        otaManifest: `${d('tablet')}ota/${rv}/manifest`,
        apkKunye: `${d('tablet')}apk/surum.json`,
        vds: vds('tablet'),
        defter: defter('tablet'),
      },
      backend: { feed: d('backend'), manifest: `${d('backend')}son.json`, vds: vds('backend'), defter: defter('backend') },
    };
  }
  return { gruplar, otaTakmaAd: `${k}${AYRILMIS_GRUP_KODLARI[0]}/${rv}/manifest` };
}

/** Grubun terfi kaynağı (kök grup → null); kayıtlı olmayan grup → atar (fail-closed). */
export function terfiKaynagi(kayit, grup) {
  const o = gecerliKayit(kayit);
  const g = o.gruplar.find((x) => x.kod === grup);
  if (!g) throw new Error(`"${grup}" ${KAYIT_REL} içinde kayıtlı bir güncelleme grubu değil`);
  return g.terfiKaynagi;
}

/** Yeni paket eski kanallardan biriyle aynı makinede yan yana durur: bu alanlar paylaşılamaz (büyük/küçük harf duyarsız). */
export const AYRIK_KIMLIK_ALANLARI = Object.freeze([
  ['panel', 'appId'], ['panel', 'urunAdi'], ['panel', 'paketAdi'],
  ['tablet', 'androidPaket'], ['tablet', 'otaSertifika'],
  ['backend', 'urunAdi'], ['backend', 'hizmetAdi'],
]);

/**
 * Eski kanal kaydından AYRILIK: indirme ana makinesi, VDS/defter kökleri, grup kodları ve
 * kimlikler eski kanallarınkiyle kesişmez. `istisnalar` = `[{alan:'backend.hizmetAdi', kanal, gerekce}]`;
 * kullanılmayan istisna da hatadır (beyan çürümesin).
 */
export function eskiKanalAyrimi(kayit, eski, istisnalar = []) {
  const o = gecerliKayit(kayit);
  if (!nesneMi(eski) || !nesneMi(eski.kanallar)) throw new Olculemedi(`${ESKI_KAYIT_REL}: "kanallar" nesnesi yok`);
  const h = [];
  const kullanilan = new Set();
  const yeniHost = new URL(o.indirmeKoku).host;
  for (const [kod, kn] of Object.entries(eski.kanallar)) {
    if (o.gruplar.some((g) => g.kod === kod)) h.push(`grup kodu "${kod}" eski kanal kodu — satıcıdaki eski kanal satırı grup sayılırdı`);
    const yayin = nesneMi(kn?.yayin) ? kn.yayin : {};
    for (const [a, v] of Object.entries(yayin)) {
      if (typeof v !== 'string') continue;
      if (v.startsWith('https://') && new URL(v).host === yeniHost) h.push(`indirmeKoku ana makinesi (${yeniHost}) eski kanal "${kod}" yayın adresiyle aynı (${a}) — eski kanala yayın yolu açılırdı`);
      if (v.startsWith('/')) {
        for (const yeni of ['vdsKoku', 'defterKoku']) {
          if (altinda(v, o[yeni]) || altinda(o[yeni], v)) h.push(`${yeni} (${o[yeni]}) eski kanal "${kod}" yoluyla (${a} = ${v}) iç içe — eski yayın ağacına yazılırdı`);
        }
        const eskiKok = v.split('/').slice(0, 5).join('/'); // /opt/stack/apps/<uygulama>
        for (const yeni of ['vdsKoku', 'defterKoku']) {
          if (altinda(o[yeni], eskiKok)) h.push(`${yeni} (${o[yeni]}) eski kanal "${kod}" uygulama kökünün (${eskiKok}) altında`);
        }
      }
    }
    for (const [u, alan] of AYRIK_KIMLIK_ALANLARI) {
      const yeni = o.urun[u][alan];
      const eskiDeger = kn?.[u]?.[alan];
      if (typeof eskiDeger !== 'string' || eskiDeger.toLowerCase() !== yeni.toLowerCase()) continue;
      const ist = istisnalar.find((i) => i.alan === `${u}.${alan}` && i.kanal === kod);
      if (ist) { kullanilan.add(ist); continue; }
      h.push(`urun.${u}.${alan} = "${yeni}" eski kanal "${kod}" ile aynı — yan yana kurulumda üzerine yazar`);
    }
  }
  for (const i of istisnalar) if (!kullanilan.has(i)) h.push(`kullanılmayan ayrılık istisnası ${i.alan} / ${i.kanal} — beyan sil`);
  return [...new Set(h)];
}

/** Hizmet adlarının tek çekirdeği (setup + geçiş): soneksiz taban = makinedeki tek kurulum. */
export const KANAL_ADLARI_REL = 'deploy/hizmet/kanal-adlari.ps1';

/**
 * Ortak backend paketinin kimliği (`paketle.ps1` argümansız, O11a) — paket kanal/müşteri TAŞIMAZ.
 * Hizmet adı soneksiz tabana eşit olmalı (son ek kanal kimliğidir, ortak pakette yeri yok); lisans
 * satıcısı backend varsayılanına eşit olmalı (kurulum etkin değeri buna karşı ölçer). Okunamayan → Olculemedi.
 * Dönüş: `paketle.ps1`in okuduğu KEY=VALUE çiftleri.
 */
export function backendPaketKimligi(kayit, vendorMetni, kanalAdlariMetni) {
  const o = gecerliKayit(kayit);
  const vm = typeof vendorMetni === 'string' ? /^export const DEFAULT_LICENSE_SERVER_URL = "([^"]+)";$/m.exec(vendorMetni) : null;
  if (!vm) throw new Olculemedi(`${VENDOR_URL_REL} DEFAULT_LICENSE_SERVER_URL okunamadı`);
  const tm = typeof kanalAdlariMetni === 'string' ? /^\s*\$taban = "([^"]+)"\s*$/m.exec(kanalAdlariMetni) : null;
  if (!tm) throw new Olculemedi(`${KANAL_ADLARI_REL} hizmet adı tabanı ($taban) okunamadı`);
  const b = o.urun.backend;
  if (b.hizmetAdi !== tm[1]) throw new Error(`urun.backend.hizmetAdi "${b.hizmetAdi}" soneksiz taban "${tm[1]}" değil (${KANAL_ADLARI_REL}) — son ek kanal kimliğidir, ortak pakette olamaz`);
  if (o.lisansSunucusu !== vm[1]) throw new Error(`lisansSunucusu (${o.lisansSunucusu}) backend varsayılanı (${vm[1]}) değil — kurulumun etkin değeri ayrışırdı`);
  return {
    TEKSERP_BACKEND_URUN: b.urunAdi,
    TEKSERP_HIZMET_ADI: b.hizmetAdi,
    TEKSERP_LISANS_SUNUCUSU: o.lisansSunucusu,
    TEKSERP_LISANS_VARSAYILAN: vm[1],
  };
}

/** Bekçinin (check-dagitim) okuduğu, kodda yaşayan sabit kaynaklar. */
export const VENDOR_URL_REL = 'Teks-Erp/src/lib/license/vendor-url.ts';
export const SATICI_INDIRME_REL = 'satici/sunucu/src/lisans-protokol/indirme.ts';
export const WORKER_REL = 'deploy/guncelleme-sunucusu/worker/indirme-kapisi.js';
export const KAPI_KANCASI_REL = 'scripts/hooks/pre-commit.mjs';
export const CI_REL = '.github/workflows/ci.yml';
/** Satıcının grup aynaları (O2): `UPDATE_GROUPS` sabiti + grup satırlarını doğuran migration — §7 ölçer. */
export const SATICI_GRUPLAR_REL = 'satici/sunucu/src/services/channel.service.ts';
export const SATICI_GRUP_MIGRATION_REL = 'satici/sunucu/prisma/migrations/20261006120000_guncelleme_gruplari/migration.sql';
/** Fabrikanın grup aynası (O3): indirme belirteci yanıtındaki `grup` yalnız bu kümeden — §7 ölçer. */
export const BACKEND_GRUPLAR_REL = 'Teks-Erp/src/lib/license/update-group.ts';

/**
 * `deploy/dagitim.json`ı okuyan ürün/yayın dosyaları — BEYANLI. Bekçi ağaçta kaydın adını taşıyan
 * her kod dosyasını bu liste + bekçi dosyalarıyla kıyaslar (iki yönlü).
 */
export const TUKETICILER = Object.freeze(['scripts/dagitim-kapisi.mjs', 'deploy/paketle.ps1', 'deploy/kurulum/kurulum-arsivi.mjs', 'scripts/test_kurulum_arsivi.mjs',
  'Teks-Erp/scripts/test_kurulum_betikleri.ts']);

/** İki dağıtım bekçisinin okuduğu dosyalar — commit tetiği bunları kapsar (okunandan dar olamaz). */
export const DAGITIM_BEKCI_DOSYALARI = Object.freeze([
  KAYIT_REL, ESKI_KAYIT_REL, 'scripts/lib/dagitim.mjs', 'scripts/check-dagitim.mjs', 'scripts/test_eski_kanal_donuk.mjs',
  VENDOR_URL_REL, SATICI_INDIRME_REL, WORKER_REL, KAPI_KANCASI_REL, CI_REL, SATICI_GRUPLAR_REL, SATICI_GRUP_MIGRATION_REL,
  BACKEND_GRUPLAR_REL, KANAL_ADLARI_REL, 'docs/design/TEK-ORTAK-PAKET.md',
]);

export function dagitimBekcisiTetigi(rel) {
  return DAGITIM_BEKCI_DOSYALARI.includes(rel) || TUKETICILER.includes(rel);
}

/** Göreli yolları okur; olmayan/okunamayan dosyanın değeri `undefined` kalır (tüketici ÖLÇÜLEMEDİ der). */
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
