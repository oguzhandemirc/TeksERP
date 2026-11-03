// K29 S15b: açık iş listesinde rotasız İE satırı — bu istasyonda adımı yok, okutunca (seçince) adım eklenir.
// Etiket sunucudan (`scanRouteLabel`); satır `includeScanRouted` istenmeden hiç gelmez, eski sunucu alanı göndermez.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { palette } from '../../../theme/tokens';

export default function ScanRouteAddBadge({ card, testID }: { card: { scanRouteAdd?: boolean; scanRouteLabel?: string }; testID?: string }) {
  if (!card.scanRouteAdd) return null;
  const label = card.scanRouteLabel || 'Sahada belirlenecek';
  return (
    <View style={styles.badge} testID={testID} accessibilityLabel={`${label}: seçince bu istasyon adımı eklenir`}>
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: palette.amber[50], borderColor: palette.amber[500], borderWidth: 1, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, flexShrink: 1, maxWidth: '45%' },
  text: { fontSize: 12, fontWeight: '700', color: palette.amber[900] },
});
