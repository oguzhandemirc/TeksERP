// Seçim çipleri — tek/çok seçim; seçili = indigo dolgu + ✓, "sonra" seçeneği kesik kenarlı.
// Paper Chip yerine TouchableRipple: dokunma alanı ve seçili kontrastı tablette okunur olsun.
// `fill`: seçenek satırı kalıbı (ChoiceRow) — düğmeler satırı eşit genişlikte doldurur; çok seçenekte düzgün ızgaraya sarar.
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
  /** Solda küçük ikon (MaterialCommunityIcons adı). */
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}

/** Bu sayıya kadar seçenek tek sırada eşit genişlik; fazlası 3 sütunlu ızgaraya sarar. */
export const FILL_ONE_ROW_MAX = 4;

interface Common {
  options: readonly ChoiceOption[];
  size?: 'md' | 'square';
  disabled?: boolean;
  /** Düğmeler satırı eşit genişlikte doldurur (seçenek satırı kalıbı). */
  fill?: boolean;
  testID: string;
}
type Single = Common & { multi?: false; value: string | null; onChange: (v: string | null) => void };
type Multi = Common & { multi: true; value: readonly string[]; onChange: (v: string[]) => void };
export type ChoiceChipsProps = Single | Multi;

export function ChoiceChips(props: ChoiceChipsProps) {
  const { options, size = 'md', disabled, fill = false, testID } = props;
  const isOn = (v: string | null) => (props.multi ? v != null && props.value.includes(v) : props.value === v);
  const press = (v: string | null) => {
    if (props.multi) {
      if (v == null) return;
      props.onChange(props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
    } else props.onChange(v);
  };
  const square = size === 'square';
  const oneRow = fill && options.length <= FILL_ONE_ROW_MAX;
  const fillCell = fill ? (oneRow ? styles.fillCell : styles.gridCell) : null;
  return (
    <View testID={testID} style={[styles.wrap, oneRow && styles.noWrap]}>
      {options.map((o) => {
        const on = isOn(o.value);
        const bg = on ? (o.dashed ? colors.choice.laterOnBg : colors.choice.onBg) : colors.choice.offBg;
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
              { backgroundColor: bg },
              on ? styles.onBorder : o.dashed ? styles.dashed : styles.offBorder,
              disabled ? styles.disabled : null,
              fillCell,
            ]}
          >
            <View style={styles.inner}>
              {o.icon ? <MaterialCommunityIcons name={o.icon} size={20} color={fg} /> : null}
              {on && !o.icon && !(square && !o.dashed) ? <MaterialCommunityIcons name="check" size={18} color={fg} /> : null}
              <Text style={[square && !o.dashed ? styles.squareText : styles.mdText, { color: fg }, on ? styles.bold : null, fill ? styles.fillText : null]}>
                {o.label}
              </Text>
              {on && o.icon ? <MaterialCommunityIcons name="check" size={18} color={fg} /> : null}
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
  noWrap: { flexWrap: 'nowrap' },
  // Tek sıra: eşit pay (basis 0). Izgara: 3 sütun (gap payı düşülerek), son sıra da aynı genişlikte.
  fillCell: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, paddingHorizontal: spacing.sm },
  gridCell: { flexGrow: 0, flexBasis: '31%', minWidth: 0, paddingHorizontal: spacing.sm },
  fillText: { flexShrink: 1, textAlign: 'center' },
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
