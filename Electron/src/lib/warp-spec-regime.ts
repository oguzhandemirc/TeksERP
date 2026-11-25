// =============================================================================
// ÇÖZGÜ KARTI REJİMİ (ürün kartı D4 / K1) — panel TEK yüklemi
// =============================================================================
// Backend aynası: `Teks-Erp/src/services/helpers/warp-spec-regime.helper.ts` (`requireWarpSpecRegime`).
// Çözgü kartı ürün YAPISI tanımıdır: devere ∨ dokuma açıkken tanımlanır. Levent / fason devere
// işlemleri devere kapısında kalır — onlar bu yüklemi OKUMAZ.
// =============================================================================

/** Ham (ETKİN) bayraklar → rejim. Devere ve dokuma bağlamdaki ETKİN değerlerdir; belirsizken false gelir. */
export function resolveWarpSpecEnabled(f: { devereEnabled: boolean; dokumaEnabled: boolean }): boolean {
  return f.devereEnabled || f.dokumaEnabled;
}

/** Çözgü Kartları karosu / palet girişi / route çizilsin mi? Alan yoksa (eski bağlam literali) KAPALI. */
export function isWarpSpecsVisible(ctx: { warpSpecEnabled?: boolean }): boolean {
  return ctx.warpSpecEnabled === true;
}
