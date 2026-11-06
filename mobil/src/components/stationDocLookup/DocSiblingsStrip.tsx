// Belgeden açılan işin şeridi (2026-11-06): "Bu belgede N parti var · açılan: P1 (işlem) · diğerine geç: P2 P3".
// Tek dokunuşla diğer partinin kartı ekranın mevcut kart çözümüyle açılır. Şerit yalnız belgeden açılan kart aktifken
// görünür (operatör başka kart okutunca kendiliğinden gizlenir).
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, IconButton, Surface, Text } from 'react-native-paper';
import type { StationLookupWorkOrder } from '../../services/stationDocLookup.service';
import { colors, spacing, typography } from '../../theme';
import { isHere, partyLabel, siblingStripText } from './decide';

interface Props {
  siblings: StationLookupWorkOrder[];
  /** Ekrandaki aktif kartın barkodu (belgeden açılan kartla eşleşmezse şerit çizilmez). */
  activeCardBarcode: string | null;
  onSwitch: (workOrder: StationLookupWorkOrder) => void;
  onDismiss: () => void;
}

export default function DocSiblingsStrip({ siblings, activeCardBarcode, onSwitch, onDismiss }: Props) {
  const opened = siblings.find((w) => w.cardBarcode === activeCardBarcode);
  if (siblings.length < 2 || !opened) return null;
  const others = siblings.filter((w) => w.id !== opened.id);
  return (
    <Surface style={styles.strip} elevation={1} testID="belge-kardes-serit">
      <View style={styles.textCol}>
        <Text style={styles.title}>{siblingStripText(siblings, opened)}</Text>
        <ScrollView horizontal contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
          <Text style={styles.muted}>Diğerine geç:</Text>
          {others.map((w) => (
            <Button
              key={w.id}
              mode={isHere(w) ? 'contained-tonal' : 'outlined'}
              onPress={() => onSwitch(w)}
              contentStyle={styles.btn}
              testID={`belge-kardes-${w.workOrderNumber}`}
            >
              {partyLabel(w)}
            </Button>
          ))}
        </ScrollView>
      </View>
      <IconButton icon="close" size={20} onPress={onDismiss} accessibilityLabel="Şeridi kapat" style={styles.close} />
    </Surface>
  );
}

/** Ekranın şerit durumu: belgeden açılınca kardeşler tutulur, kapatınca düşer. */
export function useDocSiblings() {
  const [siblings, setSiblings] = useState<StationLookupWorkOrder[]>([]);
  return { siblings, setSiblings, clear: () => setSiblings([]) };
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', marginHorizontal: spacing.md, marginTop: spacing.sm, padding: spacing.sm, borderRadius: 8, backgroundColor: colors.surface },
  textCol: { flex: 1, gap: spacing.xs },
  title: { color: colors.text, fontSize: typography.size.base, fontWeight: typography.weight.semibold },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  muted: { color: colors.textSecondary, fontSize: typography.size.sm },
  btn: { minHeight: 56 },
  close: { margin: 0 },
});
