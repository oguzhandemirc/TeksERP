#!/usr/bin/env node
// =============================================================================
// BEKÇİ — KORUMALI LINUX İMAJI İÇERİĞİ (Faz 2f · zero-dep, DB'siz, ağsız)
// =============================================================================
// Korumalı imaj (`Teks-Erp/docker/korumali/Dockerfile`) müşteriye KAYNAKSIZ gider: sunucu
// V8 bayt kodu (.jsc) + yükleyici, karartılmış araçlar, native çekirdek, prod node_modules.
// Bu bekçi DERLENMİŞ imajın dosya sistemini (docker export → tar akışı, kendi ayrıştırıcısı)
// ve künyesini (docker image inspect) ölçer:
//   K1 süreç kullanıcısı root değil (boş/0/root = kırmızı)
//   K2 kaynak yok: app/src/ · app altında .ts (node_modules ve .d.ts hariç) · her yerde .map
//   K3 tsx yok (node_modules/tsx · .bin/tsx) · seed/araç kaynağı yok (prisma/seed*.ts K2'de)
//   K4 bytenode öncesi server.cjs yok; araçlarda `// src/...` yol yorumu yok (karartılmamış)
//   K5 zorunlu parçalar VAR: yükleyici + .jsc + künye + native .node + migration SQL +
//      Linux şema motoru + runtime node (yoksa ölçülen imaj korumalı imaj DEĞİLDİR)
//   K6 uygulama ağacı root'a ait, grup/diğerine yazılamaz (yamalı .jsc yazılamasın)
//   K7 imajda DOLU /etc/machine-id yok (parmak izi F1 konaktan gelir) · app altında .env yok
//
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ (docker yok / imaj yok / akış okunamadı).
// İmaj yoksa YEŞİL DEĞİL ÖLÇÜLEMEDİ döner — sessiz yeşil yok. Cırcır DEĞİL (taban yok).
//
//   node scripts/test_korumali_imaj.mjs [--imaj=<etiket>]   # varsayılan: etiketli en yeni imaj
//   node scripts/test_korumali_imaj.mjs --sonda              # negatif + pozitif sondalar (docker'sız)
// =============================================================================
import { spawn, spawnSync } from 'node:child_process';

export const ZORUNLU = [
  'app/dist/server.js',
  'app/dist/server.jsc',
  'app/dist/server-kunye.json',
  'app/native/lisans-cekirdek.linux-x64-gnu.node',
  'app/prisma/schema.prisma',
  'app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x',
  'app/dist/tools/seed.cjs',
  'app/dist/tools/yedek-sifrele.cjs',
  'usr/local/bin/node',
];

/** Saf denetim — `{ user, dosyalar: [{ ad, boyut, uid, mod, tip, icerik? }] }` → ihlal listesi. */
export function denetle({ user, dosyalar }) {
  const ihlal = [];
  const u = String(user ?? '').trim();
  if (u === '' || u === 'root' || u === '0' || /^(0|root)(:|$)/.test(u)) ihlal.push(`K1 süreç kullanıcısı root (User="${u}")`);
  const adlar = new Set(dosyalar.map((d) => d.ad));
  let migration = 0;
  for (const d of dosyalar) {
    const a = d.ad;
    const nm = a.startsWith('app/node_modules/');
    if (a.startsWith('app/src/')) ihlal.push(`K2 kaynak dizini: ${a}`);
    else if (a.startsWith('app/') && !nm && d.tip === 'dosya' && /\.(ts|tsx|mts|cts)$/.test(a) && !/\.d\.[mc]?ts$/.test(a)) ihlal.push(`K2 TypeScript kaynağı: ${a}`);
    if (d.tip === 'dosya' && /\.map$/.test(a) && a.startsWith('app/')) ihlal.push(`K2 kaynak haritası: ${a}`);
    if (/^app\/node_modules\/(tsx\/|\.bin\/tsx$)/.test(a)) ihlal.push(`K3 tsx: ${a}`);
    if (a === 'app/dist/server.cjs') ihlal.push('K4 bytenode öncesi server.cjs imajda');
    if (/^app\/dist\/tools\/[^/]+\.cjs$/.test(a) && typeof d.icerik === 'string' && /^\s*\/\/ (src|scripts|prisma)\//m.test(d.icerik)) ihlal.push(`K4 araç karartılmamış: ${a}`);
    if (/^app\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(a)) migration++;
    if (a.startsWith('app/') && !nm && d.tip === 'dosya' && (d.uid !== 0 || (d.mod & 0o022) !== 0)) ihlal.push(`K6 uygulama dosyası yazılabilir/root dışı (uid ${d.uid}, mod ${d.mod.toString(8)}): ${a}`);
    if ((a === 'etc/machine-id' || a === 'var/lib/dbus/machine-id') && d.tip === 'dosya' && d.boyut > 0) ihlal.push(`K7 imajda dolu makine kimliği: ${a}`);
    if (a.startsWith('app/') && !nm && /(^|\/)\.env(\.|$)/.test(a)) ihlal.push(`K7 ortam dosyası: ${a}`);
  }
  for (const z of ZORUNLU) if (!adlar.has(z)) ihlal.push(`K5 zorunlu parça yok: ${z}`);
  if (migration === 0) ihlal.push('K5 migration SQL yok (app/prisma/migrations/*/migration.sql)');
  return ihlal;
}

// ── Tar akışı ayrıştırıcısı (ustar + GNU 'L' + PAX 'x') — zero-dep ────────────────
function sekizli(buf, bas, uz) {
  const s = buf.subarray(bas, bas + uz).toString('latin1').replace(/\0.*$/s, '').trim();
  return s === '' ? 0 : parseInt(s, 8);
}
function cstr(buf, bas, uz) {
  return buf.subarray(bas, bas + uz).toString('utf8').replace(/\0.*$/s, '');
}

/** Akan tar ayrıştırıcısı: `yaz(parca)` besler, `dosyalar` biriktirir; veri yalnız istenirse tutulur. */
export function tarAkisi(icerikIste = () => false) {
  const dosyalar = [];
  let bekleyen = Buffer.alloc(0);
  let durum = null; // { kalan, dolgu, d?, parcalar?, ozel? }
  let uzunAd = null;
  let paxAd = null;
  let bitti = false;
  function basligiIsle(h) {
    const boyut = sekizli(h, 124, 12);
    const tipBayt = String.fromCharCode(h[156] || 48);
    const dolgu = Math.ceil(boyut / 512) * 512 - boyut;
    if (tipBayt === 'L' || tipBayt === 'x') return { kalan: boyut, dolgu, ozel: tipBayt, parcalar: [] };
    if (tipBayt === 'g') return { kalan: boyut, dolgu };
    const onek = cstr(h, 345, 155);
    let ad = paxAd ?? uzunAd ?? (onek ? `${onek}/${cstr(h, 0, 100)}` : cstr(h, 0, 100));
    uzunAd = null;
    paxAd = null;
    ad = ad.replace(/^\.?\//, '').replace(/\/$/, '');
    const tip = tipBayt === '0' || tipBayt === '\0' ? 'dosya' : tipBayt === '5' ? 'dizin' : tipBayt === '2' ? 'bag' : 'diger';
    const d = { ad, boyut, uid: sekizli(h, 108, 8), mod: sekizli(h, 100, 8), tip };
    dosyalar.push(d);
    return { kalan: boyut, dolgu, d, parcalar: tip === 'dosya' && icerikIste(ad) ? [] : null };
  }
  function yaz(parca) {
    bekleyen = bekleyen.length ? Buffer.concat([bekleyen, parca]) : parca;
    let ofs = 0;
    while (!bitti) {
      if (durum) {
        const al = Math.min(durum.kalan, bekleyen.length - ofs);
        if (durum.parcalar && al > 0) durum.parcalar.push(bekleyen.subarray(ofs, ofs + al));
        ofs += al;
        durum.kalan -= al;
        if (durum.kalan > 0) break;
        const dol = Math.min(durum.dolgu, bekleyen.length - ofs);
        ofs += dol;
        durum.dolgu -= dol;
        if (durum.dolgu > 0) break;
        const veri = durum.parcalar ? Buffer.concat(durum.parcalar).toString('utf8') : null;
        if (durum.ozel === 'L') uzunAd = veri.replace(/\0.*$/s, '');
        else if (durum.ozel === 'x') { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(veri); paxAd = m ? m[1] : null; }
        else if (durum.d && veri !== null) durum.d.icerik = veri;
        durum = null;
        continue;
      }
      if (bekleyen.length - ofs < 512) break;
      const h = bekleyen.subarray(ofs, ofs + 512);
      ofs += 512;
      if (h.every((b) => b === 0)) { bitti = true; break; }
      durum = basligiIsle(h);
    }
    bekleyen = Buffer.from(bekleyen.subarray(ofs));
  }
  return { yaz, dosyalar, get bitti() { return bitti; } };
}

/** Tar baytlarını (tek parça) dosya listesine çevirir — sondalar için. */
export function tarListele(tum, icerikIste = () => false) {
  const a = tarAkisi(icerikIste);
  a.yaz(tum);
  return a.dosyalar;
}

// ── Ölçüm: docker image inspect + docker export akışı ────────────────────────────
class Olculemedi extends Error {}

function docker(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000 });
  if (r.error) throw new Olculemedi(`docker çalıştırılamadı (${r.error.code || r.error.message})`);
  return r;
}

function imajSec(istenen) {
  if (istenen) return istenen;
  const r = docker(['image', 'ls', '--filter', 'label=tr.tekserp.imaj=korumali', '--format', '{{.Repository}}:{{.Tag}}']);
  const ilk = r.status === 0 ? r.stdout.split('\n').map((s) => s.trim()).find((s) => s && !s.includes('<none>')) : null;
  if (!ilk) throw new Olculemedi('korumalı imaj yok (label tr.tekserp.imaj=korumali) — önce derle ya da --imaj= ver');
  return ilk;
}

async function olc(imaj) {
  const ins = docker(['image', 'inspect', imaj, '--format', '{{json .Config}}']);
  if (ins.status !== 0) throw new Olculemedi(`imaj bulunamadı: ${imaj}`);
  const config = JSON.parse(ins.stdout);
  const cr = docker(['create', '--platform', 'linux/amd64', imaj]);
  if (cr.status !== 0) throw new Olculemedi(`docker create düştü: ${cr.stderr.trim().slice(0, 200)}`);
  const id = cr.stdout.trim();
  try {
    const akis = tarAkisi((ad) => /^app\/dist\/tools\/[^/]+\.cjs$/.test(ad));
    await new Promise((coz, red) => {
      const p = spawn('docker', ['export', id], { stdio: ['ignore', 'pipe', 'pipe'] });
      let hataMetni = '';
      p.stdout.on('data', (c) => akis.yaz(c));
      p.stderr.on('data', (c) => { hataMetni += c; });
      p.on('error', (e) => red(new Olculemedi(`docker export: ${e.message}`)));
      p.on('close', (kod) => (kod === 0 ? coz() : red(new Olculemedi(`docker export çıkış ${kod}: ${hataMetni.slice(0, 200)}`))));
    });
    if (!akis.bitti || akis.dosyalar.length === 0) throw new Olculemedi('tar akışı eksik/boş okundu');
    return { user: config.User, dosyalar: akis.dosyalar };
  } finally {
    docker(['rm', id]);
  }
}

// ── Sondalar: temiz örnek YEŞİL (pozitif), her mutasyon KENDİ koduyla KIRMIZI (negatif) ──
function temizOrnek() {
  const f = (ad, ek = {}) => ({ ad, boyut: 10, uid: 0, mod: 0o644, tip: 'dosya', ...ek });
  return {
    user: '10001:10001',
    dosyalar: [
      ...ZORUNLU.map((z) => f(z)),
      f('app/dist/tools/seed.cjs', { icerik: '"use strict";var a=1;' }),
      f('app/prisma/migrations/20260101000000_x/migration.sql'),
      f('app/node_modules/zod/index.d.ts'),
      f('app/node_modules/pkg/src/kendi.ts', { uid: 0 }),
      f('etc/machine-id', { boyut: 0 }),
    ].filter((d, i, a) => a.findIndex((x) => x.ad === d.ad) === i),
  };
}
const MUTASYONLAR = [
  ['K1', 'root kullanıcı', (o) => { o.user = ''; }],
  ['K1', '0:0 kullanıcı', (o) => { o.user = '0:0'; }],
  ['K2 kaynak dizini', 'src dizini (.js bile)', (o) => o.dosyalar.push({ ad: 'app/src/lib/x.js', boyut: 5, uid: 0, mod: 0o644, tip: 'dosya' })],
  ['K2 TypeScript', 'seed .ts', (o) => o.dosyalar.push({ ad: 'app/prisma/seed.ts', boyut: 5, uid: 0, mod: 0o644, tip: 'dosya' })],
  ['K2 kaynak haritası', 'kaynak haritası', (o) => o.dosyalar.push({ ad: 'app/dist/server.cjs.map', boyut: 5, uid: 0, mod: 0o644, tip: 'dosya' })],
  ['K3', 'tsx paketi', (o) => o.dosyalar.push({ ad: 'app/node_modules/tsx/package.json', boyut: 5, uid: 0, mod: 0o644, tip: 'dosya' })],
  ['K4 bytenode', 'server.cjs kaldı', (o) => o.dosyalar.push({ ad: 'app/dist/server.cjs', boyut: 5, uid: 0, mod: 0o644, tip: 'dosya' })],
  ['K4 araç', 'karartılmamış araç', (o) => { o.dosyalar.find((d) => d.ad === 'app/dist/tools/seed.cjs').icerik = '\n// src/lib/prisma.ts\nvar a=1;'; }],
  ['K5 zorunlu parça yok: app/dist/server.jsc', '.jsc yok', (o) => { o.dosyalar = o.dosyalar.filter((d) => d.ad !== 'app/dist/server.jsc'); }],
  ['K5 zorunlu parça yok: app/native', 'native yok', (o) => { o.dosyalar = o.dosyalar.filter((d) => !d.ad.startsWith('app/native/')); }],
  ['K5 migration', 'migration yok', (o) => { o.dosyalar = o.dosyalar.filter((d) => !d.ad.includes('/migrations/')); }],
  ['K6', 'yazılabilir .jsc', (o) => { o.dosyalar.find((d) => d.ad === 'app/dist/server.jsc').mod = 0o666; }],
  ['K6', 'kullanıcıya ait app', (o) => { o.dosyalar.find((d) => d.ad === 'app/dist/server.js').uid = 10001; }],
  ['K7 imajda dolu', 'dolu machine-id', (o) => { o.dosyalar.find((d) => d.ad === 'etc/machine-id').boyut = 33; }],
  ['K7 ortam', '.env', (o) => o.dosyalar.push({ ad: 'app/.env', boyut: 5, uid: 0, mod: 0o600, tip: 'dosya' })],
];

function tarBaslik(ad, boyut, tip = '0') {
  const h = Buffer.alloc(512);
  h.write(ad, 0, 100, 'utf8');
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(boyut.toString(8).padStart(11, '0') + '\0', 124);
  h.write(tip, 156);
  return h;
}

function sondalar() {
  let kirmizi = 0;
  const bak = (kosul, ad) => { console.log(`  ${kosul ? '✓' : '✖'} ${ad}`); if (!kosul) kirmizi++; };
  const p0 = denetle(temizOrnek());
  bak(p0.length === 0, `P0 temiz örnek YEŞİL (${p0.length} ihlal${p0.length ? ': ' + p0.join(' | ') : ''})`);
  for (const [kod, ad, mut] of MUTASYONLAR) {
    const o = temizOrnek();
    const once = JSON.stringify(o);
    mut(o);
    const uygulandi = JSON.stringify(o) !== once;
    const ih = denetle(o);
    bak(uygulandi && ih.some((x) => x.startsWith(kod)), `N ${kod} ${ad} → kırmızı${uygulandi ? '' : ' (MUTASYON UYGULANMADI)'}`);
  }
  // Ayrıştırıcı: uzun ad (GNU L) + PAX path + içerik okuma + parça parça besleme.
  const uzun = `app/node_modules/${'x'.repeat(120)}/a.js`;
  const icerik = Buffer.from('// src/lib/x.ts\n');
  const pax = Buffer.from(`${('app/dist/tools/pax.cjs'.length + 7 + 3).toString()} path=app/dist/tools/pax.cjs\n`);
  const pad = (b) => Buffer.concat([b, Buffer.alloc(Math.ceil(b.length / 512) * 512 - b.length)]);
  const tar = Buffer.concat([
    tarBaslik('././@LongLink', uzun.length + 1, 'L'), pad(Buffer.from(uzun + '\0')), tarBaslik('kisa', 0),
    tarBaslik('PaxHeaders/x', pax.length, 'x'), pad(pax), tarBaslik('kisa2', icerik.length), pad(icerik),
    Buffer.alloc(1024),
  ]);
  const a = tarAkisi((ad) => ad.endsWith('.cjs'));
  for (let i = 0; i < tar.length; i += 97) a.yaz(tar.subarray(i, i + 97));
  bak(a.bitti && a.dosyalar[0]?.ad === uzun, 'T1 GNU uzun ad (97 baytlık parçalarla)');
  bak(a.dosyalar[1]?.ad === 'app/dist/tools/pax.cjs' && a.dosyalar[1]?.icerik === icerik.toString(), 'T2 PAX path + içerik');
  bak(denetle({ user: '10001', dosyalar: a.dosyalar }).some((x) => x.startsWith('K4 araç')), 'T3 ayrıştırılan içerik K4\'e ulaşır');
  return kirmizi;
}

async function main() {
  if (process.argv.includes('--sonda')) {
    console.log('== test_korumali_imaj --sonda ==');
    const k = sondalar();
    console.log(k ? `\n  ✖ ${k} sonda tutmadı` : '\n  ✓ bütün sondalar tuttu');
    process.exit(k ? 1 : 0);
  }
  const istenen = process.argv.find((a) => a.startsWith('--imaj='))?.slice(7) || process.env.TEKSERP_KORUMALI_IMAJ || null;
  let imaj = istenen;
  try {
    imaj = imajSec(istenen);
    const olcum = await olc(imaj);
    const ih = denetle(olcum);
    console.log(`== test_korumali_imaj — ${imaj} (${olcum.dosyalar.length} girdi, User=${olcum.user || '∅'}) ==`);
    if (ih.length) {
      for (const x of ih.slice(0, 40)) console.log(`  ✖ ${x}`);
      console.log(`\n  ✖ KIRMIZI: ${ih.length} ihlal`);
      process.exit(1);
    }
    console.log('  ✓ K1–K7 temiz: kaynak/harita/tsx yok, root değil, zorunlu parçalar var');
    process.exit(0);
  } catch (e) {
    if (e instanceof Olculemedi) {
      console.log(`== test_korumali_imaj — ÖLÇÜLEMEDİ ==\n  ⚠ ${e.message}\n  (yeşil DEĞİL: imaj içeriği ölçülmedi)`);
      process.exit(2);
    }
    throw e;
  }
}

main();
