#!/usr/bin/env node
// =============================================================================
// TeksERP — ORTAK TABLET AAB'Sİ → GOOGLE PLAY TEST KANALI (androidpublisher v3, bağımlılıksız)
// =============================================================================
//   node deploy/play-yayinla.mjs --kanal=internal [--aab=<yol>]            # KURU: ölçer, Play'i okur, planı basar
//   node deploy/play-yayinla.mjs --kanal=internal --uygula                  # yükler + kanala atar + geri okur
//   node deploy/play-yayinla.mjs --kanal=alpha --uygula [--terfi-atla="<kullanıcının cümlesi>"]
//
// Kanallar: internal (dahili test = kök grup, etiketsiz) · alpha (kapalı test = kökten sonraki grup; terfi etiketi
// `terfi/<grup>/tablet-vX` + dahili testteki AYNI bayt). production/beta bu araçla AÇILMAZ.
// Kapılar ağdan ÖNCE ölçülür; hedef kanalda aynı versionCode zaten yayındaysa iş yoktur (çıkış 0).
// Servis hesabı anahtarının içeriği hiçbir çıktıya girmez; yalnız client_email basılır.
// =============================================================================

import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { grupZinciri, kayitAyristir, KAYIT_REL, Olculemedi } from '../scripts/lib/dagitim.mjs';
import { apkKunyeYolu, derlemeBagiDenetimi, derlemeKunyesiOku, dosyaOzeti } from '../scripts/lib/derleme-bagi.mjs';
import { grupTerfiHukmu } from '../scripts/lib/grup-yayin.mjs';
import { cumleDenetle, istanbulSaati } from '../scripts/lib/kullanici-cumlesi.mjs';
import { etiketAt as gercekEtiketAt } from '../scripts/lib/surum.mjs';
import { gitOlgulari as gercekGitOlgulari, terfiAtlaKaydi as gercekTerfiAtlaKaydi, terfiRaporu } from '../scripts/lib/terfi.mjs';
import { zipGirdisiOku } from '../mobil/scripts/lib/zip.mjs';
import { protoManifestOgeleri } from '../mobil/scripts/lib/apk-kimlik.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Play kanalı → terfi zincirindeki sırası (0 = kök grup). Listede olmayan kanal reddedilir. */
export const PLAY_KANALLARI = Object.freeze({ internal: { ad: 'dahili test', sira: 0 }, alpha: { ad: 'kapalı test', sira: 1 } });
const REDDEDILEN = { production: 'üretim kanalı bu araçla açılmaz (hesabın üretim izni de yok)', beta: 'açık test kullanılmıyor (dağıtım = dahili + kapalı test)' };
export const NOT_SINIRI = 500;
export const ANAHTAR_VARSAYILAN = path.join(os.homedir(), '.tekserp', 'sirlar', 'play-yayinci.json');
export const DEFTER_VARSAYILAN = path.join(os.homedir(), '.tekserp', 'yayin-defteri', 'play-YAYIN-DEFTERI.tsv');
const AAB_VARSAYILAN = (kok) => path.join(kok, 'mobil/android/app/build/outputs/bundle/release/app-release.aab');
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/';
const YUKLEME_API = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YAYINDA = new Set(['completed', 'inProgress']);

class Dur extends Error {
  constructor(baslik, satirlar = []) { super(baslik); this.satirlar = satirlar; }
}

/* ------------------------------------------------------------------ *
 * Saf parçalar
 * ------------------------------------------------------------------ */

export function argumanlar(argv) {
  const o = { uygula: false };
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(a);
    if (!m) throw new Dur(`tanınmayan argüman: ${a}`);
    const [, ad, deger] = m;
    if (ad === 'uygula' && deger === undefined) o.uygula = true;
    else if (ad === 'kuru' && deger === undefined) o.uygula = false;
    else if (['kanal', 'aab', 'anahtar', 'terfi-atla'].includes(ad) && deger !== undefined) o[ad] = deger;
    else throw new Dur(`tanınmayan argüman: ${a}`);
  }
  if (argv.includes('--uygula') && argv.includes('--kuru')) throw new Dur('--uygula ile --kuru birlikte verilmez');
  if (!o.kanal) throw new Dur('--kanal=internal|alpha zorunlu');
  if (REDDEDILEN[o.kanal]) throw new Dur(`"${o.kanal}" kanalı REDDEDİLDİ — ${REDDEDILEN[o.kanal]}`);
  if (!Object.hasOwn(PLAY_KANALLARI, o.kanal)) throw new Dur(`bilinmeyen kanal "${o.kanal}" (internal | alpha)`);
  return o;
}

/** AAB'nin kendi manifestinden paket adı + versionCode + versionName (aapt2 protobuf). */
export function aabKimligi(aabYolu) {
  let kok;
  try {
    const r = zipGirdisiOku(aabYolu, 'base/manifest/AndroidManifest.xml');
    if (r.hata || !r.veri) throw new Error(r.hata ?? 'boş');
    kok = protoManifestOgeleri(r.veri)[0].oznitelik;
  } catch (e) {
    throw new Dur('AAB manifesti okunamadı — kimlik ÖLÇÜLEMEDİ', [String(e?.message ?? e)]);
  }
  const vc = /^\d+$/.test(String(kok.versionCode ?? '')) ? Number(kok.versionCode) : null;
  if (!kok.package || vc === null || !kok.versionName) {
    throw new Dur('AAB manifestinde paket/versionCode/versionName eksik', [JSON.stringify({ package: kok.package, versionCode: kok.versionCode, versionName: kok.versionName })]);
  }
  return { paket: kok.package, versionCode: vc, versionName: kok.versionName };
}

/** Tablet X sürümünün Play notu: o sürümün turlarındaki tablet maddeleri (tek kaynak, tr-TR). */
export function playNotu(notJson, surum) {
  const turlar = (notJson?.yayinlar ?? []).filter((y) => y?.surumler?.tablet === surum);
  const maddeler = turlar.flatMap((y) => y.maddeler ?? []).filter((m) => m.kapsam === 'tablet' || m.kapsam === 'her-ikisi');
  if (!maddeler.length) throw new Dur(`sürüm notu YOK — surum-notlari.json'da tablet ${surum} maddesi bulunamadı`);
  const metin = maddeler.map((m) => `• ${String(m.metin).trim()}`).join('\n');
  const uzunluk = [...metin].length;
  if (uzunluk > NOT_SINIRI) {
    throw new Dur(`sürüm notu Play sınırını aşıyor: ${uzunluk} > ${NOT_SINIRI} karakter (tablet ${surum}, ${maddeler.length} madde)`,
      ['Not kısaltılmadan Play\'e çıkılmaz; metni kısalt (onay terfi etiketinde donar) ve yeniden dene.']);
  }
  return { metin, uzunluk, madde: maddeler.length };
}

/** Play kanal listesinden: en büyük versionCode, hedef kanalda yayında mı, kaynak (dahili) kanalda var mı. */
export function playDurumu({ tracks = [], bundles = [] }, kanal, vc) {
  const kodlar = (r) => (r.versionCodes ?? []).map(Number);
  let enBuyuk = 0;
  for (const t of tracks) for (const r of t.releases ?? []) for (const k of kodlar(r)) enBuyuk = Math.max(enBuyuk, k);
  for (const b of bundles) enBuyuk = Math.max(enBuyuk, Number(b.versionCode) || 0);
  const kanalda = (ad, kosul) => (tracks.find((t) => t.track === ad)?.releases ?? []).some((r) => YAYINDA.has(r.status) && kodlar(r).some(kosul));
  return {
    enBuyuk,
    hedefteYayinda: kanalda(kanal, (k) => k === vc),
    hedefteDahaYeni: kanalda(kanal, (k) => k > vc),
    dahilideYayinda: kanalda('internal', (k) => k >= vc),
    paket: bundles.find((b) => Number(b.versionCode) === vc) ?? null,
    ozet: tracks.map((t) => `${t.track} ${(t.releases ?? []).map((r) => `${r.status}:${(r.versionCodes ?? []).join(',')}`).join(' ') || '(boş)'}`),
  };
}

/* ------------------------------------------------------------------ *
 * Play istemcisi (fetch enjekte; anahtar ve erişim belirteci çıktıya girmez)
 * ------------------------------------------------------------------ */

function jwt(anahtar, simdi) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = Math.floor(simdi() / 1000);
  const govde = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: anahtar.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: TOKEN_URL, iat: t, exp: t + 600 })}`;
  return `${govde}.${crypto.createSign('RSA-SHA256').update(govde).sign(anahtar.private_key).toString('base64url')}`;
}

export function playIstemcisi({ anahtar, paket, fetch, simdi = Date.now }) {
  let belirtec = null;
  const istek = async (yontem, url, { govde, tur } = {}) => {
    const basliklar = { authorization: `Bearer ${belirtec}`, ...(tur ? { 'content-type': tur } : {}) };
    let y;
    try {
      y = await fetch(url, { method: yontem, headers: basliklar, body: govde });
    } catch (e) {
      throw new Dur(`Play'e ulaşılamadı (${yontem} ${url.replace(/\?.*$/, '')})`, [String(e?.message ?? e).slice(0, 200)]);
    }
    const metin = await y.text();
    let json = null;
    try { json = metin ? JSON.parse(metin) : {}; } catch { json = null; }
    if (!y.ok) throw new Dur(`Play ${y.status}: ${yontem} ${url.replace(/\?.*$/, '').replace(API, '')}`, [String(json?.error?.message ?? metin).slice(0, 300)]);
    return json ?? {};
  };
  const B = `${API}${paket}`;
  return {
    async giris() {
      let y;
      try {
        y = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt(anahtar, simdi) }) });
      } catch (e) {
        throw new Dur('Google oturumu açılamadı (ağ)', [String(e?.message ?? e).slice(0, 200)]);
      }
      const j = await y.json().catch(() => ({}));
      if (!j.access_token) throw new Dur('Google oturumu açılamadı', [`${j.error ?? y.status}: ${String(j.error_description ?? '').slice(0, 200)}`]);
      belirtec = j.access_token;
    },
    editAc: async () => (await istek('POST', `${B}/edits`)).id,
    editSil: (id) => istek('DELETE', `${B}/edits/${id}`).catch(() => null),
    kanallar: async (id) => (await istek('GET', `${B}/edits/${id}/tracks`)).tracks ?? [],
    paketler: async (id) => (await istek('GET', `${B}/edits/${id}/bundles`)).bundles ?? [],
    kanal: (id, ad) => istek('GET', `${B}/edits/${id}/tracks/${ad}`),
    yukle: (id, veri) => istek('POST', `${YUKLEME_API}${paket}/edits/${id}/bundles?uploadType=media`, { govde: veri, tur: 'application/octet-stream' }),
    kanalAta: (id, ad, surum) => istek('PUT', `${B}/edits/${id}/tracks/${ad}`, { govde: JSON.stringify({ track: ad, releases: [surum] }), tur: 'application/json' }),
    onayla: (id) => istek('POST', `${B}/edits/${id}:commit`),
  };
}

/* ------------------------------------------------------------------ *
 * Gerçek bağımlılıklar
 * ------------------------------------------------------------------ */

/** Mevcut AAB doğrulaması (build-apk --verify-only: kimlik · ERP adresi · izin/cleartext/hizmet · imza) KOPYA üzerinde. */
export function gercekAabDogrula(kok) {
  return (aabYolu) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'play-aab-'));
    try {
      const kopya = path.join(tmp, 'dogrula.aab');
      fs.copyFileSync(aabYolu, kopya);
      const r = spawnSync(process.execPath, [path.join(kok, 'mobil/scripts/build-apk.mjs'), '--aab', `--verify-only=${kopya}`],
        { cwd: path.join(kok, 'mobil'), encoding: 'utf8' });
      const satirlar = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').filter((s) => s.trim() && !/^=+$/.test(s.trim()));
      return { gecti: r.status === 0, satirlar: r.status === 0 ? satirlar.filter((s) => s.includes('✔')) : satirlar.slice(-15) };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
}

function varsayilanlar(kok = KOK) {
  return { kok, fetch: globalThis.fetch, simdi: Date.now, yaz: (s) => console.log(s), defterYolu: DEFTER_VARSAYILAN,
    aabDogrula: gercekAabDogrula(kok), gitOlgulari: (o) => gercekGitOlgulari({ ...o, kok }),
    etiketAt: gercekEtiketAt, terfiAtlaKaydi: (o) => gercekTerfiAtlaKaydi({ ...o, kok }) };
}

function anahtarOku(yol) {
  let st;
  try { st = fs.statSync(yol); } catch { throw new Dur(`servis hesabı anahtarı yok: ${yol}`); }
  if (st.mode & 0o077) throw new Dur(`servis hesabı anahtarı başkalarınca okunabilir (${(st.mode & 0o777).toString(8)})`, [`chmod 600 ${yol}`]);
  let a;
  try { a = JSON.parse(fs.readFileSync(yol, 'utf8')); } catch { throw new Dur(`servis hesabı anahtarı ayrıştırılamadı: ${yol}`); }
  if (typeof a?.client_email !== 'string' || typeof a?.private_key !== 'string') throw new Dur('servis hesabı anahtarında client_email/private_key yok');
  return a;
}

/* ------------------------------------------------------------------ *
 * Akış
 * ------------------------------------------------------------------ */

/** @returns {Promise<number>} çıkış kodu (0 tamam/zaten yayında · 1 DUR) */
export async function calistir(argv, enjekte = {}) {
  const d = { ...varsayilanlar(enjekte.kok), ...enjekte };
  const yaz = d.yaz;
  let istemci = null;
  let edit = null;
  try {
    const o = argumanlar(argv);
    const kanal = PLAY_KANALLARI[o.kanal];
    const kayit = kayitAyristir(fs.readFileSync(path.join(d.kok, KAYIT_REL), 'utf8'));
    const { zincir, hatalar } = grupZinciri(kayit.gruplar);
    if (hatalar.length || zincir.length <= kanal.sira) throw new Dur('dağıtım kaydının grup zinciri bu kanalı karşılamıyor', hatalar);
    const grup = zincir[kanal.sira];
    const kaynakGrup = kanal.sira ? zincir[kanal.sira - 1] : null;
    const beklenenPaket = kayit.urun?.tablet?.androidPaket;
    if (!beklenenPaket) throw new Dur(`${KAYIT_REL} urun.tablet.androidPaket yok`);
    if (!kaynakGrup && o['terfi-atla'] !== undefined) throw new Dur(`--terfi-atla ${o.kanal} kanalında verilemez (kök grup terfi istemez)`);

    const aabYolu = path.resolve(o.aab ?? AAB_VARSAYILAN(d.kok));
    if (!fs.existsSync(aabYolu)) throw new Dur(`AAB yok: ${aabYolu}`, ['Önce: cd mobil && npm run build:aab']);
    yaz(`TeksERP → Google Play ${kanal.ad} (${o.kanal} · grup ${grup}) — ${o.uygula ? 'UYGULA' : 'KURU (yazma yok)'}`);
    const kimlik = aabKimligi(aabYolu);
    const oz = dosyaOzeti(aabYolu);
    yaz(`  AAB     : ${aabYolu}`);
    yaz(`  Kimlik  : ${kimlik.paket} · ${kimlik.versionName} (vc ${kimlik.versionCode}) · sha256 ${oz.sha256.slice(0, 16)}… · ${oz.boyut} B`);

    // Yerel kapılar — hepsi ölçülür, sonuç Play okunduktan sonra hükme bağlanır (zaten yayındaysa iş yok).
    const kapilar = [];
    const kapi = (ad, gecti, satirlar = []) => kapilar.push({ ad, gecti, satirlar });
    kapi('paket adı dağıtım kaydıyla aynı', kimlik.paket === beklenenPaket, kimlik.paket === beklenenPaket ? [] : [`AAB "${kimlik.paket}" ≠ kayıt "${beklenenPaket}"`]);
    const kunyeYolu = apkKunyeYolu(aabYolu);
    const kunye = derlemeKunyesiOku(kunyeYolu);
    const bag = derlemeBagiDenetimi({ kok: d.kok, kunye, kunyeYolu, beklenen: { urun: 'tablet-aab', kanal: null, surum: kimlik.versionName }, ozet: oz });
    const vcTutar = kunye?.versionCode === kimlik.versionCode;
    kapi('derleme künyesi (sha256 · commit = HEAD · sürüm)', bag.sonuc === 'uyumlu' && vcTutar,
      [...bag.satirlar, ...(kunye && !vcTutar ? [`künye versionCode ${kunye.versionCode} ≠ AAB ${kimlik.versionCode}`] : [])]);
    const dog = d.aabDogrula(aabYolu);
    kapi('AAB doğrulaması (build-apk --verify-only: kimlik · izin · cleartext · imza)', dog.gecti, dog.satirlar);
    let not = null;
    try {
      not = playNotu(JSON.parse(fs.readFileSync(path.join(d.kok, 'mobil/src/data/surum-notlari.json'), 'utf8')), kimlik.versionName);
      kapi(`sürüm notu tr-TR (${not.madde} madde, ${not.uzunluk}/${NOT_SINIRI} karakter)`, true);
    } catch (e) {
      if (!(e instanceof Dur)) throw e;
      kapi('sürüm notu', false, [e.message, ...e.satirlar]);
    }

    // Play — yalnız okuma (edit açılır, okunur; kuru kipte silinir).
    const anahtar = anahtarOku(o.anahtar ?? ANAHTAR_VARSAYILAN);
    yaz(`  Hesap   : ${anahtar.client_email}`);
    istemci = playIstemcisi({ anahtar, paket: beklenenPaket, fetch: d.fetch, simdi: d.simdi });
    await istemci.giris();
    edit = await istemci.editAc();
    const durum = playDurumu({ tracks: await istemci.kanallar(edit), bundles: await istemci.paketler(edit) }, o.kanal, kimlik.versionCode);
    yaz(`  Play    : ${durum.ozet.join(' · ') || '(kanal yok)'} · en büyük vc ${durum.enBuyuk}`);

    if (durum.hedefteYayinda) {
      yaz(`\n✓ ZATEN YAYINDA — vc ${kimlik.versionCode} ${kanal.ad} kanalında; yapılacak bir şey yok.`);
      for (const k of kapilar) yaz(`  ${k.gecti ? '✓' : '·'} ${k.ad}${k.gecti ? '' : ` — yeni yayın olsaydı DURDURURDU: ${k.satirlar[0] ?? ''}`}`);
      return 0;
    }

    // Sürüm kapısı: yeni yükleme en büyükten BÜYÜK olur; zaten yüklü paket yalnız aynı baytsa kanala atanır.
    let kip;
    if (durum.paket) {
      const ayni = durum.paket.sha256 === oz.sha256;
      kapi(`vc ${kimlik.versionCode} Play'de yüklü — aynı bayt mı`, ayni, ayni ? [] : [`Play sha256 ${String(durum.paket.sha256).slice(0, 16)}… ≠ AAB ${oz.sha256.slice(0, 16)}… — aynı versionCode başka paket`]);
      kapi('hedef kanalda daha yeni sürüm yok', !durum.hedefteDahaYeni);
      kip = 'ata';
    } else {
      kapi(`versionCode ${kimlik.versionCode} > Play'deki en büyük ${durum.enBuyuk}`, kimlik.versionCode > durum.enBuyuk);
      kip = 'yukle';
    }

    // Terfi (kapalı test): kök gruptaki (dahili test) AYNI bayt + `terfi/<grup>/tablet-vX` onayı.
    let atla;
    if (kaynakGrup) {
      atla = o['terfi-atla'];
      let git = null;
      if (atla === undefined) {
        try {
          git = d.gitOlgulari({ kod: grup, urun: 'tablet', surum: kimlik.versionName });
        } catch (e) {
          if (!(e instanceof Olculemedi)) throw e;
          kapi(`terfi ${kaynakGrup} → ${grup}`, false, [`git ÖLÇÜLEMEDİ: ${e.message}`]);
        }
      }
      const kaynaklar = [{ ne: 'Play dahili test', url: 'play:internal', ...(durum.dahilideYayinda ? { durum: 'var', surum: kimlik.versionName } : { durum: 'yok' }) }];
      const ozet = { yerel: oz.sha256, kaynak: durum.paket && durum.dahilideYayinda ? { durum: 'var', sha256: durum.paket.sha256 } : { durum: 'yok' } };
      const h = atla === undefined && !git ? null : grupTerfiHukmu({ grup, urun: 'tablet', surum: kimlik.versionName, kaynak: kaynakGrup, git, kaynaklar, atla, ozet });
      if (h) kapi(`terfi ${kaynakGrup} → ${grup}`, h.sonuc === 'uyumlu', terfiRaporu(h, { kod: grup, urun: 'tablet', surum: kimlik.versionName }).slice(1).map((x) => x.trim()));
      if (atla !== undefined && h?.sonuc === 'uyumlu') atla = cumleDenetle(atla).cumle;
    }

    yaz('\nKapılar:');
    for (const k of kapilar) {
      yaz(`  ${k.gecti ? '✓' : '✖'} ${k.ad}`);
      if (!k.gecti || k.satirlar.length) for (const s of k.satirlar) yaz(`      ${s}`);
    }
    const kalan = kapilar.filter((k) => !k.gecti);
    if (kalan.length) throw new Dur(`${kalan.length} kapı geçilmedi — Play'e YAZILMADI`);

    const surum = { name: `${kimlik.versionName} (${kimlik.versionCode})`, versionCodes: [String(kimlik.versionCode)], status: 'completed',
      releaseNotes: [{ language: 'tr-TR', text: not.metin }] };
    yaz(`\nPlan: ${kip === 'yukle' ? 'AAB yükle → ' : 'yüklü paketi '}${o.kanal} kanalına ata ("${surum.name}", completed) → onayla → geri oku`);
    yaz(`Not (${not.uzunluk} karakter):\n${not.metin.split('\n').map((s) => `  ${s}`).join('\n')}`);
    if (!o.uygula) {
      yaz('\nKURU — Play\'e hiçbir şey yazılmadı. Yayın için aynı komut + --uygula.');
      return 0;
    }

    if (kip === 'yukle') {
      const y = await istemci.yukle(edit, fs.readFileSync(aabYolu));
      if (Number(y.versionCode) !== kimlik.versionCode || y.sha256 !== oz.sha256) {
        throw new Dur('Play\'in aldığı paket gönderilenle aynı değil', [`Play vc ${y.versionCode} sha256 ${String(y.sha256).slice(0, 16)}…`]);
      }
      yaz(`  ✓ yüklendi vc ${y.versionCode}`);
    }
    await istemci.kanalAta(edit, o.kanal, surum);
    await istemci.onayla(edit);
    edit = null;
    yaz(`  ✓ ${o.kanal} kanalına atandı ve onaylandı`);

    // Geri okuma — Play'in kendi kaydından.
    const e2 = await istemci.editAc();
    let dogrulandi = false;
    try {
      const t = await istemci.kanal(e2, o.kanal);
      dogrulandi = (t.releases ?? []).some((r) => YAYINDA.has(r.status) && (r.versionCodes ?? []).map(Number).includes(kimlik.versionCode));
    } finally {
      await istemci.editSil(e2);
    }
    yaz(dogrulandi ? `  ✓ geri okundu: ${o.kanal} kanalında vc ${kimlik.versionCode} yayında` : `  ✖ geri okunamadı: ${o.kanal} kanalında vc ${kimlik.versionCode} görünmüyor`);

    defterYaz(d, [istanbulSaati(new Date(d.simdi())), `tablet-${kimlik.versionName}-play-${o.kanal}`, kimFn(), oz.sha256.slice(0, 16), String(oz.boyut),
      `vc${kimlik.versionCode}`, kip, dogrulandi ? 'dogrulandi' : 'DOGRULANAMADI', ...(atla !== undefined ? [`terfi-atlandi: ${atla}`] : [])], yaz);

    if (!kaynakGrup) {
      const t = d.etiketAt('tablet', kimlik.versionName);
      yaz(`  ${t.durum === 'basarisiz' ? '⚠️ sürüm etiketi atılamadı' : t.durum === 'zaten-var' ? '· sürüm etiketi zaten var' : '✓ sürüm etiketi'}: ${t.ad}${t.not ? ` — ${t.not}` : ''}`);
    } else if (atla !== undefined) {
      const k = d.terfiAtlaKaydi({ kod: grup, urun: 'tablet', surum: kimlik.versionName, cumle: atla });
      yaz(`  ${k.durum === 'basarisiz' ? '⚠️ terfi atlama etiketi atılamadı' : '✓ terfi atlama kaydı'}: ${k.ad}`);
    }
    return dogrulandi ? 0 : 1;
  } catch (e) {
    if (!(e instanceof Dur) && !(e instanceof Olculemedi)) throw e;
    yaz(`\n✖ ${e instanceof Olculemedi ? 'ÖLÇÜLEMEDİ' : 'DUR'} — ${e.message}`);
    for (const s of e.satirlar ?? []) yaz(`    ${s}`);
    return 1;
  } finally {
    if (istemci && edit) await istemci.editSil(edit);
  }
}

const kimFn = () => `${process.env.USER ?? '?'}@${os.hostname()}`.replace(/[^A-Za-z0-9._@-]/g, '_');

function defterYaz(d, alanlar, yaz) {
  try {
    fs.mkdirSync(path.dirname(d.defterYolu), { recursive: true, mode: 0o700 });
    fs.appendFileSync(d.defterYolu, `${alanlar.map((a) => String(a).replace(/[\t\n]/g, ' ')).join('\t')}\n`, { mode: 0o600 });
    yaz(`  ✓ yayın defteri: ${d.defterYolu}`);
  } catch (e) {
    yaz(`  ⚠️ yayın defteri yazılamadı (yayın etkilenmedi): ${e.message}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  calistir(process.argv.slice(2)).then((kod) => process.exit(kod), (e) => {
    console.error(`\n✖ BEKLENMEDİK HATA — Play durumu belirsiz olabilir\n${e?.stack ?? e}`);
    process.exit(1);
  });
}
