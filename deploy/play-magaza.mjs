#!/usr/bin/env node
// =============================================================================
// TeksERP — Google Play MAĞAZA GİRİŞİ (metin + görsel + iletişim) ve Yönetim üretim kademesi (androidpublisher v3)
// =============================================================================
//   node deploy/play-magaza.mjs --app=yonetim|tablet                  # KURU: Play'deki girişi okur (edit açılır → SİLİNİR)
//   node deploy/play-magaza.mjs --app=yonetim|tablet --uygula         # tek edit: details + listings + images → commit → geri oku
//   node deploy/play-magaza.mjs --app=yonetim --uretim=1 --yuzde=20 --uygula   # üretime kademeli atama (yalnız yonetim)
//
// Kaynak: <app>/magaza/metinler.json + magaza/gorseller/{icon.png, featureGraphic.png, <imageType>/*.png}.
// Görseller her dilde AYNI dosyalardan yüklenir. Servis hesabı anahtarının içeriği hiçbir çıktıya girmez.
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/';
const YUKLEME = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ANAHTAR = path.join(os.homedir(), '.tekserp', 'sirlar', 'play-yayinci.json');

export const UYGULAMALAR = Object.freeze({
  yonetim: { paket: 'com.etkiliyazilim.tekserp.yonetim', dizin: 'patron/uygulama/magaza', uretimSerbest: true },
  tablet: { paket: 'com.etkiliyazilim.tekserp', dizin: 'mobil/magaza', uretimSerbest: false },
});
const TEKIL = ['icon', 'featureGraphic'];
const COKLU = ['phoneScreenshots', 'sevenInchScreenshots', 'tenInchScreenshots'];
const SINIR = { title: 30, shortDescription: 80, fullDescription: 4000 };

export function argumanlar(argv) {
  const o = { uygula: false };
  for (const a of argv) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`tanınmayan argüman: ${a}`);
    if (m[1] === 'uygula' && m[2] === undefined) o.uygula = true;
    else if (['app', 'uretim', 'yuzde'].includes(m[1]) && m[2]) o[m[1]] = m[2];
    else throw new Error(`tanınmayan argüman: ${a}`);
  }
  if (!UYGULAMALAR[o.app]) throw new Error('--app=yonetim|tablet zorunlu');
  if (o.uretim && !UYGULAMALAR[o.app].uretimSerbest) throw new Error(`${o.app} için üretim ataması bu araçla YAPILMAZ`);
  if (o.uretim && !/^\d+$/.test(o.uretim)) throw new Error('--uretim=<versionCode>');
  if (o.uretim && !(Number(o.yuzde) > 0 && Number(o.yuzde) <= 100)) throw new Error('--yuzde=1..100 zorunlu');
  return o;
}

/** metinler.json'u ve görsel dosyalarını okur, Play sınırlarını ölçer. */
export function kaynakOku(dizin) {
  const m = JSON.parse(fs.readFileSync(path.join(dizin, 'metinler.json'), 'utf8'));
  for (const [dil, l] of Object.entries(m.listings)) {
    for (const [alan, sinir] of Object.entries(SINIR)) {
      const n = [...String(l[alan] ?? '')].length;
      if (!n || n > sinir) throw new Error(`${dil}.${alan} uzunluğu ${n} (1..${sinir})`);
    }
  }
  if (!m.listings[m.details?.defaultLanguage]) throw new Error('details.defaultLanguage listings içinde yok');
  const gd = path.join(dizin, 'gorseller');
  const gorsel = {};
  for (const t of TEKIL) {
    const y = path.join(gd, `${t}.png`);
    if (fs.existsSync(y)) gorsel[t] = [y];
  }
  for (const t of COKLU) {
    const d = path.join(gd, t);
    if (fs.existsSync(d)) gorsel[t] = fs.readdirSync(d).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(d, f));
    if (gorsel[t] && gorsel[t].length > 8) throw new Error(`${t}: en çok 8 görüntü`);
  }
  return { metin: m, gorsel };
}

function jwt(a) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = Math.floor(Date.now() / 1000);
  const g = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: TOKEN_URL, iat: t, exp: t + 600 })}`;
  return `${g}.${crypto.createSign('RSA-SHA256').update(g).sign(a.private_key).toString('base64url')}`;
}

async function istemci(paket) {
  const st = fs.statSync(ANAHTAR);
  if (st.mode & 0o077) throw new Error('servis hesabı anahtarı başkalarınca okunabilir');
  const a = JSON.parse(fs.readFileSync(ANAHTAR, 'utf8'));
  const y = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt(a) }) });
  const j = await y.json();
  if (!j.access_token) throw new Error(`Google oturumu açılamadı: ${j.error ?? y.status}`);
  const tok = j.access_token;
  const B = `${API}${paket}`;
  const istek = async (yontem, url, govde, tur) => {
    const r = await fetch(url, { method: yontem, headers: { authorization: `Bearer ${tok}`, ...(tur ? { 'content-type': tur } : {}) }, body: govde });
    const metin = await r.text();
    let js = null;
    try { js = metin ? JSON.parse(metin) : {}; } catch { /* düz metin */ }
    if (!r.ok) {
      const e = new Error(`Play ${r.status}: ${yontem} ${url.replace(API, '').replace(YUKLEME, '').replace(/\?.*$/, '')}`);
      e.ayrinti = js?.error ?? metin;
      throw e;
    }
    return js ?? {};
  };
  const json = (o) => JSON.stringify(o);
  return {
    editAc: async () => (await istek('POST', `${B}/edits`)).id,
    editSil: (e) => istek('DELETE', `${B}/edits/${e}`).catch(() => null),
    commit: (e) => istek('POST', `${B}/edits/${e}:commit`),
    details: (e) => istek('GET', `${B}/edits/${e}/details`),
    detailsYaz: (e, d) => istek('PUT', `${B}/edits/${e}/details`, json(d), 'application/json'),
    listings: async (e) => (await istek('GET', `${B}/edits/${e}/listings`)).listings ?? [],
    listingYaz: (e, dil, l) => istek('PUT', `${B}/edits/${e}/listings/${dil}`, json({ language: dil, ...l }), 'application/json'),
    gorseller: async (e, dil, t) => (await istek('GET', `${B}/edits/${e}/listings/${dil}/${t}`)).images ?? [],
    gorselSilHepsi: (e, dil, t) => istek('DELETE', `${B}/edits/${e}/listings/${dil}/${t}`),
    gorselYukle: (e, dil, t, veri) => istek('POST', `${YUKLEME}${paket}/edits/${e}/listings/${dil}/${t}?uploadType=media`, veri, 'image/png'),
    kanallar: async (e) => (await istek('GET', `${B}/edits/${e}/tracks`)).tracks ?? [],
    kanalYaz: (e, ad, surum) => istek('PUT', `${B}/edits/${e}/tracks/${ad}`, json({ track: ad, releases: [surum] }), 'application/json'),
  };
}

async function oku(p, e, diller) {
  const d = await p.details(e);
  console.log(`details: ${JSON.stringify(d)}`);
  const ls = await p.listings(e);
  for (const l of ls) console.log(`listing ${l.language}: başlık "${l.title}" · kısa ${[...(l.shortDescription ?? '')].length} · tam ${[...(l.fullDescription ?? '')].length} karakter`);
  for (const dil of new Set([...diller, ...ls.map((l) => l.language)])) {
    const say = [];
    if (!ls.some((l) => l.language === dil)) { console.log(`görsel ${dil}: (dil girişi yok)`); continue; }
    for (const t of [...TEKIL, ...COKLU]) say.push(`${t}=${(await p.gorseller(e, dil, t)).length}`);
    console.log(`görsel ${dil}: ${say.join(' ')}`);
  }
  for (const t of await p.kanallar(e)) {
    console.log(`kanal ${t.track}: ${(t.releases ?? []).map((r) => `${r.status}:${(r.versionCodes ?? []).join(',')}${r.userFraction ? `@${r.userFraction}` : ''}`).join(' ') || '(boş)'}`);
  }
  return { d, ls };
}

async function main() {
  const o = argumanlar(process.argv.slice(2));
  const u = UYGULAMALAR[o.app];
  const kaynakVar = fs.existsSync(path.join(KOK, u.dizin, 'metinler.json'));
  const kaynak = o.uretim || (!o.uygula && !kaynakVar) ? null : kaynakOku(path.join(KOK, u.dizin));
  const diller = kaynak ? Object.keys(kaynak.metin.listings) : ['tr-TR'];
  const p = await istemci(u.paket);
  console.log(`uygulama ${u.paket}`);
  let e = await p.editAc();
  try {
    if (!o.uygula) {
      await oku(p, e, diller);
      if (kaynak) for (const [t, ds] of Object.entries(kaynak.gorsel)) console.log(`plan ${t}: ${ds.length} dosya`);
      return;
    }
    if (o.uretim) {
      const notMetni = String(fs.readFileSync(path.join(KOK, UYGULAMALAR.yonetim.dizin, `surum-notu-vc${o.uretim}.tr-TR.txt`), 'utf8')).trim();
      if ([...notMetni].length > 500) throw new Error('sürüm notu > 500');
      const surum = { versionCodes: [o.uretim], status: Number(o.yuzde) === 100 ? 'completed' : 'inProgress',
        releaseNotes: [{ language: 'tr-TR', text: notMetni }] };
      if (Number(o.yuzde) < 100) surum.userFraction = Number(o.yuzde) / 100;
      await p.kanalYaz(e, 'production', surum);
      console.log(`üretim taslağı yazıldı: vc${o.uretim} %${o.yuzde}`);
    } else {
      const m = kaynak.metin;
      await p.detailsYaz(e, m.details);
      for (const [dil, l] of Object.entries(m.listings)) {
        await p.listingYaz(e, dil, l);
        for (const [t, dosyalar] of Object.entries(kaynak.gorsel)) {
          await p.gorselSilHepsi(e, dil, t);
          for (const f of dosyalar) await p.gorselYukle(e, dil, t, fs.readFileSync(f));
          console.log(`${dil} ${t}: ${dosyalar.length} yüklendi`);
        }
      }
    }
    await p.commit(e);
    e = null;
    console.log('EDIT COMMIT EDİLDİ — geri okunuyor');
    const e2 = await p.editAc();
    try { await oku(p, e2, diller); } finally { await p.editSil(e2); }
  } finally {
    if (e) await p.editSil(e);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`DUR: ${err.message}`);
    if (err.ayrinti) console.error(JSON.stringify(err.ayrinti, null, 2));
    process.exit(1);
  });
}
