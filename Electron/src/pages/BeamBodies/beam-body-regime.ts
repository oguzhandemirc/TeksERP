// LEVENT GÖVDELERİ — görünürlük rejimi (saf). Ekran devere modülüne aittir VE `devere.beamBodyMode≠OFF` ister;
// backend iki kapısı `requireDevereEnabled` + `requireBeamBodyTracking`. Bağlam alanı yoksa/yüklenmediyse KAPALI
// (bugünkü davranış: menüde yok). Karo + palet aynı fonksiyon nesnesini taşır.
export interface BeamBodyVisibilityContext {
  devereEnabled: boolean;
  beamBodyEnabled?: boolean;
}

export function isBeamBodiesVisible(ctx: BeamBodyVisibilityContext): boolean {
  return ctx.devereEnabled && ctx.beamBodyEnabled === true;
}
