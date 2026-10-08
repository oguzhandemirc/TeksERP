#!/usr/bin/env node
// Gizlilik sayfası canlı ölçümü — internetten SALT OKUMA (curl). Paket yok.
//   node deploy/gizlilik-sayfasi/olc.mjs              # sayfa + köken + komşular (DNS kaydı açıldıktan sonra)
//   node deploy/gizlilik-sayfasi/olc.mjs --adnansahin # yalnız komşular: adnansahin eski adresi 200 · indir kapısı 403
// Çıkış: 0 hepsi geçti · 1 en az biri düştü.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADRES = 'https://tekserp.etkiliyazilim.com/gizlilik';
const KOKEN_IP = '80.253.255.188';
const HTML = fs.readFileSync(path.join(KOK, 'deploy/gizlilik-sayfasi/html/gizlilik.html'));

/** curl ile tek istek: { kod, baslik: {ad→değer}, govde: Buffer } (yönlendirme izlenmez). */
function iste(url, ek = []) {
  const ayrac = '\n@@GOVDE@@\n';
  let cikti;
  try {
    cikti = execFileSync('curl', ['-s', '-m', '15', '-D', '-', '-o', '-', '-w', `${ayrac}%{http_code}`, ...ek, url], { maxBuffer: 8 << 20 });
  } catch (e) {
    cikti = Buffer.isBuffer(e.stdout) && e.stdout.length ? e.stdout : Buffer.from(`${ayrac}0`); // ad çözülmedi / bağlantı yok → kod 0
  }
  const i = cikti.lastIndexOf(Buffer.from(ayrac));
  const kod = Number(cikti.subarray(i + ayrac.length).toString());
  const ham = cikti.subarray(0, i);
  const b = ham.indexOf('\r\n\r\n');
  const baslik = {};
  for (const s of (b < 0 ? ham : ham.subarray(0, b)).toString().split('\r\n').slice(1)) {
    const j = s.indexOf(':');
    if (j > 0) baslik[s.slice(0, j).trim().toLowerCase()] = s.slice(j + 1).trim();
  }
  return { kod, baslik, govde: b < 0 ? Buffer.alloc(0) : ham.subarray(b + 4) };
}

let dusen = 0;
function bak(ad, kosul, ayrinti = '') {
  if (!kosul) dusen++;
  console.log(`${kosul ? '✅' : '❌'} ${ad}${kosul || !ayrinti ? '' : ` — ${ayrinti}`}`);
}

function komsular() {
  for (const u of ['https://guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml', 'https://guncelleme.etkiliyazilim.com/adnansahin/mobil/apk/surum.json']) {
    const r = iste(u);
    bak(`adnansahin ${new URL(u).pathname} → 200`, r.kod === 200, `HTTP ${r.kod}`);
  }
  const r = iste('https://indir.etkiliyazilim.com/test/electron/latest.yml');
  bak('indir kapısı belirteçsiz → 403', r.kod === 403, `HTTP ${r.kod}`);
}

async function sayfa() {
  const { host, pathname } = new URL(ADRES);
  let ipler = [];
  try { ipler = await dns.resolve4(host); } catch { /* aşağıda düşer */ }
  bak(`DNS ${host} çözülüyor ve proxy açık (köken IP'si görünmez)`, ipler.length > 0 && !ipler.includes(KOKEN_IP), `A: ${ipler.join(',') || 'YOK'}`);

  const r = iste(ADRES);
  bak(`${pathname} → 200`, r.kod === 200, `HTTP ${r.kod}`);
  bak('text/html; charset=utf-8', /^text\/html;\s*charset=utf-8$/i.test(r.baslik['content-type'] ?? ''), r.baslik['content-type']);
  bak('Cache-Control kısa (max-age=300)', /max-age=300\b/.test(r.baslik['cache-control'] ?? ''), r.baslik['cache-control']);
  bak('CSP default-src none', /default-src 'none'/.test(r.baslik['content-security-policy'] ?? ''));
  const ozet = (x) => crypto.createHash('sha256').update(x).digest('hex').slice(0, 12);
  bak('yayındaki sayfa repodakiyle bayt-eşit', r.govde.equals(HTML), `yayın ${ozet(r.govde)} ↔ repo ${ozet(HTML)}`);
  bak('sayfada yer tutucu yok', r.kod === 200 && !/\[[A-ZÇĞİÖŞÜ][^\]\n]{1,80}\]/.test(r.govde.toString()));

  const s = iste(`${ADRES}/`);
  bak(`${pathname}/ → 301 ${pathname}`, s.kod === 301 && s.baslik.location === pathname, `HTTP ${s.kod} ${s.baslik.location ?? ''}`);
  const k = iste(`https://${host}/`);
  bak(`/ → 302 ${pathname}`, k.kod === 302 && k.baslik.location === pathname, `HTTP ${k.kod} ${k.baslik.location ?? ''}`);
  const y = iste(`https://${host}/yok-${Date.now()}`);
  bak('bulunamayan → 404 no-store', y.kod === 404 && /no-store/.test(y.baslik['cache-control'] ?? ''), `HTTP ${y.kod} ${y.baslik['cache-control'] ?? ''}`);
  const d = iste(ADRES, ['-k', '--resolve', `${host}:443:${KOKEN_IP}`]);
  bak("köke doğrudan (Cloudflare'siz) → 403", d.kod === 403, `HTTP ${d.kod}`);
}

if (!process.argv.includes('--adnansahin')) await sayfa();
komsular();
console.log(dusen ? `\n❌ ${dusen} ölçüm düştü` : '\n✅ hepsi geçti');
process.exit(dusen ? 1 : 0);
