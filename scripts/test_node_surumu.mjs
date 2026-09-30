#!/usr/bin/env node
// =============================================================================
// BEKÇİ — KORUMALI PAKET ÇALIŞMA ZAMANI (deploy/node-surumu.json) · zero-dep, DB'siz
// =============================================================================
// Korumalı paket `.jsc` (V8 bayt kodu) taşır; bayt kodu paketi ÜRETEN Node'un
// V8 sürümüne + platforma + mimariye KİLİTLİDİR (2a ölçümü KOD-KORUMA-OLCUM.md:
// 24.18↔24.21 aynı V8 KABUL, 26.x RED). Bu yüzden paket kendi `runtime\node.exe`
// ikilisini taşır ve o ikilinin sürümü/adresi/SHA256'sı TEK yerde yaşar:
// `deploy/node-surumu.json`. Onu OKUYAN her taraf (yükleyici motoru
// `scripts/lib/node-surumu.mjs`, derleme betiği `Teks-Erp/scripts/build-korumali.mjs`,
// CI iş akışı `.github/workflows/korumali-paket.yml`, PowerShell tarafında
// `deploy/paketle.ps1`) İKİNCİ bir kopya tutmaz — bu bekçi bunu ölçer.
//
// NE ÖLÇER (hepsi DİNLENME, ağsız):
//   §1 kayıt iç tutarlılığı (node-surumu.mjs `kayitHatalari`) — sürüm/çizgi/v8Taban
//      biçimi, iki hedef (win-x64 · linux-x64), sha256 64-hex, url sürümü taşır,
//      dosya adı arsivKok ile başlar
//   §2 TEK KAYNAK: node-surumu.json'u okuyan her tüketici onu ADIYLA okur ve
//      literal bir Node sürümü/sha256 GÖMMEZ (ikinci kopya = sessizce bayatlar)
//   §3 tüketiciler commit kapısı tetiğindedir: node-surumu.json'a dokunan commit
//      onu okuyan bekçiyi koşar (bu bekçi hızlı mandal DEĞİL — elle/CI'da koşar,
//      tetik yalnız "kim okuyor" envanteridir)
//   §4 ecosystem.config.js + kur.ps1 paketin KENDİ Node'unu (runtime\node.exe)
//      DENETLER ve eski paket biçiminde (runtime yoksa) sistem Node'una DÜŞER
//      (geriye uyum beyanı literal olarak durur)
//   §5 korumalı pakette sunucu araçları (`dist/tools/*.cjs`) da KARARTILIR: paketle.ps1
//      -Korumali build-araclar'a --korumali geçirir + kaynak yolu yorumu kapısı; build-araclar
//      minify'ı bayrağa bağlar (2b-D thinkpad-1 provası)
//
// AĞ (yalnız --ag): SHASUMS256.txt'i nodejs.org'dan çeker ve kayıttaki sha256'yı
//   doğrular. Varsayılan koşum ağsızdır (ortak-kurallar); sha biçimini §1 ölçer.
//
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ (okunamayan dosya, yeri değişmiş sabit).
// Cırcır DEĞİL (taban yok): saf durum tutarlılığı; doğduğu gün ısırabilir.
// Kalıcı sonda: `--sonda` (dosyada yaşar, bellekteki kopyaya karşı, mutasyonun
// UYGULANDIĞINI da ölçer).
//
//   node scripts/test_node_surumu.mjs          # dinlenme durumu (ağsız)
//   node scripts/test_node_surumu.mjs --sonda  # negatif + pozitif sondalar
//   node scripts/test_node_surumu.mjs --ag      # + nodejs.org SHASUMS doğrulaması
// =============================================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HEDEFLER, KAYIT_REL, Olculemedi, kayitHatalari } from './lib/node-surumu.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// node-surumu.json'u OKUYAN her taraf + onu okuduğunu gösteren iz. Kayıt yalnız
// buradan çözülmeli; literal Node sürümü/sha256 gömen bir tüketici ikinci kopyadır.
const TUKETICILER = {
  'scripts/lib/node-surumu.mjs': { iz: /KAYIT_REL = 'deploy\/node-surumu\.json'/, ne: 'yükleyici motoru (kaydın kendisi burada tanımlanır)' },
  'scripts/koruma-runtime-indir.mjs': { iz: /from '\.\/lib\/node-surumu\.mjs'/, ne: 'runtime indirici (SHA doğrulamalı)' },
  'Teks-Erp/scripts/build-korumali.mjs': { iz: /from '\.\.\/\.\.\/scripts\/lib\/node-surumu\.mjs'/, ne: 'korumalı derleme betiği' },
  '.github/workflows/korumali-paket.yml': { iz: /deploy\/node-surumu\.json/, ne: 'CI iş akışı' },
  'deploy/paketle.ps1': { iz: /koruma-runtime-indir\.mjs|node-surumu\.json/, ne: 'paketleyici (PowerShell)' },
};
// Paketin kendi Node'unu DENETLEYEN + eski biçime düşen taraflar (geriye uyum).
// Desenler KOD'a çapalı (yorum metnine değil): interpreter wiring + fallback dalı.
const RUNTIME_DENETCILERI = {
  'Teks-Erp/ecosystem.config.js': {
    denetler: /interpreter: RUNTIME_NODE/,                       // pm2'yi paketin Node'una bağlar
    geriUyum: /\? \{ interpreter: RUNTIME_NODE \} : \{\}/,       // runtime yoksa {} → sistem Node
    ne: 'pm2 interpreter',
  },
  'deploy/kur.ps1': {
    denetler: /\$runtimeExe = Join-Path \$temp "runtime\\node\.exe"/, // paketin runtime\node.exe'sini arar
    geriUyum: /paket kendi Node'unu tasimiyor \(eski bicim\)/,        // else dalı: sistem Node
    ne: 'kur.ps1 [1/9] runtime denetimi',
  },
};
// Korumalı pakette sunucu araçları da karartılır (2b-D thinkpad-1 provası): karartmasız
// `dist/tools/*.cjs` src'nin onlarca modülünü (lisans protokolü dahil) okunur JS olarak taşıyordu.
const ARAC_KARARTMA = {
  'deploy/paketle.ps1': [
    // `@(if …)` ŞART: `= if { @("x") }` tek elemanlı diziyi dizgeye açar, splat harflere böler.
    [/\$aracArg = @\(if \(\$Korumali\) \{ "--korumali" \}\)/, "build-araclar'a --korumali geçirmiyor (dizi korunmalı)"],
    [/build-araclar\.mjs"\) @aracArg/, 'build-araclar çağrısı bayrağı taşımıyor'],
    [/if \(\$yolYorumu -gt 0\) \{ Fail/, 'araç karartma kapısı (kaynak yolu yorumu sayımı) yok'],
  ],
  'Teks-Erp/scripts/build-araclar.mjs': [
    [/const KORUMALI = process\.argv\.includes\("--korumali"\)/, '--korumali bayrağını okumuyor'],
    [/minify: KORUMALI,/, 'minify korumalı bayrağa bağlı değil'],
  ],
};
// Bu bekçinin okuduğu HER dosya (tetik kapsamı §3).
const OKUNAN = [...new Set([KAYIT_REL, ...Object.keys(TUKETICILER), ...Object.keys(RUNTIME_DENETCILERI), ...Object.keys(ARAC_KARARTMA)])];

const SHASUMS = 'https://nodejs.org/dist/v{surum}/SHASUMS256.txt';

/** Göreli yolları diskten okur; yoksa değer undefined kalır (tüketici ÖLÇÜLEMEDİ der). */
function dosyalariOku(yollar, kok = KOK) {
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

/** Bütün ölçüm. d: göreli yol → içerik. */
function olc(d) {
  const kirmizi = [];
  const olculemedi = [];
  const bilgi = [];

  let kayit;
  try {
    if (typeof d[KAYIT_REL] !== 'string') throw new Olculemedi(`${KAYIT_REL} okunamadı`);
    kayit = JSON.parse(d[KAYIT_REL]);
  } catch (e) {
    olculemedi.push(e instanceof Olculemedi ? e.message : `${KAYIT_REL} ayrıştırılamadı: ${e.message}`);
    return { kirmizi, olculemedi, bilgi, kayit: null };
  }

  // §1 — kaydın iç tutarlılığı
  kirmizi.push(...kayitHatalari(kayit).map((h) => `§1 ${h}`));

  // §2 — TEK KAYNAK: her tüketici node-surumu.json'u ADIYLA okur ve literal
  //       Node sürümü/sha256 GÖMMEZ (node-surumu.mjs'in kendisi hariç: kaynağı odur).
  const surum = typeof kayit?.surum === 'string' ? kayit.surum : null;
  for (const [rel, t] of Object.entries(TUKETICILER)) {
    const m = d[rel];
    if (typeof m !== 'string') {
      olculemedi.push(`§2 ${rel} okunamadı (${t.ne})`);
      continue;
    }
    if (!t.iz.test(m)) kirmizi.push(`§2 ${rel} node-surumu.json'u okumuyor (${t.ne}) — kaynak izi bulunamadı`);
    // Literal Node sürümü gömülü mü? Yorum (tam satır + satır sonu `//`/`#`)
    // ayıklanır — örnek arşiv adları (`node-v24.18.0-…`) kaynak kopyası değildir.
    // node-surumu.mjs kaynağın kendisidir; paketle.ps1/CI kayıttan okuyup değeri
    // aktarabilir (o yüzden muaf) — asıl kural iz'in var olması.
    if (rel === 'scripts/koruma-runtime-indir.mjs' && surum) {
      const govde = m.replace(/(^|\s)(#|\/\/).*$/gm, '$1');
      if (govde.includes(surum)) {
        kirmizi.push(`§2 ${rel} Node sürümü "${surum}" literalini KOD gövdesinde taşıyor — kayıttan oku (ikinci kopya bayatlar)`);
      }
    }
  }
  // sha256'ları hiçbir tüketici gömmemeli (node-surumu.mjs dahil: orada da yalnız desen var).
  for (const hedef of HEDEFLER) {
    const sha = kayit?.yayin?.[hedef]?.sha256;
    if (typeof sha !== 'string' || sha.length !== 64) continue;
    for (const [rel, t] of Object.entries(TUKETICILER)) {
      const m = d[rel];
      if (typeof m === 'string' && m.includes(sha)) {
        kirmizi.push(`§2 ${rel} (${t.ne}) sha256 literalini gömüyor (${hedef}) — yalnız node-surumu.json'da yaşar`);
      }
    }
  }

  // §3 — tüketiciler commit kapısı tetiğindedir (node-surumu.json'a dokunan commit
  //       bu bekçiyi koşar). Tetik `scripts/hooks/pre-commit.mjs`te elle listelenir;
  //       burada envanterin diskte VAR olduğunu ölçeriz (ölü tüketici de kırmızı).
  for (const rel of OKUNAN) {
    if (typeof d[rel] !== 'string' && !fs.existsSync(path.join(KOK, rel))) {
      kirmizi.push(`§3 tüketici/okunan diskte YOK: ${rel} — bekçi envanterinden çıkar ya da dosyayı geri getir`);
    }
  }

  // §4 — runtime denetleyicileri: paketin kendi Node'unu DENETLER + geriye uyum
  for (const [rel, r] of Object.entries(RUNTIME_DENETCILERI)) {
    const m = d[rel];
    if (typeof m !== 'string') {
      olculemedi.push(`§4 ${rel} okunamadı (${r.ne})`);
      continue;
    }
    if (!r.denetler.test(m)) kirmizi.push(`§4 ${rel} paketin kendi Node'unu (runtime\\node.exe) DENETLEMİYOR (${r.ne})`);
    if (!r.geriUyum.test(m)) kirmizi.push(`§4 ${rel} eski paket biçimine (runtime yoksa sistem Node) DÜŞMÜYOR — geriye uyum beyanı yok (${r.ne})`);
  }

  // §5 — korumalı pakette araçlar da karartılır (bayrak zinciri + paketleyici kapısı)
  for (const [rel, desenler] of Object.entries(ARAC_KARARTMA)) {
    const m = d[rel];
    if (typeof m !== 'string') {
      olculemedi.push(`§5 ${rel} okunamadı (araç karartma zinciri)`);
      continue;
    }
    for (const [desen, eksik] of desenler) if (!desen.test(m)) kirmizi.push(`§5 ${rel} ${eksik} — korumalı pakette araçlar okunur kaynak taşır`);
  }

  return { kirmizi, olculemedi, bilgi, kayit };
}

/** Ağ ayağı: nodejs.org SHASUMS ile sha256 doğrulaması (yalnız --ag). */
function agDogrula(kayit) {
  const satirlar = [];
  let temiz = true;
  for (const hedef of HEDEFLER) {
    const b = kayit?.yayin?.[hedef];
    if (!b?.dosya || !b?.sha256) {
      satirlar.push(`⛔ ${hedef}: kayıt eksik, doğrulanamadı`);
      temiz = false;
      continue;
    }
    const url = SHASUMS.replace('{surum}', kayit.surum);
    let metin;
    try {
      metin = execFileSync('curl', ['-sS', '--max-time', '30', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      satirlar.push(`⛔ ${hedef}: SHASUMS okunamadı (${url}): ${e.message}`);
      temiz = false;
      continue;
    }
    const satir = metin.split('\n').find((s) => s.trim().endsWith(`  ${b.dosya}`) || s.trim().endsWith(` ${b.dosya}`));
    if (!satir) {
      satirlar.push(`⛔ ${hedef}: ${b.dosya} SHASUMS'ta bulunamadı`);
      temiz = false;
      continue;
    }
    const resmi = satir.trim().split(/\s+/)[0];
    if (resmi === b.sha256) satirlar.push(`✅ ${hedef}: ${b.dosya} sha256 resmi SHASUMS ile eşit`);
    else {
      satirlar.push(`❌ ${hedef}: sha256 UYUŞMUYOR — kayıt ${b.sha256.slice(0, 16)}… resmi ${resmi.slice(0, 16)}…`);
      temiz = false;
    }
  }
  return { temiz, satirlar };
}

const hukum = (s) => (s.olculemedi.length ? 'olculemedi' : s.kirmizi.length ? 'kirmizi' : 'yesil');

/* ------------------------------------------------------------------ *
 * Kalıcı sondalar — bellekteki kopyalara karşı
 * ------------------------------------------------------------------ */

function sondalar(taban) {
  const jd = (d, rel, fn) => {
    const o = JSON.parse(d[rel]);
    fn(o);
    d[rel] = `${JSON.stringify(o, null, 2)}\n`;
  };
  const kayitta = (fn) => (d) => jd(d, KAYIT_REL, fn);
  const S = [
    ['P0 gerçek ağaç YEŞİL', 'yesil', () => {}],
    ['P1 sürüm + çizgi + url birlikte yükseltildi YEŞİL', 'yesil', kayitta((o) => {
      o.surum = '24.19.0';
      o.cizgi = '24';
      for (const h of Object.values(o.yayin)) h.url = h.url.replace('/v24.18.0/', '/v24.19.0/');
    })],
    ['N1 sha256 kısaldı (63 hane) → KIRMIZI', 'kirmizi', kayitta((o) => { o.yayin['win-x64'].sha256 = 'a'.repeat(63); })],
    ['N2 çizgi surum ile uyuşmuyor → KIRMIZI', 'kirmizi', kayitta((o) => { o.cizgi = '22'; })],
    ['N3 v8Taban biçimi bozuk → KIRMIZI', 'kirmizi', kayitta((o) => { o.v8Taban = '13.6.233'; })],
    ['N4 url sürümü taşımıyor (sürüm değişti, url değişmedi) → KIRMIZI', 'kirmizi', kayitta((o) => { o.surum = '24.19.0'; })],
    ['N5 bir hedef silindi (linux-x64 yok) → KIRMIZI', 'kirmizi', kayitta((o) => { delete o.yayin['linux-x64']; })],
    ['N6 dosya adı arsivKok ile başlamıyor → KIRMIZI', 'kirmizi', kayitta((o) => { o.yayin['win-x64'].dosya = 'baska.zip'; })],
    ['N7 build-korumali node-surumu.mjs\'yi okumuyor → KIRMIZI (§2)', 'kirmizi',
      (d) => { d['Teks-Erp/scripts/build-korumali.mjs'] = d['Teks-Erp/scripts/build-korumali.mjs'].replace("from '../../scripts/lib/node-surumu.mjs'", "from './yerel.mjs'"); }, '§2'],
    ['N8 ecosystem interpreter wiring\'i kaldırıldı (hep sistem Node) → KIRMIZI (§4)', 'kirmizi',
      (d) => { d['Teks-Erp/ecosystem.config.js'] = d['Teks-Erp/ecosystem.config.js'].replace('...(RUNTIME_NODE ? { interpreter: RUNTIME_NODE } : {}),', 'interpreter: "node",'); }, '§4'],
    ['N9 kur.ps1 runtime\\node.exe denetimi kaldırıldı → KIRMIZI (§4)', 'kirmizi',
      (d) => { d['deploy/kur.ps1'] = d['deploy/kur.ps1'].replace('$runtimeExe = Join-Path $temp "runtime\\node.exe"', '$runtimeExe = Join-Path $temp "x\\y.exe"'); }, '§4'],
    ['N10 CI iş akışı node-surumu.json\'u okumuyor → KIRMIZI (§2)', 'kirmizi',
      (d) => { d['.github/workflows/korumali-paket.yml'] = d['.github/workflows/korumali-paket.yml'].replace(/deploy\/node-surumu\.json/g, 'deploy/x.json'); }, '§2'],
    ['N11 paketle.ps1 build-araclar\'a --korumali geçirmiyor → KIRMIZI (§5)', 'kirmizi',
      (d) => { d['deploy/paketle.ps1'] = d['deploy/paketle.ps1'].replace('$aracArg = @(if ($Korumali) { "--korumali" })', '$aracArg = @(if ($Korumali) { })'); }, '§5'],
    ['N11b paketle.ps1 tek elemanlı dizi dizgeye açılıyor (splat harflere böler) → KIRMIZI (§5)', 'kirmizi',
      (d) => { d['deploy/paketle.ps1'] = d['deploy/paketle.ps1'].replace('$aracArg = @(if ($Korumali) { "--korumali" })', '$aracArg = if ($Korumali) { @("--korumali") } else { @() }'); }, '§5'],
    ['N12 build-araclar minify bayrağa bağlı değil (hep okunur) → KIRMIZI (§5)', 'kirmizi',
      (d) => { d['Teks-Erp/scripts/build-araclar.mjs'] = d['Teks-Erp/scripts/build-araclar.mjs'].replace('minify: KORUMALI,', 'minify: false,'); }, '§5'],
    ['N13 paketle.ps1 araç karartma kapısı kaldırıldı → KIRMIZI (§5)', 'kirmizi',
      (d) => { d['deploy/paketle.ps1'] = d['deploy/paketle.ps1'].replace('if ($yolYorumu -gt 0) { Fail', 'if ($false) { Write-Host'); }, '§5'],
    ['O1 kayıt bozuk JSON → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { d[KAYIT_REL] = d[KAYIT_REL].slice(0, 30); }],
  ];

  let gecti = 0;
  const kaldi = [];
  for (const [ad, beklenen, mutasyon, iz] of S) {
    const d = { ...taban };
    mutasyon(d);
    const degisti = ad.startsWith('P0') || Object.keys(taban).some((k) => d[k] !== taban[k]);
    const s = olc(d);
    const h = hukum(s);
    const ok = degisti && h === beklenen && (!iz || [...s.kirmizi, ...s.olculemedi].some((x) => x.includes(iz)));
    if (ok) gecti += 1;
    else kaldi.push(ad);
    const neden = [...s.olculemedi, ...s.kirmizi][0];
    console.log(`${ok ? '✅' : '❌'} ${ad}${degisti ? '' : ' — MUTASYON UYGULANMADI'} · hüküm ${h}${neden && beklenen !== 'yesil' ? ` · ${neden.slice(0, 130)}` : ''}`);
    if (!ok && h !== beklenen) for (const x of [...s.olculemedi, ...s.kirmizi].slice(0, 4)) console.log(`     · ${x}`);
  }
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi.length} başarısız ===`);
  return kaldi.length === 0;
}

/* ------------------------------------------------------------------ */

function main() {
  const d = dosyalariOku(OKUNAN);

  if (process.argv.includes('--sonda')) {
    console.log('test_node_surumu — kalıcı sondalar (bellekteki kopyalara karşı)\n');
    process.exit(sondalar(d) ? 0 : 1);
  }

  const s = olc(d);
  console.log('test_node_surumu — korumalı paket çalışma zamanı kaydı (deploy/node-surumu.json)\n');
  for (const x of s.bilgi) console.log(x);
  for (const x of s.olculemedi) console.log(`⛔ ÖLÇÜLEMEDİ — ${x}`);
  for (const x of s.kirmizi) console.log(`❌ ${x}`);

  if (process.argv.includes('--ag') && s.kayit) {
    console.log('\n--ag: nodejs.org SHASUMS256 doğrulaması');
    const a = agDogrula(s.kayit);
    for (const x of a.satirlar) console.log(`  ${x}`);
    if (!a.temiz) {
      console.log('\n=== Sonuç: KIRMIZI (SHASUMS doğrulaması) ===');
      process.exit(1);
    }
  }

  const h = hukum(s);
  if (h === 'yesil') {
    console.log(`✅ node ${s.kayit.surum} (çizgi ${s.kayit.cizgi}, V8 ${s.kayit.v8Taban}) · ${HEDEFLER.join(' + ')} · ${Object.keys(TUKETICILER).length} tüketici tek kaynaktan · runtime denetimi + geriye uyum yerinde`);
    console.log('\n=== Sonuç: yeşil ===');
    process.exit(0);
  }
  console.log(`\n=== Sonuç: ${h === 'olculemedi' ? 'ÖLÇÜLEMEDİ' : 'KIRMIZI'} (${s.kirmizi.length} kırmızı, ${s.olculemedi.length} ölçülemedi) ===`);
  process.exit(h === 'olculemedi' ? 2 : 1);
}

main();
