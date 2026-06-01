import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { useDeviceStore } from '../store/deviceStore';
import { useBaseUrlStore } from '../store/baseUrlStore';
import { useDeviceSettingsStore } from '../store/deviceSettingsStore';
import { setUnauthorizedHandler } from '../services/api';
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
  const { hasAnyMobileScreen } = usePermissions();

  useEffect(() => {
    void initBaseUrl();
    void initDevice();
    void initDeviceSettings();
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
        {!paired ? (
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
