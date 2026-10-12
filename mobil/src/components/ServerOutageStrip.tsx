import React, { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChannelLabel } from '../hooks/useChannelLabel';
import { useLicenseStatus } from '../hooks/useLicenseStatus';
import { useOutageClock, useOutagePolling, useOutageTarget } from '../hooks/useServerOutage';
import { bannerToShow } from '../lib/license';
import { outageStrip, type OutageStrip } from '../lib/sunucu-kesintisi';
import { offlineReason, subscribeOfflineReason } from '../offline/serverReachability';
import { colors } from '../theme/tokens';

const MIN_HEIGHT = 16;
const BAND_HEIGHT = 22;

/**
 * Sunucu güncellemesi şeridi — `LicenseBanner` kalıbı: MUTLAK biner, dokunmayı yutmaz, yerleşimi itmez. Kanal
 * şeridinin ve lisans bandının ALTINA oturur. Yazılan form ekranda kalır; kesintide istekler bekletilir (`api.ts`).
 */
export function ServerOutageStripView({
  strip,
  channelLabel,
  licenseBand,
}: {
  strip: OutageStrip | null;
  channelLabel: string | null;
  licenseBand: boolean;
}) {
  const insets = useSafeAreaInsets();
  if (!strip) return null;
  const stripHeight = Math.max(insets.top, MIN_HEIGHT);
  const baseTop = channelLabel ? stripHeight : 0;
  const baseHeight = channelLabel ? BAND_HEIGHT : Math.max(stripHeight, BAND_HEIGHT);
  const top = licenseBand ? baseTop + baseHeight : baseTop;
  const height = licenseBand ? BAND_HEIGHT : baseHeight;
  return (
    <View
      pointerEvents="none"
      testID="sunucu-kesinti-seridi"
      accessibilityLabel={strip.text}
      style={[styles.strip, { top, height, backgroundColor: strip.kind === 'outage' ? colors.infoDark : colors.warningDark }]}
    >
      <Text style={styles.text} numberOfLines={1}>
        {strip.text}
      </Text>
    </View>
  );
}

export default function ServerOutageStrip() {
  useOutagePolling();
  const target = useOutageTarget();
  const now = useOutageClock(target);
  const reason = useSyncExternalStore(subscribeOfflineReason, offlineReason);
  const channelLabel = useChannelLabel();
  const { data } = useLicenseStatus();
  return (
    <ServerOutageStripView
      strip={outageStrip(target, now, reason === 'server')}
      channelLabel={channelLabel}
      licenseBand={bannerToShow(data) !== null}
    />
  );
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
