// =============================================================================
// SessionGate — oturumlu ekranların yer-onayı kapısı (fail-closed)
// =============================================================================
// Ekran ancak aktif çalışma oturumunun TÜRÜ ekranın beklediği türle eşleşince
// render edilir; aksi halde PlaceConfirmView gösterilir (deep-nav dahil hiçbir
// yol kapıyı atlayamaz). Farklı istasyona geçiş serbesttir: Tambur oturumu
// varken KK1'e girilirse KK1 kapısı yeni yer onayı ister (eski oturum backend'de
// NEW_LOGIN ile kapanır). Ekran kodu yalnız oturum eşleşince require edilir
// (lazy-load disiplini korunur).
//
// INVARIANT: Yer onayı yalnız ODAKTAKİ ekranda gösterilir/denenir — oturumu
// yalnız kullanıcının BAKTIĞI ekran açabilir. Native-stack'te alttaki ekranlar
// mount kalır (v7 navigate() pop-back yapmaz, üste push eder); arka plandaki
// kind-uyuşmaz bir gate PlaceConfirmView(autoOpen) render etseydi odaktaki
// gate'le dönüşümlü oturum kapma savaşına girerdi (~1sn'lik ekran↔yer-onayı
// ping-pong'u — PlaceConfirmView'deki tek-slot 6sn guard'ı dönüşümlü key'leri
// yakalayamaz). Odağa dönüşte gate taze PlaceConfirmView mount eder → tek
// otomatik açılış denemesi orada yapılır. Eşleşme (matches) dalı odağa
// BAĞLANMAZ: alt sayfa (Paketleme vb.) push'larında alttaki ekran state'iyle
// mount kalmalı.
// =============================================================================

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSessionStore } from '../../store/sessionStore';
import { STATION_KIND_BY_SCREEN } from '../../constants/stationScreens';
import type { MobileScreenKey } from '../../types/permissions';
import PlaceConfirmView from './PlaceConfirmView';

/**
 * Kapının taşıdığı ekran bileşeninin sözleşmesi. Props'u navigator verir ve kapı
 * onları OKUMADAN geçirir — bu yüzden anahtarlar bilinmez, tip `any` değildir.
 */
export type GatedScreen = React.ComponentType<Record<string, unknown>>;

export function withWorkSession(
  screenKey: MobileScreenKey,
  load: () => GatedScreen,
): GatedScreen {
  const expectedKind = STATION_KIND_BY_SCREEN[screenKey];
  if (!expectedKind) {
    // Gezici ekran yanlışlıkla sarılırsa kapı yok — doğrudan ekran.
    return load();
  }

  let Loaded: GatedScreen | null = null;

  return function SessionGate(props: Record<string, unknown>) {
    const active = useSessionStore((s) => s.active);
    const isLoaded = useSessionStore((s) => s.isLoaded);
    const isFocused = useIsFocused();

    const matches = active?.station.kind === expectedKind;
    if (matches) {
      if (!Loaded) Loaded = load();
      const Screen = Loaded;
      return <Screen {...props} />;
    }
    // Odakta değilken PlaceConfirmView HİÇ mount edilmez (pasif spinner):
    // arka plandaki gate ne otomatik oturum açabilir ne de yer listesi çeker.
    // Ekran odağa dönünce useIsFocused re-render tetikler → taze PlaceConfirmView.
    if (!isLoaded || !isFocused) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' }}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      );
    }
    // Oturum açılınca store güncellenir → matches true → ekran render (onDone no-op).
    // autoOpen: girişte makine seçtirme YOK — çözülebilir yer (son yer / tek istasyon+
    // tek makine) varsa otomatik açılır; değilse seçim ekranı çıkar.
    return <PlaceConfirmView expectedKind={expectedKind} onDone={() => undefined} autoOpen />;
  };
}
