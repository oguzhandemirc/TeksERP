// Etiket adedi seçicisi — büyük "– N +" (endüstriyel dokunma hedefi, ≥56dp).
// Yalnız `labelCopiesSource = STATION` iken çizilir (çağıran `useLabelCopies().enabled`
// ile kapılar); GLOBAL'de ekran bugünküyle aynı kalır.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { colors, radius } from '../../theme';
import { LABEL_COPIES_MAX, LABEL_COPIES_MIN } from '../../lib/labelCopies';

interface Props {
  count: number;
  onInc: () => void;
  onDec: () => void;
  /** Komşu baskı düğmesinin yüksekliği — sıra hizalı kalsın. */
  height: number;
  /** Vurgu rengi (ekranın modül rengi); verilmezse marka. */
  tint?: string;
  disabled?: boolean;
}

const MIN_TOUCH = 56;

function StepBtn({
  sign,
  enabled,
  onPress,
  label,
  big,
  h,
  tint,
}: {
  sign: '+' | '–';
  enabled: boolean;
  onPress: () => void;
  label: string;
  big: boolean;
  h: number;
  tint: string;
}) {
  return (
    <TouchableRipple
      testID={sign === '+' ? 'label-copies-inc' : 'label-copies-dec'}
      onPress={
        enabled
          ? () => {
              Haptics.selectionAsync().catch(() => {});
              onPress();
            }
          : undefined
      }
      disabled={!enabled}
      borderless
      rippleColor="rgba(79,70,229,0.18)"
      style={[styles.step, { width: big ? 72 : MIN_TOUCH, height: h }]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityLabel={label}
    >
      <Text style={[styles.stepText, { fontSize: big ? 40 : 30, color: enabled ? tint : colors.borderStrong }]}>{sign}</Text>
    </TouchableRipple>
  );
}

export function LabelCopiesStepper({ count, onInc, onDec, height, tint = colors.brand, disabled }: Props) {
  const h = Math.max(MIN_TOUCH, height);
  const canDec = !disabled && count > LABEL_COPIES_MIN;
  const canInc = !disabled && count < LABEL_COPIES_MAX;
  const big = h >= 80;

  return (
    <View
      testID="label-copies-stepper"
      style={[styles.wrap, { height: h, borderColor: tint }]}
      accessibilityLabel={`Etiket adedi ${count}`}
    >
      <StepBtn sign="–" enabled={canDec} onPress={onDec} label="Etiket adedini azalt" big={big} h={h} tint={tint} />
      <View style={[styles.mid, { minWidth: big ? 64 : 44 }]}>
        <Text testID="label-copies-count" style={[styles.count, { fontSize: big ? 40 : 28, color: tint }]}>
          {count}
        </Text>
        <Text style={[styles.unit, { fontSize: big ? 14 : 11 }]}>etiket</Text>
      </View>
      <StepBtn sign="+" enabled={canInc} onPress={onInc} label="Etiket adedini artır" big={big} h={h} tint={tint} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  step: { alignItems: 'center', justifyContent: 'center' },
  stepText: { fontWeight: '800' },
  mid: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  count: { fontWeight: '900', fontVariant: ['tabular-nums'] },
  unit: { color: colors.textMuted, fontWeight: '600', marginTop: -2 },
});
