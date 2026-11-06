// İş Emirleri — "Sütunlar": onay kutulu liste (ModuleSheet). Zorunlu sütunlar kilitli, gerekçesi satırda yazar.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet from '../../../components/ModuleSheet';
import { colors, radius, spacing, typography } from '../../../theme';
import { COLUMNS, type ColumnKey } from './columns';

interface Props {
  visible: boolean;
  columns: ColumnKey[];
  onToggle: (k: ColumnKey) => void;
  onDismiss: () => void;
}

export default function ColumnsSheet({ visible, columns, onToggle, onDismiss }: Props) {
  return (
    <ModuleSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Sütunlar"
      subtitle="Görmek istediğiniz sütunları işaretleyin; seçim bu cihazda sizin için saklanır."
      size="sm"
      footer={<Button mode="contained" onPress={onDismiss} contentStyle={styles.btn} testID="ie-sutun-tamam">Tamam</Button>}
    >
      {COLUMNS.map((c) => {
        const on = columns.includes(c.key);
        return (
          <TouchableRipple
            key={c.key}
            onPress={c.required ? undefined : () => onToggle(c.key)}
            disabled={c.required}
            style={[styles.row, on && styles.rowOn]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: c.required }}
            testID={`ie-sutun-${c.key}`}
          >
            <View style={styles.inner}>
              <Icon source={c.required ? 'lock-outline' : on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={26} color={on ? colors.brand : colors.textMuted} />
              <Text style={styles.label}>{c.label}</Text>
              {c.required && <Text style={styles.hint}>Her zaman açık</Text>}
            </View>
          </TouchableRipple>
        );
      })}
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: 56, paddingHorizontal: spacing.xl },
  row: { minHeight: 56, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  rowOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  label: { flex: 1, fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  hint: { fontSize: typography.size.sm, color: colors.textMuted },
});
