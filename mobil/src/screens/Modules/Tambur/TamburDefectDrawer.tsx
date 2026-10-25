// =============================================================================
// Tambur "HATA GİR" çekmecesi (KQ-D7) — sağdan açılan InspectionPanel
// =============================================================================
// Tambur'da hata girişi TEK bileşenden (InspectionPanel, KK2 ile aynı). Bu
// adımda açılan hatalar silinebilir; önceki istasyonlarınki gri ve künyeli.
// Konak her dokunuşta `/tambur/report-error` ucunu çağırır (gövde değişmedi).
// Yalnız istasyonda muayene açıkken (`inspectionEnabled`) çizilir.
// =============================================================================
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import TruncatedText from '../../../components/TruncatedText';
import { palette } from '../../../theme/tokens';
import type { DefectType, TamburRollSummary } from '../../../types/models';
import InspectionPanel, {
  type InspectionDefect,
  type InspectionDefectInput,
  type InspectionPriorDefect,
} from '../../../components/inspection/InspectionPanel';

/** Varsayılan tip ilk tuş olur (sıra bir karar değildir; liste ilki uydurulmaz). */
export function orderDefaultFirst(list: DefectType[]): DefectType[] {
  const idx = list.findIndex((d) => d.isDefault === true);
  if (idx <= 0) return list;
  return [list[idx]!, ...list.slice(0, idx), ...list.slice(idx + 1)];
}

/** Topun açık hatalarını bu adımınkiler (silinebilir) ve öncekiler (gri) diye ayırır. */
export function splitTamburDefects(
  roll: Pick<TamburRollSummary, 'errors'>,
  stepId: string,
): { own: InspectionDefect[]; prior: InspectionPriorDefect[] } {
  const own: InspectionDefect[] = [];
  const prior: InspectionPriorDefect[] = [];
  for (const e of roll.errors) {
    const base = { id: e.id, startMeter: e.startMeter, defectTypeId: null, errorType: e.errorType };
    if (e.detectedAtStepId === stepId) own.push(base);
    else prior.push({ ...base, detectedStationName: e.detectedStationName ?? null });
  }
  return { own, prior };
}

interface Props {
  visible: boolean;
  roll: TamburRollSummary | null;
  stepId: string;
  defectTypes: DefectType[];
  onDefect: (input: InspectionDefectInput) => void;
  onDelete: (id: string) => void;
  onDismiss: () => void;
}

export default function TamburDefectDrawer({ visible, roll, stepId, defectTypes, onDefect, onDelete, onDismiss }: Props) {
  const { width } = useWindowDimensions();
  const [meter, setMeter] = useState('');
  const ordered = useMemo(() => orderDefaultFirst(defectTypes), [defectTypes]);
  const split = useMemo(() => (roll ? splitTamburDefects(roll, stepId) : { own: [], prior: [] }), [roll, stepId]);
  // Kayıt sunucudan dönüp listeye düşünce metre kutusu boşalır (yeni hata için hazır).
  useEffect(() => setMeter(''), [split.own.length]);
  if (!roll) return null;
  const panelWidth = Math.min(560, Math.round(width * 0.92));
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} supportedOrientations={['portrait', 'landscape']}>
      {/* RN Modal ayrı bir kök: TruncatedText balon jesti için RNGH kökü burada da şart. */}
      <GestureHandlerRootView style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={onDismiss} accessibilityLabel="Çekmeceyi kapat" />
        <View style={[styles.drawer, { width: panelWidth }]} testID="tambur-defect-drawer">
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Hata Gir</Text>
              <TruncatedText style={styles.sub} revealOnTap>
                {[roll.barcode ?? roll.itemName, ' · ', roll.currentQty.toFixed(1), ' mt']}
              </TruncatedText>
            </View>
            <IconButton icon="close" size={28} onPress={onDismiss} accessibilityLabel="Kapat" style={styles.close} />
          </View>
          <InspectionPanel
            defectTypes={ordered}
            ownDefects={split.own}
            priorDefects={split.prior}
            meterInput={meter}
            onMeterChange={setMeter}
            onDefect={onDefect}
            onDelete={onDelete}
            maxMeter={roll.currentQty}
            compact={width < 700}
          />
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, flexDirection: 'row' },
  scrim: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)' },
  drawer: { backgroundColor: palette.slate[50], paddingTop: 8, paddingBottom: 12, gap: 8, elevation: 8 },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4 },
  title: { fontSize: 20, fontWeight: '800', color: palette.slate[900] },
  sub: { fontSize: 13, color: palette.slate[500] },
  close: { width: 56, height: 56 },
});
