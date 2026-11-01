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
 * Ek katmanın çözgü firesi (2026-11-01 kullanıcı kararı, #355): SEPARATE_BEAM katmanı ayrı
 * leventte hazırlandığı için firesi KENDİ çözgü kartından; kartta fire yoksa ya da kip
 * SHARED_BEAM/CREEL ise zemin zinciri AYNEN (bayt-aynı). Maliyet ve iplik ihtiyacı yalnız buradan.
 */
export function layerOwnCardWastePct(beamMode: string, cardWastePct: Prisma.Decimal | null): Prisma.Decimal | null {
  return layerHasOwnBeam(beamMode) ? cardWastePct : null;
}

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

/** SY-B2: levent raporunda leventin, bağlı işin ürün yapısındaki yeri (zemin / ek katman). */
export interface BeamLayerTag {
  rol: "GROUND" | "LENO" | "SECONDARY";
  beamMode: WarpBeamModeCode | null;
  etiket: string;
}
const LAYER_ROLE_LABEL: Record<string, string> = { LENO: "Döner çözgü", SECONDARY: "Ek çözgü" };
const SHARED_GROUP_LABEL: Record<string, string> = { LENO: "döner", SECONDARY: "ek" };

/**
 * Leventin çözgü kartı bağlı işin zemini mi, ek katmanı mı? Ürünün ek katmanı YOKSA null — rapor
 * satırına anahtar yazılmaz (tek katmanlıda bayt-aynı). Kart yapıda yoksa da null (uydurulmaz).
 */
export function beamLayerTag(
  beamWarpSpecId: string,
  groundWarpSpecId: string | null,
  layers: ReadonlyArray<{ warpSpecId: string; role: string; beamMode: string }>,
): BeamLayerTag | null {
  if (!layers.length) return null;
  if (beamWarpSpecId === groundWarpSpecId) {
    const shared = layers.filter((l) => isSharedBeamLayer(l.beamMode)).map((l) => SHARED_GROUP_LABEL[l.role] ?? l.role);
    return { rol: "GROUND", beamMode: null, etiket: shared.length ? `Zemin çözgü + ${shared.join(", ")} tel grubu (aynı levent)` : "Zemin çözgü" };
  }
  const own = layers.find((l) => l.warpSpecId === beamWarpSpecId);
  if (!own) return null;
  const mode = own.beamMode as WarpBeamModeCode;
  const base = LAYER_ROLE_LABEL[own.role] ?? own.role;
  return { rol: own.role === "LENO" ? "LENO" : "SECONDARY", beamMode: mode, etiket: layerHasOwnBeam(mode) ? base : `${base} · ${WARP_BEAM_MODE_LABEL[mode] ?? mode}` };
}
