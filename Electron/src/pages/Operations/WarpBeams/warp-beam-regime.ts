// =============================================================================
// LEVENTLER — GÖRÜNÜRLÜK REJİMİ (saf katman; `weaving-regime.ts` kalıbı)
// =============================================================================
// Ekran DEVERE modülüne aittir (referans fabrikada KAPALI → karo çizilmez). Yüklem saf,
// palet aynı fonksiyon nesnesini taşır (`toBe`). Yetki duvarı DEĞİL: kapı izindir
// (`warpbeam:read`), asıl sed backend `requireDevereEnabled` (`warp-beam.routes`).
// `devereEnabled` ETKİN değerdir (devere → iplik → ticaret zinciri bağlamı kuran hook'ta).
// =============================================================================

export interface WarpBeamVisibilityContext {
  devereEnabled: boolean;
}

/** Leventler karosu / palet girişi çizilsin mi? */
export function isWarpBeamsVisible(ctx: WarpBeamVisibilityContext): boolean {
  return ctx.devereEnabled;
}
