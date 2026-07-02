// =============================================================================
// SessionGate — oturumlu ekranların yer-onayı kapısı (fail-closed)
// =============================================================================
// Ekran ancak aktif çalışma oturumunun TÜRÜ ekranın beklediği türle eşleşince
// render edilir; aksi halde PlaceConfirmView gösterilir (deep-nav dahil hiçbir
// yol kapıyı atlayamaz). Farklı istasyona geçiş serbesttir: Tambur oturumu
// varken KK1'e girilirse KK1 kapısı yeni yer onayı ister (eski oturum backend'de
// NEW_LOGIN ile kapanır). Ekran kodu yalnız oturum eşleşince require edilir
// (lazy-load disiplini korunur).
// =============================================================================

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSessionStore } from '../../store/sessionStore';
import { STATION_KIND_BY_SCREEN } from '../../constants/stationScreens';
import type { MobileScreenKey } from '../../types/permissions';
import PlaceConfirmView from './PlaceConfirmView';

export function withWorkSession(
  screenKey: MobileScreenKey,
  load: () => React.ComponentType<any>,
): React.ComponentType<any> {
  const expectedKind = STATION_KIND_BY_SCREEN[screenKey];
  if (!expectedKind) {
    // Gezici ekran yanlışlıkla sarılırsa kapı yok — doğrudan ekran.
    return load();
  }

  let Loaded: React.ComponentType<any> | null = null;

  return function SessionGate(props: Record<string, unknown>) {
    const active = useSessionStore((s) => s.active);
    const isLoaded = useSessionStore((s) => s.isLoaded);

    const matches = active?.station.kind === expectedKind;
    if (matches) {
      if (!Loaded) Loaded = load();
      const Screen = Loaded;
      return <Screen {...props} />;
    }
    if (!isLoaded) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' }}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      );
    }
    // Oturum açılınca store güncellenir → matches true → ekran render (onDone no-op).
    return <PlaceConfirmView expectedKind={expectedKind} onDone={() => undefined} />;
  };
}
