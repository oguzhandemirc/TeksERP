#!/usr/bin/env node
// =============================================================================
// PLAY YAYINCISI (deploy/play-yayinla.mjs) — ağsız (sahte fetch), DB'siz; geçici git deposu + sahte AAB.
//   §1 kanal: production/beta/bilinmeyen RED, ağa çıkmadan · kök kanalda --terfi-atla RED
//   §2 sürüm notu: tablet maddeleri, 500 sınırı (501 RED), notsuz sürüm RED
//   §3 kuru: Play yalnız OKUNUR (yazan çağrı yok, edit silinir) · zaten yayında = 0
//   §4 kapılar: küçük/eşit versionCode · paket adı · künye özeti · AAB doğrulaması · aynı vc başka bayt · Play'in aldığı bayt
//   §5 uygula: yükle → ata → onayla → geri oku → defter + sürüm etiketi; kapalı test terfi (etiket, dahilide aynı bayt, kaçış)
//   §6 sır: anahtar içeriği ve erişim belirteci hiçbir çıktıda/adreste yok · gevşek izinli anahtar RED
// Koşum: node scripts/test_play_yayinla.mjs
// =============================================================================
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { calistir, playNotu, NOT_SINIRI } from '../deploy/play-yayinla.mjs';
import { KAYIT_REL } from './lib/dagitim.mjs';

for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k];
const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let gecti = 0;
let kaldi = 0;
const ol = (ad, kosul, ayrinti = '') => { kosul ? gecti++ : kaldi++; console.log(`  ${kosul ? '✅' : '❌'} ${ad}${!kosul && ayrinti ? ` — ${String(ayrinti).slice(0, 900)}` : ''}`); };

/* ---- sahte AAB: zip + aapt2 protobuf manifest ---- */
function zipYaz(yol, girdiler) {
  const yerel = []; const merkez = []; let ofset = 0;
  for (const { ad, veri } of girdiler) {
    const adB = Buffer.from(ad); const sik = zlib.deflateRawSync(veri); const crc = zlib.crc32 ? zlib.crc32(veri) : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(sik.length, 18); lh.writeUInt32LE(veri.length, 22); lh.writeUInt16LE(adB.length, 26);
    yerel.push(lh, adB, sik);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(sik.length, 20); ch.writeUInt32LE(veri.length, 24); ch.writeUInt16LE(adB.length, 28); ch.writeUInt32LE(ofset, 42);
    merkez.push(ch, adB); ofset += 30 + adB.length + sik.length;
  }
  const cd = Buffer.concat(merkez); const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(girdiler.length, 8); eocd.writeUInt16LE(girdiler.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(ofset, 16);
  fs.writeFileSync(yol, Buffer.concat([...yerel, cd, eocd]));
}
const pbVarint = (n) => { const o = []; do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 0x80; o.push(x); } while (n); return Buffer.from(o); };
const pbAlan = (no, v) => { const b = Buffer.isBuffer(v) ? v : Buffer.from(String(v)); return Buffer.concat([pbVarint(no * 8 + 2), pbVarint(b.length), b]); };
const pbOz = (ad, deger) => pbAlan(4, Buffer.concat([pbAlan(2, ad), pbAlan(3, deger)]));
const pbOge = (ad, ozler = []) => pbAlan(1, Buffer.concat([pbAlan(3, ad), ...ozler]));

/* ---- geçici depo (dağıtım kaydı + not dosyası + git HEAD) ---- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'play-yayinla-'));
const depo = path.join(tmp, 'depo');
fs.mkdirSync(path.join(depo, 'deploy'), { recursive: true });
fs.mkdirSync(path.join(depo, 'mobil/src/data'), { recursive: true });
fs.copyFileSync(path.join(KOK, KAYIT_REL), path.join(depo, KAYIT_REL));
const PAKET = JSON.parse(fs.readFileSync(path.join(KOK, KAYIT_REL), 'utf8')).urun.tablet.androidPaket;
const notlar = (metin) => fs.writeFileSync(path.join(depo, 'mobil/src/data/surum-notlari.json'), JSON.stringify({ yayinlar: [
  { id: 'x', surumler: { tablet: '9.1.0' }, maddeler: [{ kapsam: 'tablet', metin }, { kapsam: 'panel', metin: 'PANEL-MADDESI' }] },
] }));
notlar('Tablet kısa not.');
const g = (...a) => execFileSync('git', a, { cwd: depo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
g('init', '-q'); g('-c', 'user.name=b', '-c', 'user.email=b@b', 'commit', '-q', '--allow-empty', '-m', 'b');
const BAS = g('rev-parse', 'HEAD');

function aabYaz({ paket = PAKET, vc = 61, ad = '9.1.0', kunye = true, kunyeSha = null } = {}) {
  const yol = path.join(tmp, `a-${crypto.randomUUID()}.aab`);
  zipYaz(yol, [{ ad: 'base/manifest/AndroidManifest.xml', veri: pbOge('manifest', [pbOz('package', paket), pbOz('versionCode', String(vc)), pbOz('versionName', ad)]) }]);
  const b = fs.readFileSync(yol);
  const sha256 = crypto.createHash('sha256').update(b).digest('hex');
  if (kunye) {
    fs.writeFileSync(`${yol}.derleme.json`, JSON.stringify({ v: 1, urun: 'tablet-aab', kanal: null, surum: ad, commit: BAS, dosya: path.basename(yol),
      boyut: b.length, sha256: kunyeSha ?? sha256, sha512: crypto.createHash('sha512').update(b).digest('base64'), versionCode: vc }));
  }
  return { yol, sha256 };
}

/* ---- anahtar (gerçek RSA, içerik izlenir) ---- */
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const anahtarYolu = path.join(tmp, 'anahtar.json');
fs.writeFileSync(anahtarYolu, JSON.stringify({ client_email: 'yayinci@ornek.iam.gserviceaccount.com', private_key: PEM, private_key_id: 'GIZLI-KIMLIK-0123' }), { mode: 0o600 });
const ERISIM = 'ERISIM-BELIRTECI-0f9e8d';

/* ---- sahte Play ---- */
function sahtePlay({ tracks = [], bundles = [], yuklenen = null, tokenHata = false, geriOkuma = null } = {}) {
  const cagri = [];
  const fetch = async (url, o = {}) => {
    const m = o.method ?? 'GET';
    cagri.push({ m, url, govde: typeof o.body === 'string' ? o.body : o.body instanceof URLSearchParams ? o.body.toString() : `<${o.body?.length ?? 0} B>`, auth: o.headers?.authorization ?? '' });
    const yanit = (d, j) => ({ ok: d < 300, status: d, text: async () => JSON.stringify(j), json: async () => j });
    if (url.startsWith('https://oauth2')) return tokenHata ? yanit(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }) : yanit(200, { access_token: ERISIM });
    if (m === 'POST' && url.endsWith('/edits')) return yanit(200, { id: `e${cagri.length}` });
    if (m === 'DELETE') return yanit(204, {});
    if (m === 'GET' && url.endsWith('/tracks')) return yanit(200, { tracks });
    if (m === 'GET' && url.endsWith('/bundles')) return yanit(200, { bundles });
    if (m === 'GET' && /\/tracks\/[a-z]+$/.test(url)) return yanit(200, geriOkuma ?? { releases: [] });
    if (m === 'POST' && url.includes('/upload/')) return yanit(200, yuklenen);
    if (m === 'PUT') return yanit(200, JSON.parse(o.body));
    if (m === 'POST' && url.endsWith(':commit')) return yanit(200, { id: 'c' });
    return yanit(404, { error: { message: `bilinmeyen ${m} ${url}` } });
  };
  return { fetch, cagri, yazan: () => cagri.filter((c) => c.m === 'PUT' || c.url.includes('/upload/') || c.url.endsWith(':commit')) };
}
const IC = (vc, status = 'completed') => ({ track: 'internal', releases: [{ status, versionCodes: [String(vc)] }] });

async function kos(argv, { play = sahtePlay(), aab, dogrula = { gecti: true, satirlar: ['✔ sahte doğrulama'] }, git = null, ek = {} } = {}) {
  const satir = [];
  const etiket = [];
  const defterYolu = path.join(tmp, `defter-${crypto.randomUUID()}.tsv`);
  const kod = await calistir([...argv, ...(aab ? [`--aab=${aab}`] : []), ...(argv.some((a) => a.startsWith('--anahtar')) ? [] : [`--anahtar=${anahtarYolu}`])], {
    kok: depo, fetch: play.fetch, yaz: (s) => satir.push(s), defterYolu, aabDogrula: () => dogrula,
    gitOlgulari: () => { if (!git) throw new Error('git olgusu beklenmiyordu'); return git; },
    etiketAt: (onEk, surum) => { etiket.push(`${onEk}-v${surum}`); return { durum: 'atildi', ad: `${onEk}-v${surum}` }; },
    terfiAtlaKaydi: (o) => { etiket.push(`terfi/${o.kod}/${o.urun}-v${o.surum}`); return { durum: 'atildi', ad: `terfi/${o.kod}/${o.urun}-v${o.surum}` }; },
    ...ek,
  });
  const cikti = satir.join('\n');
  return { kod, cikti, play, etiket, defter: fs.existsSync(defterYolu) ? fs.readFileSync(defterYolu, 'utf8') : null };
}

try {
  console.log('\n§1 kanal');
  for (const k of ['production', 'beta', 'uretim']) {
    const r = await kos([`--kanal=${k}`, '--uygula'], { aab: aabYaz().yol });
    ol(`1 ${k} reddedilir, ağa çıkılmaz`, r.kod === 1 && /REDDEDİLDİ|bilinmeyen kanal/.test(r.cikti) && r.play.cagri.length === 0, r.cikti);
  }
  { const r = await kos([], { aab: aabYaz().yol }); ol('1 kanalsız çağrı DUR', r.kod === 1 && /--kanal/.test(r.cikti), r.cikti); }
  { const r = await kos(['--kanal=internal', '--terfi-atla=Kullanıcı bu sürümü test etmeden onayladı'], { aab: aabYaz().yol });
    ol('1 kök kanalda --terfi-atla RED', r.kod === 1 && /kök grup terfi istemez/.test(r.cikti) && r.play.cagri.length === 0, r.cikti); }

  console.log('\n§2 sürüm notu');
  const notJ = (metin, kapsam = 'tablet') => ({ yayinlar: [{ surumler: { tablet: '9.1.0' }, maddeler: [{ kapsam, metin }, { kapsam: 'panel', metin: 'P' }] }] });
  { const n = playNotu(notJ('a'.repeat(NOT_SINIRI - 2)), '9.1.0'); ol('2 500 karakterlik not geçer, panel maddesi girmez', n.uzunluk === NOT_SINIRI && !n.metin.includes('P')); }
  { let h = null; try { playNotu(notJ('a'.repeat(NOT_SINIRI - 1)), '9.1.0'); } catch (e) { h = e.message; } ol('2 501 karakter RED', /501 > 500/.test(h ?? ''), h); }
  { let h = null; try { playNotu(notJ('x'), '9.9.9'); } catch (e) { h = e.message; } ol('2 notsuz sürüm RED', /sürüm notu YOK/.test(h ?? ''), h); }
  { const n = playNotu(notJ('ortak', 'her-ikisi'), '9.1.0'); ol('2 her-ikisi maddesi girer', n.metin === '• ortak'); }
  notlar('ç'.repeat(NOT_SINIRI + 10));
  { const r = await kos(['--kanal=internal', '--uygula'], { aab: aabYaz().yol, play: sahtePlay({ tracks: [IC(60)] }) });
    ol('2 uzun notla yayın DUR, Play\'e yazılmaz', r.kod === 1 && /Play sınırını aşıyor/.test(r.cikti) && r.play.yazan().length === 0, r.cikti); }
  notlar('Tablet kısa not.');

  console.log('\n§3 kuru');
  { const p = sahtePlay({ tracks: [IC(60)], bundles: [{ versionCode: 60, sha256: 'aa' }] });
    const r = await kos(['--kanal=internal'], { aab: aabYaz().yol, play: p });
    ol('3 kuru: plan basılır, çıkış 0', r.kod === 0 && /KURU — Play'e hiçbir şey yazılmadı/.test(r.cikti) && /AAB yükle/.test(r.cikti), r.cikti);
    ol('3 kuru: yazan çağrı yok, edit silindi, defter yok', p.yazan().length === 0 && p.cagri.some((c) => c.m === 'DELETE') && r.defter === null && r.etiket.length === 0, JSON.stringify(p.cagri.map((c) => c.m + ' ' + c.url))); }
  { const a = aabYaz({ vc: 60, kunyeSha: '0'.repeat(64) });
    const r = await kos(['--kanal=internal', '--uygula'], { aab: a.yol, play: sahtePlay({ tracks: [IC(60)], bundles: [{ versionCode: 60, sha256: a.sha256 }] }) });
    ol('3 zaten yayında: çıkış 0, yazma yok (kapı bilgisi basılır)', r.kod === 0 && /ZATEN YAYINDA/.test(r.cikti) && r.play.yazan().length === 0 && /DURDURURDU/.test(r.cikti), r.cikti); }

  console.log('\n§4 kapılar');
  for (const vc of [59, 60]) {
    const r = await kos(['--kanal=internal', '--uygula'], { aab: aabYaz({ vc }).yol, play: sahtePlay({ tracks: [IC(58), { track: 'alpha', releases: [{ status: 'completed', versionCodes: ['60'] }] }] }) });
    ol(`4 vc ${vc} ≤ Play'deki en büyük 60 → RED`, r.kod === 1 && /✖ versionCode/.test(r.cikti) && r.play.yazan().length === 0, r.cikti);
  }
  { const r = await kos(['--kanal=internal', '--uygula'], { aab: aabYaz({ paket: 'com.baska.paket' }).yol, play: sahtePlay({ tracks: [IC(60)] }) });
    ol('4 paket adı farklı → RED', r.kod === 1 && /✖ paket adı/.test(r.cikti) && r.play.yazan().length === 0, r.cikti); }
  { const r = await kos(['--kanal=internal', '--uygula'], { aab: aabYaz({ kunyeSha: '1'.repeat(64) }).yol, play: sahtePlay({ tracks: [IC(60)] }) });
    ol('4 künye özeti tutmuyor → RED', r.kod === 1 && /künyedeki özetle TUTMUYOR/.test(r.cikti) && r.play.yazan().length === 0, r.cikti); }
  { const r = await kos(['--kanal=internal', '--uygula'], { aab: aabYaz({ kunye: false }).yol, play: sahtePlay({ tracks: [IC(60)] }) });
    ol('4 künyesiz AAB → RED', r.kod === 1 && /DERLEME KÜNYESİ YOK/.test(r.cikti) && r.play.yazan().length === 0, r.cikti); }
  { const r = await kos(['--kanal=internal', '--uygula'], { aab: aabYaz().yol, play: sahtePlay({ tracks: [IC(60)] }), dogrula: { gecti: false, satirlar: ['usesCleartextTraffic=true'] } });
    ol('4 AAB doğrulaması (izin/cleartext) düşerse RED', r.kod === 1 && /✖ AAB doğrulaması/.test(r.cikti) && /usesCleartextTraffic/.test(r.cikti) && r.play.yazan().length === 0, r.cikti); }
  { const r = await kos(['--kanal=internal', '--uygula'], { aab: aabYaz({ vc: 61 }).yol, play: sahtePlay({ tracks: [IC(60)], bundles: [{ versionCode: 61, sha256: 'b'.repeat(64) }] }) });
    ol('4 aynı vc Play\'de başka bayt → RED', r.kod === 1 && /aynı versionCode başka paket/.test(r.cikti) && r.play.yazan().length === 0, r.cikti); }
  { const a = aabYaz();
    const p = sahtePlay({ tracks: [IC(60)], yuklenen: { versionCode: 61, sha256: 'c'.repeat(64) } });
    const r = await kos(['--kanal=internal', '--uygula'], { aab: a.yol, play: p });
    ol('4 Play\'in aldığı bayt farklı → DUR, kanal atanmaz, edit silinir', r.kod === 1 && /gönderilenle aynı değil/.test(r.cikti) && !p.cagri.some((c) => c.m === 'PUT' || c.url.endsWith(':commit')) && p.cagri.at(-1).m === 'DELETE', r.cikti); }
  { const src = fs.readFileSync(path.join(KOK, 'deploy/play-yayinla.mjs'), 'utf8');
    ol('4 gerçek doğrulayıcı build-apk --aab --verify-only KOPYA üzerinde koşar', /mobil\/scripts\/build-apk\.mjs'\), '--aab', `--verify-only=\$\{kopya\}`/.test(src) && /copyFileSync\(aabYolu, kopya\)/.test(src)); }

  console.log('\n§5 uygula');
  { const a = aabYaz();
    const p = sahtePlay({ tracks: [IC(60)], yuklenen: { versionCode: 61, sha256: a.sha256 }, geriOkuma: { releases: [{ status: 'completed', versionCodes: ['61'] }] } });
    const r = await kos(['--kanal=internal', '--uygula'], { aab: a.yol, play: p });
    const put = p.cagri.find((c) => c.m === 'PUT');
    const govde = put ? JSON.parse(put.govde) : null;
    const sira = p.cagri.map((c) => (c.url.includes('/upload/') ? 'YUKLE' : c.m === 'PUT' ? 'ATA' : c.url.endsWith(':commit') ? 'ONAY' : null)).filter(Boolean).join('>');
    ol('5 dahili: yükle > ata > onayla, geri okundu, çıkış 0', r.kod === 0 && sira === 'YUKLE>ATA>ONAY' && /geri okundu/.test(r.cikti), `${sira}\n${r.cikti}`);
    ol('5 kanal gövdesi: internal, completed, tr-TR notu', govde?.track === 'internal' && govde.releases[0].status === 'completed' && govde.releases[0].versionCodes[0] === '61' && govde.releases[0].releaseNotes[0].language === 'tr-TR' && govde.releases[0].releaseNotes[0].text === '• Tablet kısa not.', put?.govde);
    ol('5 defter satırı + tablet-v etiketi', /\ttablet-9\.1\.0-play-internal\t.*\tvc61\tyukle\tdogrulandi\n$/.test(r.defter ?? '') && r.etiket.join() === 'tablet-v9.1.0', `${r.defter} ${r.etiket}`); }
  { const a = aabYaz();
    const p = sahtePlay({ tracks: [IC(60)], yuklenen: { versionCode: 61, sha256: a.sha256 }, geriOkuma: { releases: [] } });
    const r = await kos(['--kanal=internal', '--uygula'], { aab: a.yol, play: p });
    ol('5 geri okumada görünmüyorsa çıkış 1, defterde DOGRULANAMADI', r.kod === 1 && /DOGRULANAMADI/.test(r.defter ?? ''), r.cikti); }

  const gitOlgu = (terfi = true) => ({ bas: BAS, surumEtiketi: BAS, terfiEtiketi: terfi ? { tur: 'tag', commit: BAS, mesaj: 'Öncü fabrikalarda test ettim, kapalı teste çıkabilir. 2026-10-08 21:00' } : null });
  { const a = aabYaz();
    const p = sahtePlay({ tracks: [IC(61)], bundles: [{ versionCode: 61, sha256: a.sha256 }] });
    const r = await kos(['--kanal=alpha', '--uygula'], { aab: a.yol, play: p, git: gitOlgu(false) });
    ol('5 kapalı test: terfi etiketi yoksa RED', r.kod === 1 && /terfi\/oncu\/tablet-v9\.1\.0 onay etiketi YOK/.test(r.cikti) && p.yazan().length === 0, r.cikti); }
  { const a = aabYaz();
    const p = sahtePlay({ tracks: [IC(60)], bundles: [{ versionCode: 60, sha256: 'd'.repeat(64) }] });
    const r = await kos(['--kanal=alpha', '--uygula'], { aab: a.yol, play: p, git: gitOlgu() });
    ol('5 kapalı test: dahili testte olmayan sürüm RED', r.kod === 1 && /test kanalı GERİDE/.test(r.cikti) && p.yazan().length === 0, r.cikti); }
  { const a = aabYaz();
    const p = sahtePlay({ tracks: [IC(61)], bundles: [{ versionCode: 61, sha256: a.sha256 }], geriOkuma: { releases: [{ status: 'completed', versionCodes: ['61'] }] } });
    const r = await kos(['--kanal=alpha', '--uygula'], { aab: a.yol, play: p, git: gitOlgu() });
    ol('5 kapalı test: onaylı + dahilide aynı bayt → yüklemeden ata, onayla', r.kod === 0 && !p.cagri.some((c) => c.url.includes('/upload/')) && JSON.parse(p.cagri.find((c) => c.m === 'PUT').govde).track === 'alpha' && r.etiket.length === 0, r.cikti); }
  { const a = aabYaz();
    const p = sahtePlay({ tracks: [IC(61)], bundles: [{ versionCode: 61, sha256: a.sha256 }], geriOkuma: { releases: [{ status: 'completed', versionCodes: ['61'] }] } });
    const kisa = await kos(['--kanal=alpha', '--uygula', '--terfi-atla=evet'], { aab: a.yol, play: p });
    ol('5 kısa kaçış cümlesi RED', kisa.kod === 1 && /--terfi-atla REDDEDİLDİ/.test(kisa.cikti), kisa.cikti);
    const p2 = sahtePlay({ tracks: [IC(61)], bundles: [{ versionCode: 61, sha256: a.sha256 }], geriOkuma: { releases: [{ status: 'completed', versionCodes: ['61'] }] } });
    const r = await kos(['--kanal=alpha', '--uygula', '--terfi-atla=Acil düzeltme, kapalı teste etiketsiz çıkmasını ben istiyorum'], { aab: a.yol, play: p2 });
    ol('5 kullanıcı cümlesiyle kaçış: deftere ve terfi kaydına yazılır', r.kod === 0 && /terfi-atlandi: Acil düzeltme/.test(r.defter ?? '') && r.etiket.join() === 'terfi/oncu/tablet-v9.1.0', r.cikti); }

  console.log('\n§6 sır');
  { const a = aabYaz();
    const tumu = [];
    for (const play of [sahtePlay({ tracks: [IC(60)], yuklenen: { versionCode: 61, sha256: a.sha256 }, geriOkuma: { releases: [{ status: 'completed', versionCodes: ['61'] }] } }), sahtePlay({ tokenHata: true })]) {
      const r = await kos(['--kanal=internal', '--uygula'], { aab: a.yol, play });
      tumu.push(r.cikti, r.defter ?? '', ...play.cagri.map((c) => c.url));
    }
    const metin = tumu.join('\n');
    const pemGovde = PEM.split('\n')[1];
    ol('6 anahtar içeriği (özel anahtar, anahtar kimliği) ve erişim belirteci çıktıya/adrese/deftere sızmaz',
      !metin.includes(pemGovde) && !metin.includes('PRIVATE KEY') && !metin.includes('GIZLI-KIMLIK') && !metin.includes(ERISIM));
    ol('6 yalnız client_email basılır; belirteç hatası DUR', /yayinci@ornek\.iam\.gserviceaccount\.com/.test(metin) && /Google oturumu açılamadı/.test(metin)); }
  { const gevsek = path.join(tmp, 'gevsek.json');
    fs.copyFileSync(anahtarYolu, gevsek); fs.chmodSync(gevsek, 0o644);
    const p = sahtePlay();
    const r = await kos(['--kanal=internal', `--anahtar=${gevsek}`], { aab: aabYaz().yol, play: p });
    ol('6 başkalarınca okunabilir anahtar RED, ağa çıkılmaz', r.kod === 1 && /başkalarınca okunabilir/.test(r.cikti) && p.cagri.length === 0 && !r.cikti.includes(PEM.split('\n')[1]), r.cikti); }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${kaldi ? '❌' : '✅'} play-yayinla: ${gecti} geçti, ${kaldi} kaldı`);
process.exit(kaldi ? 1 : 0);
