// =============================================================================
// YAYIN HEDEFİ — yükleyicilerin (panel · tablet · backend) VDS dizini, doğrulama adresi ve defteri
// =============================================================================
// Hedef YALNIZ dağıtım kaydından (`scripts/lib/grup-yayin.mjs` `grupHedefi`) çözülür;
// ortam değişkeni ya da argümanla ezme görülürse yükleyici DURUR. Ezme listeleri ve uzak değer denetimi burada
// tek kaynaktır (grup yükleyicileri ve bekçileri buradan alır).
//
// Uzak kabuğa giden her değer burada biçim denetiminden geçer: yükleyiciler değerleri betik metnine
// gömmez, `bash -s -- <değer…>` konumsal argümanıyla geçirir — ssh argümanları uzak kabukta yeniden
// sözcüklere bölündüğü için değer, kabuğun yorumlayacağı karakter TAŞIYAMAZ (serbest metin base64'le).
// =============================================================================

import { Olculemedi } from './dagitim.mjs';

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
    'Yayın hedefi (VDS dizini · doğrulama adresi · defter · ssh takma adı) YALNIZ dağıtım kaydından çözülür (scripts/lib/grup-yayin.mjs).',
    'Kabuktan kaldır (ör. `unset UZAK_DIZIN`) ya da argümanı sil; prova `--kuru` ile ya da test grubunda yapılır.',
  ];
}

/** Değerin uzak kabukta tek sözcük kaldığını doğrular; değilse fırlatır (çağıran DURUR). */
export function uzakDegerDenetle(ad, deger) {
  const v = String(deger ?? '');
  if (!UZAK_DEGER.test(v) || v.split('/').includes('..')) throw new Olculemedi(`${ad} uzak komuta gidemez (biçimsiz): "${v.slice(0, 80)}"`);
  return v;
}
