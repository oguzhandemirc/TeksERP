import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { setUnauthorizedHandler } from '../services/api';
import { usePermissions } from '../hooks/usePermission';
import LoginScreen from '../screens/Auth/LoginScreen';
import NoAccessScreen from '../screens/Common/NoAccessScreen';
import MainNavigator from './MainNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { user, isLoading, loadStoredAuth, clearAuth } = useAuthStore();
  const { hasAnyMobileScreen } = usePermissions();

  useEffect(() => {
    loadStoredAuth();
    setUnauthorizedHandler(() => {
      void clearAuth();
    });
  }, []);

  if (isLoading) {
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
        {!user ? (
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
