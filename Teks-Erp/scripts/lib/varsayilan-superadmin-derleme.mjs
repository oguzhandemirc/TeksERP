// =============================================================================
// VARSAYILAN SÜPERADMİN MALZEMESİ — derleme anı kaynağı (kullanıcı kararı 2026-10-11)
// =============================================================================
// `{v:1, kullaniciAdi, ozet}` (bcrypt, maliyet ≥12) derlemede `__TEKSERP_VARSAYILAN_SA__`
// sabitine gömülür; düz parola hiçbir katmanda yoktur, özet de REPOYA girmez.
// Kaynak sırası: ortam `TEKSERP_VARSAYILAN_SA` (GitHub Actions sırrı) > dosya
// `TEKSERP_VARSAYILAN_SA_DOSYA` (Docker `--mount=type=secret`) > `~/.tekserp/sirlar/varsayilan-superadmin.json`.
// Kaynak YOKSA `null` ⇒ sabit tanımlanmaz ⇒ hesap doğmaz (bugünkü davranış). Kaynak VAR ama
// bozuksa derleme DURUR (sessizce malzemesiz paket üretmek yanlış güven verirdi).
// Biçim sözleşmesi `src/constants/varsayilan-superadmin.ts` ile AYNI (bekçi kıyaslar).
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_HASH_RE = /^\$2[aby]\$1[2-9]\$[./A-Za-z0-9]{53}$/;
export const VARSAYILAN_AD_RE = /^[A-Za-z0-9._-]{3,50}$/;
export const YEREL_SIR_DOSYASI = path.join('.tekserp', 'sirlar', 'varsayilan-superadmin.json');

/** Ham metni doğrular ve kanonik JSON'a indirger; bozuksa hata (içerik mesaja girmez). */
export function malzemeKanonik(ham, kaynak) {
  let j;
  try {
    j = JSON.parse(ham);
  } catch {
    throw new Error(`varsayılan süperadmin malzemesi JSON değil (kaynak: ${kaynak})`);
  }
  if (!j || typeof j !== 'object' || j.v !== 1 || typeof j.kullaniciAdi !== 'string' || typeof j.ozet !== 'string'
    || !VARSAYILAN_AD_RE.test(j.kullaniciAdi) || !DEFAULT_HASH_RE.test(j.ozet)) {
    throw new Error(`varsayılan süperadmin malzemesi biçimsiz — {v:1, kullaniciAdi, ozet(bcrypt ≥12)} beklenir (kaynak: ${kaynak})`);
  }
  return JSON.stringify({ v: 1, kullaniciAdi: j.kullaniciAdi, ozet: j.ozet });
}

/**
 * Derlemeye gömülecek malzemeyi çözer.
 * @returns {{ json: string, kaynak: string } | null}
 */
export function varsayilanSaMalzemesi({ env = process.env, ev = os.homedir() } = {}) {
  const ortam = (env.TEKSERP_VARSAYILAN_SA ?? '').trim();
  if (ortam) return { json: malzemeKanonik(ortam, 'ortam TEKSERP_VARSAYILAN_SA'), kaynak: 'ortam' };
  const dosyalar = [];
  if (env.TEKSERP_VARSAYILAN_SA_DOSYA) dosyalar.push(['dosya', env.TEKSERP_VARSAYILAN_SA_DOSYA]);
  if (ev) dosyalar.push(['yerel', path.join(ev, YEREL_SIR_DOSYASI)]);
  for (const [kaynak, yol] of dosyalar) {
    if (!fs.existsSync(yol)) continue;
    const ham = fs.readFileSync(yol, 'utf8').trim();
    if (!ham) continue;
    return { json: malzemeKanonik(ham, kaynak), kaynak };
  }
  return null;
}

/** esbuild `define` parçası: malzeme yoksa BOŞ (sabit tanımsız kalır → `typeof` ile okunur). */
export function varsayilanSaDefine(malzeme) {
  return malzeme ? { __TEKSERP_VARSAYILAN_SA__: JSON.stringify(malzeme.json) } : {};
}
