// =============================================================================
// TeksERP — YAYIN SUNUCUSU OKUMALARI — tek kaynak (3c')
// =============================================================================
// Güncelleme sunucusu kenarda Cloudflare Worker ile korunur: `/<kanal>/electron/*`,
// `/<kanal>/mobil/*` ve `/<kanal>/backend/*` yalnız İNDİRME belirteciyle (başlık `X-TKL-Indirme`) açılır,
// anonim okuma 403 alır. Yayın betiklerinin okuması bu yüzden iki yoldan birinden geçer:
//   ① SSH (tercih) — VDS dosya sisteminden, `yayinci` hesabıyla (sır gerektirmez):
//      "ne yayında" sorusunun kaynağı (latest.yml · OTA manifesti · APK künyesi).
//   ② Belirteçli HTTP — yalnız "kenardan ne görünüyor" doğrulamasında (CF önbelleği,
//      başlıklar, boyut). Belirteç kaynağı, bu sırayla:
//      a) TAZE CLI belirteci — `~/.tekserp/yayin-belirteci-kaynagi.json` (600) varsa: satıcı
//         `anahtar.ts indirme-belirteci` komutu adresin kanalı için basar (hazırlıkta yerel anahtar
//         dizini, üretimde VDS'teki satıcı konteyneri, SSH ile); kanal × ürün öneki, ≤ 70 dk.
//      b) yoksa `~/.tekserp/yayin-belirteci` (600) dosyası (tek belirteç).
//      Belirteç repoya GİRMEZ.
// Belirteç yoksa/biçimsizse/izinleri gevşekse ya da yapılandırılmış CLI üretemezse DUR — anonim
// okumaya ve öteki kaynağa DÜŞÜLMEZ.
// Belirteç değeri hiçbir çıktıya, hata mesajına ya da süreç argümanına yazılmaz.
// Bekçi: scripts/check-yayin-okuma.mjs (yayın betiklerinde belirteçsiz HTTP okuma yok).
// =============================================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Olculemedi } from './dagitim.mjs';

export const INDIRME_BASLIGI = 'X-TKL-Indirme';
/** Belirteç dosyasının yerini ezer (bekçiler ve doğrulama için); verilmezse ev dizinindeki dosya. */
export const BELIRTEC_ORTAMI = 'TEKSERP_YAYIN_BELIRTECI';
/** Yayın ağacına yazan tek ssh takma adı (`yayinci`, sudo yok); ezilmez — yükleyiciler `yayin-hedefi.mjs`ten alır. */
export const SSH_HEDEF_VARSAYILAN = 'tekserp-yayin';
const BELIRTEC_DESENI = /^[A-Za-z0-9._~+/=-]{16,8192}$/;
const SSH_ZAMAN_ASIMI_MS = 30_000;
const YOK_KODU = 44;

/** Belirteç yok / okunamıyor / biçimsiz — betik DURUR (anonim okumaya düşmez). */
export class BelirtecYok extends Error {}

export function belirtecDosyasi() {
  return process.env[BELIRTEC_ORTAMI] || path.join(os.homedir(), '.tekserp', 'yayin-belirteci');
}

const nasilAlinir = (yol) => [
  'Güncelleme sunucusu anonim okumaya KAPALIDIR (Cloudflare Worker, başlık X-TKL-Indirme);',
  'yayın betiği kenar doğrulamasını yalnız satıcı yayın belirteciyle yapar.',
  `Belirteci satıcı portalından al, tek satır olarak ${yol} dosyasına yaz ve: chmod 600 ${yol}`,
  'Belirteç repoya, log\'a ya da sürüm notuna GİRMEZ.',
].join('\n  ');

// ---------------------------------------------------------------- taze CLI belirteci (kaynak a)
/** CLI kaynağının yapılandırma dosyasını ezer (bekçiler için); verilmezse ev dizinindeki dosya. */
export const KAYNAK_ORTAMI = 'TEKSERP_YAYIN_BELIRTEC_KAYNAGI';
const SATICI_SUNUCU = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'satici', 'sunucu');
const CLI_OMUR_DK = 60;
/** Bu kadar süresi kalmış belirteç yeniden kullanılmaz — uzun yükleme ortasında dolmasın. */
const TAZELIK_PAYI_MS = 10 * 60_000;
const CLI_ZAMAN_ASIMI_MS = 60_000;
// Ürün kümesi protokol `DOWNLOAD_PRODUCTS`; CLI çıktısı her satırda bunu ister, eksik ürün bütün yayını durdurur.
const KAPSAM_DESENI = /^\/([a-z0-9][a-z0-9-]{0,39})\/(electron|mobil|backend|backend-oci)\//;
const SSH_HEDEF_DESENI = /^[A-Za-z0-9@._-]{1,120}$/;
const UZAK_KOMUT_DESENI = /^[A-Za-z0-9 ._/=-]{1,300}$/;
const onbellek = new Map();

export function kaynakDosyasi() {
  return process.env[KAYNAK_ORTAMI] || path.join(os.homedir(), '.tekserp', 'yayin-belirteci-kaynagi.json');
}

/** Yapılandırılmamışsa null (bugünkü davranış: dosya belirteci). Dosya VARSA her kusuru DUR'dur. */
function kaynakOku() {
  const yol = kaynakDosyasi();
  let st;
  try {
    st = fs.statSync(yol);
  } catch {
    return null;
  }
  if (!st.isFile() || (process.platform !== 'win32' && (st.mode & 0o077) !== 0)) {
    throw new BelirtecYok(`YAYIN BELİRTECİ KAYNAĞI dosya değil ya da izinleri gevşek: ${yol} — chmod 600`);
  }
  let k;
  try {
    k = JSON.parse(fs.readFileSync(yol, 'utf8'));
  } catch {
    throw new BelirtecYok(`YAYIN BELİRTECİ KAYNAĞI okunamadı/JSON değil: ${yol}`);
  }
  const anahtarlar = Object.keys(k ?? {}).sort().join(',');
  if (k?.tur === 'yerel' && anahtarlar === 'dizin,tur' && typeof k.dizin === 'string' && k.dizin.length > 0) {
    return { tur: 'yerel', dizin: k.dizin.startsWith('~/') ? path.join(os.homedir(), k.dizin.slice(2)) : path.resolve(k.dizin) };
  }
  if (k?.tur === 'ssh' && anahtarlar === 'hedef,komut,tur' && SSH_HEDEF_DESENI.test(String(k.hedef)) && UZAK_KOMUT_DESENI.test(String(k.komut))) {
    return { tur: 'ssh', hedef: k.hedef, komut: k.komut };
  }
  throw new BelirtecYok(`YAYIN BELİRTECİ KAYNAĞI tanınmıyor: ${yol} — {"tur":"yerel","dizin":…} ya da {"tur":"ssh","hedef":…,"komut":…}`);
}

/** Adresin kanal + ürün öneki (`/<kanal>/electron/` · `mobil/` · `backend/` · `backend-oci/`); değilse null. */
export function kapsamCoz(url) {
  let yol;
  try {
    yol = new URL(String(url ?? ''), 'https://yer-tutucu.invalid').pathname;
  } catch {
    return null;
  }
  const m = KAPSAM_DESENI.exec(yol);
  return m ? { kanal: m[1], yolOneki: `/${m[1]}/${m[2]}/` } : null;
}

function cliCalistir(kaynak, kanal) {
  const argv = ['indirme-belirteci', `--kanal=${kanal}`, `--dk=${CLI_OMUR_DK}`];
  const secenek = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CLI_ZAMAN_ASIMI_MS, maxBuffer: 1024 * 1024 };
  let cikti;
  try {
    cikti = kaynak.tur === 'yerel'
      ? execFileSync(process.execPath, ['--import', 'tsx', 'scripts/anahtar.ts', ...argv, `--dizin=${kaynak.dizin}`], { ...secenek, cwd: SATICI_SUNUCU })
      : execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', kaynak.hedef, `${kaynak.komut} ${argv.join(' ')}`], secenek);
  } catch (e) {
    throw new BelirtecYok(`YAYIN BELİRTECİ üretilemedi (${kaynak.tur}; çıkış ${e.status ?? e.code ?? '?'}) — satıcı anahtar CLI'ını denetle`);
  }
  let j;
  try {
    j = JSON.parse(cikti);
  } catch {
    throw new BelirtecYok('YAYIN BELİRTECİ CLI çıktısı JSON değil (içerik yazdırılmadı)');
  }
  const liste = (Array.isArray(j?.belirtecler) ? j.belirtecler : []).map((b) => ({ yolOneki: b?.yolOneki, belirtec: b?.belirtec, expMs: Date.parse(b?.exp) }));
  if (j?.v !== 1 || liste.length === 0 || !liste.every((b) => KAPSAM_DESENI.test(String(b.yolOneki)) && BELIRTEC_DESENI.test(String(b.belirtec)) && Number.isFinite(b.expMs))) {
    throw new BelirtecYok('YAYIN BELİRTECİ CLI çıktısı sözleşmeye uymuyor (içerik yazdırılmadı)');
  }
  return liste;
}

function cliBelirteci(kaynak, url) {
  const kapsam = kapsamCoz(url);
  if (!kapsam) throw new BelirtecYok(`YAYIN BELİRTECİ: adres kanal/ürün önekinde değil (/<kanal>/electron|mobil|backend|backend-oci/): ${String(url ?? '(yok)').split(/[?#]/)[0]}`);
  const taze = (b) => b.yolOneki === kapsam.yolOneki && b.expMs - Date.now() >= TAZELIK_PAYI_MS;
  let b = (onbellek.get(kapsam.kanal) ?? []).find(taze);
  if (!b) {
    onbellek.set(kapsam.kanal, cliCalistir(kaynak, kapsam.kanal));
    b = onbellek.get(kapsam.kanal).find(taze);
  }
  if (!b) throw new BelirtecYok(`YAYIN BELİRTECİ: CLI ${kapsam.yolOneki} için taze belirteç vermedi`);
  return b.belirtec;
}

/**
 * @param {string} [url] okunacak adres ya da yol — CLI kaynağında belirtecin kanal/ürün öneki buradan seçilir.
 * @returns {string} belirteç — yalnız başlığa konur, hiçbir yere yazdırılmaz.
 */
export function belirtecOku(url) {
  const kaynak = kaynakOku();
  if (kaynak) return cliBelirteci(kaynak, url);
  const yol = belirtecDosyasi();
  let st;
  try {
    st = fs.statSync(yol);
  } catch {
    throw new BelirtecYok(`YAYIN BELİRTECİ YOK: ${yol}\n  ${nasilAlinir(yol)}`);
  }
  if (!st.isFile()) throw new BelirtecYok(`YAYIN BELİRTECİ bir dosya değil: ${yol}\n  ${nasilAlinir(yol)}`);
  if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) {
    throw new BelirtecYok(`YAYIN BELİRTECİNİN İZİNLERİ GEVŞEK (${(st.mode & 0o777).toString(8)}): ${yol}\n  Yalnız sahibi okuyabilmeli:  chmod 600 ${yol}`);
  }
  let deger;
  try {
    deger = fs.readFileSync(yol, 'utf8').trim();
  } catch (e) {
    throw new BelirtecYok(`YAYIN BELİRTECİ okunamadı: ${yol} (${e.code ?? 'hata'})\n  ${nasilAlinir(yol)}`);
  }
  if (!BELIRTEC_DESENI.test(deger)) {
    throw new BelirtecYok(`YAYIN BELİRTECİ BİÇİMSİZ: ${yol} — tek satır, boşluksuz, en az 16 karakter olmalı (içerik yazdırılmadı).\n  ${nasilAlinir(yol)}`);
  }
  return deger;
}

export const indirmeBasliklari = (url) => ({ [INDIRME_BASLIGI]: belirtecOku(url) });

/**
 * Güncelleme sunucusuna TEK sanksiyonlu HTTP okuması — belirteç başlığı her istekte.
 * Yayın betiklerinde çıplak `fetch(` yasaktır (bekçi: check-yayin-okuma).
 */
export async function belirtecliFetch(url, secenek = {}) {
  if (!/^https:\/\//.test(String(url ?? ''))) throw new Olculemedi(`adres HTTPS değil: ${url}`);
  const basliklar = { ...(secenek.headers ?? {}), ...indirmeBasliklari(url) };
  return fetch(url, { ...secenek, headers: basliklar });
}

/**
 * Kabuk betikleri için başlık dosyası (`curl -H @dosya`): belirteç argv'ye düşmez. Mod 600.
 * `url`: dosyayla okunacak adreslerin ortak öneki (ör. `/<kanal>/electron/`) — CLI kaynağında gerekir.
 */
export function baslikDosyasiYaz(hedef, url) {
  const satir = `${INDIRME_BASLIGI}: ${belirtecOku(url)}\n`;
  fs.writeFileSync(hedef, satir, { mode: 0o600 });
  fs.chmodSync(hedef, 0o600);
}

export const GUVENLI_YOL = /^\/[A-Za-z0-9._/-]+$/;

/**
 * Yayın adresinin VDS dosya yolu — çağıranın verdiği yayın bloklarından (`{ kanallar: { <ad>: { yayin } } }`;
 * grup blokları `grupYayinBlogu`ndan: panelFeed↔vdsPanel, mobilFeed↔vdsMobil, backendFeed↔vdsBackend). Örtük kayıt
 * yok: blok verilmezse ya da adres hiçbirinin kökünde değilse ÖLÇÜLEMEDİ.
 */
export function vdsYolu(url, kayit) {
  if (!kayit || typeof kayit !== 'object') throw new Olculemedi('yayın bloğu verilmedi — adres hangi grubun VDS yoluna iner belirsiz');
  const temiz = String(url ?? '').split(/[?#]/)[0];
  for (const kanal of Object.values(kayit.kanallar ?? {})) {
    const y = kanal.yayin ?? {};
    for (const [feed, vds] of [[y.panelFeed, y.vdsPanel], [y.mobilFeed, y.vdsMobil], [y.backendFeed, y.vdsBackend]]) {
      if (!feed || !vds || !temiz.startsWith(feed)) continue;
      const yol = `${vds.replace(/\/+$/, '')}/${temiz.slice(feed.length)}`.replace(/\/+$/, '');
      if (!GUVENLI_YOL.test(yol) || yol.split('/').includes('..')) throw new Olculemedi(`güvensiz yayın yolu: ${yol}`);
      return yol;
    }
  }
  throw new Olculemedi(`adres verilen yayın bloklarının hiçbirinin kökünde değil: ${temiz}`);
}

/**
 * VDS dosya sisteminden SSH ile okur (yayinci; salt okuma).
 * @returns {{durum:'var', govde:string} | {durum:'yok'} | {durum:'olculemedi', neden:string}}
 */
export function sshOku(yol, { hedef = SSH_HEDEF_VARSAYILAN } = {}) {
  if (!GUVENLI_YOL.test(String(yol ?? '')) || String(yol).split('/').includes('..')) {
    return { durum: 'olculemedi', neden: `güvensiz yayın yolu: ${yol}` };
  }
  try {
    const govde = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', hedef,
      `test -f '${yol}' || exit ${YOK_KODU}; cat '${yol}'`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SSH_ZAMAN_ASIMI_MS, maxBuffer: 16 * 1024 * 1024 });
    return { durum: 'var', govde };
  } catch (e) {
    if (e.status === YOK_KODU) return { durum: 'yok' };
    const ic = e.stderr ? `: ${String(e.stderr).trim().slice(0, 160)}` : '';
    return { durum: 'olculemedi', neden: `${hedef}:${yol} okunamadı (ssh çıkış ${e.status ?? e.code ?? '?'}${ic})` };
  }
}

/** Yayın adresini VDS'ten okur (adres → yol → SSH). Tanınmayan adres ÖLÇÜLEMEDİ. */
export function yayinOku(url, secenek = {}) {
  let yol;
  try {
    yol = vdsYolu(url, secenek.kayit);
  } catch (e) {
    return { durum: 'olculemedi', neden: e.message };
  }
  return sshOku(yol, secenek);
}
