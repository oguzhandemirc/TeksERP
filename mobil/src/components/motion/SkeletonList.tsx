import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Skeleton from './Skeleton';
import { colors, radius, spacing } from '../../theme';

interface Props {
  /** Kaç placeholder satır. Default 6. */
  count?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Liste yükleniyor placeholder'ı — gerçek satırların şeklini (ikon + 2 metin +
 * aksiyon) taklit eden nefes alan iskelet kartlar. Tek spinner yerine içeriğin
 * iskeletini göstermek algılanan hızı artırır ve geçişi akışkan kılar.
 * İstasyon recents/geçmiş listelerinde ortak kullanım için.
 */
export default function SkeletonList({ count = 6, style }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={44} height={44} radius={radius.md} />
          <View style={styles.lines}>
            <Skeleton width="62%" height={14} />
            <Skeleton width="40%" height={12} />
          </View>
          <Skeleton width={52} height={28} radius={radius.sm} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, padding: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lines: { flex: 1, gap: spacing.sm },
});
