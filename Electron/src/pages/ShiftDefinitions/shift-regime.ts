// =============================================================================
// VARDİYA TANIMLARI — GÖRÜNÜRLÜK REJİMİ (saf katman; `stop-regime.ts` kalıbı)
// =============================================================================
// Ekran DOKUMA modülüne aittir (referans fabrikada KAPALI → karo çizilmez). Yetki duvarı
// DEĞİL: kapı `loom:spec-manage` izni, asıl sed backend `requireDokumaEnabled`.
// =============================================================================

export interface ShiftDefinitionsVisibilityContext {
  /** Dokuma modülü — ETKİN değer (`production && dokuma`). */
  dokumaEnabled: boolean;
}

/** Vardiya Tanımları karosu / palet girişi çizilsin mi? */
export function isShiftDefinitionsVisible(ctx: ShiftDefinitionsVisibilityContext): boolean {
  return ctx.dokumaEnabled;
}
