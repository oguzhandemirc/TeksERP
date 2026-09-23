import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { colors, spacing, typography } from '../../../theme';
import { shipmentDestinationLabels, type DestinationLock, type ShipmentDestination } from '../../../services/packing.service';
import { destinationSourceLabels } from './destinationDefault';

interface Props {
  lock: DestinationLock | undefined;
  picked: ShipmentDestination | null;
  onPick: (d: ShipmentDestination) => void;
  hasBranch: boolean;
}

/**
 * Sevk yönü: kilitliyse ROZET (kaynağı + ihracat kodu), zincir boşsa TEK SEFERLİK
 * seçici — seçim sevkiyatla birlikte carinin (şubeli sevkte şubenin) kartına yazılır.
 */
export function DestinationLockRow({ lock, picked, onPick, hasBranch }: Props) {
  if (!lock) return <Text style={styles.hint}>Sevk yönü okunuyor…</Text>;
  if (lock.destination) {
    const exp = lock.destination === 'EXPORT';
    return (
      <View style={styles.row} testID="destination-lock-badge">
        <View style={[styles.chip, exp ? styles.chipExport : styles.chipActive]}>
          <Text style={[styles.chipText, styles.chipTextActive]}>🔒 {shipmentDestinationLabels[lock.destination]}</Text>
        </View>
        {lock.source && <Text style={styles.hint}>{destinationSourceLabels[lock.source]}</Text>}
        {lock.exportCode && <Text style={styles.code}>İhracat Kodu: {lock.exportCode}</Text>}
        {exp && <Text style={styles.hint}>çuval tartısı zorunlu</Text>}
      </View>
    );
  }
  return (
    <View testID="destination-first-pick">
      <View style={styles.row}>
        {(['DOMESTIC', 'EXPORT'] as const).map((d) => {
          const active = picked === d;
          return (
            <TouchableRipple
              key={d}
              onPress={() => onPick(d)}
              style={[styles.chip, active && (d === 'EXPORT' ? styles.chipExport : styles.chipActive)]}
              borderless
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{shipmentDestinationLabels[d]}</Text>
            </TouchableRipple>
          );
        })}
      </View>
      <Text style={[styles.hint, styles.center]}>
        İlk sevk: seçim {hasBranch ? 'şubenin' : 'carinin'} kartına yazılır, sonra kilitli gelir.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, justifyContent: 'center', flexWrap: 'wrap' },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipExport: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
  chipText: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: colors.textOnDark },
  hint: { fontSize: typography.size.xs, color: colors.textSecondary, fontStyle: 'italic' },
  code: { fontSize: typography.size.xs, color: colors.text, fontWeight: '600' },
  center: { textAlign: 'center', marginTop: spacing.xs },
});
