// =============================================================================
// EK ÇÖZGÜ KATMANI SARIM BİÇİMİ — saf, DB'siz (Seyitoğlu SY-B1; 2026-10-31 kullanıcı kararı)
// =============================================================================
// `ItemWarpLayer.beamMode` üç kip: SEPARATE_BEAM (ayrı levent, bugünkü levent takımı) · SHARED_BEAM
// (zeminle AYNI levent; her tel grubu kendi take-up'ıyla tüketir, leventin kalanı EN HIZLI tükenen
// gruptan okunur) · CREEL (cağlık/bobin; levent yok, iplik stoktan). Maliyet motoru, levent
// otomatik tüketimi ve iplik ihtiyacı kip kararını YALNIZ buradan alır.
// =============================================================================
import { Prisma } from "@prisma/client";

export const WARP_BEAM_MODES = ["SEPARATE_BEAM", "SHARED_BEAM", "CREEL"] as const;
export type WarpBeamModeCode = (typeof WARP_BEAM_MODES)[number];

export const WARP_BEAM_MODE_LABEL: Record<WarpBeamModeCode, string> = {
  SEPARATE_BEAM: "Ayrı levent",
  SHARED_BEAM: "Zeminle aynı levent",
  CREEL: "Cağlık (levent yok)",
};

/** Katman zemin leventine mi sarılı (tel grubu)? */
export const isSharedBeamLayer = (mode: string): boolean => mode === "SHARED_BEAM";
/** Katmanın kendi leventi var mı? CREEL'de levent önerisi/levent düşümü YOK. */
export const layerHasOwnBeam = (mode: string): boolean => mode === "SEPARATE_BEAM";

/**
 * Zemin leventinin ETKİN take-up'ı: zemin + SHARED_BEAM gruplarının en büyüğü (en hızlı tükenen
 * grup leventin kalanını belirler). Ortak grup yoksa zemin değeri AYNEN döner (bayt-aynı).
 * Bilinmeyen (null) grup yok sayılır; hepsi null ise null.
 */
export function fastestGroupTakeUpPct(
  groundTakeUpPct: Prisma.Decimal | null,
  layers: ReadonlyArray<{ beamMode: string; takeUpPct: Prisma.Decimal | null }>,
): Prisma.Decimal | null {
  let out = groundTakeUpPct;
  for (const l of layers) {
    if (!isSharedBeamLayer(l.beamMode) || l.takeUpPct === null) continue;
    if (out === null || l.takeUpPct.gt(out)) out = l.takeUpPct;
  }
  return out;
}
