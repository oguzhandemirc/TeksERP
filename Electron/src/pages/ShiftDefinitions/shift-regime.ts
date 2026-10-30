// =============================================================================
// VARDİYA TANIMLARI — GÖRÜNÜRLÜK REJİMİ (saf katman; `stop-regime.ts` kalıbı)
// =============================================================================
// D4-A3: vardiya takvimi ve tanım uçları duruş rejimiyle açılır (dokuma ∨ üretim ∧ makine duruşu
// takibi) — karo aynı alanı okur, ikinci yüklem yok. Yetki duvarı DEĞİL: kapı `loom:spec-manage`
// izni, asıl sed backend `requireMachineStopRegime` (`shift-definition.routes`).
// =============================================================================

export interface ShiftDefinitionsVisibilityContext {
  /** Duruş rejimi — ETKİN değer (`resolveMachineStopEnabled`). */
  machineStopEnabled: boolean;
}

/** Vardiya Tanımları karosu / palet girişi çizilsin mi? */
export function isShiftDefinitionsVisible(ctx: ShiftDefinitionsVisibilityContext): boolean {
  return ctx.machineStopEnabled;
}
