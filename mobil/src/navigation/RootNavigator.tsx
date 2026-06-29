import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { useDeviceStore } from '../store/deviceStore';
import { useBaseUrlStore } from '../store/baseUrlStore';
import { useDeviceSettingsStore } from '../store/deviceSettingsStore';
import { useBtPrinterStore } from '../store/btPrinterStore';
import { useBtMeterStore } from '../store/btMeterStore';
import { setUnauthorizedHandler } from '../services/api';
import { deviceService } from '../services/device.service';
import { usePermissions } from '../hooks/usePermission';
import LoginScreen from '../screens/Auth/LoginScreen';
import PairingScreen from '../screens/Auth/PairingScreen';
import NoAccessScreen from '../screens/Common/NoAccessScreen';
import SettingsScreen from '../screens/Common/SettingsScreen';
import DevicePairingScreen from '../screens/Common/DevicePairingScreen';
import MainNavigator from './MainNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { user, isLoading: authLoading, loadStoredAuth, clearAuth } = useAuthStore();
  const {
    paired,
    isLoading: deviceLoading,
    init: initDevice,
  } = useDeviceStore();
  const initBaseUrl = useBaseUrlStore((s) => s.init);
  const baseUrlLoaded = useBaseUrlStore((s) => s.isLoaded);
  const initDeviceSettings = useDeviceSettingsStore((s) => s.init);
  const initBtPrinter = useBtPrinterStore((s) => s.init);
  const initBtMeter = useBtMeterStore((s) => s.init);
  const { hasAnyMobileScreen } = usePermissions();

  // Cihaz eşleştirmesi zorunlu mu? Public gate (login öncesi okunur). React Query
  // cache'i AsyncStorage'a persist edilir → son bilinen değer offline'da da geçerli.
  // Yüklenene kadar / hata halinde false (pasif): boot'u bloklamayız, operatör
  // doğrudan Login'e ulaşır. Eşleşmiş cihaz zaten `paired` ile Pairing'i atlar.
  const pairingRequired =
    useQuery({
      queryKey: ['device', 'pairing-required'],
      queryFn: deviceService.getPairingRequired,
      staleTime: 5 * 60 * 1000,
    }).data ?? false;

  useEffect(() => {
    void initBaseUrl();
    void initDevice();
    void initDeviceSettings();
    void initBtPrinter();
    void initBtMeter();
    loadStoredAuth();
    setUnauthorizedHandler(() => {
      // 401 → sadece kullanıcıyı çıkar, eşleşmeyi koru. Cihaz pasifleştirilirse
      // login ekranında "Cihaz pasif" hatası görünür; admin aktif yapınca operatör
      // yeniden login olup devam eder — eşleşme kodu sorulmaz.
      void clearAuth();
    });
  }, []);

  if (authLoading || deviceLoading || !baseUrlLoaded) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#0f172a',
        }}
      >
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        {!paired && pairingRequired ? (
          <Stack.Screen name="Pairing" component={PairingScreen} />
        ) : !user ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : !hasAnyMobileScreen ? (
          <Stack.Screen name="NoAccess" component={NoAccessScreen} />
        ) : (
          <Stack.Screen name="Main" component={MainNavigator} />
        )}
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="DevicePairing"
          component={DevicePairingScreen}
          options={{ animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
