// Kompakt sayı kutusu — etiket içeride, birim sağda; aynı satıra birkaç tane sığar.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import NumpadInput from '../NumpadInput';
import { DOC_HIGHLIGHT_BG } from '../DocHighlight';
import { colors, radius, spacing } from '../../theme';

export interface CompactNumberFieldProps {
  label: string;
  unit: string;
  value: string;
  onChangeText: (next: string) => void;
  fromDoc?: boolean;
  /** Başka alandan türetildi notu (ör. "gelen metre") — etiket satırında gösterilir. */
  derivedNote?: string | null;
  derivedTestID?: string;
  invalid?: boolean;
  disabled?: boolean;
  width?: number;
  placeholder?: string;
  testID: string;
}

export function CompactNumberField({
  label, unit, value, onChangeText, fromDoc, derivedNote, derivedTestID, invalid, disabled, width = 150, placeholder, testID,
}: CompactNumberFieldProps) {
  const bg = invalid ? colors.dangerContainer : fromDoc ? DOC_HIGHLIGHT_BG : colors.surface;
  return (
    <View
      testID={`${testID}-kutu`}
      style={[styles.box, { width, backgroundColor: bg }, invalid ? styles.invalid : null, disabled ? styles.disabled : null]}
    >
      <View style={styles.labelRow}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        {derivedNote ? (
          <Text testID={derivedTestID} style={styles.derived} numberOfLines={1}>{`↧ ${derivedNote}`}</Text>
        ) : null}
      </View>
      <View style={styles.inputRow}>
        <NumpadInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          numpadLabel={label}
          useNativeKeyboard
          allowDecimal
          mode="flat"
          dense
          disabled={disabled}
          placeholder={placeholder}
          accessibilityLabel={`${label} (${unit})`}
          underlineColor="transparent"
          activeUnderlineColor="transparent"
          style={styles.input}
          contentStyle={styles.inputContent}
        />
        <Text style={styles.unit}>{unit}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: 64, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong,
    paddingHorizontal: spacing.sm, paddingTop: spacing.xs, overflow: 'hidden',
  },
  invalid: { borderWidth: 2, borderColor: colors.danger },
  disabled: { opacity: 0.5 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  derived: { fontSize: 12, fontWeight: '600', color: colors.band.aside, flexShrink: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, backgroundColor: 'transparent', height: 40, paddingHorizontal: 0 },
  inputContent: { fontSize: 24, fontWeight: '700', paddingHorizontal: 0 },
  unit: { fontSize: 16, fontWeight: '600', color: colors.textMuted, marginLeft: spacing.xs },
});
