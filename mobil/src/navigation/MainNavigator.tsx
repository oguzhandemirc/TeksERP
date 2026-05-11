import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MainStackParamList } from './types';
import { usePermissions } from '../hooks/usePermission';
import ModuleSelectScreen from '../screens/Common/ModuleSelectScreen';
import TartiPaketScreen from '../screens/Modules/TartiPaket/TartiPaketScreen';
import SevkiyatScreen from '../screens/Modules/Sevkiyat/SevkiyatScreen';
import DepoScreen from '../screens/Modules/Depo/DepoScreen';
import KK1Screen from '../screens/Modules/KK1/KK1Screen';
import FasonSevkScreen from '../screens/Modules/FasonSevk/FasonSevkScreen';
import FasonKabulScreen from '../screens/Modules/FasonKabul/FasonKabulScreen';
import KursunQcScreen from '../screens/Modules/KursunQc/KursunQcScreen';
import TamburScreen from '../screens/Modules/Tambur/TamburScreen';
import type { MobileScreenKey } from '../types/permissions';

const Stack = createNativeStackNavigator<MainStackParamList>();

const SCREEN_COMPONENTS: Record<MobileScreenKey, React.ComponentType<any>> = {
  KK1: KK1Screen,
  KursunQc: KursunQcScreen,
  Tambur: TamburScreen,
  Depo: DepoScreen,
  TartiPaket: TartiPaketScreen,
  Sevkiyat: SevkiyatScreen,
  FasonSevk: FasonSevkScreen,
  FasonKabul: FasonKabulScreen,
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
        <Stack.Screen key={s.key} name={s.key} component={SCREEN_COMPONENTS[s.key]} />
      ))}
    </Stack.Navigator>
  );
}
