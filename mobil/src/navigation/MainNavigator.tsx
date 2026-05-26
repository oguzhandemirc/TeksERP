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
      screenOptions={{ headerShown: false, animation: 'fade' }}
    >
      {hasMultipleMobileScreens && (
        <Stack.Screen name="ModuleSelect" component={ModuleSelectScreen} />
      )}
      {allowedScreens.map((s) => (
        <Stack.Screen key={s.key} name={s.key} getComponent={SCREEN_LOADERS[s.key]} />
      ))}
    </Stack.Navigator>
  );
}
