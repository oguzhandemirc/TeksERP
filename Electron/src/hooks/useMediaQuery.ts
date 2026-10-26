import { useEffect, useState } from "react";

/** Kenar çubuğunun çekmeceye döndüğü eşik (UX-3: ≤1024 px tablet/telefon). Tailwind `lg` ile aynı yer. */
export const NARROW_SHELL_QUERY = "(max-width: 1024px)";

/**
 * CSS medya sorgusunun canlı sonucu. `matchMedia` yoksa (jsdom, eski gömülü tarayıcı)
 * `false` — geniş masaüstü yerleşimi bugünkü davranıştır, kuşkuda o seçilir.
 */
export function useMediaQuery(query: string): boolean {
  const read = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Sürükle-bırak/tuval düzenleyicilerinin salt-okunura döndüğü eşik: telefon (<768 px). Tablet düzenler. */
export const NARROW_EDITOR_QUERY = "(max-width: 767px)";

/** Düzenleyici dar ekranda mı — tasarımcı/stüdyo/düzen ekranları burada salt-okunur + uyarı gösterir. */
export function useNarrowEditor(): boolean {
  return useMediaQuery(NARROW_EDITOR_QUERY);
}
