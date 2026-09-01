import { useSyncExternalStore } from "react";

/**
 * Adres çubuğundaki hash yolu — DEĞİŞİNCE YENİDEN RENDER EDER.
 *
 * ⚠️ NEDEN GEREKLİ: `App.tsx`teki `Root` kapısı hangi kabuğun (AppShell /
 * BossShell / authRouter) çizileceğini hash'e bakarak seçiyor. Düz
 * `window.location.hash` okumak React'e HİÇBİR ŞEY söylemez: hash değişir,
 * bileşen render olmaz, ekran eski kabukta ASILI KALIR. İlk yazımda tam bu
 * oldu — "Tam panele geç" düğmesi adresi değiştiriyor ama ekran patron
 * kabuğunda kalıyordu; hata yok, log yok, yalnız tepkisiz bir düğme.
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

/** `#/boss?x=1` → `/boss`. Hash yoksa `/`. */
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
