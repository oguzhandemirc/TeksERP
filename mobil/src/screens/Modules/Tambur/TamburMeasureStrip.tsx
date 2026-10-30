// =============================================================================
// D4-B3 Tambur ölçüm şeridi — son kesimin metresi + kaynak rozeti
// =============================================================================
// Yeşil = makine, amber = elle, kırmızı = SİMÜLASYON (Kurşun MeterStrip ile aynı dil).
// Hiç kesim yoksa çizilmez; telefon dikeyinde satır kırılır (flexWrap).
// =============================================================================

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Surface, Text } from 'react-native-paper';
import { colors, radius, spacing } from '../../../theme/tokens';
import { MEASURE_LABEL, measureToneOf, type TamburMeasureSource } from './measureSource';

export interface LastTamburMeasure {
  meters: number;
  source: TamburMeasureSource;
  barcode?: string | null;
}

const TONE = {
  GREEN: { bg: colors.successContainer, fg: colors.successText },
  AMBER: { bg: colors.warningContainer, fg: colors.warningText },
  RED: { bg: colors.dangerContainer, fg: colors.dangerText },
  NONE: { bg: colors.surfaceMuted, fg: colors.textSecondary },
} as const;

export default function TamburMeasureStrip({ last }: { last: LastTamburMeasure | null }) {
  if (!last) return null;
  const tone = TONE[measureToneOf(last.source)];
  const tail = last.barcode ? ` · top ${last.barcode.slice(-4)}` : '';
  return (
    <Surface style={[s.root, { backgroundColor: tone.bg }]} elevation={0} testID="tambur-olcum-serit">
      <View style={s.row}>
        <Text style={s.label}>{`Son kesim${tail}`}</Text>
        <Text style={s.value}>{`${last.meters.toFixed(1)} m`}</Text>
        <Text style={[s.tag, { color: tone.fg, borderColor: tone.fg }]} testID="tambur-olcum-kaynak">
          {MEASURE_LABEL[last.source]}
        </Text>
      </View>
    </Surface>
  );
}

const s = StyleSheet.create({
  root: { paddingHorizontal: 14, paddingVertical: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  label: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  value: { fontSize: 20, fontWeight: '700', color: colors.text },
  tag: { fontSize: 14, fontWeight: '800', marginLeft: 'auto', borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
});
