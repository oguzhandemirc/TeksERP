// `/durum` bant listesine lisans kararından BAĞIMSIZ katılan bilgi bantları.
import { currentSignedSkew, signedSkewBanner } from "./signed-skew";
import type { Banner } from "./state";

/**
 * Lisans kararına GİRMEYEN, süreçte ölçülen bilgi bantları: yalnız `/durum` bant listesine katılır, kademe/engel/tavan
 * doğurmaz, bu yüzden gözlemde de görünür ("gözlemde sıfır fark"ın K9 ile birlikte beyanlı istisnası). Kapalı liste.
 */
export const PROCESS_INFO_BANNERS: Readonly<Record<string, () => Banner | null>> = Object.freeze({
  SAAT_SAPMASI: () => signedSkewBanner(currentSignedSkew()),
});

const TONE_RANK: Record<Banner["ton"], number> = { tehlike: 3, uyari: 2, bilgi: 1 };

/** Lisans bantları + süreç bilgi bantları; şiddete göre azalan (eşitlikte lisans önce), aynı metin bir kez. */
export function withProcessBanners(license: readonly Banner[]): readonly Banner[] {
  const extra = Object.values(PROCESS_INFO_BANNERS)
    .map((f) => f())
    .filter((b): b is Banner => b !== null && !license.some((l) => l.metin === b.metin));
  if (extra.length === 0) return license;
  const all = [...license, ...extra].map((b, i) => ({ b, i }));
  all.sort((x, y) => TONE_RANK[y.b.ton] - TONE_RANK[x.b.ton] || x.i - y.i);
  return Object.freeze(all.map((x) => x.b));
}

/** `/durum` bant alanları: `bant` daima `bantlar[0]` (eski istemci tek alanı okur). */
export function bannerFields(license: readonly Banner[]): { readonly bant: Banner | null; readonly bantlar: readonly Banner[] } {
  const bantlar = withProcessBanners(license);
  return { bant: bantlar[0] ?? null, bantlar };
}
