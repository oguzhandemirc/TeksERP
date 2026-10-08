#!/usr/bin/env node
// =============================================================================
// KORUMALI LINUX İMAJI — İMAJ İÇİ BÜTÜNLÜK LİSTESİ (G13; satıcı Mac'inde, PAKET anahtarıyla)
// =============================================================================
//   TEKSERP_PAKET_ANAHTARI=<anahtar dosyası> node Teks-Erp/docker/korumali/imaj-imzala.mjs <taban-etiket> <imzalı-etiket> [imza bayrakları]
// Windows korumalı paketinin AYNI mekanizması (tek kaynak, elle kopya yok): `/app` ağacı imzasız tabandan
// dışa verilir → `build-korumali-imza.ts imzala` kapsamı (`integrity-scope.ts`) ölçer, `butunluk-liste.txt` +
// imzalı yükü yazar (`pkt-*` anahtarda `butunluk-zincir.jws`, `paket-*`te `butunluk.jws`) → ikisi tabana İNCE
// SON KATMAN olarak eklenir (`FROM <taban>` + `COPY`, root:root 0644) → yeni etiket. Kapsamdaki hiçbir dosya
// değişmez; katman yalnız imza dosyalarını taşır (dosyanın imzası kendi içinde olamaz).
// ÖZ-DENETİM (imzalı etiket ancak bundan sonra kalır): imzalı imajda, ağsız, salt-okunur kök ve süreç
// kullanıcısıyla, imajın KENDİ native çekirdeği (gömülü çapa) her imzalı yükü `/app`e karşı doğrular → GECERLI
// değilse etiket silinir. Ardından imaj bekçisi `--imzali` (K1–K9).
// İmza bayrakları imza aracına aynen geçer: --ci-atla="<kullanıcının cümlesi>" · --ci-kosu=<id> · --sertifika=<dosya>
// · --kok-dosyasi=<kök.json> · --kok-capa=<test çapası> · --zincir-anahtar=<pkt> · --zincir-sertifika=<dosya>
// · --paket-iptal=<dosya> · --kasa=<ad>|yok · --parola-dosyasi=<yol>. Kök/sürüm/ürün/müşteri bu betikten gelir.
// Parolayı yalnız imza aracı okur (`cli-girdi.ts` askPassword): --parola-dosyasi > Anahtar Zinciri kasası
// (`tekserp/paket`, tek kaynak `scripts/lib/parola-kasasi.mjs`) > TTY > stdin; değer argüman/ortamdan ASLA.
// Çıkış: 0 imzalı etiket hazır · 1 RED/düştü (imzalı etiket yok) · 2 kullanım.
// Runbook: docs/ops/LINUX-DOCKER-KURULUM.md §8.
// =============================================================================
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const TEKS = path.resolve(BURASI, '..', '..');
const REPO = path.resolve(TEKS, '..');
const IMZA_BAYRAKLARI = ['ci-atla', 'ci-kosu', 'sertifika', 'kok-dosyasi', 'kok-capa', 'zincir-anahtar', 'zincir-sertifika', 'paket-iptal', 'kasa', 'parola-dosyasi'];
// İmza aracının pakete yazdığı dosyalar (`scripts/lib/butunluk-imza.ts`); taban imajda biri bile varsa imzalı sayılır.
const LISTE = 'butunluk-liste.txt';
const YUKLER = ['butunluk-zincir.jws', 'butunluk.jws'];
const IPTAL = 'paket-iptal.jws';
const NATIVE = '/app/native/lisans-cekirdek.linux-x64-gnu.node';

class Red extends Error {}
const red = (m) => { throw new Red(m); };

function docker(args, o = {}) {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000, ...o });
  if (r.error) red(`docker çalıştırılamadı (${r.error.code || r.error.message})`);
  return r;
}
function dockerOk(args, ne, o) {
  const r = docker(args, o);
  if (r.status !== 0) red(`${ne}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`);
  return r.stdout.trim();
}
function etiketler(imaj) {
  const r = docker(['image', 'inspect', imaj, '--format', '{{json .}}']);
  if (r.status !== 0) red(`imaj yok: ${imaj}`);
  const j = JSON.parse(r.stdout);
  return { id: j.Id, labels: j.Config?.Labels ?? {}, katmanlar: j.RootFS?.Layers ?? [], platform: `${j.Os}/${j.Architecture}` };
}
function argumanlar() {
  const konum = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const bayrak = process.argv.slice(2).filter((a) => a.startsWith('--'));
  if (konum.length !== 2) {
    console.error('kullanım: TEKSERP_PAKET_ANAHTARI=<dosya> node Teks-Erp/docker/korumali/imaj-imzala.mjs <taban-etiket> <imzalı-etiket> [imza bayrakları]');
    process.exit(2);
  }
  for (const b of bayrak) {
    const ad = b.slice(2).split('=')[0];
    if (!IMZA_BAYRAKLARI.includes(ad)) red(`tanınmayan bayrak: --${ad} (geçenler: ${IMZA_BAYRAKLARI.map((x) => `--${x}`).join(' ')}; kök/sürüm/ürün bu betikten)`);
  }
  return { taban: konum[0], hedef: konum[1], bayrak };
}

/** Konteyner içinde çalışır: imzalı yükü imajın kendi native çekirdeğiyle `/app`e karşı doğrular, ham yanıtı basar. */
const OZ_DENETIM = `
const fs = require('fs');
const b = require(${JSON.stringify(NATIVE)});
const t = fs.readFileSync('/app/' + process.argv[1], 'utf8').trim();
b.verifyIntegrity(JSON.stringify({ manifest: t, root: '/app' })).then((x) => process.stdout.write(x), (e) => { console.error(String(e)); process.exit(3); });
`;

function ozDenetim(imaj, yuk) {
  const r = docker(['run', '--rm', '--platform', 'linux/amd64', '--network', 'none', '--read-only', '--user', '10001:10001', '--entrypoint', 'node', imaj, '-e', OZ_DENETIM, yuk]);
  let rapor = null;
  try {
    const j = JSON.parse(r.stdout);
    rapor = j && typeof j === 'object' && 'value' in j ? j.value : j;
  } catch {
    rapor = null;
  }
  return { ok: r.status === 0 && rapor?.durum === 'GECERLI', rapor, ham: `${r.stdout}${r.stderr}`.trim().slice(0, 400) };
}

function kidOf(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')).kid ?? null;
  } catch {
    return null;
  }
}

function main() {
  const { taban, hedef, bayrak } = argumanlar();
  const anahtar = process.env.TEKSERP_PAKET_ANAHTARI || '';
  if (!anahtar) red('PAKET anahtarı verilmedi (TEKSERP_PAKET_ANAHTARI) — varsayılan yol yok; üretimde PAKET sertifikalı pkt-* zinciri — imzasız imaj imzalı sayılmaz');
  if (!fs.existsSync(anahtar)) red(`PAKET anahtarı yok: ${anahtar}`);
  if (taban === hedef) red('imzalı etiket taban etiketinden farklı olmalı (taban imzasız kalır)');
  if (docker(['image', 'inspect', hedef]).status === 0) red(`${hedef} zaten var — yeni etiket ver (var olan imaj ezilmez)`);

  const t = etiketler(taban);
  if (t.labels['tr.tekserp.imaj'] !== 'korumali') red(`${taban} korumalı imaj değil (label tr.tekserp.imaj=${t.labels['tr.tekserp.imaj'] ?? '∅'})`);
  if (t.labels['tr.tekserp.butunluk']) red(`${taban} zaten imzalı (${t.labels['tr.tekserp.butunluk']}) — imzasız tabandan imzala`);
  if (t.platform !== 'linux/amd64') red(`taban platformu ${t.platform} (linux/amd64 bekleniyor)`);
  const bekci = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'test_korumali_imaj.mjs'), `--imaj=${taban}`], { stdio: 'inherit' });
  if (bekci.status !== 0) red('taban imaj bekçisi yeşil değil — imzalanmadı');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-imaj-imza-'));
  let hedefYazildi = false;
  try {
    // 1. /app dışa: konteyner yaratılır (koşturulmaz), ağaç kopyalanır.
    const cid = dockerOk(['create', '--platform', 'linux/amd64', taban], 'docker create');
    try {
      dockerOk(['cp', `${cid}:/app`, path.join(tmp, 'app')], 'docker cp /app');
    } finally {
      docker(['rm', cid]);
    }
    const kok = path.join(tmp, 'app');
    const izler = [LISTE, ...YUKLER, IPTAL].filter((f) => fs.existsSync(path.join(kok, f)));
    if (izler.length) red(`tabanın /app kökünde imza izi var (${izler.join(', ')}) — imzasız tabandan imzala`);
    const surum = JSON.parse(fs.readFileSync(path.join(kok, 'package.json'), 'utf8')).version;

    // 2. İmza: Windows paketinin aynı aracı ve kapsamı (parola aracın kendi girişinden: dosya > kasa > TTY > stdin).
    const imza = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/build-korumali-imza.ts', 'imzala', `--kok=${kok}`, `--anahtar=${anahtar}`, `--surum=${surum}`, '--urun=backend-docker', ...bayrak],
      { cwd: TEKS, stdio: 'inherit' },
    );
    if (imza.status !== 0) red('imza aracı düştü — imzalı etiket üretilmedi');
    const yazilan = [LISTE, ...YUKLER, IPTAL].filter((f) => fs.existsSync(path.join(kok, f)));
    const yukler = YUKLER.filter((f) => yazilan.includes(f));
    if (!yazilan.includes(LISTE) || yukler.length === 0) red(`imza aracı liste/yük yazmadı (${yazilan.join(', ') || 'hiçbiri'})`);
    const kid = kidOf(fs.readFileSync(path.join(kok, yukler[0]), 'utf8').trim());
    if (!kid) red('imzalı yükün başlığı okunamadı');

    // 3. İnce son katman: yalnız imza dosyaları, root:root 0644; taban kimliği etikette.
    const katman = path.join(tmp, 'katman');
    fs.mkdirSync(katman);
    for (const f of yazilan) fs.copyFileSync(path.join(kok, f), path.join(katman, f));
    fs.writeFileSync(
      path.join(katman, 'Dockerfile'),
      [
        `FROM ${taban}`,
        `COPY --chown=0:0 --chmod=0644 ${yazilan.join(' ')} /app/`,
        `LABEL tr.tekserp.butunluk="${kid}" tr.tekserp.butunluk.taban="${t.id}"`,
        '',
      ].join('\n'),
    );
    hedefYazildi = true;
    dockerOk(['build', '--platform', 'linux/amd64', '--pull=false', '-q', '-t', hedef, katman], 'imzalı katman derlenemedi');
    const h = etiketler(hedef);
    const tabanKatmanlari = h.katmanlar.slice(0, t.katmanlar.length);
    if (h.katmanlar.length !== t.katmanlar.length + 1 || tabanKatmanlari.some((k, i) => k !== t.katmanlar[i])) {
      red(`imzalı imaj tabanın üstüne TEK katman değil (${t.katmanlar.length} → ${h.katmanlar.length})`);
    }

    // 4. Öz-denetim: imajın kendi native çekirdeği, ağsız, süreç kullanıcısıyla.
    for (const y of yukler) {
      const o = ozDenetim(hedef, y);
      if (!o.ok) red(`öz-denetim düştü (${y}): ${o.rapor ? `${o.rapor.durum} ${o.rapor.kod ?? ''}` : o.ham}`);
      console.log(`✓ öz-denetim ${y}: GECERLI · ${o.rapor.dosyaSayisi} dosya · paketId ${o.rapor.paket?.paketId ?? '?'} (imajın native çekirdeği, gömülü çapa)`);
    }
    const son = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'test_korumali_imaj.mjs'), `--imaj=${hedef}`, '--imzali'], { stdio: 'inherit' });
    if (son.status !== 0) red('imzalı imaj bekçisi (--imzali) yeşil değil');
    hedefYazildi = false;
    console.log(`✓ imzalı imaj: ${hedef} · ${h.id} · kid ${kid} · katman: ${yazilan.join(', ')}`);
  } finally {
    if (hedefYazildi) {
      docker(['image', 'rm', hedef]);
      console.error(`✖ ${hedef} etiketi silindi (yarım imzalı imaj kalmaz)`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (e) {
  console.error(`✖ ${e instanceof Red ? e.message : e?.stack || String(e)}`);
  process.exit(1);
}
