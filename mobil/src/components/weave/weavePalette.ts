// İplik harfi → sabit renk (koordinatör kararı 3a: veri modeli değişmez, renk yalnız harften).
// Panel `--chart-1..n` sırasına yakın; tükenince döner (harf lejantta ayırt eder). Renk jetonları tek kaynaktan.
import { colors, palette } from '../../theme';

export const YARN_PALETTE = [palette.blue[600], palette.orange[600], palette.emerald[600], palette.violet[600], palette.red[600], palette.cyan[700]] as const;

/** 1-tabanlı iplik no → renk. */
export function yarnColor(yarn: number): string {
  return YARN_PALETTE[(Math.max(1, yarn) - 1) % YARN_PALETTE.length]!;
}

export const WEAVE_COLORS = {
  lift: colors.text,
  leno: palette.amber[600],
  lenoBg: palette.amber[100],
  /** Kenar çerçevesi — panel armür ızgarasının yeşil "K" dili. */
  selvedge: palette.emerald[600],
  selvedgeBg: palette.emerald[100],
  selectorBg: colors.surfaceMuted,
  bg: colors.surface,
  line: colors.borderStrong,
  label: colors.textMuted,
} as const;
