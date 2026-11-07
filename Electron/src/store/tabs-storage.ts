import { createJSONStorage } from "zustand/middleware";

/** Sekme defterinin depolama anahtarı. */
export const TABS_STORAGE_KEY = "teks.tabs";

type NavPerf = Pick<Performance, "getEntriesByType"> | undefined;

/** Bu sayfa yüklemesi F5 / Electron reload mu? Ölçülemezse `false` (sıfırlama yönü güvenlidir). */
export function isPageReload(perf: NavPerf = globalThis.performance): boolean {
  try {
    const entry = perf?.getEntriesByType?.("navigation")?.[0] as { type?: string } | undefined;
    return entry?.type === "reload";
  } catch {
    return false;
  }
}

/**
 * Uygulama YENİ açıldıysa (reload değil) önceki sekmeleri at: her açılış Anasayfa'dan başlar.
 * `sessionStorage` pencere kapanınca zaten ölür; bu ikinci emniyet, depolamanın yeniden
 * başlatmada kalabildiği ortamlara karşı. Eski sürümün `localStorage` kopyası her açılışta silinir.
 */
export function purgeTabsOnFreshLaunch(perf: NavPerf = globalThis.performance): void {
  try {
    globalThis.localStorage?.removeItem(TABS_STORAGE_KEY);
  } catch {
    /* depolama yok — silinecek bir şey de yok */
  }
  if (isPageReload(perf)) return;
  try {
    globalThis.sessionStorage?.removeItem(TABS_STORAGE_KEY);
  } catch {
    /* depolama yok */
  }
}

/** Sekmeler yalnız bu pencerenin ömrü boyunca kalır (F5'te korunur, yeniden başlatmada gider). */
export const tabsStorage = createJSONStorage(() => globalThis.sessionStorage);
