// TamburLabelPaper stilleri — dosya boyu tavanı için bileşenden ayrıldı (davranış aynı).
import { StyleSheet } from 'react-native';
import { colors, palette, radius, shadow, spacing, typography } from '../../../theme/tokens';

const EDIT_BG = 'rgba(37,99,235,0.12)';
export const EDIT_BORDER = palette.blue[600];

export const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0, gap: 4 },
  // minHeight 0: kaydırmasız sol sütunda alan kalan yere küçülebilsin (kâğıt ölçeği onLayout'tan izler).
  area: { flex: 1, minHeight: 0, overflow: 'hidden' },
  paperLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  paper: {
    backgroundColor: palette.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.slate[300],
    overflow: 'hidden',
    shadowColor: palette.black,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  emptyHit: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: palette.red[600], borderRadius: 3, paddingHorizontal: 3, backgroundColor: palette.red[50] },
  emptyText: { color: palette.red[700], fontStyle: 'italic' },
  autoText: { color: palette.slate[400], fontStyle: 'italic' },
  editHit: { backgroundColor: EDIT_BG, borderBottomWidth: 2, borderBottomColor: EDIT_BORDER, borderRadius: 3, paddingHorizontal: 2 },
  rowsPad: { padding: 10, gap: 4 },
  rowHit: { alignSelf: 'flex-start' },
  rowText: { color: palette.black, fontFamily: 'monospace' },
  rowBig: { fontWeight: '800' },
  rowMuted: { color: palette.slate[400] },
  // Yakınken köşede sıfırlama çipi; dokunma alanı 48 dp.
  zoomChip: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    minWidth: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: palette.slate[700],
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  zoomChipText: { color: palette.white, fontSize: typography.size.base, fontWeight: typography.weight.bold },
  staleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  staleText: { fontSize: 12, color: colors.warningText },
});
