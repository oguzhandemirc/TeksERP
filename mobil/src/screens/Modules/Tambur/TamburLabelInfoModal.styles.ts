// TamburLabelInfoModal stilleri — dosya boyu tavanı için bileşenden ayrıldı (davranış aynı).
import { StyleSheet } from 'react-native';
import { colors, spacing } from '../../../theme/tokens';

export const s = StyleSheet.create({
  sub: { color: colors.textSecondary, marginBottom: spacing.sm },
  err: { color: colors.dangerText, marginBottom: spacing.sm },
  cols: { flexDirection: 'row', gap: spacing.xl },
  col: { flex: 1 },
  stacked: { marginTop: spacing.md },
  colTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5, color: colors.textSecondary, marginBottom: spacing.sm },
  // Vazgeç solda (kırmızı), Kaydet sağda (birincil).
  footerBar: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  freeBox: { gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  btn: { minHeight: 56 },
  reasonBox: { marginTop: spacing.sm },
});
