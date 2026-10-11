// Varsayılan süperadmin malzemesinin SAF sözleşmesi (DB'siz): `{v:1, kullaniciAdi, ozet}`.
// Derleme tarafı ikizi `scripts/lib/varsayilan-superadmin-derleme.mjs` (regex'ler bayt-eşit; bekçi kıyaslar).

/** bcrypt özeti, maliyet 12–19 (ortak parolanın özeti pakette durur; ucuz özet kabul edilmez). */
export const DEFAULT_HASH_RE = /^\$2[aby]\$1[2-9]\$[./A-Za-z0-9]{53}$/;
/** `superadmin-olustur` ile aynı ad sözleşmesi. */
export const VARSAYILAN_AD_RE = /^[A-Za-z0-9._-]{3,50}$/;
/** Ortak parolanın alt sınırı (özet betiği zorlar; özetten ölçülemez). */
export const VARSAYILAN_PAROLA_MIN = 16;

export interface VarsayilanMalzeme {
  kullaniciAdi: string;
  ozet: string;
}

/** Ham malzemeyi doğrular; bozuksa `null` (içerik hiçbir mesaja girmez). */
export function malzemeCoz(ham: unknown): VarsayilanMalzeme | null {
  let j: unknown = ham;
  if (typeof ham === "string") {
    try {
      j = JSON.parse(ham);
    } catch {
      return null;
    }
  }
  if (!j || typeof j !== "object") return null;
  const { v, kullaniciAdi, ozet } = j as Record<string, unknown>;
  if (v !== 1 || typeof kullaniciAdi !== "string" || typeof ozet !== "string") return null;
  if (!VARSAYILAN_AD_RE.test(kullaniciAdi) || !DEFAULT_HASH_RE.test(ozet)) return null;
  return { kullaniciAdi, ozet };
}
