// =============================================================================
// PlaceChip — header'da "şu an neredeyim" çipi (bulunulan makine ADI)
// =============================================================================
// ScreenChrome her ekranda render eder; çip yalnız OTURUMLU ekranlarda (route
// adı STATION_KIND_BY_SCREEN'de) ve aktif oturum ekranla eşleşince görünür.
// TABLET: salt gösterge — makine değiştirme, ortadaki açık etiketli "Makine
// Değiş" butonundadır (PlaceActions); çipe dokunmak bir şey yapmaz.
// TELEFON: dokununca PlaceConfirmView modalı açılır (yer/makine değiştirme) —
// telefonda ortada buton için yer yok, eski davranış korunur.
// =============================================================================

import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { useRoute } from '@react-navigation/native';
import AppModal from '../AppModal';
import PlaceConfirmView from './PlaceConfirmView';
import { useSessionStore } from '../../store/sessionStore';
import { useDeviceType } from '../../hooks/useDeviceType';
import { STATION_KIND_BY_SCREEN } from '../../constants/stationScreens';
import type { MobileScreenKey } from '../../types/permissions';

export default function PlaceChip() {
  const route = useRoute();
  const active = useSessionStore((s) => s.active);
  const isTablet = useDeviceType() === 'tablet';
  const [open, setOpen] = useState(false);
  const { width: winW, height: winH } = useWindowDimensions();

  const expectedKind = STATION_KIND_BY_SCREEN[route.name as MobileScreenKey];
  if (!expectedKind || !active || active.station.kind !== expectedKind) return null;

  // Makine ADI göster (kod değil) — saha operatörü kodu değil adı tanır.
  // Ad boşsa koda düş; makinesiz (SHIPPING) istasyonda istasyon adı.
  const label = active.machine ? active.machine.name || active.machine.code : active.station.name;

  const inner = (
    <View style={styles.chipInner}>
      <Icon source={isTablet ? 'cog' : 'swap-horizontal'} size={16} color="#a5b4fc" />
      <Text style={styles.chipText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  // Tablet: dokunulmaz etiket (değiştirme "Makine Değiş" butonunda).
  if (isTablet) {
    return <View style={styles.chip}>{inner}</View>;
  }

  return (
    <>
      <TouchableRipple
        onPress={() => setOpen(true)}
        rippleColor="rgba(255,255,255,0.15)"
        style={styles.chip}
        accessibilityLabel="Yer değiştir"
      >
        {inner}
      </TouchableRipple>

      <AppModal visible={open} onDismiss={() => setOpen(false)}>
        <View style={{ width: Math.min(winW - 32, 560), height: Math.min(winH * 0.85, 720), borderRadius: 16, overflow: 'hidden' }}>
          <PlaceConfirmView
            expectedKind={expectedKind}
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </View>
      </AppModal>
    </>
  );
}

const styles = StyleSheet.create({
  // Header pill'leriyle (Tümünü Gör / Yenile / Makine Değiş) AYNI yükseklik:
  // paddingV 9 + 1px kenarlık + radius 10 (eskiden 7/16 — kısa kalıyordu).
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
