// KK1 muayene paneli (K4P-TABLET, plan §5.1): tablette sağ yarı, telefonda tam ekran modal.
// Tek bileşen `InspectionPanel` 4 puan moduyla çizilir; kaydetmeyi KK1 formu yapar (top ile aynı gövde).
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import InspectionPanel from '../../../components/inspection/InspectionPanel';
import InspectionRecentList from '../../../components/inspection/InspectionRecentList';
import { palette } from '../../../theme/tokens';
import type { Kk1Inspection } from './useKk1Inspection';

interface Props {
  insp: Kk1Inspection;
  compact: boolean;
  onClose: () => void;
}

export default function Kk1InspectionSheet({ insp, compact, onClose }: Props) {
  return (
    <View style={styles.wrap} testID="kk1-inspection-sheet">
      <View style={styles.head}>
        <Text style={styles.title}>MUAYENE · 4 PUAN</Text>
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
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 14, backgroundColor: palette.amber[100], borderBottomWidth: 2, borderBottomColor: palette.amber[600] },
  title: { fontSize: 20, fontWeight: '900', color: palette.amber[900], letterSpacing: 0.5 },
  close: { margin: 4, width: 64, height: 64 },
  body: { gap: 10, paddingVertical: 10 },
});
