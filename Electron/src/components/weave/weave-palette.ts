// Kart görselleri renk paleti — iplik kartında renk alanı yok (karar 3a): renk iplik SIRASINDAN gelir
// (A = 1. renk, B = 2. …), panel temasının `--chart-1..6` değişkenleri (açık/koyu tema hazır). 6'dan fazla
// iplikte palet açık tonla döner; ayırt edici asıl işaret her zaman harftir (lejant + sütun başlığı).

const PALETTE_SIZE = 6;

/** 1-tabanlı iplik no → CSS rengi (SVG `fill` ve `style.background` için). */
export function yarnColor(n: number): string {
  const i = ((Math.max(1, Math.trunc(n)) - 1) % PALETTE_SIZE) + 1;
  const cycle = Math.floor((Math.max(1, Math.trunc(n)) - 1) / PALETTE_SIZE);
  if (cycle === 0) return `hsl(var(--chart-${i}))`;
  return `hsl(var(--chart-${i}) / ${cycle === 1 ? 0.55 : 0.3})`;
}

/** 0-tabanlı sıra → iplik harfi (A, B, C…); atkı kartı editörüyle aynı. */
export const yarnLetter = (index0: number): string => String.fromCharCode(65 + index0);

/** Armürde kalkık çerçeve (dolu kare) ve kumaş görünümünde üstte kalan çözgü. */
export const LIFT_COLOR = "hsl(var(--foreground))";
export const WARP_COLOR = "hsl(var(--foreground) / 0.78)";
/** Döner (leno) çerçeve sütununun zemin tonu — armür ızgarasındaki turuncu başlıkla aynı aile. */
export const LENO_TINT = "hsl(38 92% 50% / 0.2)";
export const LENO_LABEL = "hsl(32 95% 44%)";
/** Kenar (selvedge) çerçevesi — desen kartı armür ızgarasındaki yeşil "K" dili (emerald-100 zemin / emerald-600 başlık). */
export const SELVEDGE_TINT = "hsl(152 76% 40% / 0.18)";
export const SELVEDGE_LABEL = "hsl(161 94% 30%)";
