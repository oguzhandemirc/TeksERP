// DEVERE DÖNÜŞ KABULÜ — tablet tasarım dili stilleri (Tambur referansı): açık gri zemin, beyaz yuvarlak kartlar,
// kısa başlık, büyük kutu girdiler, kahraman sayı bloğu, büyük satır eylemleri.
import { StyleSheet } from 'react-native';
import { colors, palette, spacing, typography } from '../../../theme';

/** Ana eylem mavisi / özel eylem turuncusu (tasarım dili renk anlamı). */
export const MAIN_BLUE = palette.blue[800];
export const SPECIAL_ORANGE = palette.orange[600];

export const ds = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text },
  caps: { fontSize: 12, fontWeight: '800', letterSpacing: 1, color: colors.textSecondary },
  bigName: { fontSize: 26, fontWeight: '900', color: colors.text },
  orderTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  gray: { fontSize: typography.size.base, color: colors.textSecondary },
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Tek tip büyük kutu girdi (irsaliye, gövde no, metre, kg).
  bigInput: { backgroundColor: colors.surface, fontSize: 22, height: 60 },
  label: { fontSize: typography.size.sm, fontWeight: '700', color: colors.textSecondary },
  hero: { minWidth: 150, borderRadius: 14, backgroundColor: palette.emerald[700], paddingHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center' },
  heroValue: { fontSize: 38, fontWeight: '900', color: colors.textOnDark, lineHeight: 44 },
  heroUnit: { fontSize: 14, fontWeight: '700', color: colors.textOnDark },
  tall: { height: 56 },
  chip: { height: 52, justifyContent: 'center' },
  chipText: { fontSize: 16, fontWeight: '700' },
  hint: { color: colors.textSecondary, fontSize: typography.size.base },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, borderBottomWidth: 1, borderColor: colors.border },
  lineIdx: { width: 28, fontSize: typography.size.base, color: colors.textMuted },
  lineName: { fontSize: 18, fontWeight: '800', color: colors.text },
  lineSub: { fontSize: 13, color: colors.textSecondary },
  lineM: { fontSize: 18, fontWeight: '800', color: colors.text, minWidth: 90, textAlign: 'right' },
  squareBtn: { width: 56, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  squareBlue: { backgroundColor: palette.blue[50] },
  rowBtnOrange: { height: 56, borderRadius: 12, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: palette.orange[100] },
  rowBtnOrangeText: { color: palette.orange[800], fontWeight: '800', fontSize: 15 },
  summary: { fontSize: 18, fontWeight: '800', color: colors.text },
  subChip: { borderRadius: 10, backgroundColor: 'rgba(99,102,241,0.18)', borderWidth: 1, borderColor: 'rgba(99,102,241,0.40)', marginHorizontal: 4, overflow: 'hidden' },
  subChipInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, maxWidth: 360 },
  subChipText: { color: colors.textOnDark, fontWeight: '800', fontSize: 14 },
});
