import { useSyncExternalStore } from "react";

/**
 * Adres çubuğundaki hash yolu — DEĞİŞİNCE YENİDEN RENDER EDER.
 *
 * ⚠️ NEDEN GEREKLİ: `App.tsx`teki `Root` kapısı hangi kabuğun (AppShell /
 * authRouter) çizileceğini hash'e bakarak seçiyor (`#/2fa-kurulum`). Düz
 * `window.location.hash` okumak React'e HİÇBİR ŞEY söylemez: hash değişir,
 * bileşen render olmaz, ekran eski kabukta ASILI KALIR (hata yok, log yok).
 *
 * `hashchange` HEM tarayıcı gezinmesini HEM programatik atamayı yakalar.
 * `popstate` de dinlenir: react-router'ın hash router'ı `history.pushState`
 * kullanabiliyor ve o `hashchange` üretmez.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** `#/2fa-kurulum?x=1` → `/2fa-kurulum`. Hash yoksa `/`. */
export function readHashPath(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const path = raw.split("?")[0]?.split("#")[0] ?? "";
  return path.startsWith("/") ? path : `/${path}`;
}

export function useHashPath(): string {
  return useSyncExternalStore(
    subscribe,
    () => readHashPath(window.location.hash),
    () => "/",
  );
}
