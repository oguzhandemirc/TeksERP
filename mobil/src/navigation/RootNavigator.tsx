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
import { setUnauthorizedHandler } from '../services/api';
import { deviceService } from '../services/device.service';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { usePermissions } from '../hooks/usePermission';
import LoginScreen from '../screens/Auth/LoginScreen';
import AwaitingAssignmentScreen from '../screens/Auth/AwaitingAssignmentScreen';
import NoAccessScreen from '../screens/Common/NoAccessScreen';
import SettingsScreen from '../screens/Common/SettingsScreen';
import DevicePairingScreen from '../screens/Common/DevicePairingScreen';
import MainNavigator from './MainNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { user, isLoading: authLoading, loadStoredAuth, clearAuth } = useAuthStore();
  const {
    isLoading: deviceLoading,
    init: initDevice,
    setPaired,
    clearPairing,
  } = useDeviceStore();
  const initBaseUrl = useBaseUrlStore((s) => s.init);
  const baseUrlLoaded = useBaseUrlStore((s) => s.isLoaded);
  const initDeviceSettings = useDeviceSettingsStore((s) => s.init);
  const initBtPrinter = useBtPrinterStore((s) => s.init);
  const { hasAnyMobileScreen } = usePermissions();

  // Cihaz onayı/ataması zorunlu mu? Public gate (login öncesi). false (default) →
  // pasif; tablet onaysız da Login'e geçer (atıf null). Hata/erişimsizlikte false.
  const assignmentRequired =
    useQuery({
      queryKey: ['device', 'assignment-required'],
      queryFn: deviceService.getAssignmentRequired,
      staleTime: 5 * 60 * 1000,
    }).data ?? false;

  // Atama durumu — zorunluyken APPROVED olana kadar poll'lanır.
  const assignment = useQuery({
    queryKey: ['device', 'status'],
    queryFn: deviceService.getStatus,
    enabled: assignmentRequired,
    refetchInterval: (q) => (q.state.data?.status === 'APPROVED' ? false : 5000),
  }).data;

  useEffect(() => {
    void initBaseUrl();
    void initDevice();
    void initDeviceSettings();
    void initBtPrinter();
    loadStoredAuth();
    // Tablet kendini bildirir (bilinmiyorsa PENDING kaydı açılır → admin onaylar+atar).
    void getOrCreateDeviceId().then((deviceId) =>
      deviceService.announce({ deviceId }).catch(() => undefined),
    );
    setUnauthorizedHandler(() => {
      // 401 → sadece kullanıcıyı çıkar, atamayı koru.
      void clearAuth();
    });
  }, []);

  // SettingsScreen gösterimi için `paired`'ı atama durumundan senkronla.
  useEffect(() => {
    if (assignment?.status === 'APPROVED' && assignment.machineId) {
      void setPaired({
        id: assignment.machineId,
        code: assignment.machineCode ?? '',
        name: assignment.machineName ?? '',
        stationId: assignment.stationId ?? '',
        stationName: assignment.stationName ?? '',
      });
    } else if (assignment && assignment.status !== 'APPROVED') {
      void clearPairing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.status, assignment?.machineId]);

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
        {assignmentRequired && assignment?.status !== 'APPROVED' ? (
          <Stack.Screen name="Pairing" component={AwaitingAssignmentScreen} />
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
