// =============================================================================
// TEZGAH SALONU — GÖRÜNÜRLÜK REJİMİ (saf katman; `stop-regime.ts` kalıbı)
// =============================================================================
// Ekran TEZGAH İZLEME modülüne aittir (referans profilde KAPALI → karo çizilmez).
// Yetki duvarı DEĞİL: kapı izindir (`loom:live-view`), asıl sed backend
// `requireTezgahEnabled` (`/api/loom-floor`). Palet aynı fonksiyon nesnesini taşır.
// =============================================================================

export interface FloorVisibilityContext {
  /** Tezgah izleme — ETKİN değer (`production && tezgah`). */
  tezgahEnabled: boolean;
}

/** Tezgah Salonu karosu / palet girişi çizilsin mi? */
export function isWeavingFloorVisible(ctx: FloorVisibilityContext): boolean {
  return ctx.tezgahEnabled;
}
