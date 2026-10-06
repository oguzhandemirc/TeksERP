import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChannelLabel } from '../hooks/useChannelLabel';
import { bannerToShow, type LicenseBanner as Banner } from '../lib/license';
import { useLicenseStatus } from '../hooks/useLicenseStatus';
import { colors } from '../theme/tokens';

/** Durum çubuğu boyu raporlanmayan cihazda da şerit okunabilsin (ChannelStrip ile aynı). */
const MIN_HEIGHT = 16;
const BAND_HEIGHT = 22;

const TONE_BG: Readonly<Record<Banner['ton'], string>> = {
  bilgi: colors.infoDark,
  uyari: colors.warningDark,
  tehlike: colors.dangerDark,
};

/**
 * Lisans bandı — `ChannelStrip` kalıbı: MUTLAK biner, dokunmayı yutmaz, hiçbir ekranın
 * yerleşimini itmez. Kanal şeridi varsa onun ALTINA, yoksa durum çubuğu şeridine oturur.
 * Bant yoksa (gözlem kipi, normal kademe, eski backend) hiç çizilmez.
 */
export function LicenseBannerView({
  banner,
  channelLabel,
}: {
  banner: Banner | null;
  channelLabel: string | null;
}) {
  const insets = useSafeAreaInsets();
  if (!banner) return null;
  const stripHeight = Math.max(insets.top, MIN_HEIGHT);
  const top = channelLabel ? stripHeight : 0;
  const height = channelLabel ? BAND_HEIGHT : Math.max(stripHeight, BAND_HEIGHT);
  return (
    <View
      pointerEvents="none"
      testID="lisans-bandi"
      accessibilityLabel={`Lisans: ${banner.metin}`}
      style={[styles.strip, { top, height, backgroundColor: TONE_BG[banner.ton] }]}
    >
      <Text style={styles.text} numberOfLines={1}>
        {banner.metin}
      </Text>
    </View>
  );
}

export default function LicenseBanner() {
  const { data } = useLicenseStatus();
  const channelLabel = useChannelLabel(Constants.expoConfig);
  return <LicenseBannerView banner={bannerToShow(data)} channelLabel={channelLabel} />;
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    zIndex: 1000,
    elevation: 1000,
  },
  text: { color: colors.textOnDark, fontSize: 12, fontWeight: '800' },
});
