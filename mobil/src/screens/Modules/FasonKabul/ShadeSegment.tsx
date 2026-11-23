import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { colors } from '../../../theme/tokens';

/** Hızlı ton harfleri; '' = tonsuz ("—"). Nadir kodlar panelden ("Ton ata") verilir. */
export const SHADE_SEGMENT_OPTIONS = ['', 'A', 'B', 'C', 'D', 'E'] as const;

interface Props {
  value: string | undefined;
  onChange: (next: string) => void;
}

/**
 * Dönen açık kumaşın ton grubu — büyük segment düğmeler (eldivenle basılır, tek dokunuş).
 * Yalnız `shipping.shadeMixPolicy` açıkken çizilir; seçilmeyen parça tonsuz gider.
 */
export function ShadeSegment({ value, onChange }: Props) {
  const current = value ?? '';
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Ton</Text>
      <View style={styles.row}>
        {SHADE_SEGMENT_OPTIONS.map((s) => {
          const on = current === s;
          return (
            <TouchableRipple
              key={s || 'none'}
              onPress={() => onChange(s)}
              style={[styles.btn, on && styles.btnOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={s ? `Ton ${s}` : 'Tonsuz'}
              testID={`shade-${s || 'none'}`}
            >
              <Text style={[styles.btnText, on && styles.btnTextOn]}>{s || '—'}</Text>
            </TouchableRipple>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  label: { fontSize: 15, fontWeight: '600', color: colors.textSecondary, minWidth: 36 },
  row: { flex: 1, flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  btnText: { fontSize: 20, fontWeight: '700', color: colors.text },
  btnTextOn: { color: colors.textOnDark },
});
