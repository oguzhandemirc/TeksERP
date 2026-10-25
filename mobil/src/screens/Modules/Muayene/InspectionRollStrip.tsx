// Bağımsız Muayene ekranının durum yüzeyleri (K4P-EKRAN): boş hal, top şeridi, aktif muayene uyarısı.
// Hata girişi YOK — o tek bileşen `InspectionPanel`dedir.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { palette } from '../../../theme/tokens';
import type { InspectionPreview } from '../../../services/qualityInspection.service';
import { activeInspectionText, rollStripParts, type StripRoll } from './standaloneInspectionHost';

export function ScanEmptyState({ compact }: { compact: boolean }) {
  return (
    <View style={styles.empty} testID="inspection-empty">
      <Icon source="barcode-scan" size={compact ? 56 : 88} color={palette.violet[600]} />
      <Text style={styles.emptyTitle}>Muayene edilecek topu okutun</Text>
      <Text style={styles.emptyHint}>Kamera, el okuyucu ya da barkodu elle yazın. Aktif muayenesi olan top panelden düzeltilir.</Text>
    </View>
  );
}

interface StripProps {
  roll: StripRoll;
  status: Pick<InspectionPreview, 'widthCm' | 'widthSource'> | null;
  phase?: 'RAW' | 'FINAL' | null;
  onChange: () => void;
}

export function RollStrip({ roll, status, phase, onChange }: StripProps) {
  const parts = rollStripParts(roll, status);
  return (
    <View style={styles.strip} testID="inspection-roll-strip">
      <View style={styles.stripText}>
        <Text style={styles.barcode}>{parts[0]}</Text>
        <Text style={styles.stripRest} numberOfLines={2}>
          {parts.slice(1).join(' · ')}
          {phase ? ` · ${phase === 'FINAL' ? 'MAMUL' : 'HAM'}` : ''}
        </Text>
      </View>
      <Button mode="outlined" icon="barcode-scan" onPress={onChange} contentStyle={styles.tall} labelStyle={styles.changeLabel}>
        BAŞKA TOP
      </Button>
    </View>
  );
}

export function ActiveInspectionBanner({ active }: { active: { revision: number } }) {
  return (
    <View style={styles.active} testID="inspection-active-banner">
      <Icon source="clipboard-alert-outline" size={40} color={palette.amber[900]} />
      <View style={styles.flex}>
        <Text style={styles.activeTitle}>{activeInspectionText(active)}</Text>
        <Text style={styles.activeHint}>Tablette yeni muayene açılmaz. Düzeltme: Panel → Kalite Güvence → Muayeneler.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, flex: 1 },
  emptyTitle: { fontSize: 24, fontWeight: '900', color: palette.slate[900], textAlign: 'center' },
  emptyHint: { fontSize: 17, color: palette.slate[600], textAlign: 'center', maxWidth: 560 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: palette.violet[50], borderBottomWidth: 2, borderBottomColor: palette.violet[600] },
  stripText: { flex: 1 },
  barcode: { fontSize: 24, fontWeight: '900', color: palette.violet[700], letterSpacing: 0.5 },
  stripRest: { fontSize: 18, fontWeight: '700', color: palette.slate[800] },
  tall: { minHeight: 56 },
  changeLabel: { fontSize: 16, fontWeight: '900' },
  active: { flexDirection: 'row', alignItems: 'center', gap: 14, margin: 14, padding: 18, borderRadius: 10, backgroundColor: palette.amber[100], borderWidth: 2, borderColor: palette.amber[600] },
  activeTitle: { fontSize: 22, fontWeight: '900', color: palette.amber[900] },
  activeHint: { fontSize: 16, color: palette.amber[900], marginTop: 4 },
  flex: { flex: 1 },
});
