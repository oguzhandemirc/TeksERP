// Tek İE formunda çip grubunun satırı: soru kutusu (etiket + ek, kısa durum; çiplerle aynı yükseklik) solda, seçenekler aynı satırda sağında; ayrı başlık
// satırı yok. Dar ekranda seçenekler kendi içinde sarar. Seçici satırları etiketini kendi içinde taşır (SelectButton).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { colors, radius, spacing, typography } from '../../../../theme';

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
        <View style={styles.labelRow}>
          <Icon source="help-circle-outline" size={20} color={colors.brand} />
          <Text style={styles.label}>{label}</Text>
        </View>
        {aside ? <Text style={styles.aside}>{aside}</Text> : null}
        {status ? <Text style={styles.status} testID={`${testID}-durum`}>{status}</Text> : null}
      </View>
      {children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // Soru olduğu belli olsun: yanındaki seçeneklerle aynı yükseklikte, sabit genişlikte kutu (satırlar hizalı).
  head: { flexShrink: 0, width: 240, maxWidth: '40%', minHeight: 56, justifyContent: 'center', gap: 2, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.md, backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: colors.brandContainer },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  label: { flexShrink: 1, fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  aside: { fontSize: typography.size.xs, color: colors.textMuted },
  status: { fontSize: typography.size.xs, color: colors.textMuted },
  body: { flex: 1, minWidth: 0 },
});
