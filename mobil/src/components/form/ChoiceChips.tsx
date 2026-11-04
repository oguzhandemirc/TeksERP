// Seçim çipleri — tek/çok seçim; seçili = indigo dolgu + ✓, "sonra" seçeneği kesik kenarlı.
// Paper Chip yerine TouchableRipple: dokunma alanı ve seçili kontrastı tablette okunur olsun.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../theme';

export interface ChoiceOption {
  value: string | null;
  label: string;
  a11y?: string;
  dashed?: boolean;
  testID?: string;
}

interface Common {
  options: readonly ChoiceOption[];
  size?: 'md' | 'square';
  disabled?: boolean;
  testID: string;
}
type Single = Common & { multi?: false; value: string | null; onChange: (v: string | null) => void };
type Multi = Common & { multi: true; value: readonly string[]; onChange: (v: string[]) => void };
export type ChoiceChipsProps = Single | Multi;

export function ChoiceChips(props: ChoiceChipsProps) {
  const { options, size = 'md', disabled, testID } = props;
  const isOn = (v: string | null) => (props.multi ? v != null && props.value.includes(v) : props.value === v);
  const press = (v: string | null) => {
    if (props.multi) {
      if (v == null) return;
      props.onChange(props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
    } else props.onChange(v);
  };
  const square = size === 'square';
  return (
    <View testID={testID} style={styles.wrap}>
      {options.map((o) => {
        const on = isOn(o.value);
        const fill = on ? (o.dashed ? colors.choice.laterOnBg : colors.choice.onBg) : colors.choice.offBg;
        const fg = on ? colors.choice.onText : colors.text;
        return (
          <TouchableRipple
            key={o.value ?? '__yok'}
            testID={o.testID ?? `${testID}-${o.value ?? 'yok'}`}
            accessibilityRole="button"
            accessibilityLabel={o.a11y ?? o.label}
            accessibilityState={{ selected: on, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => press(o.value)}
            style={[
              square && !o.dashed ? styles.square : styles.md,
              { backgroundColor: fill },
              on ? styles.onBorder : o.dashed ? styles.dashed : styles.offBorder,
              disabled ? styles.disabled : null,
            ]}
          >
            <View style={styles.inner}>
              {on && !(square && !o.dashed) ? <MaterialCommunityIcons name="check" size={18} color={fg} /> : null}
              <Text style={[square && !o.dashed ? styles.squareText : styles.mdText, { color: fg }, on ? styles.bold : null]}>
                {o.label}
              </Text>
              {on && square && !o.dashed ? (
                <MaterialCommunityIcons name="check-circle" size={14} color={fg} style={styles.corner} />
              ) : null}
            </View>
          </TouchableRipple>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  md: { minHeight: 56, borderRadius: radius.md, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  square: { minWidth: 64, minHeight: 64, borderRadius: radius.md, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  offBorder: { borderWidth: 1.5, borderColor: colors.choice.offBorder },
  onBorder: { borderWidth: 1.5, borderColor: 'transparent' },
  dashed: { borderWidth: 1.5, borderColor: colors.choice.offBorder, borderStyle: 'dashed' },
  mdText: { fontSize: 16, fontWeight: '600' },
  squareText: { fontSize: 20, fontWeight: '700' },
  bold: { fontWeight: '700' },
  corner: { position: 'absolute', top: -14, right: -6 },
  disabled: { opacity: 0.5 },
});
