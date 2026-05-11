import React from 'react';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import Toast from 'react-native-toast-message';
import RootNavigator from './src/navigation/RootNavigator';
import { NumpadProvider } from './src/components/NumpadProvider';
import { toastConfig } from './src/components/ToastConfig';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#4f46e5',
    primaryContainer: '#e0e7ff',
  },
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <PaperProvider theme={theme}>
          <StatusBar style="light" />
          <NumpadProvider>
            <RootNavigator />
          </NumpadProvider>
          <Toast config={toastConfig} />
        </PaperProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
