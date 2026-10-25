// Cetveldeki noktaya dokununca: o noktadaki bu-adım hata(lar)ı, her biri "Sil".
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Icon, IconButton, Text } from 'react-native-paper';
import AppModal from '../AppModal';
import { palette } from '../../theme/tokens';
import type { DefectType } from '../../types/models';
import { isCriticalDefect, type InspectionDefect } from './inspectionModel';

interface DeletePointModalProps {
  visible: boolean;
  defects: InspectionDefect[];
  defectTypes: DefectType[];
  onDelete: (id: string) => void;
  onDismiss: () => void;
}

function DeleteRow({ d, crit, onDelete }: { d: InspectionDefect; crit: boolean; onDelete: (id: string) => void }) {
  return (
    <View style={styles.row}>
      <View style={[styles.dot, crit && styles.dotCritical]} />
      <Text style={styles.rowMeter}>{d.startMeter.toFixed(1)} m</Text>
      <Text style={styles.rowType} numberOfLines={1}>
        {d.errorType ?? 'Hata'}
      </Text>
      {crit && (
        <View style={styles.critBadge}>
          <Text style={styles.critBadgeText}>KRİTİK</Text>
        </View>
      )}
      <Button
        mode="contained"
        icon="delete"
        compact
        buttonColor={palette.red[600]}
        onPress={() => onDelete(d.id)}
        style={styles.delBtn}
        labelStyle={styles.delBtnLabel}
      >
        Sil
      </Button>
    </View>
  );
}

export default function DeletePointModal({ visible, defects, defectTypes, onDelete, onDismiss }: DeletePointModalProps) {
  const { width: winW } = useWindowDimensions();
  const phone = winW < 600;
  const sorted = [...defects].sort((a, b) => a.startMeter - b.startMeter);
  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <View style={[styles.sheet, { width: phone ? winW * 0.9 : Math.min(460, winW * 0.5) }]}>
        <View style={styles.header}>
          <Icon source="alert-circle-outline" size={22} color={palette.amber[700]} />
          <Text style={styles.title}>
            {sorted.length > 1 ? `Hata Noktası (${sorted.length})` : 'Hatayı Sil'}
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>
        {sorted.map((d) => (
          <DeleteRow key={d.id} d={d} crit={isCriticalDefect(d, defectTypes)} onDelete={onDelete} />
        ))}
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: palette.white, borderRadius: 16, padding: 12, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  title: { fontSize: 16, fontWeight: '800', color: palette.slate[900] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: palette.slate[100],
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.slate[400] },
  dotCritical: { backgroundColor: palette.red[600] },
  rowMeter: { fontSize: 16, fontWeight: '800', color: palette.slate[900], minWidth: 64 },
  rowType: { flex: 1, fontSize: 14, color: palette.slate[600], fontWeight: '600' },
  critBadge: {
    backgroundColor: palette.red[50],
    borderColor: palette.red[300],
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  critBadgeText: { fontSize: 9, fontWeight: '800', color: palette.red[700] },
  delBtn: { borderRadius: 8 },
  delBtnLabel: { fontSize: 13, fontWeight: '800', marginVertical: 4, marginHorizontal: 10 },
});
