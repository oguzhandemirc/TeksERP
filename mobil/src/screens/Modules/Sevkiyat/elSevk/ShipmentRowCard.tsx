// Sevk Çıkışı liste kartı: solda cari (kimlik) + sevk no · tarih + durum çipi · yük; sağda brüt metre (kritik rakam) + kg.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import TruncatedText from '../../../../components/TruncatedText';
import type { ShipmentListRow } from '../../../../services/handheldShipment.service';
import { colors, palette, radius, spacing, typography } from '../../../../theme';
import { rowChip, rowDate, rowKg, rowLoadLine, rowMeters, type RowTone } from './listRow';
import { ACCENT_SOFT, ui } from './ui';

const CHIP: Record<RowTone, { bg: string; fg: string }> = {
  open: { bg: ACCENT_SOFT, fg: palette.orange[600] },
  empty: { bg: colors.surfaceMuted, fg: colors.textSecondary },
  done: { bg: colors.successContainer, fg: colors.successText },
};

export function ShipmentRowCard({ row, onPress }: { row: ShipmentListRow; onPress: (row: ShipmentListRow) => void }) {
  const chip = rowChip(row);
  const kg = rowKg(row);
  return (
    <TouchableRipple onPress={() => onPress(row)} style={[ui.card, styles.card]} borderless testID={`sevk-satir-${row.shipmentNo}`} accessibilityRole="button">
      <View style={styles.inner}>
        <View style={styles.left}>
          <TruncatedText style={ui.primary}>{row.customer.name}</TruncatedText>
          <Text style={ui.secondary} numberOfLines={1}>
            {row.shipmentNo} · {rowDate(row)}
          </Text>
          <View style={styles.metaRow}>
            <View style={[styles.chip, { backgroundColor: CHIP[chip.tone].bg }]}>
              <Text style={[styles.chipText, { color: CHIP[chip.tone].fg }]}>{chip.label}</Text>
            </View>
            <Text style={ui.secondary} numberOfLines={1}>
              {rowLoadLine(row)}
            </Text>
          </View>
        </View>
        <View style={styles.right}>
          <Text style={ui.figure}>{rowMeters(row)}</Text>
          {kg ? <Text style={[ui.secondary, styles.num]}>{kg}</Text> : null}
        </View>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, minHeight: 56 },
  left: { flex: 1, minWidth: 0, gap: spacing.xs },
  right: { alignItems: 'flex-end' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chip: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  chipText: { fontSize: typography.size.xs, fontWeight: typography.weight.bold },
  num: { fontVariant: ['tabular-nums'] },
});

