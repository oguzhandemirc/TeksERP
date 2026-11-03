// Plan makinesi rozeti (Gülkesim 2026-11-02): planlamacının ÖNERDİĞİ makine. Yalnız bilgi —
// fiilî makine bu tabletin oturumundan gelir, engel/uyarı yok. Öneri yoksa (ya da eski backend) çizilmez.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { palette } from '../../../theme/tokens';

export default function PlannedMachineBadge({ name, testID }: { name: string | null | undefined; testID?: string }) {
  if (!name) return null;
  return (
    <View style={styles.badge} testID={testID} accessibilityLabel={`Önerilen makine ${name}`}>
      <Text style={styles.text} numberOfLines={1}>
        Plan: {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sabit px tavanı yok: 180 px 'Plan: KURŞUN MAKİNESİ 1'i yer varken kesiyordu (QA 2026-11-03);
  // satır daralırsa önce o küçülür, en fazla satırın %45'i.
  badge: { backgroundColor: palette.blue[50], borderColor: palette.blue[500], borderWidth: 1, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, flexShrink: 1, maxWidth: '45%' },
  text: { fontSize: 12, fontWeight: '700', color: palette.blue[800] },
});
