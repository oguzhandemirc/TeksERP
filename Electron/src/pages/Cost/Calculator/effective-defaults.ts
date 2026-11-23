// Boş ezme kutusunda "varsayılan" yerine GERÇEK değer görünsün (M13): önce sunucunun son önizlemesindeki
// etkin girdi (eski sunucu alanı eksik gönderebilir → isteğe bağlı zincir) (yapı + parametre uygulanmış), önizleme yoksa yürürlükteki parametre seti. Hesap yok, yalnız gösterim.
import type { StructureKey } from "../Items/service";
import type { CostParameterSet } from "../Parameters/service";
import type { CostInputSnap } from "../shared/cost-types";

export type EffectiveDefaults = Partial<Record<StructureKey, string | number | null>>;

export function effectiveDefaults(girdi: CostInputSnap | undefined, params: CostParameterSet | null | undefined): EffectiveDefaults {
  if (girdi) {
    return {
      loomRpm: girdi.loom?.rpm.value ?? null,
      efficiencyPct: girdi.loom?.efficiencyPct.value ?? null,
      warpWastePct: girdi.warp?.wastePct.value ?? null,
      weftWastePct: girdi.weft?.wastePct.value ?? null,
      fabricWastePct: girdi.fabricWastePct?.value ?? null,
      weftLengthCm: girdi.weft?.lengthCm.value ?? null,
      beamLengthM: girdi.beam?.lengthM.value ?? null,
      lengthShrinkPct: girdi.lengthShrinkPct?.value ?? null,
      extraCostPerMTry: girdi.extra?.amountTry ?? null,
    };
  }
  if (!params) return {};
  return {
    loomRpm: params.defaultLoomRpm,
    efficiencyPct: params.defaultEfficiencyPct,
    warpWastePct: params.defaultWarpWastePct,
    weftWastePct: params.defaultWeftWastePct,
    fabricWastePct: params.defaultFabricWastePct,
    beamLengthM: params.defaultBeamLengthM,
  };
}
