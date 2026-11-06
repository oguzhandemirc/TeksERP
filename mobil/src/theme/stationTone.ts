// =============================================================================
// İstasyon rengi — Electron `lib/station-colors.ts` `toneFor(type, kind)` kuralının mobil aynası (saf).
// Dış (fason) istasyon → fason; iç istasyon → türünün tonu; tür yoksa marka rengi. Yazı rengi zemine göre en yüksek
// kontrastlı olandan seçilir (beyaz / koyu) — rozet ≥20pt kalın yazıyla basılır, renk yanında istasyon adı da yazar.
// =============================================================================
import { colors, palette, stationTonesHsl } from './tokens';

export type StationToneKey = keyof typeof stationTonesHsl;

/** Backend `StationKind` → ton anahtarı (Electron `stationToneForKind` ile birebir). */
export function stationToneKeyForKind(kind: string): StationToneKey {
  switch (kind) {
    case 'RAW_QC':
      return 'kk1';
    case 'TAMBUR':
      return 'tambur';
    case 'SHIPPING':
      return 'depo';
    default:
      return 'process';
  }
}

/** Saf: HSL (derece, %, %) → #rrggbb. */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG kontrast oranı (1..21). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Zemine en okunur yazı rengi: beyaz ya da koyu (slate-900). */
export function readableOn(bg: string): string {
  return contrastRatio(bg, palette.white) >= contrastRatio(bg, palette.slate[900]) ? palette.white : palette.slate[900];
}

export interface StationTone {
  key: StationToneKey | 'brand';
  bg: string;
  fg: string;
}

const TONES = Object.fromEntries(
  (Object.keys(stationTonesHsl) as StationToneKey[]).map((k) => {
    const [h, s, l] = stationTonesHsl[k];
    const bg = hslToHex(h, s, l);
    return [k, { key: k, bg, fg: readableOn(bg) }];
  }),
) as Record<StationToneKey, StationTone>;

const BRAND: StationTone = { key: 'brand', bg: colors.brand, fg: readableOn(colors.brand) };

/** `dis` = dış (fason) istasyon; `tur` = `StationKind`. */
export function stationToneFor(dis: boolean, tur?: string | null): StationTone {
  if (dis) return TONES.fason;
  if (tur) return TONES[stationToneKeyForKind(tur)];
  return BRAND;
}
