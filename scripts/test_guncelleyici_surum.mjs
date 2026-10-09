#!/usr/bin/env node
// =============================================================================
// BEKÇİ — HİZMET İKİLİSİ DEĞİŞTİYSE SÜRÜMÜ ARTAR · zero-dep, DB'siz, ağsız
// =============================================================================
// Sahadaki güncelleyici yeni ikiliyi yalnız kendi sürümünden BÜYÜKSE alır (selfupdate) ve §9.5 kanıt
// kapısı değişikliği sürüm farkından tanır: kaynağı değişip sürümü aynı kalan ikili sahaya hiç ulaşmaz.
// Taban = en büyük `backend-vX.Y.Z` etiketi (sahaya çıkan son sürüm); kaynak etiketle çalışma ağacı
// arasında değiştiyse Cargo sürümü etiketteki sürümden büyük olmalı. Sürüm geriye gidemez.
//
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ (etiket yok — CI'da sığ klon: önce etiketleri çek).
//   node scripts/test_guncelleyici_surum.mjs                 # dinlenme
//   node scripts/test_guncelleyici_surum.mjs --taban <ref>   # tabanı elle ver (prova)
//   node scripts/test_guncelleyici_surum.mjs --sonda         # kalıcı negatif + pozitif sondalar
// =============================================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const N = 'Teks-Erp/native';

// İkili → Cargo.toml'u + ikiliye giren kaynak yolları (kendi crate'i + bağladığı yol bağımlılıkları).
export const IKILILER = [
  {
    ad: 'tekserp-guncelleyici',
    cargo: `${N}/tekserp-guncelleyici/Cargo.toml`,
    kaynak: [
      `${N}/tekserp-guncelleyici/Cargo.toml`, `${N}/tekserp-guncelleyici/src`,
      `${N}/tekserp-hizmet/Cargo.toml`, `${N}/tekserp-hizmet/src`,
      `${N}/tekserp-dogrulama/Cargo.toml`, `${N}/tekserp-dogrulama/src`,
      `${N}/Cargo.toml`, `${N}/Cargo.lock`,
    ],
  },
  {
    ad: 'tekserp-hizmet',
    cargo: `${N}/tekserp-hizmet/Cargo.toml`,
    kaynak: [`${N}/tekserp-hizmet/Cargo.toml`, `${N}/tekserp-hizmet/src`],
  },
];

class Olculemedi extends Error {}

/** `[package]` bölümündeki `version`; yoksa null. */
export function cargoSurumu(metin) {
  const paket = /^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(metin);
  const m = paket && /^version\s*=\s*"([^"]+)"\s*$/m.exec(paket[1]);
  return m ? m[1] : null;
}

function parca(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '');
  if (!m) throw new Olculemedi(`sürüm x.y.z değil: ${JSON.stringify(v)}`);
  return m.slice(1).map(Number);
}

export function karsilastir(a, b) {
  const [x, y] = [parca(a), parca(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** Saf yüklem: taban sürüm (etiketteki; crate yoksa null), baştaki sürüm, değişen kaynak dosyaları. */
export function degerlendir({ ad, tabanSurum, basSurum, degisen }) {
  if (tabanSurum === null) return { yesil: true, mesaj: `${ad}: tabanda yok (yeni ikili) — ${basSurum}` };
  const k = karsilastir(basSurum, tabanSurum);
  if (k < 0) return { yesil: false, mesaj: `${ad}: sürüm GERİLEDİ ${tabanSurum} → ${basSurum}` };
  if (degisen.length > 0 && k === 0) {
    const ornek = degisen.slice(0, 5).join(', ') + (degisen.length > 5 ? ` … (+${degisen.length - 5})` : '');
    return {
      yesil: false,
      mesaj: `${ad}: kaynak tabandan beri değişti (${degisen.length} dosya: ${ornek}) ama sürüm hâlâ ${basSurum} — ` +
        `Cargo.toml sürümünü artırın (sahadaki ikili eşit sürümü almaz)`,
    };
  }
  return { yesil: true, mesaj: `${ad}: ${tabanSurum} → ${basSurum} · ${degisen.length} değişen kaynak dosyası` };
}

const git = (args) => execFileSync('git', args, { cwd: KOK, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function tabanEtiketi() {
  const etiketler = git(['tag', '-l', 'backend-v*']).split('\n').map((s) => s.trim())
    .filter((t) => /^backend-v\d+\.\d+\.\d+$/.test(t));
  if (etiketler.length === 0) throw new Olculemedi('backend-vX.Y.Z etiketi yok (sığ klon mu? önce `git fetch origin "+refs/tags/backend-v*:refs/tags/backend-v*"`)');
  etiketler.sort((a, b) => karsilastir(b.slice(9), a.slice(9)));
  return etiketler[0];
}

function olc(taban) {
  const sonuc = [];
  for (const ik of IKILILER) {
    let tabanMetni = null;
    try { tabanMetni = git(['show', `${taban}:${ik.cargo}`]); } catch { /* tabanda crate yok */ }
    const tabanSurum = tabanMetni === null ? null : cargoSurumu(tabanMetni);
    if (tabanMetni !== null && tabanSurum === null) throw new Olculemedi(`${taban}:${ik.cargo} sürümsüz`);
    const basSurum = cargoSurumu(fs.readFileSync(path.join(KOK, ik.cargo), 'utf8'));
    if (basSurum === null) throw new Olculemedi(`${ik.cargo} sürümsüz`);
    // Çalışma ağacına karşı: commit edilmemiş değişiklik de sayılır.
    const degisen = git(['diff', '--name-only', taban, '--', ...ik.kaynak]).split('\n').filter(Boolean);
    sonuc.push(degerlendir({ ad: ik.ad, tabanSurum, basSurum, degisen }));
  }
  return sonuc;
}

function sondalar() {
  let iyi = true;
  const bekle = (ad, girdi, yesil) => {
    const r = degerlendir({ ad: 'x', ...girdi });
    const ok = r.yesil === yesil;
    iyi &&= ok;
    console.log(`${ok ? '✓' : '✗'} ${ad} → ${r.yesil ? 'yeşil' : 'kırmızı'} (beklenen ${yesil ? 'yeşil' : 'kırmızı'})`);
  };
  bekle('N1 kaynak değişti, sürüm aynı', { tabanSurum: '0.1.3', basSurum: '0.1.3', degisen: ['a/src/x.rs'] }, false);
  bekle('N2 sürüm geriledi (kaynak aynı)', { tabanSurum: '0.2.0', basSurum: '0.1.9', degisen: [] }, false);
  bekle('N3 sürüm geriledi (kaynak değişti)', { tabanSurum: '0.2.0', basSurum: '0.1.9', degisen: ['a'] }, false);
  bekle('P1 kaynak değişti, sürüm arttı', { tabanSurum: '0.1.3', basSurum: '0.2.0', degisen: ['a/src/x.rs'] }, true);
  bekle('P2 kaynak aynı, sürüm aynı', { tabanSurum: '0.1.3', basSurum: '0.1.3', degisen: [] }, true);
  bekle('P3 tabanda crate yok', { tabanSurum: null, basSurum: '0.1.0', degisen: ['a'] }, true);
  const cs = (ad, metin, v) => { const ok = cargoSurumu(metin) === v; iyi &&= ok; console.log(`${ok ? '✓' : '✗'} ${ad}`); };
  cs('C1 [package] sürümü okunur', '[package]\nname = "a"\nversion = "1.2.3"\n\n[dependencies]\nx = { version = "9.9.9" }\n', '1.2.3');
  cs('C2 bağımlılık sürümü paket sürümü sayılmaz', '[package]\nname = "a"\nversion.workspace = true\n\n[dependencies]\nversion = "9.9.9"\n', null);
  let ol = false;
  try { karsilastir('0.2.0-rc1', '0.1.0'); } catch (e) { ol = e instanceof Olculemedi; }
  iyi &&= ol;
  console.log(`${ol ? '✓' : '✗'} C3 x.y.z dışı sürüm ÖLÇÜLEMEDİ`);
  return iyi;
}

function main() {
  if (process.argv.includes('--sonda')) {
    console.log('test_guncelleyici_surum — kalıcı sondalar\n');
    process.exit(sondalar() ? 0 : 1);
  }
  const i = process.argv.indexOf('--taban');
  try {
    const taban = i > 0 ? process.argv[i + 1] : tabanEtiketi();
    console.log(`test_guncelleyici_surum — taban ${taban}\n`);
    const sonuc = olc(taban);
    for (const r of sonuc) console.log(`${r.yesil ? '✓' : '✗'} ${r.mesaj}`);
    process.exit(sonuc.every((r) => r.yesil) ? 0 : 1);
  } catch (e) {
    if (!(e instanceof Olculemedi)) throw e;
    console.error(`⚠ ÖLÇÜLEMEDİ: ${e.message}`);
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
