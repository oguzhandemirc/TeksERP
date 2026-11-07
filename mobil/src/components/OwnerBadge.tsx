// Emanet (müşteri malı) rozeti — Depo ve Hızlı İş Emri top satırları (T3). Kural `utils/ownership.ts`.
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';

import TruncatedText from './TruncatedText';
import { colors, radius } from '../theme';
import { ownerBadgeOf, type OwnedRollLike } from '../utils/ownership';

export default function OwnerBadge({
  emanetOn,
  roll,
  style,
}: {
  emanetOn: boolean;
  roll: OwnedRollLike;
  /** Satır içi (yatay) kapta `alignSelf: 'center'` verilir; varsayılan sütunda sola yaslı. */
  style?: StyleProp<ViewStyle>;
}) {
  const badge = ownerBadgeOf(emanetOn, roll);
  if (!badge) return null;
  return (
    <View style={[styles.pill, style]} testID="owner-badge">
      <Text style={styles.label}>Emanet</Text>
      {badge.name ? <TruncatedText style={styles.name}>{badge.name}</TruncatedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    maxWidth: 220,
    flexShrink: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.band.bg,
  },
  label: { fontSize: 12, fontWeight: '800', color: colors.band.text },
  name: { fontSize: 12, fontWeight: '600', color: colors.band.aside, flexShrink: 1 },
});
