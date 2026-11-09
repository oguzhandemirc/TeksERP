// Etiket bilgisi penceresinin satırları (TamburLabelInfoModal): seçici açan alan satırı + İE geneli "Diğer etiket alanları" satırı.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Checkbox, IconButton, Text, TouchableRipple } from 'react-native-paper';
import ModalTextInput from '../../../components/ModalTextInput';
import { colors, spacing } from '../../../theme/tokens';

export function LabelFieldRow({ label, value, hint, onPress, onClear, testID }: {
  label: string; value: string; hint: string; onPress: () => void; onClear: () => void; testID: string;
}) {
  const filled = value.trim() !== '';
  return (
    <View style={s.fieldRow}>
      <TouchableRipple onPress={onPress} style={s.field} testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${filled ? value : hint}`}>
        <View>
          <Text style={s.fieldLabel}>{label}</Text>
          <Text style={filled ? s.fieldValue : s.fieldHint} testID={`${testID}-deger`}>{filled ? value : hint}</Text>
        </View>
      </TouchableRipple>
      {filled ? <IconButton icon="close-circle-outline" size={26} onPress={onClear} style={s.clear} accessibilityLabel={`${label} temizle`} testID={`${testID}-temizle`} /> : null}
    </View>
  );
}

export type FieldDraft = { text: string; blank: boolean };

export function OverrideRow({ field, value: v, onChange }: { field: { key: string; label: string; type: 'text' | 'number' }; value: FieldDraft; onChange: (v: FieldDraft) => void }) {
  return (
    <View style={s.row}>
      <View style={s.input}>
        <ModalTextInput
          mode="outlined"
          dense
          label={field.label}
          value={v.text}
          disabled={v.blank}
          keyboardType={field.type === 'number' ? 'decimal-pad' : 'default'}
          maxLength={120}
          onChangeText={(text) => onChange({ ...v, text })}
          testID={`etiket-bilgisi-${field.key}`}
        />
      </View>
      <TouchableRipple onPress={() => onChange({ text: '', blank: !v.blank })} testID={`etiket-bilgisi-bos-${field.key}`} style={s.blankHit}>
        <View style={s.row}>
          <Checkbox.Android status={v.blank ? 'checked' : 'unchecked'} />
          <Text>Boş bas</Text>
        </View>
      </TouchableRipple>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  field: {
    flex: 1,
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  fieldLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  fieldValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  fieldHint: { fontSize: 16, color: colors.textMuted, fontStyle: 'italic' },
  clear: { margin: 0, width: 56, height: 56 },
  input: { flex: 1 },
  blankHit: { minHeight: 56, justifyContent: 'center', paddingRight: spacing.sm },
});
