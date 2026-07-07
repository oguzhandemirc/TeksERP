// =============================================================================
// PlaceChip — header'da "şu an neredeyim" çipi (bulunulan makine ADI)
// =============================================================================
// ScreenChrome her ekranda render eder; çip yalnız OTURUMLU ekranlarda (route
// adı STATION_KIND_BY_SCREEN'de) ve aktif oturum ekranla eşleşince görünür.
// SALT GÖSTERGE — dokunmak bir şey yapmaz. Makine değiştirme profil (👤)
// menüsündedir (PlaceActions). Not: KK1 telefonda makine adını başlık
// subtitle'ında gösterir → bu çipi `hidePlaceChip` ile gizler.
// =============================================================================

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useRoute } from '@react-navigation/native';
import { useSessionStore } from '../../store/sessionStore';
import { STATION_KIND_BY_SCREEN } from '../../constants/stationScreens';
import type { MobileScreenKey } from '../../types/permissions';

export default function PlaceChip() {
  const route = useRoute();
  const active = useSessionStore((s) => s.active);

  const expectedKind = STATION_KIND_BY_SCREEN[route.name as MobileScreenKey];
  if (!expectedKind || !active || active.station.kind !== expectedKind) return null;

  // Makine ADI göster (kod değil) — saha operatörü kodu değil adı tanır.
  // Ad boşsa koda düş; makinesiz (SHIPPING) istasyonda istasyon adı.
  const label = active.machine ? active.machine.name || active.machine.code : active.station.name;

  return (
    <View style={styles.chip}>
      <View style={styles.chipInner}>
        <Icon source="cog" size={16} color="#a5b4fc" />
        <Text style={styles.chipText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Header pill'leriyle (Tümünü Gör / Yenile / Makine Değiş) AYNI yükseklik:
  // paddingV 9 + 1px kenarlık + radius 10.
  chip: {
    borderRadius: 10,
    backgroundColor: 'rgba(99,102,241,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.40)',
    marginHorizontal: 4,
    overflow: 'hidden',
  },
  chipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    maxWidth: 220,
  },
  chipText: { color: '#c7d2fe', fontSize: 13, fontWeight: '700' },
});
