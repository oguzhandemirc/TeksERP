// Seçici düğmesi — basınca modal açılır (combobox yok); boşken "seç" çağrısı, doluyken değer öne çıkar.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../theme';
import { DOC_HIGHLIGHT_BG } from '../DocHighlight';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
export type SelectButtonState = 'normal' | 'fromDoc' | 'review' | 'missing';

export interface SelectButtonProps {
  label: string;
  value?: string | null;
  caption?: string;
  hint?: string | null;
  optional?: boolean;
  /** Boşken nötr çerçeve + soluk etiket (isteğe bağlı plan alanı "seç" çağrısı gibi bağırmaz). */
  quiet?: boolean;
  icon?: IconName;
  state?: SelectButtonState;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}

function frame(filled: boolean, state: SelectButtonState, quiet: boolean) {
  if (state === 'missing') return { backgroundColor: colors.dangerContainer, borderColor: colors.danger, borderWidth: 2 };
  if (state === 'review') return { backgroundColor: colors.surface, borderColor: colors.warning, borderWidth: 2 };
  if (state === 'fromDoc') return { backgroundColor: DOC_HIGHLIGHT_BG, borderColor: colors.borderStrong, borderWidth: 1.5 };
  if (!filled && !quiet) return { backgroundColor: colors.brandSoft, borderColor: colors.brand, borderWidth: 2 };
  return { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1.5 };
}

const STATE_ICON: Partial<Record<SelectButtonState, { name: IconName; color: string; size: number }>> = {
  fromDoc: { name: 'file-document-check-outline', color: colors.textSecondary, size: 16 },
  review: { name: 'alert-outline', color: colors.warningText, size: 18 },
};

export function SelectButton({
  label, value, caption, hint, optional, quiet = false, icon, state = 'normal', onPress, disabled, testID,
}: SelectButtonProps) {
  const filled = !!value;
  const labelColor = state === 'missing' ? colors.dangerText : quiet ? colors.textSecondary : colors.brand;
  const mark = STATE_ICON[state];
  return (
    <TouchableRipple
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={filled ? `${caption ?? label}: ${value}` : label}
      onPress={onPress}
      disabled={disabled}
      style={[styles.box, frame(filled, state, quiet), disabled ? styles.disabled : null]}
    >
      <View style={styles.row}>
        {icon ? <MaterialCommunityIcons name={icon} size={22} color={filled ? colors.textSecondary : labelColor} /> : null}
        <View style={styles.body}>
          {filled ? (
            <>
              {caption ? <Text style={styles.caption}>{caption}</Text> : null}
              <Text style={styles.value} numberOfLines={2}>{value}</Text>
            </>
          ) : (
            <Text style={[styles.label, quiet ? styles.quietLabel : null, { color: labelColor }]}>{label}</Text>
          )}
          {hint ? <Text style={styles.hint} numberOfLines={2}>{hint}</Text> : null}
        </View>
        {mark ? <MaterialCommunityIcons name={mark.name} size={mark.size} color={mark.color} /> : null}
        {optional && !filled ? <Text style={styles.optional}>isteğe bağlı</Text> : null}
        <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textMuted} />
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  box: { minHeight: 64, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  body: { flex: 1 },
  caption: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  value: { fontSize: 20, fontWeight: '700', color: colors.text },
  label: { fontSize: 18, fontWeight: '700' },
  quietLabel: { fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 14, fontWeight: '400', color: colors.textSecondary, marginTop: 2 },
  optional: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  disabled: { opacity: 0.5 },
});
