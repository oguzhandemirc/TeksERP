// =============================================================================
// TeksERP — YAYIN SUNUCUSU OKUMALARI — tek kaynak (3c')
// =============================================================================
// Güncelleme sunucusu kenarda Cloudflare Worker ile korunur: `/<kanal>/electron/*`
// ve `/<kanal>/mobil/*` yalnız İNDİRME belirteciyle (başlık `X-TKL-Indirme`) açılır,
// anonim okuma 403 alır. Yayın betiklerinin okuması bu yüzden iki yoldan birinden geçer:
//   ① SSH (tercih) — VDS dosya sisteminden, `yayinci` hesabıyla (sır gerektirmez):
//      "ne yayında" sorusunun kaynağı (latest.yml · OTA manifesti · APK künyesi).
//   ② Belirteçli HTTP — yalnız "kenardan ne görünüyor" doğrulamasında (CF önbelleği,
//      başlıklar, boyut). Belirteç repoya GİRMEZ: `~/.tekserp/yayin-belirteci` (600).
// Belirteç yoksa/biçimsizse/izinleri gevşekse DUR — anonim okumaya DÜŞÜLMEZ.
// Belirteç değeri hiçbir çıktıya, hata mesajına ya da süreç argümanına yazılmaz.
// Bekçi: scripts/check-yayin-okuma.mjs (yayın betiklerinde belirteçsiz HTTP okuma yok).
// =============================================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { kayitOku, Olculemedi } from './kanallar.mjs';

export const INDIRME_BASLIGI = 'X-TKL-Indirme';
/** Belirteç dosyasının yerini ezer (bekçiler ve doğrulama için); verilmezse ev dizinindeki dosya. */
export const BELIRTEC_ORTAMI = 'TEKSERP_YAYIN_BELIRTECI';
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

/** @returns {string} belirteç — yalnız başlığa konur, hiçbir yere yazdırılmaz. */
export function belirtecOku() {
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

export const indirmeBasliklari = () => ({ [INDIRME_BASLIGI]: belirtecOku() });

/**
 * Güncelleme sunucusuna TEK sanksiyonlu HTTP okuması — belirteç başlığı her istekte.
 * Yayın betiklerinde çıplak `fetch(` yasaktır (bekçi: check-yayin-okuma).
 */
export async function belirtecliFetch(url, secenek = {}) {
  if (!/^https:\/\//.test(String(url ?? ''))) throw new Olculemedi(`adres HTTPS değil: ${url}`);
  const basliklar = { ...(secenek.headers ?? {}), ...indirmeBasliklari() };
  return fetch(url, { ...secenek, headers: basliklar });
}

/** Kabuk betikleri için başlık dosyası (`curl -H @dosya`): belirteç argv'ye düşmez. Mod 600. */
export function baslikDosyasiYaz(hedef) {
  const satir = `${INDIRME_BASLIGI}: ${belirtecOku()}\n`;
  fs.writeFileSync(hedef, satir, { mode: 0o600 });
  fs.chmodSync(hedef, 0o600);
}

const GUVENLI_YOL = /^\/[A-Za-z0-9._/-]+$/;

/**
 * Yayın adresinin VDS dosya yolu — kanal kayıt defterinden (panelFeed↔vdsPanel,
 * mobilFeed↔vdsMobil); kök sabiti ikinci kez yazılmaz. Tanınmayan adres ÖLÇÜLEMEDİ.
 */
export function vdsYolu(url, kayit = kayitOku()) {
  const temiz = String(url ?? '').split(/[?#]/)[0];
  for (const kanal of Object.values(kayit.kanallar ?? {})) {
    const y = kanal.yayin ?? {};
    for (const [feed, vds] of [[y.panelFeed, y.vdsPanel], [y.mobilFeed, y.vdsMobil]]) {
      if (!feed || !vds || !temiz.startsWith(feed)) continue;
      const yol = `${vds.replace(/\/+$/, '')}/${temiz.slice(feed.length)}`.replace(/\/+$/, '');
      if (!GUVENLI_YOL.test(yol) || yol.split('/').includes('..')) throw new Olculemedi(`güvensiz yayın yolu: ${yol}`);
      return yol;
    }
  }
  throw new Olculemedi(`adres hiçbir kanalın yayın kökünde değil (deploy/kanallar.json): ${temiz}`);
}

/**
 * VDS dosya sisteminden SSH ile okur (yayinci; salt okuma).
 * @returns {{durum:'var', govde:string} | {durum:'yok'} | {durum:'olculemedi', neden:string}}
 */
export function sshOku(yol, { hedef = process.env.SSH_HEDEF || SSH_HEDEF_VARSAYILAN } = {}) {
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
