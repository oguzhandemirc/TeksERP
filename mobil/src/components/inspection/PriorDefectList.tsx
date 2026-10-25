// Önceki adım hataları (KQ-D7): gri, salt-okunur, künyeli satırlar. Silme/dokunma YOK —
// hata açıldığı istasyonun malıdır; bu istasyon yalnız bilgilenir ("sonraki istasyonu bilgilendir").
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { palette } from '../../theme/tokens';
import { fmtMeter, priorDefectKunye, type InspectionPriorDefect } from './inspectionModel';

// Tek satır (yatay kaydırmalı çipler). `inline`: cetvel başlık satırına gömülür (başlık
// "önceki N" rozetidir) — tablette alt numpad'den yükseklik çalmaz.
export default function PriorDefectList({ defects, inline = false }: { defects: InspectionPriorDefect[]; inline?: boolean }) {
  if (defects.length === 0) return null;
  return (
    <View style={inline ? styles.inline : styles.box} testID="prior-defect-list">
      {!inline && (
        <View style={styles.head}>
          <Icon source="history" size={14} color={palette.slate[500]} />
          <Text style={styles.title}>Önceki istasyon hataları ({defects.length})</Text>
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={styles.chips}>
        {defects.map((d) => (
          <View key={d.id} style={styles.chip}>
            <Text style={styles.meter}>{fmtMeter(d.startMeter)} mt</Text>
            <Text style={styles.type}>{d.errorType ?? 'Hata'}</Text>
            <Text style={styles.kunye}>{priorDefectKunye(d)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.slate[100], borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, gap: 8 },
  inline: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 12, fontWeight: '700', color: palette.slate[600] },
  chips: { gap: 6, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.slate[200], borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  meter: { fontSize: 12, fontWeight: '700', color: palette.slate[500], fontVariant: ['tabular-nums'] },
  type: { fontSize: 12, color: palette.slate[600] },
  kunye: { fontSize: 11, color: palette.slate[400] },
});
