// =============================================================================
// TEZGAH SALONU — TV BAĞLANTISI (menüsüz kip, DOKUMA-CANLI-EKRAN §9 madde 4)
// =============================================================================
// `#/tezgah-tv` sekme/menü kabuğu çizilmeden salonu TV kipinde açar (App `Root` kapısı).
// Kapılar uygulama route'uyla AYNI: izin `loom:live-view` + `operations/weaving-floor`
// ekranının modülü (`tezgahEnabled`); gerçek kapı yine backend'dir.
// =============================================================================

/** TV bağlantısının hash yolu — App kapısı, panel düğmesi ve bağlantı üreteci aynı sabitten. */
export const TEZGAH_TV_PATH = "/tezgah-tv";
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

/** Bu pencereyi TV kipine geçirir (menüsüz; çıkış uygulamayı yeniden açmak ya da adresi değiştirmek). */
export function openTezgahTvHere(): void {
  window.location.hash = `#${TEZGAH_TV_PATH}`;
}
