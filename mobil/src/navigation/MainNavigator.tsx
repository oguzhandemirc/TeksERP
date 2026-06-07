import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MainStackParamList } from './types';
import { usePermissions } from '../hooks/usePermission';
import ModuleSelectScreen from '../screens/Common/ModuleSelectScreen';
import type { MobileScreenKey } from '../types/permissions';

const Stack = createNativeStackNavigator<MainStackParamList>();

// Her modül ekranı yalnızca o ekrana navigate edildiğinde require ediliyor.
// Operatörün yetkisi olmayan ekranların modül-level kodu hiç parse edilmez.
const SCREEN_LOADERS: Record<MobileScreenKey, () => React.ComponentType<any>> = {
  KK1: () => require('../screens/Modules/KK1/KK1Screen').default,
  KursunQc: () => require('../screens/Modules/KursunQc/KursunQcScreen').default,
  Tambur: () => require('../screens/Modules/Tambur/TamburScreen').default,
  Depo: () => require('../screens/Modules/Depo/DepoScreen').default,
  TartiPaket: () => require('../screens/Modules/TartiPaket/TartiPaketScreen').default,
  Sevkiyat: () => require('../screens/Modules/Sevkiyat/SevkiyatScreen').default,
  FasonSevk: () => require('../screens/Modules/FasonSevk/FasonSevkScreen').default,
  FasonKabul: () => require('../screens/Modules/FasonKabul/FasonKabulScreen').default,
  KartelaSevk: () => require('../screens/Modules/KartelaSevk/KartelaSevkScreen').default,
  KartelaKabul: () => require('../screens/Modules/KartelaKabul/KartelaKabulScreen').default,
  IadeGirisi: () => require('../screens/Modules/IadeGirisi/IadeGirisiScreen').default,
  HizliIsEmri: () => require('../screens/Modules/HizliIsEmri/HizliIsEmriScreen').default,
};

export default function MainNavigator() {
  const { allowedScreens, hasMultipleMobileScreens } = usePermissions();

  // Tek ekran yetkisi varsa direkt o ekrana git, ModuleSelect'i atla
  const initialRouteName: keyof MainStackParamList = hasMultipleMobileScreens
    ? 'ModuleSelect'
    : (allowedScreens[0]?.key ?? 'ModuleSelect');

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      // Modüle girerken sağdan kayar, geri dönerken geri kayar — fade yerine
      // uzamsal hiyerarşi (ModuleSelect = ana sayfa, istasyon = üstüne push).
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: 260,
      }}
    >
      {hasMultipleMobileScreens && (
        // Ana sayfaya dönüş yumuşak fade ile (kayma değil) — "üst seviye" hissi.
        <Stack.Screen
          name="ModuleSelect"
          component={ModuleSelectScreen}
          options={{ animation: 'fade' }}
        />
      )}
      {allowedScreens.map((s) => (
        <Stack.Screen key={s.key} name={s.key} getComponent={SCREEN_LOADERS[s.key]} />
      ))}
      {/* Alt sayfalar — Tartı/Paket & Sevkiyat'tan push edilir (modül değil, yetki-bağımsız). */}
      <Stack.Screen
        name="SevkiyatGecmisi"
        getComponent={() => require('../screens/Modules/Sevkiyat/SevkiyatGecmisiScreen').default}
      />
      <Stack.Screen
        name="SevkiyatDetay"
        getComponent={() => require('../screens/Modules/Sevkiyat/SevkiyatDetayScreen').default}
      />
      <Stack.Screen
        name="Paketleme"
        getComponent={() => require('../screens/Modules/TartiPaket/PaketlemeScreen').default}
      />
      <Stack.Screen
        name="KartelaSevkGecmisi"
        getComponent={() => require('../screens/Modules/KartelaSevk/KartelaSevkGecmisiScreen').default}
      />
      <Stack.Screen
        name="KartelaKabulGecmisi"
        getComponent={() => require('../screens/Modules/KartelaKabul/KartelaKabulGecmisiScreen').default}
      />
      <Stack.Screen
        name="FasonSevkGecmisi"
        getComponent={() => require('../screens/Modules/FasonSevk/FasonSevkGecmisiScreen').default}
      />
      <Stack.Screen
        name="IadeGecmisi"
        getComponent={() => require('../screens/Modules/IadeGirisi/IadeGecmisiScreen').default}
      />
    </Stack.Navigator>
  );
}
