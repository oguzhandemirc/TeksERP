// "Son Çıkan Toplar" sütun seçici: başlıktaki "Sütunlar" düğmesi + liste kartının üstünde açılan onay kutulu katman.
// Katman RemoteListSheet `overlay` yuvasında çizilir (aynı RNModal portalı — iki modal çakışmaz).
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Checkbox, Text, TouchableRipple } from 'react-native-paper';
import { colors, radius, spacing } from '../../../theme/tokens';
import { OUTPUT_COLUMNS, type OutputColumnKey } from './recentOutputColumns';

export function OutputColumnsButton({ onPress }: { onPress: () => void }) {
  return (
    <Button mode="outlined" icon="view-column-outline" onPress={onPress} contentStyle={s.btn} testID="son-cikan-sutunlar">
      Sütunlar
    </Button>
  );
}

export function OutputColumnsPicker({
  visible,
  value,
  onToggle,
  onReset,
  onClose,
}: {
  visible: boolean;
  value: ReadonlySet<OutputColumnKey>;
  onToggle: (key: OutputColumnKey) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  return (
    <View style={s.backdrop} testID="son-cikan-sutun-secici">
      <View style={s.card}>
        <Text style={s.title}>Görünecek sütunlar</Text>
        <ScrollView style={s.list}>
        {OUTPUT_COLUMNS.map((c) => {
          const on = value.has(c.key);
          return (
            <TouchableRipple
              key={c.key}
              onPress={() => onToggle(c.key)}
              disabled={c.required}
              style={s.row}
              testID={`son-cikan-sutun-${c.key}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: !!c.required }}
            >
              <View style={s.rowInner}>
                <Checkbox.Android status={on ? 'checked' : 'unchecked'} disabled={c.required} />
                <Text style={s.label}>{c.required ? `${c.label} (zorunlu)` : c.label}</Text>
              </View>
            </TouchableRipple>
          );
        })}
        </ScrollView>
        <View style={s.actions}>
          <Button mode="text" onPress={onReset} contentStyle={s.btn} testID="son-cikan-sutun-varsayilan">Varsayılana dön</Button>
          <Button mode="contained" onPress={onClose} contentStyle={s.btn} testID="son-cikan-sutun-tamam">Tamam</Button>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { minHeight: 48 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: { width: 380, maxWidth: '100%', maxHeight: '100%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: 2 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  list: { flexShrink: 1 },
  row: { minHeight: 48, justifyContent: 'center', borderRadius: radius.md },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { fontSize: 16, color: colors.text },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
});
