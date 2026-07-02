import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MainStackParamList } from './types';
import { usePermissions } from '../hooks/usePermission';
import { useSessionStore } from '../store/sessionStore';
import { withWorkSession } from '../components/session/SessionGate';
import {
  SCREEN_BY_STATION_KIND,
  isSessionScreen,
  isSessionStationKind,
} from '../constants/stationScreens';
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

// Oturumlu ekranlar (KK1/KursunQc/Tambur/TartiPaket) SessionGate ile sarılır —
// yer onayı olmadan ekran render edilmez (fail-closed). Sarılmış bileşen modül
// kapsamında BİR KEZ üretilir (her render'da yeni tip → remount olmasın).
const GATED_COMPONENTS: Partial<Record<MobileScreenKey, React.ComponentType<any>>> = {};
function componentLoaderFor(key: MobileScreenKey): () => React.ComponentType<any> {
  if (!isSessionScreen(key)) return SCREEN_LOADERS[key];
  return () => {
    if (!GATED_COMPONENTS[key]) {
      GATED_COMPONENTS[key] = withWorkSession(key, SCREEN_LOADERS[key]);
    }
    return GATED_COMPONENTS[key]!;
  };
}

export default function MainNavigator() {
  const { allowedScreens, hasMultipleMobileScreens } = usePermissions();
  const hasSessionScreens = allowedScreens.some((s) => isSessionScreen(s.key));
  const sessionLoaded = useSessionStore((s) => s.isLoaded);
  const active = useSessionStore((s) => s.active);
  const lastPlace = useSessionStore((s) => s.lastPlace);

  // Oturum durumu login SONRASI yüklenir (auth'suz çağrı 401 üretirdi). Gezici
  // kullanıcı (oturumlu ekranı yok) hiç sorgulamaz — yer sorusu görmez.
  useEffect(() => {
    if (hasSessionScreens && !useSessionStore.getState().isLoaded) {
      void useSessionStore.getState().init();
    }
  }, [hasSessionScreens]);

  if (hasSessionScreens && !sessionLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' }}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  // Tek ekran yetkisi varsa direkt o ekrana git, ModuleSelect'i atla.
  let initialRouteName: keyof MainStackParamList = hasMultipleMobileScreens
    ? 'ModuleSelect'
    : (allowedScreens[0]?.key ?? 'ModuleSelect');

  // Login-sonrası kısayol: aktif oturum ya da cihazın SON yeri izinli bir oturumlu
  // ekrana işaret ediyorsa doğrudan o ekran açılır — gate tek dokunuş onayı gösterir
  // (yer = ekran; operatör ModuleSelect'te ekran aramaz).
  const hintKind = active?.station.kind ?? lastPlace?.station.kind;
  if (isSessionStationKind(hintKind)) {
    const target = SCREEN_BY_STATION_KIND[hintKind];
    if (allowedScreens.some((s) => s.key === target)) initialRouteName = target;
  }

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
        <Stack.Screen key={s.key} name={s.key} getComponent={componentLoaderFor(s.key)} />
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
        name="CuvalDuzelt"
        getComponent={() => require('../screens/Modules/TartiPaket/CuvalDuzeltScreen').default}
      />
      <Stack.Screen
        name="HizliSiparis"
        getComponent={() => require('../screens/Modules/TartiPaket/HizliSiparisScreen').default}
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
