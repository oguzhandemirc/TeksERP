// =============================================================================
// AĞIR ADIMLAR CI'A — `TEKSERP_KAPI_AGIR_CI=1`
// =============================================================================
// NEDEN (2026-11-01): ~10 paralel ajanda (load 50–97, swap 4,5 GB) kapı ortalaması 30–40 dk,
// bunun 13–23 dk'sı semafor beklemesiydi; ağır adımlar (tip · lint · lint tavanı · hızlı test)
// 16:00'dan beri ~250 koşumda 3 kez kırmızı, CI aynılarını ~11 dk'da koşar ve iniş CI yeşiline bağlı.
// Yalnız "1" açar (yoksa bugünkü davranış); ağır olmayan adımlar (mandallar, migration hijyeni,
// doküman, sır, yayın bekçileri) HER ZAMAN yerelde koşar.
export const KAPI_AGIR_CI_ENV = "TEKSERP_KAPI_AGIR_CI";

/** `agir: true` adımları env "1" iken ayıklar; sıra korunur. */
export function agirAdimlariAyikla(adimlar, env = process.env) {
  if (env[KAPI_AGIR_CI_ENV] !== "1") return { kalan: adimlar, atlanan: [] };
  return { kalan: adimlar.filter((a) => !a.agir), atlanan: adimlar.filter((a) => a.agir) };
}
