// =============================================================================
// PlaceActions — profil menüsündeki "Makine değiştir / Bölüm değiştir" desteği
// =============================================================================
// Bu işlemler üst barda DEĞİL, profil (👤) menüsünde Ayarlar'ın altındadır —
// saha kararı: arıza dışında kullanılmayan nadir işlemler açık yerde durmasın.
// TABLET ve TELEFONDA AYNI: cihaz ayrımı yok, görünürlük yalnız oturum/yetki
// durumuna bakar. Bu dosya iki parça sağlar:
//  - usePlaceActions(): menü maddelerinin görünürlük kuralları
//      · Makine değiştir → oturumlu ekran + türde seçilebilir yer > 1
//      · Bölüm değiştir  → birden çok ekran yetkisi (ModuleSelect'te gizli)
//  - MachinePickerModal: PlaceConfirmView'i saran makine seçme modalı — menü
//    kapanınca da yaşasın diye ScreenChrome kökünde render edilir.
// =============================================================================

import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRoute } from '@react-navigation/native';
import AppModal from '../AppModal';
import PlaceConfirmView from './PlaceConfirmView';
import { useSessionStore } from '../../store/sessionStore';
import { useVisibleScreens } from '../../hooks/useVisibleScreens';
import { workSessionService } from '../../services/workSession.service';
import { placesOfKind } from './placeSuggest';
import { STATION_KIND_BY_SCREEN, type SessionStationKind } from '../../constants/stationScreens';
import type { MobileScreenKey } from '../../types/permissions';

export function usePlaceActions(): {
  expectedKind: SessionStationKind | undefined;
  showMachine: boolean;
  showStation: boolean;
} {
  const route = useRoute();
  // "Bölüm değiştir" maddesi de ModuleSelect'e gider → GÖRÜNÜR ekran sayısına
  // bakar (ham izne değil): gidilecek grid yoksa madde de olmamalı.
  const { hasMultipleVisibleScreens } = useVisibleScreens();
  const active = useSessionStore((s) => s.active);

  const expectedKind = STATION_KIND_BY_SCREEN[route.name as MobileScreenKey];
  const sessionMatches = !!expectedKind && !!active && active.station.kind === expectedKind;

  // Yerler — yalnız oturumlu ekranda çekilir (cache'li, 5 dk taze).
  const placesQ = useQuery({
    queryKey: ['work-session', 'places'],
    queryFn: workSessionService.places,
    staleTime: 5 * 60 * 1000,
    enabled: sessionMatches,
  });

  // Bu türde seçilebilir toplam yer: makineli istasyon = makine sayısı,
  // makinesiz istasyon (SHIPPING) = kendisi (1). 1'den fazlaysa değişilecek
  // bir yer VAR → madde görünür; tek yer varsa madde anlamsız, gizli.
  const kindPlaces = expectedKind ? placesOfKind(placesQ.data ?? [], expectedKind) : [];
  const optionCount = kindPlaces.reduce((n, st) => n + Math.max(st.machines.length, 1), 0);

  return {
    expectedKind,
    showMachine: sessionMatches && optionCount > 1,
    showStation: hasMultipleVisibleScreens && route.name !== 'ModuleSelect',
  };
}

/** Makine seçme modalı (PlaceConfirmView drill-down) — menüden bağımsız yaşar. */
export function MachinePickerModal({
  visible,
  expectedKind,
  onClose,
}: {
  visible: boolean;
  expectedKind: SessionStationKind;
  onClose: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  return (
    <AppModal visible={visible} onDismiss={onClose}>
      <View
        style={{
          width: Math.min(winW - 32, 560),
          height: Math.min(winH * 0.85, 720),
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <PlaceConfirmView expectedKind={expectedKind} onDone={onClose} onCancel={onClose} />
      </View>
    </AppModal>
  );
}
