// WorkOrderOutputPanel stilleri — dosya boyu tavanı için bileşenden ayrıldı (davranış aynı).
import { StyleSheet } from 'react-native';
import { colors } from '../../../theme/tokens';

export const s = StyleSheet.create({
  bulkBtn: { marginHorizontal: 8, marginBottom: 6 },
  wrapFill: { flex: 1, minHeight: 0, maxHeight: undefined, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  wrap: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    // ⚠️ Yükseklik SINIRLI: panel iş emri top listesinin ALTINDA duruyor ve
    // sınırsız büyürse asıl listeyi ekrandan iter. Saha onayı: "klavyenin
    // altında kalabilir bir kısmı sorun değil".
    maxHeight: 260,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
  },
  // Başlık şeridi büyütüldü (kullanıcı 2026-11-11): başlık 18, özet 17, ikonlar 26, dokunma alanı 48.
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1e40af' },
  headerBtn: { margin: 0, width: 48, height: 48 },
  chevron: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  lastMeasure: { fontSize: 14, fontWeight: '700' },
  headerTotals: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    marginLeft: 8,
    fontVariant: ['tabular-nums'],
  },
  totals: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 12,
  },
  totalBox: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  totalValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    fontVariant: ['tabular-nums'],
  },
  totalLabel: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  totalDivider: { width: 1, height: 18, backgroundColor: '#cbd5e1' },
  list: { flexGrow: 0 },
  row: { borderTopWidth: 1, borderTopColor: '#eef2f6', backgroundColor: '#fff' },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 6,
    minHeight: 56,
    gap: 8,
  },
  rowTime: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    width: 44,
  },
  // min-w-0 muadili: uzun barkod komşularını ekrandan itmesin.
  rowBarcode: {
    flex: 1,
    minWidth: 0,
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  rowQty: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    fontVariant: ['tabular-nums'],
  },
  rowBtn: { margin: 0, marginVertical: 4, width: 48, height: 48, borderRadius: 10 },
  // Sabit sütunlar + sağa hizalı sayılar: "20.0 m" ile "500.0 kg" bitişmesin (2026-11-11).
  rowM: { width: 76, textAlign: 'right' },
  rowKg: { width: 84, marginLeft: 12, marginRight: 4, textAlign: 'right', color: colors.textSecondary },
  empty: { paddingVertical: 18, alignItems: 'center' },
  emptyText: { fontSize: 13, color: '#94a3b8' },
});
