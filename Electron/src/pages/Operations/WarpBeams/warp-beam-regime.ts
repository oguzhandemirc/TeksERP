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

/**
 * Devere F2: Üretim › Devere / Çözgü grubundaki "Denye Sapması" karosu (rapor yaprağı `/reports/dokuma/denye-sapma`).
 * Route kapısıyla aynı: dokuma (rapor kategorisi) ∧ devere (`ROUTE_ALSO_REQUIRES`) ∧ rapor açık.
 */
export function isDenierReportVisible(ctx: WarpBeamVisibilityContext & { dokumaEnabled: boolean; isReportOpen: (key: string) => boolean }): boolean {
  return ctx.devereEnabled && ctx.dokumaEnabled && ctx.isReportOpen("dokuma/denye-sapma");
}

/** Devere-levent S2: "Devereci Karnesi" karosu — denye sapma karosuyla aynı kapı, kendi rapor anahtarıyla. */
export function isWarperScorecardVisible(ctx: WarpBeamVisibilityContext & { dokumaEnabled: boolean; isReportOpen: (key: string) => boolean }): boolean {
  return ctx.devereEnabled && ctx.dokumaEnabled && ctx.isReportOpen("dokuma/devereci-karnesi");
}
