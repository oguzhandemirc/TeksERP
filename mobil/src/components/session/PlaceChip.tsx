// =============================================================================
// PlaceChip — header'da "şu an neredeyim" çipi + ekran-içi yer değiştirme
// =============================================================================
// ScreenChrome her ekranda render eder; çip yalnız OTURUMLU ekranlarda (route
// adı STATION_KIND_BY_SCREEN'de) ve aktif oturum ekranla eşleşince görünür.
// Dokununca PlaceConfirmView modal açılır — operatör makine değiştirir (eski
// oturum backend'de NEW_LOGIN/TAKEOVER ile kapanır), sorgular oturum id'siyle
// anahtarlandığından donanım kendiliğinden tazelenir.
// =============================================================================

import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { useRoute } from '@react-navigation/native';
import AppModal from '../AppModal';
import PlaceConfirmView from './PlaceConfirmView';
import { useSessionStore } from '../../store/sessionStore';
import { STATION_KIND_BY_SCREEN } from '../../constants/stationScreens';
import type { MobileScreenKey } from '../../types/permissions';

export default function PlaceChip() {
  const route = useRoute();
  const active = useSessionStore((s) => s.active);
  const [open, setOpen] = useState(false);
  const { width: winW, height: winH } = useWindowDimensions();

  const expectedKind = STATION_KIND_BY_SCREEN[route.name as MobileScreenKey];
  if (!expectedKind || !active || active.station.kind !== expectedKind) return null;

  const label = active.machine ? active.machine.code : active.station.name;

  return (
    <>
      <TouchableRipple
        onPress={() => setOpen(true)}
        rippleColor="rgba(255,255,255,0.15)"
        style={styles.chip}
        accessibilityLabel="Yer değiştir"
      >
        <View style={styles.chipInner}>
          <Icon source="map-marker" size={16} color="#a5b4fc" />
          <Text style={styles.chipText} numberOfLines={1}>
            {label}
          </Text>
        </View>
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
  chip: {
    borderRadius: 16,
    backgroundColor: 'rgba(99,102,241,0.18)',
    marginHorizontal: 4,
  },
  chipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    maxWidth: 150,
  },
  chipText: { color: '#c7d2fe', fontSize: 13, fontWeight: '700' },
});
