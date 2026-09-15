// =============================================================================
// Üretim İstasyonları — GÖRÜNÜM TERCİHİ (kart ⇄ liste), cihaza kayıtlı (kullanıcı isteği #3, 2026-09-16)
// =============================================================================
// Varsayılan LİSTE. Kalıcılık `localStorage` — sunucu ayarı DEĞİL (`useListToggles` gerekçesi: görünüm
// tercihi iş verisi değildir; makineye bağlı kalır, başka bilgisayarda varsayılanla başlar). Depo
// okunamazsa/bozuksa (gizli mod, elle bozulmuş değer) varsayılana düşülür; liste çalışmaya devam eder.
// =============================================================================
import { useCallback, useState } from "react";

export type StationsViewMode = "cards" | "list";
export const STATIONS_VIEW_MODE_KEY = "stations.viewMode";
export const DEFAULT_STATIONS_VIEW_MODE: StationsViewMode = "list";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readStationsViewMode(storage: StorageLike | null = defaultStorage()): StationsViewMode {
  try {
    const v = storage?.getItem(STATIONS_VIEW_MODE_KEY);
    return v === "cards" || v === "list" ? v : DEFAULT_STATIONS_VIEW_MODE;
  } catch {
    return DEFAULT_STATIONS_VIEW_MODE;
  }
}

export function writeStationsViewMode(mode: StationsViewMode, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(STATIONS_VIEW_MODE_KEY, mode);
  } catch {
    /* sessiz: kalıcılık kaybı görünümü bozmaz */
  }
}

/** Sayfa hook'u: ilk değer depodan, her değişim depoya. */
export function useStationsViewMode(): [StationsViewMode, (m: StationsViewMode) => void] {
  const [mode, setMode] = useState<StationsViewMode>(() => readStationsViewMode());
  const set = useCallback((m: StationsViewMode) => {
    setMode(m);
    writeStationsViewMode(m);
  }, []);
  return [mode, set];
}
