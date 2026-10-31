// =============================================================================
// SY-F3 Tambur hedef değer çipleri — "Kuşak: ZEBRA" (TASARIM §7.5/3)
// =============================================================================
// İş emrinin aktif hedef değerleri adım özetinden (`stepSummary.targetValues`)
// SALT-OKUNUR gelir; operatöre yeni alan yok. Liste boş ya da eski backend
// alanı göndermiyorsa HİÇ çizilmez → hedef değersiz iş emrinde ekran aynıdır.
// =============================================================================

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, radius, spacing } from '../../../theme/tokens';
import type { TamburTargetValueChip } from '../../../types/models';

/** Çip metni: "Özellik: Değer" — değer adı boşsa kodu. */
export function targetValueChipLabel(t: TamburTargetValueChip): string {
  const value = t.valueName?.trim() || t.valueCode;
  return `${t.propertyName}: ${value}`;
}

export default function TamburTargetValueChips({
  targetValues,
}: {
  targetValues?: TamburTargetValueChip[] | null;
}) {
  if (!targetValues || targetValues.length === 0) return null;
  return (
    <View style={s.row} testID="tambur-hedef-deger-cipleri">
      {targetValues.map((t) => (
        <View key={t.propertyId} style={s.chip} testID={`tambur-hedef-deger-${t.propertyId}`}>
          <Text style={s.chipText}>
            {targetValueChipLabel(t)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chip: {
    backgroundColor: colors.infoContainer,
    borderColor: colors.info,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: { fontSize: 14, fontWeight: '700', color: colors.infoText },
});
