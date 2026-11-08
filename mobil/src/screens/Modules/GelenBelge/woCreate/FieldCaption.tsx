// Tek İE formunda çip grubunun küçük etiketi (renkli bölüm şeridi yerine): soluk tek satır ad + isteğe bağlı ek + kısa durum.
// Seçici satırları etiketini kendi içinde taşır; yalnız çip grupları (makine, gramaj, özellik, adımlar) bu etikete ihtiyaç duyar.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, spacing, typography } from '../../../../theme';

interface Props {
  label: string;
  aside?: string | null;
  status?: string | null;
  testID: string;
}

export function FieldCaption({ label, aside, status, testID }: Props) {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.label}>{label}</Text>
      {aside ? <Text style={styles.aside}>{aside}</Text> : null}
      <View style={styles.flex} />
      {status ? <Text style={styles.status} testID={`${testID}-durum`}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  label: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold, color: colors.textSecondary },
  aside: { fontSize: typography.size.sm, color: colors.textMuted },
  flex: { flex: 1 },
  status: { fontSize: typography.size.sm, color: colors.textSecondary },
});
