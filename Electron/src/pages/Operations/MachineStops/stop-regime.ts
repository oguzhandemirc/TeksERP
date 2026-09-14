// =============================================================================
// TEZGAH DURUŞLARI — GÖRÜNÜRLÜK REJİMİ (saf katman; `weaving-regime.ts` kalıbı)
// =============================================================================
// Ekran DOKUMA modülüne aittir (referans fabrikada KAPALI → karo çizilmez, "sıfır
// görünür fark"). Yüklem saf ve palet aynı fonksiyon nesnesini taşır (`toBe`).
// Yetki duvarı DEĞİL: kapı izindir (`loom:manual-entry` | `loom:classify`), asıl
// sed backend `requireDokumaEnabled` (`machine-stop.routes`).
// =============================================================================

export interface StopVisibilityContext {
  /** Dokuma modülü — ETKİN değer (`production && dokuma`). */
  dokumaEnabled: boolean;
}

/** Tezgah Duruşları karosu / palet girişi çizilsin mi? */
export function isMachineStopsVisible(ctx: StopVisibilityContext): boolean {
  return ctx.dokumaEnabled;
}
