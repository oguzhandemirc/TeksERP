// Desen kartı (WeaveDesign) + etkin yapı sabitleri — Seyitoğlu SY-A2 (tasarım §2.5–2.6).
// Tutarlılık eşiği UYARIDIR (kayıt reddedilmez); ızgara tavanı gövde büyüklüğünü sınırlar.

/** Σ rapordaki atkı ÷ desen boyu ile atkı sıklığı arasındaki izinli fark (%). */
export const REPEAT_PICKS_TOLERANCE_PCT = 5;

/** Armür ızgarası tavanı: en çok 32 çerçeve × 512 atkı (satır = atkı, sütun = çerçeve). */
export const LIFT_PLAN_MAX_FRAMES = 32;
export const LIFT_PLAN_MAX_PICKS = 512;

export const WEAVE_DESIGN_KINDS = ["PLAIN", "DOBBY", "JACQUARD", "LENO"] as const;
export const WARP_LAYER_ROLES = ["LENO", "SECONDARY"] as const;
export const WARP_BEAM_MODES = ["SEPARATE_BEAM", "SHARED_BEAM", "CREEL"] as const;

/** Etkin yapı uyarı kodları (`warnings[].code`). */
export const CONSTRUCTION_WARNING = {
  repeatPicksMismatch: "REPEAT_PICKS_MISMATCH",
  liftPlanFramesExceed: "LIFT_PLAN_FRAMES_EXCEED",
  liftPlanPicksMismatch: "LIFT_PLAN_PICKS_MISMATCH",
} as const;
