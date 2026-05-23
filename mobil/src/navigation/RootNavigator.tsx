import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { useDeviceStore } from '../store/deviceStore';
import { setUnauthorizedHandler } from '../services/api';
import { usePermissions } from '../hooks/usePermission';
import LoginScreen from '../screens/Auth/LoginScreen';
import PairingScreen from '../screens/Auth/PairingScreen';
import NoAccessScreen from '../screens/Common/NoAccessScreen';
import MainNavigator from './MainNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { user, isLoading: authLoading, loadStoredAuth, clearAuth } = useAuthStore();
  const { paired, isLoading: deviceLoading, init: initDevice } = useDeviceStore();
  const { hasAnyMobileScreen } = usePermissions();

  useEffect(() => {
    void initDevice();
    loadStoredAuth();
    setUnauthorizedHandler(() => {
      void clearAuth();
    });
  }, []);

  if (authLoading || deviceLoading) {
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
