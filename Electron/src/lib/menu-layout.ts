// =============================================================================
// MENÜ DÜZENİ süzgeci (K19) — saf yüklemler; hub karoları · komut paleti · kenar menü tek kaynaktan süzer.
// Gizleme güvenlik sınırı DEĞİL (doğrudan URL açılır, izin ayrı). Ayar yokken/yüklenmeden menü bugünkü gibidir.
// =============================================================================
import type { MenuLayoutView } from "@/services/menuLayoutService";

export interface MenuLayoutState {
  /** Menüden gizlenen ekran anahtarları (katalog `key`i: `system/perf`, `KK1`). */
  hidden: ReadonlySet<string>;
  /** Gelişmiş grubu AÇIKSA teknik ekranlar; kapalıysa boş (ekranlar bugünkü yerinde). */
  advanced: ReadonlySet<string>;
}

export const EMPTY_MENU_LAYOUT: MenuLayoutState = { hidden: new Set(), advanced: new Set() };

export function toMenuLayoutState(view: Pick<MenuLayoutView, "hiddenScreens" | "advancedGroup" | "advancedScreens"> | null | undefined): MenuLayoutState {
  if (!view) return EMPTY_MENU_LAYOUT;
  return {
    hidden: new Set(view.hiddenScreens ?? []),
    advanced: view.advancedGroup ? new Set(view.advancedScreens ?? []) : new Set(),
  };
}

/** Route yolu → katalog anahtarı: baştaki `/`, sorgu ve çapa atılır (`/system/perf?x=1` → `system/perf`). */
export function menuKeyOf(to: string): string {
  return to.replace(/[?#].*$/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

/** Ekran menüden gizli mi (palet + hub + kenar menü + Rapor Merkezi). */
export function isMenuHidden(state: MenuLayoutState, to: string): boolean {
  if (state.hidden.size === 0) return false;
  const key = menuKeyOf(to);
  if (state.hidden.has(key)) return true;
  // Rapor alt sayfasının kendi anahtarı yok; kategori hub'ı ve ALT raporları aynı yüklemi taşır.
  const segs = key.split("/");
  return segs[0] === "reports" && segs.length >= 3 && state.hidden.has(`reports/${segs[1]}`);
}

/** Ekran Gelişmiş grubunda mı (gizli değilse). */
export function isInAdvancedGroup(state: MenuLayoutState, to: string): boolean {
  return state.advanced.size > 0 && !isMenuHidden(state, to) && state.advanced.has(menuKeyOf(to));
}

/** Hub karosu çizilmez mi: gizli ya da Gelişmiş grubuna taşınmış. */
export function isHubTileHidden(state: MenuLayoutState, to: string): boolean {
  return isMenuHidden(state, to) || isInAdvancedGroup(state, to);
}
