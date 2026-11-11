// Tema renk matematiği — belirteçler "H S% L%" HSL kanalı olarak tutulur (index.css). Özel renk seçici
// hex verir; buradan kanala çevrilir ve yazı rengi WCAG kontrastına göre otomatik seçilir.

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** "250 72% 58%" → {h,s,l}; geçersizse null. */
export function parseHslChannels(value: string): Hsl | null {
  const m = value.trim().match(/^(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return null;
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

export function formatHslChannels({ h, s, l }: Hsl): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return `${r(((h % 360) + 360) % 360)} ${r(s)}% ${r(l)}%`;
}

/** #rgb / #rrggbb → {h,s,l}; geçersizse null. */
export function hexToHsl(hex: string): Hsl | null {
  let m = hex.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(m)) m = m.split("").map((c) => c + c).join("");
  if (!/^[\da-f]{6}$/i.test(m)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: (h + 360) % 360, s: s * 100, l: l * 100 };
}

/** {h,s,l} → [r,g,b] (0..1). */
export function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const S = clamp(s, 0, 100) / 100;
  const L = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

export function hslToHex(c: Hsl): string {
  return `#${hslToRgb(c)
    .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** WCAG 2.x göreli parlaklık. */
export function relativeLuminance(c: Hsl): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hslToRgb(c).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Hsl, b: Hsl): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const WHITE: Hsl = { h: 0, s: 0, l: 100 };
/** Koyu yazı — açık birincil renklerin üstünde (index.css --foreground ile aynı aile). */
export const INK: Hsl = { h: 240, s: 24, l: 10 };

/** Zemin üstünde daha okunur olan yazı rengi (beyaz ya da koyu mürekkep). */
export function pickForeground(bg: Hsl): Hsl {
  return contrastRatio(bg, WHITE) >= contrastRatio(bg, INK) ? WHITE : INK;
}
