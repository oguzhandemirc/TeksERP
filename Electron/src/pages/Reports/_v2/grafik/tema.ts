// Rapor grafiği paletleri. Ekran: panel token'ları (`--chart-*`, açık/koyu tema izler).
// Baskı: sabit, açık zeminde yüksek kontrastlı palet — kâğıt temayı bilmez.

export interface GrafikTema {
  renkler: string[];
  /** Önceki dönem / kıyas serisi (soluk). */
  soluk: string;
  metin: string;
  ikincil: string;
  izgara: string;
  zemin: string;
  isiDusuk: string;
  isiYuksek: string;
  yaziTipi: string;
}

const YAZI_TIPI = '-apple-system, "Segoe UI", Arial, sans-serif';

export const BASKI_TEMASI: GrafikTema = {
  renkler: ["#1f4e9c", "#d9730d", "#2e7d32", "#c62828", "#6a3d9a", "#00838f", "#6d4c41", "#455a64"],
  soluk: "#8a8f98",
  metin: "#111111",
  ikincil: "#444444",
  izgara: "#d4d4d4",
  zemin: "#ffffff",
  isiDusuk: "#eef3fb",
  isiYuksek: "#1f4e9c",
  yaziTipi: YAZI_TIPI,
};

/** `--chart-1: 243 75% 59%` → `hsl(243, 75%, 59%)` (zrender virgüllü yazımı ayrıştırır). */
function cssHsl(stil: CSSStyleDeclaration, ad: string): string | null {
  const ham = stil.getPropertyValue(ad).trim();
  const p = ham.split(/\s+/);
  return p.length === 3 ? `hsl(${p[0]}, ${p[1]}, ${p[2]})` : null;
}

/** Ekran paleti — token okunamazsa (test ortamı, erken boyama) baskı paletine düşer. */
export function ekranTemasi(): GrafikTema {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return { ...BASKI_TEMASI, zemin: "transparent" };
  const stil = getComputedStyle(document.documentElement);
  const renkler = [1, 2, 3, 4, 5, 6].map((i) => cssHsl(stil, `--chart-${i}`)).filter((r): r is string => r !== null);
  return {
    renkler: renkler.length ? renkler : BASKI_TEMASI.renkler,
    soluk: cssHsl(stil, "--muted-foreground") ?? BASKI_TEMASI.soluk,
    metin: cssHsl(stil, "--foreground") ?? BASKI_TEMASI.metin,
    ikincil: cssHsl(stil, "--muted-foreground") ?? BASKI_TEMASI.ikincil,
    izgara: cssHsl(stil, "--border") ?? BASKI_TEMASI.izgara,
    zemin: "transparent",
    isiDusuk: BASKI_TEMASI.isiDusuk,
    isiYuksek: renkler[0] ?? BASKI_TEMASI.isiYuksek,
    yaziTipi: YAZI_TIPI,
  };
}
