// KK1 muayene paneli (K4P-TABLET, plan §5.1): tablette sağ yarı, telefonda tam ekran modal.
// Tek bileşen `InspectionPanel` 4 puan moduyla çizilir; kaydetmeyi KK1 formu yapar (top ile aynı gövde).
import React from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import InspectionPanel from '../../../components/inspection/InspectionPanel';
import InspectionRecentList from '../../../components/inspection/InspectionRecentList';
import { palette } from '../../../theme/tokens';
import type { Kk1Inspection } from './useKk1Inspection';

interface Props {
  insp: Kk1Inspection;
  compact: boolean;
  onClose: () => void;
  /** Telefonda tam ekran modal durum çubuğunun altına girmesin (KK1 `insets.top`). */
  topInset?: number;
}

// Taslak yerel ama operatörün emeği: tek yanlış dokunuşla gitmesin.
function confirmClear(count: number, onYes: () => void) {
  Alert.alert('Muayene taslağı silinsin mi?', `${count} hata kaydı silinecek. Top kaydı etkilenmez.`, [
    { text: 'Vazgeç', style: 'cancel' },
    { text: 'Sil', style: 'destructive', onPress: onYes },
  ]);
}

export default function Kk1InspectionSheet({ insp, compact, onClose, topInset = 0 }: Props) {
  return (
    <View style={styles.wrap} testID="kk1-inspection-sheet">
      <View style={[styles.head, { paddingTop: topInset }]}>
        {/* Dar ekranda kısa başlık: kapat düğmesi taşmasın. */}
        <Text style={styles.title}>{compact ? 'MUAYENE' : 'MUAYENE · 4 PUAN'}</Text>
        <View style={styles.flex} />
        {insp.draft.defects.length > 0 && (
          <Button
            mode="outlined"
            icon="delete-sweep"
            testID="kk1-inspection-clear"
            onPress={() => confirmClear(insp.draft.defects.length, () => insp.dispatch({ type: 'clear' }))}
            style={styles.clear}
            contentStyle={styles.clearContent}
            labelStyle={styles.clearLabel}
          >
            TASLAĞI SİL
          </Button>
        )}
        <IconButton icon="close" size={32} onPress={onClose} accessibilityLabel="Muayeneyi kapat" style={styles.close} />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <InspectionPanel
          defectTypes={insp.defectTypes}
          ownDefects={insp.ownDefects}
          meterInput={insp.meterInput}
          onMeterChange={insp.setMeterInput}
          sizeClassMode
          meterOptional
          meterAutoActivate={false}
          compact={compact}
          summary={insp.summary}
          rulerEmptyText={insp.draft.defects.length > 0 ? 'Metreli hata yok — kayıtlar aşağıda' : undefined}
          onDefect={insp.onDefect}
          onDelete={(id) => insp.dispatch({ type: 'remove', id })}
        >
          <InspectionRecentList entries={insp.draft.defects} defectTypes={insp.defectTypes} onUndo={() => insp.dispatch({ type: 'undoLast' })} />
        </InspectionPanel>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.slate[50] },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, backgroundColor: palette.amber[100], borderBottomWidth: 2, borderBottomColor: palette.amber[600] },
  title: { fontSize: 20, fontWeight: '900', color: palette.amber[900], letterSpacing: 0.5 },
  close: { margin: 4, width: 64, height: 64 },
  flex: { flex: 1 },
  clear: { borderColor: palette.red[600], borderWidth: 2 },
  clearContent: { minHeight: 56 },
  clearLabel: { fontSize: 18, fontWeight: '900', color: palette.red[700] },
  body: { gap: 10, paddingVertical: 10 },
});
