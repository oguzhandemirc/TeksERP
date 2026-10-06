#!/usr/bin/env node
// =============================================================================
// BEKÇİ — DAĞITIM KAYDI (tek ortak paket O1) · zero-dep, DB'siz, ağsız
// =============================================================================
// Kayıt `deploy/dagitim.json`; yüklemler `scripts/lib/dagitim.mjs` (tüketiciler AYNI fonksiyonları çağırır).
//
// NE ÖLÇER (dinlenme durumu, commit edilen ağaç):
//   §1 kapalı şema + biçim (kök · ürün blokları · grup satırları; defter kökü web kökünün altında olamaz)
//   §2 terfi zinciri tek kök, doğrusal, döngüsüz; DONMUŞ küme test → oncu → genel (kullanıcı kararı 2026-10-03/06)
//   §3 türetim: kütüphanenin ürettiği her grup × ürün adresi bu dosyadaki BAĞIMSIZ şablonla birebir;
//      adresler ve VDS yolları ayrık; ürün dizinleri satıcı `DOWNLOAD_PRODUCTS` ve Worker `URUN_DIZINLERI` ile
//      aynı küme; her adres Worker'ın `yolOneki` kuralına (`/<grup>/<dizin>/`) uyar; Worker'ın OTA takma ad öneki
//      (`OTA_TAKMA_AD_ONEKI`, O9) kaydın `otaTakmaAd` şablonuyla aynı
//   §4 eski kanal kaydından AYRILIK: ana makine, VDS/defter kökü, grup kodu ve yan yana kurulum kimlikleri
//      eski kanallarınkiyle kesişmez (beyanlı istisna; kullanılmayan istisna da kırmızı)
//   §5 lisansSunucusu = backend varsayılanı (`vendor-url.ts` DEFAULT_LICENSE_SERVER_URL)
//   §6 tüketici envanteri (kaydın adını taşıyan her kod dosyası beyanlı, beyanlı her tüketici okuyor) +
//      commit kancası ve CI kablolu + tetik okunan her dosyayı kapsar
//   §7 satıcı grup aynaları (O2): `UPDATE_GROUPS` sabiti = zincir (sırasıyla); grup migration'ının INSERT satırları
//      (kod × sira 1..n) ve iki `NOT IN`/`IN` kümesi = zincir — kayıt, kod ve DB satırı tek küme
//      + fabrika aynası (O3): backend `UPDATE_GROUPS` (indirme belirteci yanıtının `grup` kümesi) = zincir
//   §8 ortak backend paketinin kimliği (O11a): `paketle.ps1`in argümansız yolunun çağırdığı türetim
//      (`backendPaketKimligi`) ağaçta koşar — hizmet adı `kanal-adlari.ps1`in soneksiz tabanı, lisans satıcısı
//      backend varsayılanı
//
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ. Cırcır değil (taban yok).
//   node scripts/check-dagitim.mjs          # dinlenme durumu
//   node scripts/check-dagitim.mjs --sonda  # kalıcı negatif + pozitif sondalar (bellekteki kopyalara karşı)
// =============================================================================

import { execFileSync } from 'node:child_process';

import {
  BACKEND_GRUPLAR_REL,
  CI_REL,
  DAGITIM_BEKCI_DOSYALARI,
  ESKI_KAYIT_REL,
  KANAL_ADLARI_REL,
  KAPI_KANCASI_REL,
  KAYIT_REL,
  KOK,
  Olculemedi,
  SATICI_GRUP_MIGRATION_REL,
  SATICI_GRUPLAR_REL,
  SATICI_INDIRME_REL,
  TUKETICILER,
  URUN_DIZINI,
  URUNLER,
  VENDOR_URL_REL,
  WORKER_REL,
  backendPaketKimligi,
  dagitimBekcisiTetigi,
  dosyalariOku,
  eskiKanalAyrimi,
  grupZinciri,
  kayitAyristir,
  kayitHatalari,
  turet,
} from './lib/dagitim.mjs';

/** Kullanıcı kararı (2026-10-03, 2026-10-06): yayın sırası ve klasörler `/test`, `/oncu`, `/genel`. */
const DONMUS_ZINCIR = ['test', 'oncu', 'genel'];

/** §2.1'in türetim kuralı, kütüphaneden BAĞIMSIZ yazılmış hâli ({k} kök · {g} grup · {v} VDS · {d} defter · {rv}). */
const SABLON = {
  panel: { feed: '{k}{g}/electron/', manifest: '{k}{g}/electron/latest.yml', vds: '{v}/{g}/electron', defter: '{d}/{g}-panel-YAYIN-DEFTERI.tsv' },
  tablet: {
    feed: '{k}{g}/mobil/', otaManifest: '{k}{g}/mobil/ota/{rv}/manifest', apkKunye: '{k}{g}/mobil/apk/surum.json',
    vds: '{v}/{g}/mobil', defter: '{d}/{g}-tablet-YAYIN-DEFTERI.tsv',
  },
  backend: { feed: '{k}{g}/backend/', manifest: '{k}{g}/backend/son.json', vds: '{v}/{g}/backend', defter: '{d}/{g}-backend-YAYIN-DEFTERI.tsv' },
};
const TAKMA_AD_SABLONU = '{k}ota/{rv}/manifest';

/**
 * Ayrılık istisnaları — BEYANLI. adnansahin pm2'de koşar (`tekserp-backend-yeni`), Windows hizmeti yoktur;
 * kayıttaki `TeksERP-Backend` geçiş aracının (gecis.ps1, K-13: dokunulmaz) hedef adıdır. O11a KARARI: ortak
 * hizmet adı soneksiz taban kalır (§8) — makinede tek kurulumun adıdır; adnansahin Faz 4'te aynı adı alır.
 */
const AYRILIK_ISTISNALARI = [
  { alan: 'backend.hizmetAdi', kanal: 'adnansahin', gerekce: 'adnansahin pm2de, hizmet yok; ortak ad soneksiz taban (O11a KARARI); Faz 4te aynı adı alır (TEK-ORTAK-PAKET.md §8.4)' },
];

const OKUNAN = [KAYIT_REL, ESKI_KAYIT_REL, VENDOR_URL_REL, KANAL_ADLARI_REL, SATICI_INDIRME_REL, WORKER_REL, KAPI_KANCASI_REL, CI_REL, SATICI_GRUPLAR_REL, SATICI_GRUP_MIGRATION_REL, BACKEND_GRUPLAR_REL];

const sablonDoldur = (s, y) => s.replaceAll('{k}', y.k).replaceAll('{g}', y.g).replaceAll('{v}', y.v).replaceAll('{d}', y.d).replaceAll('{rv}', y.rv);

function diziOku(metin, desen, ne) {
  const m = typeof metin === 'string' ? desen.exec(metin) : null;
  if (!m) throw new Olculemedi(`${ne} bulunamadı (sabitin adı/biçimi değişti mi?)`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** Kaydın adını taşıyan izlenen kod dosyaları (belgeler hariç); git yoksa null. */
function kaydiAnanDosyalar() {
  try {
    const out = execFileSync('git', ['grep', '--untracked', '-l', '-F', 'dagitim.json', '--', '.', ':!*.md'], { cwd: KOK, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch (e) {
    if (e.status === 1) return []; // eşleşme yok
    return null;
  }
}

/**
 * @param d       okunan dosyalar (rel → metin)
 * @param okuyanlar kaydın adını taşıyan dosyalar (null = ölçülemedi)
 * @param ek      sondaların enjeksiyonu: { turet, tuketiciler }
 */
function olc(d, okuyanlar, ek = {}) {
  const s = { kirmizi: [], olculemedi: [], bilgi: [] };
  const turetFn = ek.turet ?? turet;
  const tuketiciler = ek.tuketiciler ?? TUKETICILER;
  let kayit;
  try {
    kayit = kayitAyristir(d[KAYIT_REL]);
  } catch (e) {
    s.olculemedi.push(e.message);
    return s;
  }

  // §1 + §2 (zincir hataları kayitHatalari içinde)
  const h = kayitHatalari(kayit);
  for (const x of h) s.kirmizi.push(`§1 ${x}`);
  if (h.length) return s;

  const { zincir } = grupZinciri(kayit.gruplar);
  if (JSON.stringify(zincir) !== JSON.stringify(DONMUS_ZINCIR)) {
    s.kirmizi.push(`§2 DONMUŞ grup zinciri ${DONMUS_ZINCIR.join(' → ')} olmalı, kayıtta ${zincir.join(' → ')} (değişimi kullanıcı kararıdır + satıcı migration'ı)`);
  }

  // §3 türetim
  let t;
  try {
    t = turetFn(kayit);
  } catch (e) {
    s.kirmizi.push(`§3 türetim attı: ${e.message}`);
    return s;
  }
  const y0 = { k: kayit.indirmeKoku, v: kayit.vdsKoku, d: kayit.defterKoku, rv: kayit.urun.tablet.runtimeVersion };
  const gorulenAdres = new Map();
  if (JSON.stringify(Object.keys(t.gruplar ?? {})) !== JSON.stringify(zincir)) {
    s.kirmizi.push(`§3 türetimin grupları (${Object.keys(t.gruplar ?? {}).join(', ')}) zincirle (${zincir.join(', ')}) aynı sırada değil`);
  }
  for (const g of zincir) {
    const y = { ...y0, g };
    for (const u of URUNLER) {
      const bek = SABLON[u];
      const gel = t.gruplar?.[g]?.[u] ?? {};
      const anahtarlar = new Set([...Object.keys(bek), ...Object.keys(gel)]);
      for (const a of anahtarlar) {
        if (!Object.hasOwn(bek, a)) { s.kirmizi.push(`§3 türetim farkı: ${g}.${u}.${a} şablonda yok (kütüphane fazla alan üretiyor)`); continue; }
        const beklenen = sablonDoldur(bek[a], y);
        if (gel[a] !== beklenen) { s.kirmizi.push(`§3 türetim farkı: ${g}.${u}.${a} = ${JSON.stringify(gel[a])}, şablon ${beklenen}`); continue; }
        if (gorulenAdres.has(beklenen)) s.kirmizi.push(`§3 ${g}.${u}.${a} ile ${gorulenAdres.get(beklenen)} aynı yolu üretiyor`);
        gorulenAdres.set(beklenen, `${g}.${u}.${a}`);
        if (beklenen.startsWith('https://')) {
          const yol = new URL(beklenen).pathname;
          if (!beklenen.startsWith(kayit.indirmeKoku)) s.kirmizi.push(`§3 ${g}.${u}.${a} indirme kökünün dışında`);
          if (!yol.startsWith(`/${g}/${URUN_DIZINI[u]}/`)) s.kirmizi.push(`§3 ${g}.${u}.${a} yolu Worker yolOneki kuralına (/${g}/${URUN_DIZINI[u]}/) uymuyor`);
        }
      }
    }
  }
  const takma = sablonDoldur(TAKMA_AD_SABLONU, { ...y0, g: '' });
  if (t.otaTakmaAd !== takma) s.kirmizi.push(`§3 türetim farkı: otaTakmaAd = ${JSON.stringify(t.otaTakmaAd)}, şablon ${takma}`);
  try {
    const satici = diziOku(d[SATICI_INDIRME_REL], /export const DOWNLOAD_PRODUCTS = \[([^\]]*)\] as const;/, `${SATICI_INDIRME_REL} DOWNLOAD_PRODUCTS`);
    const worker = diziOku(d[WORKER_REL], /export const URUN_DIZINLERI = Object\.freeze\(\[([^\]]*)\]\);/, `${WORKER_REL} URUN_DIZINLERI`);
    const bizim = Object.values(URUN_DIZINI).sort().join(',');
    if (satici.slice().sort().join(',') !== bizim) s.kirmizi.push(`§3 ürün dizinleri satıcıyla ayrıştı: satıcı ${satici.join(',')} · kayıt ${bizim}`);
    if (worker.slice().sort().join(',') !== bizim) s.kirmizi.push(`§3 ürün dizinleri Worker'la ayrıştı: Worker ${worker.join(',')} · kayıt ${bizim}`);
    const takmaOnek = /^export const OTA_TAKMA_AD_ONEKI = "([^"]*)";$/m.exec(d[WORKER_REL] ?? '')?.[1];
    if (takmaOnek === undefined) throw new Olculemedi(`${WORKER_REL} OTA_TAKMA_AD_ONEKI bulunamadı (sabitin adı/biçimi değişti mi?)`);
    const beklenenOnek = `/${TAKMA_AD_SABLONU.replace('{k}', '').split('{rv}')[0]}`;
    if (takmaOnek !== beklenenOnek) s.kirmizi.push(`§3 Worker OTA takma ad öneki (${takmaOnek}) kaydın türetiminden (${beklenenOnek}) farklı`);
  } catch (e) {
    if (e instanceof Olculemedi) s.olculemedi.push(`§3 ${e.message}`);
    else throw e;
  }

  // §4 eski kanaldan ayrılık
  try {
    if (typeof d[ESKI_KAYIT_REL] !== 'string') throw new Olculemedi(`${ESKI_KAYIT_REL} okunamadı`);
    let eski;
    try { eski = JSON.parse(d[ESKI_KAYIT_REL]); } catch (e) { throw new Olculemedi(`${ESKI_KAYIT_REL} ayrıştırılamadı: ${e.message}`); }
    for (const x of eskiKanalAyrimi(kayit, eski, AYRILIK_ISTISNALARI)) s.kirmizi.push(`§4 ${x}`);
  } catch (e) {
    if (e instanceof Olculemedi) s.olculemedi.push(`§4 ${e.message}`);
    else throw e;
  }

  // §5 lisans sunucusu
  const m = typeof d[VENDOR_URL_REL] === 'string' ? /^export const DEFAULT_LICENSE_SERVER_URL = "([^"]+)";$/m.exec(d[VENDOR_URL_REL]) : null;
  if (!m) s.olculemedi.push(`§5 ${VENDOR_URL_REL} DEFAULT_LICENSE_SERVER_URL okunamadı`);
  else if (m[1] !== kayit.lisansSunucusu) s.kirmizi.push(`§5 lisansSunucusu (${kayit.lisansSunucusu}) backend varsayılanı (${m[1]}) değil`);

  // §8 ortak backend paketinin kimliği (paketleyici aynı yüklemi çağırır)
  try {
    backendPaketKimligi(kayit, d[VENDOR_URL_REL], d[KANAL_ADLARI_REL]);
  } catch (e) {
    (e instanceof Olculemedi ? s.olculemedi : s.kirmizi).push(`§8 ${e.message}`);
  }

  // §7 satıcı grup aynaları
  try {
    const sabit = diziOku(d[SATICI_GRUPLAR_REL], /export const UPDATE_GROUPS = \[([^\]]*)\] as const;/, `${SATICI_GRUPLAR_REL} UPDATE_GROUPS`);
    if (JSON.stringify(sabit) !== JSON.stringify(zincir)) s.kirmizi.push(`§7 satıcı UPDATE_GROUPS (${sabit.join(', ')}) zincirle (${zincir.join(', ')}) aynı sırada değil`);
    const sql = typeof d[SATICI_GRUP_MIGRATION_REL] === 'string' ? d[SATICI_GRUP_MIGRATION_REL].replace(/^--.*$/gm, '') : null;
    if (sql === null) throw new Olculemedi(`${SATICI_GRUP_MIGRATION_REL} okunamadı`);
    const satirlar = [...sql.matchAll(/\(gen_random_uuid\(\),\s*'([^']+)',\s*'[^']*',\s*'uretim',\s*'\{\}'::jsonb,\s*(\d+),\s*true,/g)].map((m) => `${m[1]}:${m[2]}`);
    if (satirlar.length === 0) throw new Olculemedi(`${SATICI_GRUP_MIGRATION_REL} INSERT satırları okunamadı (biçim değişti mi?)`);
    const beklenen = zincir.map((g, i) => `${g}:${i + 1}`);
    if (satirlar.join() !== beklenen.join()) s.kirmizi.push(`§7 grup migration'ı satırları (${satirlar.join(', ')}) zincirden (${beklenen.join(', ')}) farklı`);
    const kumeler = [...sql.matchAll(/"kod" (?:NOT )?IN \(([^)]*)\)/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).join(','));
    if (kumeler.length < 2) throw new Olculemedi(`${SATICI_GRUP_MIGRATION_REL} grup kümeleri (IN / NOT IN) okunamadı`);
    for (const k of kumeler) if (k !== zincir.join(',')) s.kirmizi.push(`§7 grup migration'ında küme (${k}) zincirden (${zincir.join(',')}) farklı`);
  } catch (e) {
    if (e instanceof Olculemedi) s.olculemedi.push(`§7 ${e.message}`);
    else throw e;
  }

  // §7 fabrika grup aynası (O3)
  try {
    const sabit = diziOku(d[BACKEND_GRUPLAR_REL], /export const UPDATE_GROUPS = \[([^\]]*)\] as const;/, `${BACKEND_GRUPLAR_REL} UPDATE_GROUPS`);
    if (JSON.stringify(sabit) !== JSON.stringify(zincir)) s.kirmizi.push(`§7 backend UPDATE_GROUPS (${sabit.join(', ')}) zincirle (${zincir.join(', ')}) aynı sırada değil`);
  } catch (e) {
    if (e instanceof Olculemedi) s.olculemedi.push(`§7 ${e.message}`);
    else throw e;
  }

  // §6 tüketici envanteri + kablolama
  if (okuyanlar === null) s.olculemedi.push('§6 git grep koşamadı — kaydı okuyan dosyalar ölçülemedi');
  else {
    const beyanli = new Set([...DAGITIM_BEKCI_DOSYALARI, ...tuketiciler]);
    for (const f of okuyanlar) if (!beyanli.has(f)) s.kirmizi.push(`§6 beyansız tüketici: ${f} ${KAYIT_REL} adını taşıyor ama TUKETICILER listesinde yok (scripts/lib/dagitim.mjs)`);
    for (const f of tuketiciler) if (!okuyanlar.includes(f)) s.kirmizi.push(`§6 ölü tüketici beyanı: ${f} kaydı okumuyor`);
  }
  const kanca = d[KAPI_KANCASI_REL];
  if (typeof kanca !== 'string') s.olculemedi.push(`§6 ${KAPI_KANCASI_REL} okunamadı`);
  else {
    if (!kanca.includes('staged.some(dagitimBekcisiTetigi)') || !kanca.includes('"scripts/check-dagitim.mjs"')) {
      s.kirmizi.push('§6 commit kancasında dağıtım kaydı adımı yok (staged.some(dagitimBekcisiTetigi) → scripts/check-dagitim.mjs)');
    }
    if (!/^adimlar\.push\(\{[^\n]*"scripts\/test_eski_kanal_donuk\.mjs"/m.test(kanca)) {
      s.kirmizi.push('§6 eski kanal donma adımı commit kancasında KOŞULSUZ değil (silme ACMR listesine girmez; adım her commit koşmalı)');
    }
  }
  const ci = d[CI_REL];
  if (typeof ci !== 'string') s.olculemedi.push(`§6 ${CI_REL} okunamadı`);
  else {
    for (const komut of ['node scripts/check-dagitim.mjs', 'node scripts/check-dagitim.mjs --sonda', 'node scripts/test_eski_kanal_donuk.mjs', 'node scripts/test_eski_kanal_donuk.mjs --sonda']) {
      const re = new RegExp(`${komut.replaceAll('.', '\\.').replaceAll('-', '\\-')}(?![\\w-])(?! --sonda)`);
      if (!re.test(ci)) s.kirmizi.push(`§6 CI adımı yok: ${komut}`);
    }
  }
  for (const f of [...OKUNAN, 'scripts/lib/dagitim.mjs', 'scripts/check-dagitim.mjs', 'scripts/test_eski_kanal_donuk.mjs']) {
    if (!dagitimBekcisiTetigi(f)) s.kirmizi.push(`§6 commit tetiği ${f} dosyasını kapsamıyor`);
  }

  if (!s.kirmizi.length && !s.olculemedi.length) {
    for (const g of zincir) {
      const r = t.gruplar[g];
      s.bilgi.push(`   ${g.padEnd(5)} panel ${r.panel.feed} · tablet ${r.tablet.otaManifest} · apk ${r.tablet.apkKunye} · backend ${r.backend.manifest}`);
    }
    s.bilgi.push(`   OTA takma adı ${t.otaTakmaAd}`);
  }
  return s;
}

const hukum = (s) => (s.olculemedi.length ? 'olculemedi' : s.kirmizi.length ? 'kirmizi' : 'yesil');

/* ------------------------------------------------------------------ */

function sondalar(taban, tabanOkuyanlar) {
  const jd = (d, rel, fn) => { const o = JSON.parse(d[rel]); fn(o); d[rel] = `${JSON.stringify(o, null, 2)}\n`; };
  const kayitta = (fn) => (d) => jd(d, KAYIT_REL, fn);
  const grup = (o, kod) => o.gruplar.find((g) => g.kod === kod);
  const S = [
    // [ad, beklenen, mutasyon(d, ctx), iz?]  ctx = { okuyanlar, ek }
    ['P0 gerçek ağaç YEŞİL', 'yesil', () => {}],
    ['P1 grup görünen adı değişti (Öncü → Öncü Fabrikalar) YEŞİL (kod değil ad)', 'yesil', kayitta((o) => { grup(o, 'oncu').ad = 'Öncü Fabrikalar'; })],
    ['P2 runtimeVersion 55.1 — türetim izler, YEŞİL', 'yesil', kayitta((o) => { o.urun.tablet.runtimeVersion = '55.1'; })],
    ['P3 gruplar dizide ters sırada — zincir terfiKaynagi\'ndan türer, YEŞİL', 'yesil', kayitta((o) => { o.gruplar.reverse(); })],
    ['N1 kök düzeyde şema dışı anahtar (yayin bloğu) → KIRMIZI', 'kirmizi', kayitta((o) => { o.yayin = { panelFeed: 'https://indir.etkiliyazilim.com/test/electron/' }; }), 'tanınmayan anahtar "yayin"'],
    ['N2 kök düzeyde davranış anahtarı (financeEnabled) → KIRMIZI', 'kirmizi', kayitta((o) => { o.financeEnabled = true; }), 'tanınmayan anahtar'],
    ['N3 panel bloğuna erpAdresi (gömülü adres) → KIRMIZI', 'kirmizi', kayitta((o) => { o.urun.panel.erpAdresi = 'http://192.168.1.250:4000'; }), 'urun.panel: tanınmayan'],
    ['N4 grup satırına şema dışı anahtar (sira) → KIRMIZI', 'kirmizi', kayitta((o) => { grup(o, 'test').sira = 1; }), 'gruplar[0]: tanınmayan'],
    ['N5 tablet bloğunda otaSertifika eksik → KIRMIZI', 'kirmizi', kayitta((o) => { delete o.urun.tablet.otaSertifika; }), 'eksik anahtar "otaSertifika"'],
    ['N6 kökte müşteri anahtarı (musteri) → KIRMIZI', 'kirmizi', kayitta((o) => { o.musteri = 'adnansahin'; }), 'tanınmayan anahtar "musteri"'],
    ['N7 grup zinciri döngüsü (test ← genel) → KIRMIZI', 'kirmizi', kayitta((o) => { grup(o, 'test').terfiKaynagi = 'genel'; }), 'grup zinciri'],
    ['N8 iki kök (oncu null) → KIRMIZI', 'kirmizi', kayitta((o) => { grup(o, 'oncu').terfiKaynagi = null; }), 'tam bir kök'],
    ['N9 kayıtsız terfi kaynağı (hazirlik) → KIRMIZI', 'kirmizi', kayitta((o) => { grup(o, 'oncu').terfiKaynagi = 'hazirlik'; }), 'kayıtlı bir grup değil'],
    ['N10 dallanan zincir (genel ← test) → KIRMIZI', 'kirmizi', kayitta((o) => { grup(o, 'genel').terfiKaynagi = 'test'; }), 'doğrusal'],
    ['N11 kendi kendine kaynak (oncu ← oncu) → KIRMIZI', 'kirmizi', kayitta((o) => { grup(o, 'oncu').terfiKaynagi = 'oncu'; }), 'döngü'],
    ['N12 mükerrer grup kodu → KIRMIZI', 'kirmizi', kayitta((o) => { o.gruplar.push({ kod: 'test', ad: 'Test 2', terfiKaynagi: 'genel' }); }), 'mükerrer kod'],
    ['N13 ayrılmış grup kodu (ota) → KIRMIZI', 'kirmizi', kayitta((o) => { o.gruplar.push({ kod: 'ota', ad: 'OTA', terfiKaynagi: 'genel' }); }), 'ayrılmış'],
    ['N14 biçimsiz grup kodu (Test) → KIRMIZI', 'kirmizi', kayitta((o) => { grup(o, 'oncu').terfiKaynagi = 'Test'; grup(o, 'test').kod = 'Test'; }), 'biçimsiz'],
    ['N15 DONMUŞ küme: genel → herkes → KIRMIZI', 'kirmizi', kayitta((o) => { grup(o, 'genel').kod = 'herkes'; }), '§2 DONMUŞ'],
    ['N16 türetim farkı: kütüphane APK künyesini başka yola türetiyor → KIRMIZI', 'kirmizi', (d, c) => {
      c.ek.turet = (k) => { const t = turet(k); t.gruplar.test.tablet.apkKunye = t.gruplar.test.tablet.apkKunye.replace('surum.json', 'latest.json'); return t; };
    }, '§3 türetim farkı'],
    ['N17 türetim farkı: kütüphane şablonda olmayan alan üretiyor → KIRMIZI', 'kirmizi', (d, c) => {
      c.ek.turet = (k) => { const t = turet(k); t.gruplar.genel.panel.eskiFeed = 'https://guncelleme.etkiliyazilim.com/genel/electron/'; return t; };
    }, 'şablonda yok'],
    ['N18 türetim farkı: OTA takma adı gruba gömülü → KIRMIZI', 'kirmizi', (d, c) => {
      c.ek.turet = (k) => ({ ...turet(k), otaTakmaAd: 'https://indir.etkiliyazilim.com/test/mobil/ota/55.0/manifest' });
    }, 'otaTakmaAd'],
    ['N19 satıcı DOWNLOAD_PRODUCTS\'a yeni ürün (patron) → KIRMIZI', 'kirmizi', (d) => {
      d[SATICI_INDIRME_REL] = d[SATICI_INDIRME_REL].replace('["electron", "mobil", "backend"]', '["electron", "mobil", "backend", "patron"]');
    }, 'satıcıyla ayrıştı'],
    ['N20 indirme kökü eski adres (guncelleme.etkiliyazilim.com) → KIRMIZI', 'kirmizi', kayitta((o) => { o.indirmeKoku = 'https://guncelleme.etkiliyazilim.com/'; }), '§4 indirmeKoku ana makinesi'],
    ['N21 VDS kökü eski yayın ağacının altında → KIRMIZI', 'kirmizi', kayitta((o) => { o.vdsKoku = '/opt/stack/apps/tekserp-guncelleme/html/ortak'; }), '§4 vdsKoku'],
    ['N22 defter kökü web kökünün altında (herkese açık defter) → KIRMIZI', 'kirmizi', kayitta((o) => { o.defterKoku = '/opt/stack/apps/tekserp-indir/html/defter'; }), 'internetten okunur'],
    ['N23 grup kodu eski kanal kodu (oncu → demofabrika) → KIRMIZI', 'kirmizi', kayitta((o) => { grup(o, 'genel').terfiKaynagi = 'demofabrika'; grup(o, 'oncu').kod = 'demofabrika'; }), '§4 grup kodu "demofabrika"'],
    ['N24 panel appId adnansahin\'inki → KIRMIZI (yan yana kurulum üzerine yazar)', 'kirmizi', kayitta((o) => { o.urun.panel.appId = 'com.etkiliyazilim.adnan-sahin-erp'; }), '§4 urun.panel.appId'],
    ['N25 tablet paketi adnansahin\'inki → KIRMIZI', 'kirmizi', kayitta((o) => { o.urun.tablet.androidPaket = 'com.teks.erp.mobil'; }), '§4 urun.tablet.androidPaket'],
    ['N25b panel ürün adı adnansahin\'inki, yalnız harf büyüklüğü farklı → KIRMIZI (Windows kurulum dizini duyarsız)', 'kirmizi', kayitta((o) => { o.urun.panel.urunAdi = 'ADNAN ŞAHIN ERP'; }), '§4 urun.panel.urunAdi'],
    ['N26 OTA sertifikası adnansahin\'inki → KIRMIZI (eski tablet yeni OTA\'yı kabul ederdi)', 'kirmizi', kayitta((o) => { o.urun.tablet.otaSertifika = 'keystore/ota-certs/certificate.pem'; }), '§4 urun.tablet.otaSertifika'],
    ['N27 hizmet adı değişti → beyanlı istisna kullanılmıyor → KIRMIZI', 'kirmizi', kayitta((o) => { o.urun.backend.hizmetAdi = 'TeksERP-Sunucu'; }), 'kullanılmayan ayrılık istisnası'],
    ['N28 lisansSunucusu backend varsayılanından ayrıştı → KIRMIZI', 'kirmizi', kayitta((o) => { o.lisansSunucusu = 'https://lisans2.etkiliyazilim.com'; }), '§5'],
    ['N29 indirme kökü http:// → KIRMIZI', 'kirmizi', kayitta((o) => { o.indirmeKoku = 'http://indir.etkiliyazilim.com/'; }), 'indirmeKoku'],
    ['N30 beyansız tüketici (mobil/app.config.js) → KIRMIZI', 'kirmizi', (d, c) => { c.okuyanlar.push('mobil/app.config.js'); }, 'beyansız tüketici'],
    ['N31 ölü tüketici beyanı → KIRMIZI', 'kirmizi', (d, c) => { c.ek.tuketiciler = ['mobil/scripts/build-apk.mjs']; }, 'ölü tüketici'],
    ['N32 commit kancasından dağıtım adımı söküldü → KIRMIZI', 'kirmizi', (d) => { d[KAPI_KANCASI_REL] = d[KAPI_KANCASI_REL].replace('staged.some(dagitimBekcisiTetigi)', 'false'); }, 'dağıtım kaydı adımı yok'],
    ['N33 donma adımı koşula alındı (girintili) → KIRMIZI', 'kirmizi', (d) => {
      d[KAPI_KANCASI_REL] = d[KAPI_KANCASI_REL].replace(/^adimlar\.push\(\{([^\n]*"scripts\/test_eski_kanal_donuk\.mjs")/m, 'if (false) {\n  adimlar.push({$1');
    }, 'KOŞULSUZ değil'],
    ['N34 CI\'dan donma sondası adımı silindi → KIRMIZI', 'kirmizi', (d) => { d[CI_REL] = d[CI_REL].replace('node scripts/test_eski_kanal_donuk.mjs --sonda', 'true'); }, 'CI adımı yok: node scripts/test_eski_kanal_donuk.mjs --sonda'],
    ['N35 satıcı UPDATE_GROUPS sırası bozuldu (genel, oncu, test) → KIRMIZI', 'kirmizi', (d) => {
      d[SATICI_GRUPLAR_REL] = d[SATICI_GRUPLAR_REL].replace('["test", "oncu", "genel"] as const', '["genel", "oncu", "test"] as const');
    }, '§7 satıcı UPDATE_GROUPS'],
    ['N36 satıcıya kayıtta olmayan grup (pilot) → KIRMIZI', 'kirmizi', (d) => {
      d[SATICI_GRUPLAR_REL] = d[SATICI_GRUPLAR_REL].replace('["test", "oncu", "genel"] as const', '["test", "oncu", "genel", "pilot"] as const');
    }, '§7 satıcı UPDATE_GROUPS'],
    ['N37 migration satırının sırası farklı (genel 3 → 4) → KIRMIZI', 'kirmizi', (d) => {
      d[SATICI_GRUP_MIGRATION_REL] = d[SATICI_GRUP_MIGRATION_REL].replace("'genel', 'Genel', 'uretim', '{}'::jsonb, 3,", "'genel', 'Genel', 'uretim', '{}'::jsonb, 4,");
    }, "§7 grup migration'ı satırları"],
    ['N38 migration emeklileştirme kümesinden grup düştü (NOT IN test, oncu) → KIRMIZI (genel pasife düşerdi)', 'kirmizi', (d) => {
      d[SATICI_GRUP_MIGRATION_REL] = d[SATICI_GRUP_MIGRATION_REL].replace(`WHERE "kod" NOT IN ('test', 'oncu', 'genel')`, `WHERE "kod" NOT IN ('test', 'oncu')`);
    }, "§7 grup migration'ında küme"],
    ['N39 kayıtta grup kodu değişti, satıcı aynası değişmedi (genel → herkes) → KIRMIZI', 'kirmizi', kayitta((o) => { grup(o, 'genel').kod = 'herkes'; }), '§7'],
    ['N40 backend UPDATE_GROUPS\'a eski kanal (demofabrika) eklendi → KIRMIZI (pasif kanalın kirası grup sayılırdı)', 'kirmizi', (d) => {
      d[BACKEND_GRUPLAR_REL] = d[BACKEND_GRUPLAR_REL].replace('["test", "oncu", "genel"] as const', '["test", "oncu", "genel", "demofabrika"] as const');
    }, '§7 backend UPDATE_GROUPS'],
    ['N41 backend UPDATE_GROUPS\'tan grup düştü (genel) → KIRMIZI', 'kirmizi', (d) => {
      d[BACKEND_GRUPLAR_REL] = d[BACKEND_GRUPLAR_REL].replace('["test", "oncu", "genel"] as const', '["test", "oncu"] as const');
    }, '§7 backend UPDATE_GROUPS'],
    ['N42 Worker OTA takma ad öneki kayıttan ayrıştı (/guncel/) → KIRMIZI', 'kirmizi', (d) => {
      d[WORKER_REL] = d[WORKER_REL].replace('export const OTA_TAKMA_AD_ONEKI = "/ota/";', 'export const OTA_TAKMA_AD_ONEKI = "/guncel/";');
    }, '§3 Worker OTA takma ad öneki'],
    ['N43 ortak hizmet adı son ekli (TeksERP-Backend-test: kanal kimliği pakete döner) → KIRMIZI', 'kirmizi', kayitta((o) => { o.urun.backend.hizmetAdi = 'TeksERP-Backend-test'; }), '§8 urun.backend.hizmetAdi'],
    ['N44 kanal-adlari.ps1 tabanı kayıttan ayrıştı (TeksERP-Sunucu) → KIRMIZI', 'kirmizi', (d) => {
      d[KANAL_ADLARI_REL] = d[KANAL_ADLARI_REL].replace('$taban = "TeksERP-Backend"', '$taban = "TeksERP-Sunucu"');
    }, '§8 urun.backend.hizmetAdi'],
    ['O10 kanal-adlari.ps1 tabanı okunamadı → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[KANAL_ADLARI_REL] = d[KANAL_ADLARI_REL].replace('$taban = ', '$kok = '); }],
    ['O1 kayıt bozuk JSON → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[KAYIT_REL] = d[KAYIT_REL].slice(0, 40); }],
    ['O2 vendor-url.ts varsayılan sabitinin adı değişti → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[VENDOR_URL_REL] = d[VENDOR_URL_REL].replace('DEFAULT_LICENSE_SERVER_URL', 'VARSAYILAN_SATICI'); }],
    ['O3 Worker URUN_DIZINLERI adı değişti → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[WORKER_REL] = d[WORKER_REL].replace('export const URUN_DIZINLERI', 'export const DIZINLER'); }],
    ['O4 eski kanal kaydı okunamadı → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[ESKI_KAYIT_REL] = undefined; }],
    ['O5 git grep koşamadı → ÖLÇÜLEMEDİ', 'olculemedi', (d, c) => { c.okuyanlar = null; }],
    ['O6 satıcı UPDATE_GROUPS adı değişti → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[SATICI_GRUPLAR_REL] = d[SATICI_GRUPLAR_REL].replace('export const UPDATE_GROUPS', 'export const GRUPLAR'); }],
    ['O7 grup migration\'ı okunamadı → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[SATICI_GRUP_MIGRATION_REL] = undefined; }],
    ['O9 Worker OTA_TAKMA_AD_ONEKI adı değişti → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[WORKER_REL] = d[WORKER_REL].replace('export const OTA_TAKMA_AD_ONEKI', 'export const TAKMA'); }],
    ['O8 backend grup aynası okunamadı → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[BACKEND_GRUPLAR_REL] = undefined; }],
  ];

  let gecti = 0;
  const kaldi = [];
  for (const [ad, beklenen, mutasyon, iz] of S) {
    const d = { ...taban };
    const c = { okuyanlar: [...tabanOkuyanlar], ek: {} };
    mutasyon(d, c);
    const degisti = ad.startsWith('P0') || Object.keys(taban).some((k) => d[k] !== taban[k]) ||
      JSON.stringify(c.okuyanlar) !== JSON.stringify(tabanOkuyanlar) || Object.keys(c.ek).length > 0;
    const s = olc(d, c.okuyanlar, c.ek);
    const h = hukum(s);
    const ok = degisti && h === beklenen && (!iz || [...s.kirmizi, ...s.olculemedi].some((x) => x.includes(iz)));
    if (ok) gecti += 1;
    else kaldi.push(ad);
    const neden = [...s.olculemedi, ...s.kirmizi][0];
    console.log(`${ok ? '✅' : '❌'} ${ad}${degisti ? '' : ' — MUTASYON UYGULANMADI'} · hüküm ${h}${neden && beklenen !== 'yesil' ? ` · ${neden.slice(0, 140)}` : ''}`);
    if (!ok) for (const x of [...s.olculemedi, ...s.kirmizi].slice(0, 5)) console.log(`     · ${x}`);
  }
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi.length} başarısız ===`);
  return kaldi.length === 0;
}

/* ------------------------------------------------------------------ */

function main() {
  const d = dosyalariOku(OKUNAN);
  const okuyanlar = kaydiAnanDosyalar();
  if (process.argv.includes('--sonda')) {
    console.log('check-dagitim — kalıcı sondalar (bellekteki kopyalara karşı)\n');
    if (okuyanlar === null) { console.log('⛔ ÖLÇÜLEMEDİ — git grep koşamadı (sonda tabanı kurulamaz)'); process.exit(2); }
    process.exit(sondalar(d, okuyanlar) ? 0 : 1);
  }
  const s = olc(d, okuyanlar);
  console.log('check-dagitim — dağıtım kaydı (tek ortak paket)\n');
  for (const x of s.olculemedi) console.log(`⛔ ÖLÇÜLEMEDİ — ${x}`);
  for (const x of s.kirmizi) console.log(`❌ ${x}`);
  const h = hukum(s);
  if (h === 'yesil') {
    const k = JSON.parse(d[KAYIT_REL]);
    console.log(`✅ ${k.gruplar.length} grup × ${URUNLER.length} ürün türetildi · zincir ${grupZinciri(k.gruplar).zincir.join(' → ')} · eski kanaldan ayrık (${AYRILIK_ISTISNALARI.length} beyanlı istisna) · ${TUKETICILER.length} tüketici`);
    for (const x of s.bilgi) console.log(x);
    console.log('\n=== Sonuç: yeşil ===');
    process.exit(0);
  }
  console.log(`\n=== Sonuç: ${h === 'olculemedi' ? 'ÖLÇÜLEMEDİ' : 'KIRMIZI'} (${s.kirmizi.length} kırmızı, ${s.olculemedi.length} ölçülemedi) ===`);
  process.exit(h === 'olculemedi' ? 2 : 1);
}

main();
