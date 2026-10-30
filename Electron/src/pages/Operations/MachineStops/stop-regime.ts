// =============================================================================
// MAKİNE / TEZGAH DURUŞLARI — GÖRÜNÜRLÜK REJİMİ (saf katman; `weaving-regime.ts` kalıbı)
// =============================================================================
// D4-A3 (ister 5.5): ekran backend'in duruş rejimiyle AYNI yüklemi taşır — dokuma ∨ (üretim ∧
// `uretim.makineDurusTakibi`) (`machine-stop-regime.helper.ts`). Panelde TEK çözüm noktası
// `resolveMachineStopEnabled`; bağlam (`useOperationsVisibilityContext`) onu bir kez çağırır, karo ·
// palet · route · Vardiya Tanımları aynı alanı (`machineStopEnabled`) okur. Dokuma açıkken başlık bugünkü.
// Yetki duvarı DEĞİL: kapı izindir, asıl sed backend `requireMachineStopRegime`.
// =============================================================================
import { TERIM_AD } from "@/lib/terim";

export interface StopVisibilityContext {
  /** Duruş rejimi — ETKİN değer (`dokuma ∨ production ∧ machineStopTracking`). */
  machineStopEnabled: boolean;
}

/** Ham bayraklar → rejim (belirsiz bayrak çağıranın işi: false gelir). Dokuma ETKİN değerdir (`production && dokuma`). */
export function resolveMachineStopEnabled(f: { dokumaEnabled: boolean; productionEnabled: boolean; machineStopTrackingEnabled: boolean }): boolean {
  return f.dokumaEnabled || (f.productionEnabled && f.machineStopTrackingEnabled);
}

/** Duruşlar karosu / palet girişi / route çizilsin mi? */
export function isMachineStopsVisible(ctx: StopVisibilityContext): boolean {
  return ctx.machineStopEnabled;
}

/** Makine adı: dokuma açıkken bugünkü "Tezgah", dokumasız rejimde "Makine" (sütun, süzgeç, giriş diyaloğu). */
export function machineNoun(ctx: { dokumaEnabled: boolean }): "Tezgah" | "Makine" {
  return ctx.dokumaEnabled ? "Tezgah" : "Makine";
}

/** Ekran adı: dokuma açıkken bugünkü "Tezgah Duruşları", dokumasız rejimde "Makine Duruşları". */
export function machineStopsTitle(ctx: { dokumaEnabled: boolean }): string {
  return ctx.dokumaEnabled ? TERIM_AD.tezgahDuruslari : TERIM_AD.makineDuruslari;
}
