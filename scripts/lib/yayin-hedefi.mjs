// =============================================================================
// YAYIN HEDEFİ — yükleyicilerin (panel · tablet · backend) VDS dizini, doğrulama adresi ve defteri
// =============================================================================
// Hedef YALNIZ `deploy/kanallar.json`dan çözülür; ortam değişkeni ya da argümanla ezme görülürse
// yükleyici DURUR (prova gerekiyorsa kayıtta ayrı kanal açılır). Ezme deseninin YOKLUĞUNU
// `scripts/check-kanallar.mjs` §7 ölçer; bu dosyanın listeleri o bekçinin de tek kaynağıdır.
//
// Uzak kabuğa giden her değer burada biçim denetiminden geçer: yükleyiciler değerleri betik metnine
// gömmez, `bash -s -- <değer…>` konumsal argümanıyla geçirir — ssh argümanları uzak kabukta yeniden
// sözcüklere bölündüğü için değer, kabuğun yorumlayacağı karakter TAŞIYAMAZ (serbest metin base64'le).
// =============================================================================

import { kanalCoz, Olculemedi } from './kanallar.mjs';
import { GUVENLI_YOL, SSH_HEDEF_VARSAYILAN } from './yayin-okuma.mjs';

/** Eskiden hedefi ezen ortam değişkenleri — biri dolu gelirse yükleyici durur. */
export const YAYIN_EZME_ORTAMLARI = ['SSH_HEDEF', 'UZAK_DIZIN', 'YAYIN_KOK', 'YAYIN_URL', 'BASE_URL'];
/** Eskiden hedefi ezen argümanlar (`--ssh` · `--uzak-dizin` · `--feed`). */
export const YAYIN_EZME_ARGUMANLARI = ['ssh', 'uzak-dizin', 'feed'];

/** Panel/tablet sürümü (`<ürün>-vX` etiketiyle aynı biçim). */
export const SURUM_BICIMI = /^\d+\.\d+\.\d+$/;
/** Tablet `runtimeVersion` (OTA yolu segmenti). */
export const RV_BICIMI = /^\d+(\.\d+){0,3}$/;
/** OTA paket damgası (`Date.now()`). */
export const DAMGA_BICIMI = /^\d{13}$/;
/** Uzak kabukta tek sözcük kalan değer: boşluk, tırnak, `$`, `;`, `|`, `&`, `*`, `?`, `\` vb. YOK. */
export const UZAK_DEGER = /^[A-Za-z0-9@%+,./:=_-]{1,512}$/;
const ADRES = /^https:\/\/[a-z0-9.-]+(?::\d+)?\/[A-Za-z0-9._/-]*$/;
const SSH_TAKMA_AD = /^[A-Za-z0-9._-]{1,64}$/;

/** Ortamda ya da argümanlarda bulunan hedef ezmeleri ("ortam UZAK_DIZIN", "argüman --feed"…). */
export function yayinEzmeleri({ env = process.env, argv = [] } = {}) {
  const ortam = YAYIN_EZME_ORTAMLARI.filter((ad) => typeof env[ad] === 'string' && env[ad] !== '').map((ad) => `ortam ${ad}`);
  const arg = YAYIN_EZME_ARGUMANLARI
    .filter((ad) => argv.some((x) => x === `--${ad}` || String(x).startsWith(`--${ad}=`)))
    .map((ad) => `argüman --${ad}`);
  return [...ortam, ...arg];
}

/** Ezme bulunduğunda basılacak açıklama (üç yükleyici aynı metni basar). */
export function ezmeSatirlari(ezmeler) {
  return [
    `Bulunan: ${ezmeler.join(' · ')}`,
    'Yayın hedefi (VDS dizini · doğrulama adresi · defter · ssh takma adı) YALNIZ deploy/kanallar.json kaydından çözülür.',
    'Kabuktan kaldır (ör. `unset UZAK_DIZIN`) ya da argümanı sil; prova gerekiyorsa kayıtta ayrı bir hazırlık kanalı aç.',
  ];
}

const BAGLAR = {
  panel: ['vdsPanel', 'panelFeed', 'panelDefter'],
  // Tablet yayın defteri panelinkiyle aynı dosyadır (satır `tablet-<sürüm>` ile ayrışır).
  tablet: ['vdsMobil', 'mobilFeed', 'panelDefter'],
  backend: ['vdsBackend', 'backendFeed', 'backendDefter'],
};

/** Değerin uzak kabukta tek sözcük kaldığını doğrular; değilse fırlatır (çağıran DURUR). */
export function uzakDegerDenetle(ad, deger) {
  const v = String(deger ?? '');
  if (!UZAK_DEGER.test(v) || v.split('/').includes('..')) throw new Olculemedi(`${ad} uzak komuta gidemez (biçimsiz): "${v.slice(0, 80)}"`);
  return v;
}

/**
 * Kanalın yayın hedefi — ürün başına VDS dizini, doğrulama adresi (sondaki `/` yok) ve defter dosyası.
 * @returns {{ ssh: string, vds: string, feed: string, defter: string }}
 * @throws {Olculemedi} kayıt okunamaz ya da değer biçimsizse · {Error} kanal bilinmiyorsa (`.satirlar`)
 */
export function yayinHedefi(kod, urun, { kayit } = {}) {
  const bag = BAGLAR[urun];
  if (!bag) throw new Olculemedi(`bilinmeyen ürün "${urun}" (${Object.keys(BAGLAR).join(' | ')})`);
  const { kanal } = kanalCoz(kod, kayit ? { kayit } : {});
  const [vdsA, feedA, defterA] = bag;
  const y = kanal.yayin ?? {};
  const vds = String(y[vdsA] ?? '').replace(/\/+$/, '');
  const feed = String(y[feedA] ?? '').replace(/\/+$/, '');
  const defter = String(y[defterA] ?? '');
  for (const [ad, v] of [[`yayin.${vdsA}`, vds], [`yayin.${defterA}`, defter]]) {
    if (!GUVENLI_YOL.test(v) || v.split('/').includes('..')) throw new Olculemedi(`kanal "${kod}" ${ad} güvenli bir VDS yolu değil: "${v}"`);
  }
  if (!ADRES.test(`${feed}/`)) throw new Olculemedi(`kanal "${kod}" yayin.${feedA} https adresi değil: "${feed}"`);
  if (!SSH_TAKMA_AD.test(SSH_HEDEF_VARSAYILAN)) throw new Olculemedi(`ssh takma adı biçimsiz: "${SSH_HEDEF_VARSAYILAN}"`);
  return { ssh: SSH_HEDEF_VARSAYILAN, vds, feed, defter };
}
