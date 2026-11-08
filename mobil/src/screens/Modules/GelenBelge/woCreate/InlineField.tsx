// Tek İE formunda çip grubunun satırı: soluk etiket (+ ek, kısa durum) solda, seçenekler aynı satırda sağında; ayrı başlık
// satırı yok. Dar ekranda seçenekler kendi içinde sarar. Seçici satırları etiketini kendi içinde taşır (SelectButton).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, spacing, typography } from '../../../../theme';

interface Props {
  label: string;
  aside?: string | null;
  status?: string | null;
  testID: string;
  children?: React.ReactNode;
}

export function InlineField({ label, aside, status, testID, children }: Props) {
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        {aside ? <Text style={styles.aside}>{aside}</Text> : null}
        {status ? <Text style={styles.status} testID={`${testID}-durum`}>{status}</Text> : null}
      </View>
      {children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  head: { flexShrink: 0, maxWidth: '40%', gap: 2 },
  label: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold, color: colors.textSecondary },
  aside: { fontSize: typography.size.xs, color: colors.textMuted },
  status: { fontSize: typography.size.xs, color: colors.textMuted },
  body: { flex: 1, minWidth: 0 },
});
