#!/usr/bin/env node
// =============================================================================
// BEKÇİ — ESKİ KANAL KAYDI BAYT-DONUK (tek ortak paket S4 / §8.1) · zero-dep, DB'siz, ağsız
// =============================================================================
// `deploy/kanallar.json` adnansahin'in dondurulmuş kanalını taşır; tek ortak paket işi onu ne düzeltir
// ne siler. Bu bekçi dosyanın baytlarını sabit sha256 + boyuta karşı ölçer:
//   §1 çalışma ağacındaki dosya        (CI'da commit'in kendisi)
//   §2 git INDEX'indeki dosya          (commit kapısında commit edilecek olan; silme/izlemeden çıkarma da değişimdir)
//   §3 pin'in kendi doğrulaması: pin, çapa commit'indeki dosyanın özetine ve tasarım belgesindeki
//      kısaltmaya eşit — dosya ile pin aynı commit'te birlikte "güncellenirse" de kırmızı.
//      Çapa commit'i sığ klonda yoksa §3a ⏭ beyanla atlanır (belge kolu yine ölçer).
//   §4 OKUYUCU İZİN LİSTESİ (O15): kaydı adıyla anan ya da `ESKI_KAYIT_REL` ile okuyan her kod dosyası
//      (`.md` ve `docs/` dışı, git grep) aşağıdaki listede GEREKÇESİYLE beyanlıdır. İki yönlü: beyansız yeni
//      okuyucu KIRMIZI (eski yol geri sızmasın), artık okumayan beyan KIRMIZI (liste yalnız küçülür).
//
// ÜÇ SONUÇ: 0 yeşil · 1 KIRMIZI (bayt değişti / silindi) · 2 ÖLÇÜLEMEDİ (okunamadı, git yok).
//   node scripts/test_eski_kanal_donuk.mjs          # dinlenme durumu
//   node scripts/test_eski_kanal_donuk.mjs --sonda  # kalıcı negatif + pozitif sondalar
// =============================================================================

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ESKI_KAYIT_REL, KOK } from './lib/dagitim.mjs';

/** 2026-10-06 ölçüldü (TEK-ORTAK-PAKET.md S4). Değiştirmek bir KULLANICI kararıdır, bekçi düzeltmesi değil. */
const PIN = Object.freeze({ sha256: '9fbdd74874492d058e8f3d61914727ef7d02424a93800e90b47e05fbbc6b9027', boyut: 9512 });
/** Pin'in ölçüldüğü commit (`origin/main`, 2026-10-06). */
const CAPA_COMMIT = '2d5aeccd6261456a3f958e8f3dd81db5781445ba';
const BELGE_REL = 'docs/design/TEK-ORTAK-PAKET.md';

/**
 * §4 — eski kanal kaydını okuyan/anan kod dosyaları. Yeni satır eklemek bir KARARDIR (gerekçe yazılır); eski
 * yayın yolu emeklidir (eski-kanal-son etiketi, docs/ops/ESKI-KANAL-ACIL.md) ve kayda yeni okuyucu gerekmez.
 */
const OKUYUCU_IZINLI = Object.freeze({
  'scripts/lib/dagitim.mjs': 'okur · ESKI_KAYIT_REL tek tanımı (ayrılık denetiminin kaynağı)',
  'scripts/check-dagitim.mjs': 'okur · §4 ayrılık: dağıtım kaydı eski kanalın hiçbir kimliğini paylaşmaz',
  'scripts/lib/grup-yayin.mjs': 'okur · eski kanal kodu grup adı olarak REDDEDİLİR',
  'scripts/lib/panel-kimlik.mjs': 'okur · karışık kimlik: ortak panel paketi eski kanal kimliği taşımaz',
  'scripts/panel-kimlik-kapisi.mjs': 'okur · aynı karışık kimlik kapısının CLI\'si',
  'scripts/test_panel_kimlik.mjs': 'okur · panel kimlik bekçisi (+ N9 sondası metni)',
  'Electron/src/test/update-feed-url.test.ts': 'okur · ortak panel adnansahin paneliyle çakışmaz (ayrılık)',
  'Teks-Erp/scripts/test_musteri_adi_kodda_yok.ts': 'okur · müşteri adı bekçisinin ad listesi',
  'scripts/test_backend_yayin.mjs': 'okur · geçici ağaca kopyalar (grup-yayin eski kod reddi için)',
  'scripts/test_grup_yayin_kapisi.mjs': 'okur · geçici ağaca kopyalar (aynı neden)',
  'scripts/test_tablet_ortak_paket.mjs': 'okur · geçici ağaca kopyalar (aynı neden)',
  'scripts/test_kurulum_arsivi.mjs': 'anar · ortak arşiv gölgesinde YOKLUĞU ölçülür',
  'deploy/satici/uretim-toren.mjs': 'okur · CF Worker İNDİRME satırı kanal kümesi — O14c\'ye kadar beyanlı',
  'satici/sunucu/scripts/test_uretim_toren.ts': 'okur · üretim töreni bekçisi — O14c\'ye kadar beyanlı',
  'deploy/gecis/gecis.ps1': 'anar · geçiş betiği mesajı — K-13 DOKUNULMAZ',
  'deploy/dagitim.json': 'anar · açıklama: eski kayıt bayt-donuk, adres/kimlik paylaşılmaz',
  'Teks-Erp/scripts/test_env_not_tracked.ts': 'anar · izlenen .env gerekçe metni',
  'satici/sunucu/prisma/schema.prisma': 'anar · kanal türü enum sözlüğü yorumu',
  'scripts/hooks/hizli-mandallar.mjs': 'anar · ad bekçisinin açıklaması',
});
const OKUYUCU_DESENI = 'kanallar\\.json|ESKI_KAYIT_REL';

const ozet = (b) => createHash('sha256').update(b).digest('hex');
const kisaltma = (sha) => `${sha.slice(0, 8)}…${sha.slice(-6)}`;

/** Okuma sonucu: Buffer · { yok: true } · { hata: metin }. */
function agacOku() {
  try {
    return fs.readFileSync(path.join(KOK, ESKI_KAYIT_REL));
  } catch (e) {
    return e.code === 'ENOENT' ? { yok: true } : { hata: `${e.code ?? e.message}` };
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: KOK, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
}

function indeksOku() {
  try {
    git(['rev-parse', '--git-dir']);
  } catch {
    return { hata: 'git deposu değil / git yok' };
  }
  try {
    if (!git(['ls-files', '--', ESKI_KAYIT_REL]).toString().trim()) return { yok: true };
    return git(['show', `:${ESKI_KAYIT_REL}`]);
  } catch (e) {
    return { hata: String(e.stderr ?? e.message).trim().split('\n')[0] };
  }
}

function capaOku() {
  try {
    git(['cat-file', '-e', `${CAPA_COMMIT}^{commit}`]);
  } catch {
    return { yok: true }; // sığ klon
  }
  try {
    return git(['show', `${CAPA_COMMIT}:${ESKI_KAYIT_REL}`]);
  } catch (e) {
    return { hata: String(e.stderr ?? e.message).trim().split('\n')[0] };
  }
}

/** §4 girdisi: deseni taşıyan izlenen kod dosyaları (bekçinin kendisi hariç). */
function okuyanlarOku() {
  try {
    const cikti = git(['grep', '-l', '-E', OKUYUCU_DESENI, '--', '.', ':!*.md', ':!docs/', `:!${ESKI_KAYIT_REL}`, ':!scripts/test_eski_kanal_donuk.mjs']).toString();
    return cikti.split('\n').filter(Boolean).sort();
  } catch (e) {
    if (e.status === 1) return []; // git grep: eşleşme yok
    return { hata: String(e.stderr ?? e.message).trim().split('\n')[0] };
  }
}

function belgeOku() {
  try {
    return fs.readFileSync(path.join(KOK, BELGE_REL), 'utf8');
  } catch (e) {
    return { hata: `${e.code ?? e.message}` };
  }
}

/** Saf ölçüm: girdiler enjekte edilebilir (sondalar). */
function olc({ agac, indeks, capa, belge, okuyanlar, pin = PIN, izinli = OKUYUCU_IZINLI }) {
  const s = { kirmizi: [], olculemedi: [], bilgi: [] };
  const bayt = (ad, v) => {
    if (Buffer.isBuffer(v)) {
      const o = ozet(v);
      if (o !== pin.sha256 || v.length !== pin.boyut) s.kirmizi.push(`${ad}: ${ESKI_KAYIT_REL} DEĞİŞTİ — sha256 ${kisaltma(o)} (${v.length} bayt), donuk ${kisaltma(pin.sha256)} (${pin.boyut} bayt). Eski kanal kaydı düzeltilmez; geri al.`);
      else s.bilgi.push(`${ad}: bayt-eşit (${kisaltma(o)}, ${v.length} bayt)`);
    } else if (v?.yok) s.kirmizi.push(`${ad}: ${ESKI_KAYIT_REL} SİLİNDİ — eski kanal kaydı silinmez (adnansahin)`);
    else s.olculemedi.push(`${ad}: ${ESKI_KAYIT_REL} okunamadı (${v?.hata ?? 'bilinmeyen'})`);
  };
  bayt('§1 çalışma ağacı', agac);
  bayt('§2 git index', indeks);

  if (Buffer.isBuffer(capa)) {
    if (ozet(capa) !== pin.sha256) s.kirmizi.push(`§3a pin, çapa commit'indeki (${CAPA_COMMIT.slice(0, 9)}) dosyanın özeti DEĞİL — pin elle değişmiş`);
    else s.bilgi.push(`§3a pin = çapa commit'i ${CAPA_COMMIT.slice(0, 9)}`);
  } else if (capa?.yok) s.bilgi.push(`⏭ §3a çapa commit'i ${CAPA_COMMIT.slice(0, 9)} bu klonda yok (sığ klon) — pin↔çapa ölçülmedi; §3b ölçer`);
  else s.olculemedi.push(`§3a çapa commit'inde dosya okunamadı (${capa?.hata ?? 'bilinmeyen'})`);

  if (typeof belge === 'string') {
    if (!belge.includes(kisaltma(pin.sha256))) s.kirmizi.push(`§3b ${BELGE_REL} pin kısaltmasını (${kisaltma(pin.sha256)}) taşımıyor — pin ile tasarım ayrıştı`);
    else s.bilgi.push(`§3b tasarım belgesi pini taşıyor`);
  } else s.olculemedi.push(`§3b ${BELGE_REL} okunamadı (${belge?.hata ?? 'bilinmeyen'})`);

  if (Array.isArray(okuyanlar)) {
    const beyansiz = okuyanlar.filter((f) => !Object.hasOwn(izinli, f));
    const olu = Object.keys(izinli).filter((f) => !okuyanlar.includes(f));
    for (const f of beyansiz) s.kirmizi.push(`§4 beyansız okuyucu: ${f} eski kanal kaydını (${ESKI_KAYIT_REL} / ESKI_KAYIT_REL) anıyor — eski yayın yolu emekli; gerekmiyorsa kaldır, gerekiyorsa OKUYUCU_IZINLI'ye gerekçesiyle ekle`);
    for (const f of olu) s.kirmizi.push(`§4 ölü beyan: ${f} artık eski kanal kaydını anmıyor — OKUYUCU_IZINLI'den çıkar (liste yalnız küçülür)`);
    if (!beyansiz.length && !olu.length) s.bilgi.push(`§4 okuyucular beyanlı (${okuyanlar.length})`);
  } else s.olculemedi.push(`§4 okuyucular ölçülemedi (${okuyanlar?.hata ?? 'bilinmeyen'})`);
  return s;
}

const hukum = (s) => (s.olculemedi.length ? 'olculemedi' : s.kirmizi.length ? 'kirmizi' : 'yesil');

function sondalar(taban) {
  const birBayt = (b) => { const c = Buffer.from(b); c[100] = c[100] === 0x20 ? 0x21 : 0x20; return c; };
  const yeniPin = (b) => ({ sha256: ozet(b), boyut: b.length });
  const S = [
    ['P0 gerçek girdiler YEŞİL', 'yesil', () => {}],
    ['P1 çapa commit\'i yok (sığ klon) → YEŞİL, ⏭ beyanlı', 'yesil', (g) => { g.capa = { yok: true }; }, '⏭ §3a'],
    ['N1 çalışma ağacında BİR bayt değişti → KIRMIZI', 'kirmizi', (g) => { g.agac = birBayt(g.agac); }, '§1 çalışma ağacı'],
    ['N2 yalnız index\'te bir bayt değişti (commit edilecek) → KIRMIZI', 'kirmizi', (g) => { g.indeks = birBayt(g.indeks); }, '§2 git index'],
    ['N3 satır sonları CRLF\'e döndü → KIRMIZI', 'kirmizi', (g) => { g.agac = Buffer.from(g.agac.toString('utf8').replaceAll('\n', '\r\n')); }, 'DEĞİŞTİ'],
    ['N4 sona tek satır sonu eklendi → KIRMIZI', 'kirmizi', (g) => { g.indeks = Buffer.concat([g.indeks, Buffer.from('\n')]); }, 'DEĞİŞTİ'],
    ['N5 dosya ağaçtan silindi → KIRMIZI', 'kirmizi', (g) => { g.agac = { yok: true }; }, 'SİLİNDİ'],
    ['N6 dosya index\'ten çıkarıldı (git rm) → KIRMIZI', 'kirmizi', (g) => { g.indeks = { yok: true }; }, '§2 git index'],
    ['N7 dosya + pin birlikte "güncellendi" → KIRMIZI (çapa commit\'i)', 'kirmizi', (g) => {
      g.agac = birBayt(g.agac); g.indeks = g.agac; g.pin = yeniPin(g.agac);
    }, '§3a'],
    ['N8 dosya + pin birlikte, sığ klonda → KIRMIZI (belge kolu)', 'kirmizi', (g) => {
      g.agac = birBayt(g.agac); g.indeks = g.agac; g.pin = yeniPin(g.agac); g.capa = { yok: true };
    }, '§3b'],
    ['O1 ağaçta okuma hatası (EACCES) → ÖLÇÜLEMEDİ', 'olculemedi', (g) => { g.agac = { hata: 'EACCES' }; }],
    ['O2 git yok → ÖLÇÜLEMEDİ', 'olculemedi', (g) => { g.indeks = { hata: 'git deposu değil / git yok' }; }],
    ['O3 tasarım belgesi okunamadı → ÖLÇÜLEMEDİ', 'olculemedi', (g) => { g.belge = { hata: 'ENOENT' }; }],
    ['N9 ⭐ yeni dosya eski kanal kaydını okuyor → KIRMIZI (§4 beyansız)', 'kirmizi', (g) => { g.okuyanlar = [...g.okuyanlar, 'deploy/yeni-eski-yol.mjs'].sort(); }, '§4 beyansız okuyucu: deploy/yeni-eski-yol.mjs'],
    ['N10 beyanlı okuyucu artık okumuyor → KIRMIZI (§4 ölü beyan)', 'kirmizi', (g) => { g.okuyanlar = g.okuyanlar.filter((f) => f !== 'scripts/lib/grup-yayin.mjs'); }, '§4 ölü beyan: scripts/lib/grup-yayin.mjs'],
    ['O4 git grep koşamadı → ÖLÇÜLEMEDİ', 'olculemedi', (g) => { g.okuyanlar = { hata: 'git grep yok' }; }],
  ];
  let gecti = 0;
  const kaldi = [];
  for (const [ad, beklenen, mutasyon, iz] of S) {
    const g = { ...taban };
    mutasyon(g);
    const degisti = ad.startsWith('P0') || Object.keys(g).some((k) => g[k] !== taban[k]);
    const s = olc(g);
    const h = hukum(s);
    const ok = degisti && h === beklenen && (!iz || [...s.kirmizi, ...s.olculemedi, ...s.bilgi].some((x) => x.includes(iz)));
    if (ok) gecti += 1;
    else kaldi.push(ad);
    const neden = [...s.olculemedi, ...s.kirmizi][0];
    console.log(`${ok ? '✅' : '❌'} ${ad}${degisti ? '' : ' — MUTASYON UYGULANMADI'} · hüküm ${h}${neden && beklenen !== 'yesil' ? ` · ${neden.slice(0, 120)}` : ''}`);
    if (!ok) for (const x of [...s.olculemedi, ...s.kirmizi]) console.log(`     · ${x}`);
  }
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi.length} başarısız ===`);
  return kaldi.length === 0;
}

function main() {
  const girdi = { agac: agacOku(), indeks: indeksOku(), capa: capaOku(), belge: belgeOku(), okuyanlar: okuyanlarOku() };
  if (process.argv.includes('--sonda')) {
    console.log('test_eski_kanal_donuk — kalıcı sondalar (bellekteki kopyalara karşı)\n');
    // Sonda tabanı = DONUK baytlar; ağaç değiştiyse sonda değil asıl ölçüm konuşur.
    const s0 = olc(girdi);
    if (hukum(s0) !== 'yesil') {
      for (const x of [...s0.olculemedi, ...s0.kirmizi]) console.log(`⛔ ${x}`);
      console.log('⛔ ÖLÇÜLEMEDİ — sonda tabanı yeşil değil; önce dinlenme ölçümü');
      process.exit(2);
    }
    process.exit(sondalar({ ...girdi, capa: Buffer.isBuffer(girdi.capa) ? girdi.capa : girdi.agac }) ? 0 : 1);
  }
  const s = olc(girdi);
  console.log('test_eski_kanal_donuk — deploy/kanallar.json bayt-donuk (adnansahin)\n');
  for (const x of s.bilgi) console.log(`   ${x}`);
  for (const x of s.olculemedi) console.log(`⛔ ÖLÇÜLEMEDİ — ${x}`);
  for (const x of s.kirmizi) console.log(`❌ ${x}`);
  const h = hukum(s);
  console.log(`\n=== Sonuç: ${h === 'yesil' ? 'yeşil' : h === 'olculemedi' ? 'ÖLÇÜLEMEDİ' : 'KIRMIZI'} ===`);
  process.exit(h === 'yesil' ? 0 : h === 'olculemedi' ? 2 : 1);
}

main();
