// =============================================================================
// TEZGAH SALONU — TV BAĞLANTISI (menüsüz kip, DOKUMA-CANLI-EKRAN §9 madde 4)
// =============================================================================
// `#/tezgah-tv` sekme/menü kabuğu çizilmeden salonu TV kipinde açar (`AppShell` dalı, App `Root` oturum-içi).
// Kapılar uygulama route'uyla AYNI: izin `loom:live-view` + `operations/weaving-floor`
// ekranının modülü (`tezgahEnabled`); gerçek kapı yine backend'dir.
// =============================================================================

import { TEZGAH_TV_HASH_PATH, isTvWindowHash, type TvWindowOpenResult } from "@shared/tv-window";
import { clearTvOpen, markTvOpen, tvWindowApi, writeTvPref } from "./tv-prefs";

/** TV bağlantısının hash yolu — AppShell dalı, panel düğmesi, bağlantı üreteci ve ayrı pencere aynı sabitten. */
export const TEZGAH_TV_PATH = TEZGAH_TV_HASH_PATH;
/** Modül kapısı bu ekran anahtarından okunur (`ROUTE_MODULE`); ayrı modül anahtarı yok. */
export const TEZGAH_TV_SCREEN = "/operations/weaving-floor";
export const TEZGAH_TV_PERMISSION = "loom:live-view";

export type TvGate = "WAIT" | "NO_PERMISSION" | "MODULE_CLOSED" | "OPEN";

/**
 * `ProtectedRoute` ile aynı sıra: izin (JWT'den, beklemez) → bayrak yüklenene dek bekle →
 * bayrak okunamadıysa çiz (gerçek kapı backend) → modül kapalıysa kapalı.
 */
export function tvGateOf(i: { permitted: boolean; flagsReady: boolean; flagsFailed: boolean; moduleOpen: boolean }): TvGate {
  if (!i.permitted) return "NO_PERMISSION";
  if (!i.flagsReady) return "WAIT";
  if (!i.flagsFailed && !i.moduleOpen) return "MODULE_CLOSED";
  return "OPEN";
}

function currentHttpOrigin(): string {
  return typeof window !== "undefined" && window.location.protocol.startsWith("http") ? window.location.origin : "";
}

/** Salon TV'sinin tarayıcısına yazılacak MUTLAK adres; web paneli yoksa (Electron `file://`) null. */
export function buildTezgahTvUrl(
  publicBase: string | undefined = import.meta.env.VITE_PUBLIC_APP_URL,
  pageOrigin: string = currentHttpOrigin(),
): string | null {
  const origin = ((publicBase ?? "").trim() || pageOrigin.trim()).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(origin)) return null;
  return `${origin}/#${TEZGAH_TV_PATH}`;
}

/** Bu pencereyi TV kipine geçirir (menüsüz; çıkış köşe düğmesi ya da Esc — `TvExit`). */
export function openTezgahTvHere(): void {
  writeTvPref({ kip: "ayni", ekranId: null });
  markTvOpen("ayni");
  window.location.hash = `#${TEZGAH_TV_PATH}`;
}

/** TV kipinden kabuğa döner; sekme defteri kalıcı olduğu için salon sekmesi yerinde bulunur. */
export function exitTezgahTvHere(): void {
  clearTvOpen();
  window.location.hash = "#/";
}

/** Ayrı TV penceresi (Electron): açılırsa kip/ekran tercihi ve "açık" işareti yazılır. */
export async function openTezgahTvWindow(displayId: number | null): Promise<TvWindowOpenResult> {
  const api = tvWindowApi();
  if (!api) return { ok: false, reason: "Ayrı pencere yalnız masaüstü uygulamasında açılır" };
  const res = await api.open({ displayId });
  if (res.ok) {
    writeTvPref({ kip: "ayri", ekranId: res.displayId });
    markTvOpen("ayri");
  }
  return res;
}

/** Bu pencere ayrı TV penceresi mi — çıkışı pencereyi kapatmaktır. */
export function isSeparateTvWindow(): boolean {
  return typeof window !== "undefined" && isTvWindowHash(window.location.hash);
}

/** Ayrı TV penceresini kapatır ("açık" işaretini ana pencere kapanış olayıyla temizler). */
export function closeTezgahTvWindow(): void {
  window.api?.window?.close?.();
}
