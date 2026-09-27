import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolveChannelLabel } from '../lib/channelLabel';
import { colors } from '../theme/tokens';

/** Durum çubuğu boyu raporlanmayan cihazda da etiket okunabilsin. */
const MIN_HEIGHT = 16;

/**
 * Hazırlık (test) kanalının işareti — gerçek verinin KOPYASINA gerçek iş girilmesin.
 * Her ekranın üstünde, durum çubuğu şeridine MUTLAK biner ve dokunmayı yutmaz: hiçbir
 * ekranın yerleşimini itmez, yatay/dikey fark etmez. Üretim kanalında hiç çizilmez.
 */
export default function ChannelStrip({ config = Constants.expoConfig }: { config?: { extra?: unknown } | null }) {
  const insets = useSafeAreaInsets();
  const label = resolveChannelLabel(config);
  if (!label) return null;
  return (
    <View
      pointerEvents="none"
      testID="kanal-seridi"
      accessibilityLabel={`Kanal: ${label}`}
      style={[styles.strip, { height: Math.max(insets.top, MIN_HEIGHT) }]}
    >
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warningDark,
    zIndex: 1000,
    elevation: 1000,
  },
  text: { color: colors.textOnDark, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
});
