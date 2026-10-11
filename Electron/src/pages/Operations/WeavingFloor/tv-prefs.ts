// Salon TV kipinin YEREL tercihi (bu bilgisayar): son seçilen kip/ekran ve kapanışta TV açık
// mıydı. Uygulama yeniden açılınca TV kendiliğinden geri gelir (TV'ye bağlı bilgisayar senaryosu);
// açıkça çıkılınca unutulur. localStorage yoksa/bozuksa varsayılana düşer — hiçbir akış durmaz.
import type { TvWindowApi } from "@shared/ipc-contract";
import type { TvDisplayInfo } from "@shared/tv-window";

export type TvMode = "ayni" | "ayri";

export interface TvPref {
  kip: TvMode;
  /** Ayrı pencerenin son ekranı; null = ana süreç seçsin (ikinci ekran varsa o). */
  ekranId: number | null;
}

const PREF_KEY = "tezgahTv.tercih";
const OPEN_KEY = "tezgahTv.acik";
export const DEFAULT_TV_PREF: TvPref = { kip: "ayni", ekranId: null };

const isMode = (v: unknown): v is TvMode => v === "ayni" || v === "ayri";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Depolama kapalı: tercih yalnız bu oturumda geçerli olmaz — sessiz geçilir.
  }
}

export function readTvPref(): TvPref {
  try {
    const raw = JSON.parse(read(PREF_KEY) ?? "null") as Partial<TvPref> | null;
    if (!raw || !isMode(raw.kip)) return DEFAULT_TV_PREF;
    const id = raw.ekranId;
    return { kip: raw.kip, ekranId: typeof id === "number" && Number.isSafeInteger(id) ? id : null };
  } catch {
    return DEFAULT_TV_PREF;
  }
}

export function writeTvPref(p: TvPref): void {
  write(PREF_KEY, JSON.stringify(p));
}

/** Kapanışta açık olan TV kipi (yeniden açılışta geri getirilir). */
export function readTvOpen(): TvMode | null {
  const v = read(OPEN_KEY);
  return isMode(v) ? v : null;
}

export function markTvOpen(mode: TvMode): void {
  write(OPEN_KEY, mode);
}

export function clearTvOpen(): void {
  write(OPEN_KEY, null);
}

/** Electron'da TV penceresi köprüsü; web panelinde/testte null. */
export function tvWindowApi(): TvWindowApi | null {
  return typeof window !== "undefined" ? (window.api?.tvWindow ?? null) : null;
}

/** Menü satırları: tek ekranda tek "ayrı pencere"; çok ekranda her ekran, birincil olmayan önce (önerilen). */
export function windowChoicesOf(displays: readonly TvDisplayInfo[]): { displayId: number | null; label: string; suggested: boolean }[] {
  if (displays.length <= 1) return [{ displayId: null, label: "Ayrı pencerede aç", suggested: false }];
  const ordered = [...displays].sort((a, b) => Number(a.primary) - Number(b.primary));
  return ordered.map((d) => ({
    displayId: d.id,
    label: `Ayrı pencere — ${d.label} (${d.width}×${d.height})${d.primary ? " · bu ekran" : ""}`,
    suggested: !d.primary,
  }));
}
