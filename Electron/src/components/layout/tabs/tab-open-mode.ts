import type { AppPreferences } from "@/types/preferences";

/**
 * "Sekme davranışı" kişisel tercihi (2026-10-30 kullanıcı isteği).
 *   newTab  — bugünkü davranış (VARSAYILAN): menü/palet odakla-ya-da-yeni-sekme, sağ tık arka plan sekmesi
 *   sameTab — her tık aktif sekmede; yeni sekme yalnız Ctrl/⌘/Shift + tık ya da orta tık
 */
export type TabOpenMode = "newTab" | "sameTab";

export const DEFAULT_TAB_OPEN_MODE: TabOpenMode = "newTab";

/** Blob gevşek doğrulanır: bilinmeyen/eksik değer → varsayılan. */
export function readTabOpenMode(prefs: AppPreferences | null | undefined): TabOpenMode {
  return prefs?.tabs?.openMode === "sameTab" ? "sameTab" : DEFAULT_TAB_OPEN_MODE;
}

// Tıklama anında okunan ayna: kaynak PreferencesProvider'dır (effect ile yazar). Ayna, React
// bağlamı dışındaki açıcıların (tembel yüklenen İz sür bağlantıları) da aynı kararı vermesi için.
let currentMode: TabOpenMode = DEFAULT_TAB_OPEN_MODE;

export function setTabOpenMode(mode: TabOpenMode): void {
  currentMode = mode;
}

export function getTabOpenMode(): TabOpenMode {
  return currentMode;
}
