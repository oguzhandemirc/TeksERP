// Kompakt sayı kutusu — etiket içeride, birim sağda; aynı satıra birkaç tane sığar. Kutunun tamamı dokunulabilir (ripple),
// odakta / numpad açıkken çerçeve ana renkte ve kalın — dokunulduğu belli olur.
import React, { useRef, useState } from 'react';
import { StyleSheet, View, type TextInput as RNTextInput } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
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
  /** Sabit genişlik; `grow` verilirse yok sayılır. */
  width?: number;
  /** Satırdaki diğer kutularla genişliği eşit paylaş (flex: 1). */
  grow?: boolean;
  placeholder?: string;
  testID: string;
}

export function CompactNumberField({
  label, unit, value, onChangeText, fromDoc, derivedNote, derivedTestID, invalid, disabled, width = 150, grow, placeholder, testID,
}: CompactNumberFieldProps) {
  const input = useRef<RNTextInput>(null);
  const [focused, setFocused] = useState(false);
  const bg = invalid ? colors.dangerContainer : fromDoc ? DOC_HIGHLIGHT_BG : colors.surface;
  return (
    <TouchableRipple
      testID={`${testID}-kutu`}
      onPress={() => input.current?.focus()}
      disabled={disabled}
      rippleColor="rgba(79,70,229,0.16)"
      accessible={false}
      style={[styles.box, grow ? styles.grow : { width }, { backgroundColor: bg }, invalid ? styles.invalid : null, focused ? styles.focused : null, disabled ? styles.disabled : null]}
    >
      <View>
        <View style={styles.labelRow}>
          <Text style={[styles.label, focused ? styles.labelFocused : null]} numberOfLines={1}>{label}</Text>
          {derivedNote ? (
            <Text testID={derivedTestID} style={styles.derived} numberOfLines={1}>{`↧ ${derivedNote}`}</Text>
          ) : null}
        </View>
        {/* Dokunuşu kutu alır (ripple görünsün); odak ref ile girdiye geçer. */}
        <View style={styles.inputRow} pointerEvents="none">
          <NumpadInput
            ref={input}
            testID={testID}
            value={value}
            onChangeText={onChangeText}
            onFocusChange={setFocused}
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
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: 64, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong,
    paddingHorizontal: spacing.sm, paddingTop: spacing.xs, overflow: 'hidden',
  },
  grow: { flex: 1, minWidth: 100 },
  invalid: { borderWidth: 2, borderColor: colors.danger },
  focused: { borderWidth: 2.5, borderColor: colors.brand },
  disabled: { opacity: 0.5 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  labelFocused: { color: colors.brand },
  derived: { fontSize: 12, fontWeight: '600', color: colors.band.aside, flexShrink: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, backgroundColor: 'transparent', height: 40, paddingHorizontal: 0 },
  inputContent: { fontSize: 24, fontWeight: '700', paddingHorizontal: 0 },
  unit: { fontSize: 16, fontWeight: '600', color: colors.textMuted, marginLeft: spacing.xs },
});
