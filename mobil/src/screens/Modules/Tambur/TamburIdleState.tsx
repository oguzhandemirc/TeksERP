// Tambur tablette iş yokken (kart/belge açılmamış) tam ekran tek boş durum (kullanıcı 2026-11-11): silik ikon + tek cümle.
// Sütun, tuş takımı, ipucu yok; okutma dinleyicisi ekranın modalında sürer.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { colors, palette, spacing, typography } from '../../../theme/tokens';

export const TAMBUR_IDLE_TEXT = 'Kart veya belge okutun';

export default function TamburIdleState() {
  return (
    <View style={s.wrap} testID="tambur-bos-durum">
      <Icon source="barcode-scan" size={72} color={palette.slate[300]} />
      <Text style={s.text}>{TAMBUR_IDLE_TEXT}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  text: { fontSize: typography.size.xl, fontWeight: typography.weight.semibold, color: colors.textMuted },
});
