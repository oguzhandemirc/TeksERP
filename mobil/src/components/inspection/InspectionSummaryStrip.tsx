// 4 puan özet şeridi (K4P-TABLET, plan §5.1): sayım yerelde, /100 m² ve en kaynağı sunucu
// önizlemesinden (konak `summary` prop'uyla indirir). Bileşen hesap YAPMAZ, yalnız gösterir.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { palette } from '../../theme/tokens';

export interface InspectionSummary {
  defectCount: number;
  totalPoints: number;
  /** Sunucu önizlemesi; null/yok = hesaplanmadı. */
  per100M2?: string | number | null;
  widthSource?: string | null;
  /** Öneri metni ("1.KALİTE · A") — konak çipi ayrıca çizer; şeritte bilgi. */
  suggested?: string | null;
  offline?: boolean;
  /** Önizleme yok sebebi ("Öneri hesaplanamadı", "Metraj girilince hesaplanır"). */
  previewNote?: string | null;
}

const WIDTH_SOURCE_LABEL: Record<string, string> = {
  ITEM_CARD: 'ÜRÜN KARTI',
  ROLL_MEASURED: 'ÖLÇÜLEN EN',
  MANUAL: 'ELLE',
};

/** Türkçe ondalık (9,8) — sunucu Decimal'i metin gelebilir. */
export function fmtPer100(v: string | number | null | undefined): string | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(1).replace('.', ',') : null;
}

export default function InspectionSummaryStrip({ summary }: { summary: InspectionSummary }) {
  const per100 = fmtPer100(summary.per100M2);
  const widthUnknown = summary.widthSource === 'UNKNOWN';
  const widthLabel = summary.widthSource ? WIDTH_SOURCE_LABEL[summary.widthSource] : undefined;
  return (
    <View style={styles.wrap} testID="inspection-summary">
      <View style={styles.row}>
        <Text style={styles.cell}>HATA {summary.defectCount}</Text>
        <Text style={styles.sep}>│</Text>
        <Text style={styles.cell}>PUAN {summary.totalPoints}</Text>
        {per100 && !summary.offline && (
          <>
            <Text style={styles.sep}>│</Text>
            <Text style={styles.cell} testID="inspection-per100">{per100} /100 m²</Text>
          </>
        )}
        {widthLabel && !summary.offline && (
          <>
            <Text style={styles.sep}>│</Text>
            <Text style={styles.cellMuted}>EN: {widthLabel}</Text>
          </>
        )}
      </View>
      {summary.offline ? (
        <Text style={[styles.band, styles.offline]} testID="inspection-offline">
          Çevrimdışı — /100 m² ve öneri çevrimiçi hesaplanır
        </Text>
      ) : widthUnknown ? (
        <Text style={[styles.band, styles.noWidth]} testID="inspection-no-width">
          Ürün kartında en yok; puan/100 hesaplanmaz
        </Text>
      ) : summary.previewNote ? (
        <Text style={[styles.band, styles.note]}>{summary.previewNote}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, paddingHorizontal: 8 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, backgroundColor: palette.slate[900], borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  cell: { fontSize: 20, fontWeight: '900', color: palette.white },
  cellMuted: { fontSize: 16, fontWeight: '700', color: palette.slate[300] },
  sep: { fontSize: 20, color: palette.slate[500] },
  band: { fontSize: 16, fontWeight: '700', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, overflow: 'hidden' },
  offline: { backgroundColor: palette.slate[200], color: palette.slate[700] },
  noWidth: { backgroundColor: palette.amber[100], color: palette.amber[900], borderWidth: 1, borderColor: palette.amber[300] },
  note: { backgroundColor: palette.slate[100], color: palette.slate[600] },
});
