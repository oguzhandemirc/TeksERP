// ⚠N rozeti (KQ-D7): kart/top önceki istasyonlarda açılmış AÇIK hata taşıyor. Sıfırda çizilmez.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { palette } from '../../theme/tokens';

export default function PriorErrorBadge({ count, testID }: { count: number | undefined; testID?: string }) {
  if (!count || count <= 0) return null;
  return (
    <View style={styles.badge} testID={testID} accessibilityLabel={`${count} açık hata`}>
      <Text style={styles.text}>⚠ {count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: palette.amber[300], borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  text: { fontSize: 12, fontWeight: '800', color: palette.amber[900] },
});
