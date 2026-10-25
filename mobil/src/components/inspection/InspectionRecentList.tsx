// 4 puan taslağının "SON KAYITLAR" listesi + GERİ AL (K4P-TABLET, plan §5.1). Konumsuz kayıtlar
// cetvelde görünmez, burada görünür. Kaydetmez: geri alma/silme konağın taslağına döner.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import TruncatedText from '../TruncatedText';
import { palette } from '../../theme/tokens';
import type { DefectType } from '../../types/models';
import type { DraftDefect } from './inspectionDraft';
import { fmtMeter, SIZE_CLASSES } from './inspectionModel';

interface Props {
  entries: DraftDefect[];
  defectTypes: DefectType[];
  onUndo: () => void;
  /** Gösterilen en yeni kayıt sayısı. */
  max?: number;
}

export default function InspectionRecentList({ entries, defectTypes, onUndo, max = 4 }: Props) {
  const shown = entries.slice(-max).reverse();
  return (
    <View style={styles.wrap} testID="inspection-recent">
      <View style={styles.head}>
        <Text style={styles.title}>SON KAYITLAR</Text>
        <Button
          mode="contained"
          icon="undo"
          disabled={entries.length === 0}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onUndo();
          }}
          style={styles.undo}
          contentStyle={styles.undoContent}
          labelStyle={styles.undoLabel}
          testID="inspection-undo"
        >
          GERİ AL
        </Button>
      </View>
      {shown.length === 0 ? (
        <Text style={styles.empty}>Henüz kayıt yok — hata türüne dokun</Text>
      ) : (
        shown.map((e) => {
          const size = e.sizeClass ? SIZE_CLASSES.find((c) => c.code === e.sizeClass) : null;
          return (
            <View key={e.id} style={styles.row}>
              <Text style={styles.meter}>{e.meter == null ? '—' : `${fmtMeter(e.meter)} m`}</Text>
              <View style={styles.nameBox}>
                <TruncatedText style={styles.name}>{defectTypes.find((d) => d.id === e.defectTypeId)?.name ?? 'Hata'}</TruncatedText>
              </View>
              <Text style={styles.size}>{size ? `${size.label} · ${size.range}` : 'sabit'}</Text>
              <Text style={styles.points}>{e.points}p</Text>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, paddingHorizontal: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '900', color: palette.slate[700], letterSpacing: 0.5 },
  undo: { backgroundColor: palette.red[700], borderRadius: 10 },
  undoContent: { minHeight: 64, paddingHorizontal: 12 },
  undoLabel: { fontSize: 20, fontWeight: '900' },
  empty: { fontSize: 16, color: palette.slate[500], fontStyle: 'italic' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.white, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  meter: { width: 76, fontSize: 18, fontWeight: '800', color: palette.slate[900] },
  nameBox: { flex: 1 },
  name: { fontSize: 18, fontWeight: '700', color: palette.slate[800] },
  size: { fontSize: 16, color: palette.slate[600] },
  points: { width: 40, textAlign: 'right', fontSize: 20, fontWeight: '900', color: palette.red[700] },
});
