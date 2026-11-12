// Aşama panellerinin ortak parçaları: çerçeve (grup; başlık satırı yok), tek seçim satırı (56dp), "belgede dokun" hedef satırı.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { colors, radius, spacing, typography } from '../../../../theme';

export function Frame({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <View style={parts.frame} testID={testID}>
      {children}
    </View>
  );
}

/** Tek seçim satırı (radyo): etiket + isteğe bağlı açıklama; metin kesilmez, sarar. */
export function ChoiceRow({ label, hint, checked, onPress, testID }: { label: string; hint?: string; checked: boolean; onPress: () => void; testID: string }) {
  return (
    <TouchableRipple onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked }} accessibilityLabel={label} style={[parts.row, checked && parts.rowActive]} testID={testID}>
      <View style={parts.rowInner}>
        <Icon source={checked ? 'radiobox-marked' : 'radiobox-blank'} size={24} color={checked ? colors.brand : colors.textMuted} />
        <View style={parts.flex}>
          <Text style={[parts.label, checked && parts.bold]}>{label}</Text>
          {hint ? <Text style={parts.hint}>{hint}</Text> : null}
        </View>
      </View>
    </TouchableRipple>
  );
}

/** "Belgede dokunun" hedef satırı: seçiliyken kalın çerçeve; değer varsa yanında, temizle düğmesiyle. */
export function TapRow(p: { label: string; value: string | null; placeholder: string; active: boolean; disabled?: boolean; onPress: () => void; onClear?: () => void; testID: string }) {
  return (
    <TouchableRipple
      onPress={p.onPress}
      disabled={p.disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: p.active, disabled: !!p.disabled }}
      accessibilityLabel={`${p.label}: ${p.value ?? p.placeholder}`}
      style={[parts.row, p.active && parts.rowSelected]}
      testID={p.testID}
    >
      <View style={parts.rowInner}>
        <Icon source={p.value ? 'check-circle' : 'gesture-tap'} size={24} color={p.value ? colors.success : colors.textMuted} />
        <Text style={[parts.label, parts.fixed, p.disabled && parts.muted]}>{p.label}</Text>
        <Text style={[parts.flex, p.value ? parts.value : parts.placeholder]} testID={`${p.testID}-deger`}>
          {p.value ?? p.placeholder}
        </Text>
        {p.value && p.onClear ? <IconButton icon="close" size={24} style={parts.iconBtn} onPress={p.onClear} accessibilityLabel={`${p.label} temizle`} testID={`${p.testID}-temizle`} /> : null}
      </View>
    </TouchableRipple>
  );
}

export const parts = StyleSheet.create({
  frame: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { minHeight: 56, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowActive: { backgroundColor: colors.brandContainer },
  rowSelected: { borderWidth: 2, borderColor: colors.brand, backgroundColor: colors.brandContainer },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
  fixed: { width: 140 },
  label: { fontSize: typography.size.base, color: colors.text },
  bold: { fontWeight: typography.weight.semibold },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  muted: { color: colors.textMuted },
  value: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  placeholder: { fontSize: typography.size.sm, color: colors.textMuted },
  iconBtn: { width: 56, height: 56, margin: 0 },
  ask: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text },
  info: { fontSize: typography.size.sm, color: colors.textSecondary },
  warn: { fontSize: typography.size.sm, color: colors.warningText },
  ok: { fontSize: typography.size.base, color: colors.successText },
  gap: { gap: spacing.sm },
  btn: { minHeight: 56 },
});
