// Önceki adım hataları (KQ-D7): gri, salt-okunur, künyeli satırlar. Silme/dokunma YOK —
// hata açıldığı istasyonun malıdır; bu istasyon yalnız bilgilenir ("sonraki istasyonu bilgilendir").
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { palette } from '../../theme/tokens';
import { fmtMeter, priorDefectKunye, type InspectionPriorDefect } from './inspectionModel';

export default function PriorDefectList({ defects }: { defects: InspectionPriorDefect[] }) {
  if (defects.length === 0) return null;
  return (
    <View style={styles.box} testID="prior-defect-list">
      <View style={styles.head}>
        <Icon source="history" size={14} color={palette.slate[500]} />
        <Text style={styles.title}>Önceki istasyon hataları ({defects.length})</Text>
      </View>
      <ScrollView style={styles.scroll} nestedScrollEnabled>
        {defects.map((d) => (
          <View key={d.id} style={styles.row}>
            <Text style={styles.meter}>{fmtMeter(d.startMeter)} mt</Text>
            <Text style={styles.type} numberOfLines={1}>{d.errorType ?? 'Hata'}</Text>
            <Text style={styles.kunye} numberOfLines={1}>{priorDefectKunye(d)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: palette.slate[100], borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 12, fontWeight: '700', color: palette.slate[600] },
  scroll: { maxHeight: 96 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  meter: { width: 64, fontSize: 12, fontWeight: '700', color: palette.slate[500], fontVariant: ['tabular-nums'] },
  type: { flex: 1, fontSize: 12, color: palette.slate[600] },
  kunye: { flexShrink: 1, fontSize: 11, color: palette.slate[400] },
});
