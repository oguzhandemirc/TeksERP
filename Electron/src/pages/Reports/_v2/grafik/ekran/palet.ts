// Ekran grafiği paleti — YALNIZ tema belirteçlerinden (`--primary`, `--tile-*`, `--foreground`…).
// Tema/özel renk değişince yeniden okunur; koyu kipte tile tonları zaten açık-doygun gelir.
// Belirteç okunamazsa (test ortamı) baskı paletine düşer — o da `tema.ts`te, burada sabit renk yok.
import { BASKI_TEMASI, type GrafikTema } from "../tema";

/** Çok serili sıra: birincil, sonra birbirinden uzak tile tonları. */
const SERIES_TOKENS = ["--primary", "--tile-sky", "--tile-amber", "--tile-teal", "--tile-rose", "--tile-blue", "--tile-green", "--tile-orange", "--tile-violet"];

/** `250 72% 58%` kanal üçlüsü → `[h, s, l]`; okunamazsa null. */
function channels(style: CSSStyleDeclaration, name: string): [string, string, string] | null {
  const parts = style.getPropertyValue(name).trim().split(/\s+/);
  return parts.length === 3 ? [parts[0]!, parts[1]!, parts[2]!] : null;
}

const hslOf = (c: [string, string, string]) => `hsl(${c[0]}, ${c[1]}, ${c[2]})`;
const hslaOf = (c: [string, string, string], a: number) => `hsla(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

export interface ScreenPalette extends GrafikTema {
  /** Alan degradesinin üst ucu (seri rengiyle aynı ton, saydam). */
  fade: (index: number, alpha: number) => string;
  /** Kart zemini — ısı haritası yazı halesi ve etiket kontrastı için. */
  card: string;
}

export function screenPalette(): ScreenPalette {
  const fallback: ScreenPalette = { ...BASKI_TEMASI, zemin: "transparent", card: BASKI_TEMASI.zemin, fade: () => "transparent" };
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return fallback;
  const style = getComputedStyle(document.documentElement);
  const series = SERIES_TOKENS.map((t) => channels(style, t)).filter((c): c is [string, string, string] => c !== null);
  if (series.length === 0) return fallback;
  const pick = (name: string, alt: string) => {
    const c = channels(style, name);
    return c ? hslOf(c) : alt;
  };
  const primary = series[0]!;
  return {
    renkler: series.map(hslOf),
    soluk: pick("--muted-foreground", BASKI_TEMASI.soluk),
    metin: pick("--foreground", BASKI_TEMASI.metin),
    ikincil: pick("--muted-foreground", BASKI_TEMASI.ikincil),
    izgara: pick("--border", BASKI_TEMASI.izgara),
    zemin: "transparent",
    isiDusuk: hslaOf(primary, 0.08),
    isiYuksek: hslOf(primary),
    yaziTipi: getComputedStyle(document.body).fontFamily || BASKI_TEMASI.yaziTipi,
    card: pick("--card", BASKI_TEMASI.zemin),
    fade: (index, alpha) => hslaOf(series[index % series.length]!, alpha),
  };
}
