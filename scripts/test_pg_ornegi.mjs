#!/usr/bin/env node
// =============================================================================
// BEKÇİ — KENDİ PostgreSQL ÖRNEĞİ (deploy/pg/) · zero-dep, DB'siz, ağsız
// =============================================================================
// Sürüm kaydı, örnek sözleşmesi ve iki şablon sahadaki her yeni kurulumun veritabanı
// sunucusunu belirler: bir satır gevşerse (listen '*', trust, md5, C dışı collation)
// her fabrikaya aynı açık gider. Bu bekçi hepsini TEK yüklemden (deploy/pg/lib) ölçer.
//
//   §1 sürüm kaydı iç tutarlılığı (pg-surumu.json)
//   §2 örnek sözleşmesi (pg-ornegi.json): sanal hizmet hesabı, initdb (UTF8 + C + scram +
//      checksum), roller süper değil, veri dizini ikili kökün dışında
//   §3 şablon yasakları: yalnız 127.0.0.1 · yalnız scram-sha-256 · trust/md5/replication/
//      include yok · UTC · ASCII · yer tutucu kümesi formülle birebir
//   §4 altın vektörler (bellek kâhini ilk-kurulum.ps1 · port kuralı · üretim özetleri)
//   §5 formül özellikleri (tekdüze artan · shared_buffers ≤ %40 RAM · ecs ≤ RAM)
//   §6 TEK KAYNAK: araçlar/CI kaydı yüklemden okur; sha256/url literal'i tüketicide yok
//   §7 uzantı kapsaması: migration'ların CREATE EXTENSION ettiği her uzantı kayıtta zorunlu
//   §8 ağ okuma kapısı (check-yayin-okuma) deploy/pg'yi tarıyor; açıklamadaki belge atıfları var
//
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ. Cırcır değil (taban yok).
//   node scripts/test_pg_ornegi.mjs            # dinlenme (ağsız)
//   node scripts/test_pg_ornegi.mjs --sonda    # kalıcı negatif + pozitif sondalar
//   node scripts/test_pg_ornegi.mjs --ag       # + resmî kaynak HEAD + postgresql.org yeni sürüm bildirimi
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  IZINLI_KAYNAK,
  ORNEK_REL,
  Olculemedi,
  SURUM_REL,
  VEKTOR_REL,
  bellekHesapla,
  confYasaklari,
  edbDosyaAdi,
  hbaYasaklari,
  jsonCoz,
  ornekHatalari,
  portSec,
  sha256,
  surumKaydiHatalari,
  yapilandirmaUret,
  yerTutuculari,
} from '../deploy/pg/lib/pg-ornegi.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRASYON_KOKU = 'Teks-Erp/prisma/migrations';
const YAYIN_OKUMA_KAPISI = 'scripts/check-yayin-okuma.mjs';
const TASARIM = 'docs/design/KENDI-POSTGRESQL.md';

// Kaydı/sözleşmeyi OKUYAN taraflar + okuduğunu gösteren iz.
const TUKETICILER = {
  'deploy/pg/pg-ikili-dogrula.mjs': { iz: /from '\.\/lib\/pg-ornegi\.mjs'/, ne: 'ikili doğrulayıcı/indirici', kod: true },
  'deploy/pg/pg-sablon.mjs': { iz: /from '\.\/lib\/pg-ornegi\.mjs'/, ne: 'şablon üretici/denetleyici', kod: true },
  '.github/workflows/pg-ikili.yml': { iz: /node deploy\/pg\/pg-ikili-dogrula\.mjs --indir/, ne: 'CI ikili doğrulama iş akışı' },
  '.github/workflows/ci.yml': { iz: /node scripts\/test_pg_ornegi\.mjs/, ne: 'CI doküman işi (bu bekçi)' },
};

function okuyabilir(rel) {
  try {
    return fs.readFileSync(path.join(KOK, rel), 'utf8');
  } catch {
    return undefined;
  }
}

/** Bekçinin okuduğu her dosya: göreli yol → içerik (yoksa undefined). */
function dosyalariOku() {
  const d = {};
  for (const rel of [SURUM_REL, ORNEK_REL, VEKTOR_REL, YAYIN_OKUMA_KAPISI, ...Object.keys(TUKETICILER)]) d[rel] = okuyabilir(rel);
  try {
    const ornek = JSON.parse(d[ORNEK_REL]);
    for (const rel of [ornek.yapilandirma.confSablonu, ornek.yapilandirma.hbaSablonu]) d[rel] = okuyabilir(rel);
  } catch {
    /* sözleşme okunamazsa olc() ÖLÇÜLEMEDİ der */
  }
  let dizinler = [];
  try {
    dizinler = fs.readdirSync(path.join(KOK, MIGRASYON_KOKU), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    /* migration kökü yoksa §7 ÖLÇÜLEMEDİ */
  }
  for (const ad of dizinler) {
    const rel = `${MIGRASYON_KOKU}/${ad}/migration.sql`;
    const m = okuyabilir(rel);
    if (m !== undefined) d[rel] = m;
  }
  return d;
}

const sqlYorumsuz = (s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const kodYorumsuz = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** "mesgul": "aralik" = sözleşmedeki port aralığının tamamı (aralık değişse de anlamı sabit). */
function portGirdisi(g, aralik) {
  const mesgul = g.mesgul === 'aralik' ? Array.from({ length: aralik.bitis - aralik.baslangic + 1 }, (_, i) => aralik.baslangic + i) : g.mesgul;
  return { mesgul, onceki: g.onceki ?? null, istenen: g.istenen ?? null };
}

/** Bütün ölçüm. d: göreli yol → içerik. */
function olc(d) {
  const kirmizi = [];
  const olculemedi = [];
  const bilgi = [];
  const k = (bolum, x) => kirmizi.push(`${bolum} ${x}`);

  const oku = (rel) => {
    if (typeof d[rel] !== 'string') throw new Olculemedi(`${rel} okunamadı`);
    return jsonCoz(d[rel], rel);
  };
  let kayit;
  let ornek;
  let vektor;
  let confSablon;
  let hbaSablon;
  try {
    kayit = oku(SURUM_REL);
    ornek = oku(ORNEK_REL);
    vektor = oku(VEKTOR_REL);
    confSablon = d[ornek?.yapilandirma?.confSablonu];
    hbaSablon = d[ornek?.yapilandirma?.hbaSablonu];
    if (typeof confSablon !== 'string') throw new Olculemedi(`conf şablonu okunamadı (${ornek?.yapilandirma?.confSablonu})`);
    if (typeof hbaSablon !== 'string') throw new Olculemedi(`hba şablonu okunamadı (${ornek?.yapilandirma?.hbaSablonu})`);
  } catch (e) {
    olculemedi.push(e instanceof Olculemedi ? e.message : String(e.message));
    return { kirmizi, olculemedi, bilgi, kayit: null };
  }

  // §1 — sürüm kaydı
  for (const x of surumKaydiHatalari(kayit)) k('§1', x);

  // §2 — örnek sözleşmesi
  const sozlesmeHatalari = ornekHatalari(ornek);
  for (const x of sozlesmeHatalari) k('§2', x);

  // §3 — şablon yasakları + yer tutucu kümesi formülle birebir
  for (const x of confYasaklari(confSablon, { sablon: true })) k('§3', x);
  for (const x of hbaYasaklari(hbaSablon)) k('§3', x);
  const bellekAdlari = Object.keys(ornek.yapilandirma?.bellek ?? {});
  const beklenenYer = ['PORT', ...bellekAdlari].sort();
  const confYer = yerTutuculari(confSablon).sort();
  if (confYer.join() !== beklenenYer.join()) k('§3', `conf şablonu yer tutucuları [${confYer}] — beklenen [${beklenenYer}] (PORT + bellek formülü)`);
  if (yerTutuculari(hbaSablon).length) k('§3', 'hba şablonu yer tutucu taşıyor (hba sabittir)');
  for (const [ad, f] of Object.entries(ornek.yapilandirma?.bellek ?? {})) {
    if (!new RegExp(`^${f.ayar}\\s*=\\s*\\{\\{${ad}\\}\\}\\s*$`, 'm').test(confSablon)) k('§3', `conf şablonunda "${f.ayar} = {{${ad}}}" satırı yok (formül ile ayar adı ayrıştı)`);
  }

  // §4 — altın vektörler (sözleşme bozuksa formül çağrılmaz: hatası §2'de)
  if (!sozlesmeHatalari.length) {
    for (const v of vektor.bellek ?? []) {
      let gercek;
      try {
        gercek = bellekHesapla(v.ramMB, ornek.yapilandirma.bellek);
      } catch (e) {
        k('§4', `bellek ${v.ramMB} MB: ${e.message}`);
        continue;
      }
      for (const [ad, deger] of Object.entries(v.beklenen)) {
        if (gercek[ad] !== deger) k('§4', `bellek ${v.ramMB} MB ${ad} = ${gercek[ad]} — kâhin (ilk-kurulum.ps1) ${deger}`);
      }
    }
    for (const v of vektor.port ?? []) {
      const r = portSec({ ...portGirdisi(v.girdi, ornek.port), aralik: ornek.port });
      if (v.beklenen.hata ? !r.hata : r.port !== v.beklenen.port) k('§4', `port "${v.ad}": ${r.hata ?? r.port} — beklenen ${v.beklenen.hata ? 'HATA' : v.beklenen.port}`);
    }
    for (const v of vektor.uretim ?? []) {
      let c;
      try {
        c = yapilandirmaUret({ ramMB: v.ramMB, port: v.port }, { ornek, confSablon, hbaSablon });
      } catch (e) {
        k('§4', `üretim ${v.ramMB} MB/${v.port}: ${e.message}`);
        continue;
      }
      for (const x of confYasaklari(c.conf, { sablon: false })) k('§4', `üretilmiş tekserp.conf (${v.ramMB} MB): ${x}`);
      for (const x of hbaYasaklari(c.hba)) k('§4', `üretilmiş pg_hba.conf: ${x}`);
      const cs = sha256(c.conf);
      const hs = sha256(c.hba);
      if (cs !== v.confSha256) k('§4', `üretim ${v.ramMB} MB/${v.port} tekserp.conf özeti ${cs} — vektör ${v.confSha256.slice(0, 16)}… (şablon değiştiyse vektörü BİLEREK güncelle)`);
      if (hs !== v.hbaSha256) k('§4', `üretim pg_hba.conf özeti ${hs} — vektör ${v.hbaSha256.slice(0, 16)}…`);
    }
    if (!(vektor.bellek?.length && vektor.port?.length && vektor.uretim?.length)) k('§4', 'vektör kümelerinden biri boş (bellek/port/üretim) — boş küme yeşil sayılmaz');

    // §5 — formül özellikleri
    const adlar = Object.keys(ornek.yapilandirma.bellek);
    const mb = (s) => (s.endsWith('GB') ? parseInt(s, 10) * 1024 : parseInt(s, 10));
    let onceki = null;
    for (let ram = 512; ram <= 262144; ram = Math.floor(ram * 1.5)) {
      const b = bellekHesapla(ram, ornek.yapilandirma.bellek);
      for (const ad of adlar) if (onceki && mb(b[ad]) < mb(onceki[ad])) k('§5', `${ad} RAM ${ram} MB'de azaldı (tekdüze değil)`);
      if (ram >= 1024 && b.SHARED_BUFFERS && mb(b.SHARED_BUFFERS) > ram * 0.4) k('§5', `shared_buffers ${b.SHARED_BUFFERS} RAM ${ram} MB'nin %40'ını aşıyor`);
      if (b.EFFECTIVE_CACHE_SIZE && mb(b.EFFECTIVE_CACHE_SIZE) > ram && ram >= 1024) k('§5', `effective_cache_size ${b.EFFECTIVE_CACHE_SIZE} RAM ${ram} MB'yi aşıyor`);
      onceki = b;
    }
  }

  // §6 — TEK KAYNAK
  const b = kayit?.yayin?.['win-x64'] ?? {};
  for (const [rel, t] of Object.entries(TUKETICILER)) {
    const m = d[rel];
    if (typeof m !== 'string') {
      olculemedi.push(`§6 ${rel} okunamadı (${t.ne})`);
      continue;
    }
    if (!t.iz.test(m)) k('§6', `${rel} kaydı yüklemden okumuyor (${t.ne}) — iz bulunamadı`);
    for (const [ad, lit] of [['sha256', b.sha256], ['url', b.url], ['sahne özeti', kayit?.sahne?.icerikSha256]]) {
      if (typeof lit === 'string' && lit.length > 20 && m.includes(lit)) k('§6', `${rel} (${t.ne}) ${ad} literal'ini gömüyor — yalnız ${SURUM_REL}'da yaşar`);
    }
    if (t.kod && typeof kayit?.surum === 'string' && new RegExp(`(^|[^\\d.])${kayit.surum.replace('.', '\\.')}(?![\\d])`).test(kodYorumsuz(m))) {
      k('§6', `${rel} sürüm "${kayit.surum}" literal'ini KOD gövdesinde taşıyor — kayıttan oku`);
    }
  }
  const tasarim = okuyabilir(TASARIM);
  if (typeof tasarim === 'string' && typeof b.sha256 === 'string' && tasarim.includes(b.sha256)) k('§6', `${TASARIM} zip sha256'sını tekrarlıyor — belge kayda atıf yapar, kopyalamaz`);

  // §7 — uzantı kapsaması
  const migrasyonlar = Object.keys(d).filter((r) => r.startsWith(`${MIGRASYON_KOKU}/`));
  if (migrasyonlar.length < 50) olculemedi.push(`§7 yalnız ${migrasyonlar.length} migration okundu (taban 50) — kapsam ölçülemedi`);
  else {
    const uzantilar = new Map();
    for (const rel of migrasyonlar) {
      for (const m of sqlYorumsuz(d[rel]).matchAll(/CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_-]+)"?/gi)) uzantilar.set(m[1].toLowerCase(), rel);
    }
    const zorunlu = new Set((kayit?.zorunlu?.uzantilar ?? []).map((u) => u.toLowerCase()));
    for (const [u, rel] of uzantilar) if (!zorunlu.has(u)) k('§7', `migration "${u}" uzantısını kuruyor (${rel}) ama ${SURUM_REL} zorunlu.uzantilar'da yok — kendi örneğin ikilisi onu taşımayabilir`);
    bilgi.push(`migration uzantıları: ${[...uzantilar.keys()].join(', ') || '(yok)'} · ${migrasyonlar.length} migration tarandı`);
  }

  // §8 — ağ okuma kapısı deploy/pg'yi tarıyor + açıklamadaki belge atıfları var
  const kapi = d[YAYIN_OKUMA_KAPISI];
  if (typeof kapi !== 'string') olculemedi.push(`§8 ${YAYIN_OKUMA_KAPISI} okunamadı`);
  else if (!/\{ dizin: 'deploy\/pg',/.test(kapi)) k('§8', `${YAYIN_OKUMA_KAPISI} KAPSAM deploy/pg'yi taramıyor — indiricinin fetch'i denetimsiz kalır`);
  for (const json of [kayit, ornek, vektor]) {
    for (const satir of json?._aciklama ?? []) {
      for (const m of satir.matchAll(/docs\/[A-Za-z0-9_./-]+\.md/g)) if (!fs.existsSync(path.join(KOK, m[0]))) k('§8', `açıklama ölü belgeye atıf yapıyor: ${m[0]}`);
    }
  }

  return { kirmizi, olculemedi, bilgi, kayit, ornek };
}

const hukum = (s) => (s.olculemedi.length ? 'olculemedi' : s.kirmizi.length ? 'kirmizi' : 'yesil');

/* ------------------------------------------------------------------ *
 * --ag: resmî kaynak yoklaması (ağır indirme YOK; tam doğrulama pg-ikili-dogrula --indir)
 * ------------------------------------------------------------------ */

/** Ağ hatası tek seferlik olabilir: bir kez yeniden dener; yine düşerse ÖLÇÜLEMEDİ (kırmızı değil). */
async function yokla(url, secenek) {
  try {
    return await fetch(url, secenek);
  } catch {
    await new Promise((r) => setTimeout(r, 2000));
    return fetch(url, secenek);
  }
}

async function agDogrula(kayit) {
  const satirlar = [];
  let durum = 'yesil';
  const b = kayit.yayin['win-x64'];
  try {
    const r = await yokla(b.url, { method: 'HEAD', redirect: 'follow' });
    const uzunluk = Number(r.headers.get('content-length'));
    if (!r.ok) {
      satirlar.push(`❌ ${b.url} HTTP ${r.status}`);
      durum = 'kirmizi';
    } else if (uzunluk !== b.boyut) {
      satirlar.push(`❌ boyut ${uzunluk} — kayıt ${b.boyut} (kaynak değişti; pg-ikili-dogrula --indir ile ölç)`);
      durum = 'kirmizi';
    } else satirlar.push(`✅ resmî kaynak erişilebilir, boyut kayıtla eşit (${uzunluk})`);
    const lm = r.headers.get('last-modified');
    if (lm && lm !== b.olcum.lastModified) satirlar.push(`⚠️ last-modified "${lm}" — kayıt "${b.olcum.lastModified}" (içerik değişmiş olabilir; tam doğrulama: pg-ikili-dogrula --indir)`);
    const sonraki = await yokla(`${IZINLI_KAYNAK}${edbDosyaAdi(kayit.surum, String(Number(kayit.derleme) + 1))}`, { method: 'HEAD' });
    if (sonraki.ok) satirlar.push(`⚠️ aynı sürümün yeni EDB derlemesi var: -${Number(kayit.derleme) + 1} (sabitleme kararı — sürüm yükseltme reçetesi)`);
  } catch (e) {
    satirlar.push(`⛔ EDB yoklanamadı (iki deneme): ${e.message}${e.cause?.code ? ` [${e.cause.code}]` : ''}`);
    durum = 'olculemedi';
  }
  try {
    const surumler = await (await yokla('https://www.postgresql.org/versions.json')).json();
    const c = surumler.find((x) => String(x.major) === kayit.cizgi);
    if (!c) satirlar.push(`⚠️ postgresql.org ${kayit.cizgi} çizgisini listelemiyor`);
    else if (`${c.major}.${c.latestMinor}` !== kayit.surum) satirlar.push(`⚠️ yeni küçük sürüm var: ${c.major}.${c.latestMinor} (${c.relDate}) — kayıt ${kayit.surum}; güvenlik düzeltmeleri için yükseltme KARARI`);
    else satirlar.push(`✅ ${kayit.surum} çizginin en güncel küçük sürümü (destek sonu ${c.eolDate})`);
  } catch (e) {
    satirlar.push(`⚠️ postgresql.org sürüm listesi okunamadı: ${e.message}`);
  }
  return { durum, satirlar };
}

/* ------------------------------------------------------------------ *
 * Kalıcı sondalar — bellekteki kopyalara karşı
 * ------------------------------------------------------------------ */

function sondalar(taban) {
  const json = (rel, fn) => (d) => {
    const o = JSON.parse(d[rel]);
    fn(o);
    d[rel] = `${JSON.stringify(o, null, 2)}\n`;
  };
  const kayitta = (fn) => json(SURUM_REL, fn);
  const ornekte = (fn) => json(ORNEK_REL, fn);
  const vektorde = (fn) => json(VEKTOR_REL, fn);
  const ornek = JSON.parse(taban[ORNEK_REL]);
  const CONF = ornek.yapilandirma.confSablonu;
  const HBA = ornek.yapilandirma.hbaSablonu;
  const metinde = (rel, eski, yeni) => (d) => {
    d[rel] = d[rel].replace(eski, yeni);
  };
  const HBA_SATIRI = 'host    all       all   127.0.0.1/32   scram-sha-256';
  const initdbDegistir = (eski, yeni) => ornekte((o) => {
    o.initdb.argumanlar = o.initdb.argumanlar.map((a) => (a === eski ? yeni : a)).filter((a) => a !== null);
  });
  const S = [
    ['P0 gerçek ağaç YEŞİL', 'yesil', () => {}],
    ['P1 sürüm + derleme + dosya + url birlikte yükseltildi YEŞİL', 'yesil', kayitta((o) => {
      o.surum = '16.16';
      o.derleme = '1';
      o.yayin['win-x64'].dosya = edbDosyaAdi('16.16', '1');
      o.yayin['win-x64'].url = `${IZINLI_KAYNAK}${o.yayin['win-x64'].dosya}`;
      o.yayin['win-x64'].sha256 = 'b'.repeat(64);
    })],
    ['P2 port aralığı genişledi YEŞİL', 'yesil', ornekte((o) => { o.port.bitis = 5599; })],
    ['N1 sha256 63 hane → KIRMIZI (§1)', 'kirmizi', kayitta((o) => { o.yayin['win-x64'].sha256 = 'a'.repeat(63); }), '§1'],
    ['N2 url http:// (düz) → KIRMIZI (§1)', 'kirmizi', kayitta((o) => { o.yayin['win-x64'].url = o.yayin['win-x64'].url.replace('https://', 'http://'); }), '§1'],
    ['N3 url başka host → KIRMIZI (§1)', 'kirmizi', kayitta((o) => { o.yayin['win-x64'].url = `https://ornek.example/${o.yayin['win-x64'].dosya}`; }), '§1'],
    ['N4 derleme değişti, dosya değişmedi → KIRMIZI (§1)', 'kirmizi', kayitta((o) => { o.derleme = '5'; }), '§1'],
    ['N5 çizgi ana sürümle uyuşmuyor → KIRMIZI (§1)', 'kirmizi', kayitta((o) => { o.cizgi = '17'; }), '§1'],
    ['N6 imza "bilinmiyor" (ölçülmemiş) → KIRMIZI (§1)', 'kirmizi', kayitta((o) => { o.yayin['win-x64'].imza = 'bilinmiyor'; }), '§1'],
    ['N7 zorunlu.icu false → KIRMIZI (§1)', 'kirmizi', kayitta((o) => { o.zorunlu.icu = false; }), '§1'],
    ['N8 initdb --locale=tr_TR.UTF-8 → KIRMIZI (§2)', 'kirmizi', initdbDegistir('--locale=C', '--locale=tr_TR.UTF-8'), '§2'],
    ['N9 initdb --auth=trust → KIRMIZI (§2)', 'kirmizi', initdbDegistir('--auth=scram-sha-256', '--auth=trust'), '§2'],
    ['N10 initdb --data-checksums düştü → KIRMIZI (§2)', 'kirmizi', initdbDegistir('--data-checksums', null), '§2'],
    ['N11 hizmet hesabı LocalSystem → KIRMIZI (§2)', 'kirmizi', ornekte((o) => { o.hizmet.hesap = 'LocalSystem'; }), '§2'],
    ['N12 uygulama rolü SUPERUSER → KIRMIZI (§2)', 'kirmizi', ornekte((o) => { o.roller.uygulama.ozellik = 'LOGIN SUPERUSER'; }), '§2'],
    ['N13 veri dizini ikili kökün altında → KIRMIZI (§2)', 'kirmizi', ornekte((o) => { o.dizinler.veri = 'pgsql\\veri'; }), '§2'],
    ["N14 listen_addresses = '*' → KIRMIZI (§3)", 'kirmizi', metinde(CONF, "listen_addresses = '127.0.0.1'", "listen_addresses = '*'"), '§3'],
    ["N15 listen_addresses = '0.0.0.0' → KIRMIZI (§3)", 'kirmizi', metinde(CONF, "listen_addresses = '127.0.0.1'", "listen_addresses = '0.0.0.0'"), '§3'],
    ['N16 listen_addresses LAN adresi ekledi → KIRMIZI (§3)', 'kirmizi', metinde(CONF, "listen_addresses = '127.0.0.1'", "listen_addresses = '127.0.0.1,192.168.1.250'"), '§3'],
    ['N17 password_encryption = md5 → KIRMIZI (§3)', 'kirmizi', metinde(CONF, "password_encryption = 'scram-sha-256'", "password_encryption = 'md5'"), '§3'],
    ['N18 timezone Europe/Istanbul (profil değeri sunucuya) → KIRMIZI (§3)', 'kirmizi', metinde(CONF, "timezone = 'UTC'\n", "timezone = 'Europe/Istanbul'\n"), '§3'],
    ['N19 hba_file yönlendirmesi → KIRMIZI (§3)', 'kirmizi', (d) => { d[CONF] += "hba_file = 'C:/baska/pg_hba.conf'\n"; }, '§3'],
    ["N20 include_dir 'conf.d' → KIRMIZI (§3)", 'kirmizi', (d) => { d[CONF] += "include_dir 'conf.d'\n"; }, '§3'],
    ['N21 conf şablonunda ASCII dışı harf → KIRMIZI (§3)', 'kirmizi', metinde(CONF, '# --- Baglanti', '# --- Bağlantı'), '§3'],
    ['N22 hba trust → KIRMIZI (§3)', 'kirmizi', metinde(HBA, HBA_SATIRI, 'host    all       all   127.0.0.1/32   trust'), '§3'],
    ['N23 hba 0.0.0.0/0 → KIRMIZI (§3)', 'kirmizi', metinde(HBA, HBA_SATIRI, 'host    all       all   0.0.0.0/0   scram-sha-256'), '§3'],
    ['N24 hba md5 → KIRMIZI (§3)', 'kirmizi', metinde(HBA, HBA_SATIRI, 'host    all       all   127.0.0.1/32   md5'), '§3'],
    ['N25 hba replication satırı → KIRMIZI (§3)', 'kirmizi', (d) => { d[HBA] += 'host    replication all 127.0.0.1/32 scram-sha-256\n'; }, '§3'],
    ['N26 hba local (Unix soketi) satırı → KIRMIZI (§3)', 'kirmizi', (d) => { d[HBA] += 'local   all       all                  scram-sha-256\n'; }, '§3'],
    ['N27 hba include satırı → KIRMIZI (§3)', 'kirmizi', (d) => { d[HBA] += 'include ek-kurallar.conf\n'; }, '§3'],
    ['N28 hba boş (her bağlantı reddedilir) → KIRMIZI (§3)', 'kirmizi', metinde(HBA, HBA_SATIRI, '# (bos)'), '§3'],
    ['N29 bellek yüzdesi değişti, kâhin değişmedi → KIRMIZI (§4)', 'kirmizi', ornekte((o) => { o.yapilandirma.bellek.SHARED_BUFFERS.yuzde = 30; }), '§4'],
    ['N30 şablona bilinmeyen yer tutucu → KIRMIZI (§3)', 'kirmizi', (d) => { d[CONF] += 'work_mem = {{BILINMEYEN}}\n'; }, '§3'],
    ['N31 şablon sessizce değişti (work_mem 32MB), vektör değişmedi → KIRMIZI (§4)', 'kirmizi', metinde(CONF, 'work_mem = 16MB', 'work_mem = 32MB'), '§4'],
    ['N32 port vektörü yanlış beklenti → KIRMIZI (§4)', 'kirmizi', vektorde((o) => { o.port[1].beklenen.port = 5434; }), '§4'],
    ['N33 migration pgcrypto kuruyor, kayıtta yok → KIRMIZI (§7)', 'kirmizi', (d) => {
      const rel = Object.keys(d).filter((r) => r.startsWith(`${MIGRASYON_KOKU}/`)).sort().pop();
      d[rel] += '\nCREATE EXTENSION IF NOT EXISTS pgcrypto;\n';
    }, '§7'],
    ['N34 ağ okuma kapısı deploy/pg\'yi taramıyor → KIRMIZI (§8)', 'kirmizi', (d) => { d[YAYIN_OKUMA_KAPISI] = d[YAYIN_OKUMA_KAPISI].replace("{ dizin: 'deploy/pg',", "{ dizin: 'deploy/yok',"); }, '§8'],
    ['N35 indirici sha256 literal gömdü → KIRMIZI (§6)', 'kirmizi', (d) => {
      const sha = JSON.parse(d[SURUM_REL]).yayin['win-x64'].sha256;
      d['deploy/pg/pg-ikili-dogrula.mjs'] += `\nconst YEDEK_OZET = '${sha}';\n`;
    }, '§6'],
    ['N36 CI iş akışı doğrulayıcıyı çağırmıyor → KIRMIZI (§6)', 'kirmizi', (d) => { d['.github/workflows/pg-ikili.yml'] = d['.github/workflows/pg-ikili.yml'].replace(/node deploy\/pg\/pg-ikili-dogrula\.mjs --indir/g, 'echo atlandi'); }, '§6'],
    ['N37 ci.yml bekçi adımı kalktı → KIRMIZI (§6)', 'kirmizi', (d) => { d['.github/workflows/ci.yml'] = d['.github/workflows/ci.yml'].replace(/node scripts\/test_pg_ornegi\.mjs/g, 'true'); }, '§6'],
    ['N38 şablon sürüm literal\'i koda girdi → KIRMIZI (§6)', 'kirmizi', (d) => { d['deploy/pg/pg-sablon.mjs'] += `\nconst SURUM = '${JSON.parse(d[SURUM_REL]).surum}';\n`; }, '§6'],
    ['O1 kayıt bozuk JSON → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[SURUM_REL] = d[SURUM_REL].slice(0, 40); }],
    ['O2 hba şablonu okunamadı → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[HBA] = undefined; }],
    ['O3 migration kökü boş → ÖLÇÜLEMEDİ (§7)', 'olculemedi', (d) => { for (const r of Object.keys(d)) if (r.startsWith(`${MIGRASYON_KOKU}/`)) delete d[r]; }, '§7'],
  ];

  let gecti = 0;
  const kaldi = [];
  for (const [ad, beklenen, mutasyon, iz] of S) {
    const d = { ...taban };
    try {
      mutasyon(d);
    } catch (e) {
      kaldi.push(ad);
      console.log(`❌ ${ad} — MUTASYON UYGULANAMADI: ${e.message}`);
      continue;
    }
    const degisti = ad.startsWith('P0') || Object.keys({ ...taban, ...d }).some((x) => d[x] !== taban[x]);
    const s = olc(d);
    const h = hukum(s);
    const ok = degisti && h === beklenen && (!iz || [...s.kirmizi, ...s.olculemedi].some((x) => x.includes(iz)));
    if (ok) gecti += 1;
    else kaldi.push(ad);
    const neden = [...s.olculemedi, ...s.kirmizi][0];
    console.log(`${ok ? '✅' : '❌'} ${ad}${degisti ? '' : ' — MUTASYON UYGULANMADI'} · hüküm ${h}${neden && beklenen !== 'yesil' ? ` · ${neden.slice(0, 120)}` : ''}`);
    if (!ok && h !== beklenen) for (const x of [...s.olculemedi, ...s.kirmizi].slice(0, 4)) console.log(`     · ${x}`);
  }
  const negatif = S.filter(([ad]) => ad.startsWith('N')).length;
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi.length} başarısız (negatif ${negatif}, ölçülemedi ${S.length - negatif - 3}, pozitif 3) ===`);
  return kaldi.length === 0;
}

/* ------------------------------------------------------------------ */

async function main() {
  const d = dosyalariOku();

  if (process.argv.includes('--sonda')) {
    console.log('test_pg_ornegi — kalıcı sondalar (bellekteki kopyalara karşı)\n');
    process.exit(sondalar(d) ? 0 : 1);
  }

  const s = olc(d);
  console.log('test_pg_ornegi — kendi PostgreSQL örneği (deploy/pg/)\n');
  for (const x of s.bilgi) console.log(`ℹ️  ${x}`);
  for (const x of s.olculemedi) console.log(`⛔ ÖLÇÜLEMEDİ — ${x}`);
  for (const x of s.kirmizi) console.log(`❌ ${x}`);

  if (process.argv.includes('--ag') && s.kayit) {
    console.log('\n--ag: resmî kaynak yoklaması (tam SHA256 doğrulaması: node deploy/pg/pg-ikili-dogrula.mjs --indir)');
    const a = await agDogrula(s.kayit);
    for (const x of a.satirlar) console.log(`  ${x}`);
    if (a.durum !== 'yesil') {
      console.log(`\n=== Sonuç: ${a.durum === 'kirmizi' ? 'KIRMIZI' : 'ÖLÇÜLEMEDİ'} (resmî kaynak) ===`);
      process.exit(a.durum === 'kirmizi' ? 1 : 2);
    }
  }

  const h = hukum(s);
  if (h === 'yesil') {
    const k = s.kayit;
    console.log(`✅ PostgreSQL ${k.surum}-${k.derleme} (ICU ${k.yayin['win-x64'].icuSurum}, imza ${k.yayin['win-x64'].imza}) · hizmet ${s.ornek.hizmet.ad} (${s.ornek.hizmet.hesap}) · port ${s.ornek.port.baslangic}..${s.ornek.port.bitis} · initdb UTF8/C/scram/checksum · şablonlar: yalnız 127.0.0.1 + scram, trust yok, UTC`);
    console.log('\n=== Sonuç: yeşil ===');
    process.exit(0);
  }
  console.log(`\n=== Sonuç: ${h === 'olculemedi' ? 'ÖLÇÜLEMEDİ' : 'KIRMIZI'} (${s.kirmizi.length} kırmızı, ${s.olculemedi.length} ölçülemedi) ===`);
  process.exit(h === 'olculemedi' ? 2 : 1);
}

main().catch((e) => {
  console.error(`⛔ BEKLENMEYEN: ${e && e.stack ? e.stack : e}`);
  process.exit(2);
});
