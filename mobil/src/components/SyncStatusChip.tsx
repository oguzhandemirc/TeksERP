import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import Pulse from './motion/Pulse';
import { palette, radius, spacing } from '../theme';
import { useIsOnline, usePendingStationOps } from '../offline/hooks';

/**
 * Çevrimdışı / senkron bekleyen istasyon işlemi rozeti — istasyon ekranlarının
 * header'ında ortak. Önceden 5 ekrana birebir kopyalanmış statik pill'di; tek
 * paylaşılan, animasyonlu komponente çıkarıldı.
 *
 * Üç durum:
 *  - online + bekleyen>0  → "N sync"        (mavi, nabız atan açık nokta = aktarım)
 *  - offline + bekleyen=0 → "Çevrimdışı"     (amber)
 *  - offline + bekleyen>0 → "Çevrimdışı · N" (kırmızı = veri sırada, dikkat)
 *
 * Tam senkronda (online + bekleyen 0) hiç render edilmez. Duruma girince
 * yaylı bir girişle belirir; nabız atan nokta operatöre "bir şey oluyor"
 * sinyalini sezgisel verir.
 */
export default function SyncStatusChip() {
  const online = useIsOnline();
  const pending = usePendingStationOps();
  const pendingCount = pending.length;

  if (online && pendingCount === 0) return null;

  let bg: string = palette.blue[800];
  let dot: string = '#bfdbfe'; // blue 200
  let label = `${pendingCount} sync`;
  if (!online && pendingCount === 0) {
    bg = palette.amber[700];
    dot = '#fde68a'; // amber 200
    label = 'Çevrimdışı';
  } else if (!online && pendingCount > 0) {
    bg = palette.red[700];
    dot = '#fecaca'; // red 200
    label = `Çevrimdışı · ${pendingCount}`;
  }

  const a11y = online
    ? `${pendingCount} işlem senkronize bekliyor`
    : pendingCount > 0
      ? `Çevrimdışı, ${pendingCount} işlem bekliyor`
      : 'Çevrimdışı';

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(16).stiffness(180).mass(0.7)}
      exiting={FadeOut.duration(160)}
      style={[styles.chip, { backgroundColor: bg }]}
      accessibilityLabel={a11y}
    >
      <Pulse color={dot} size={8} />
      <Text style={styles.label}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: radius.md,
    marginRight: spacing.sm,
  },
  label: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
