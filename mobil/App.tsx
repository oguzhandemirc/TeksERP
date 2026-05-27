import React from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Toast from 'react-native-toast-message';
import RootNavigator from './src/navigation/RootNavigator';
import { NumpadProvider } from './src/components/NumpadProvider';
import { toastConfig } from './src/components/ToastConfig';
import {
  queryClient,
  asyncStoragePersister,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE_MS,
} from './src/offline/queryClient';
import { registerStationMutationDefaults } from './src/offline/mutations';

registerStationMutationDefaults();

// Android'de operatör sistem fontunu büyütse de barkod/metraj/tablo alanları
// taşmasın diye global cap. 1.3x'e kadar serbest (erişilebilirlik korunur),
// üstünde sınırlandırılır. Her Text için tek tek allowFontScaling={false}
// eklemek yerine tek noktadan ayar.
const TEXT_MAX_SCALE = 1.3;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const textDefault = (RNText as any).defaultProps ?? {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(RNText as any).defaultProps = { ...textDefault, maxFontSizeMultiplier: TEXT_MAX_SCALE };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inputDefault = (RNTextInput as any).defaultProps ?? {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(RNTextInput as any).defaultProps = { ...inputDefault, maxFontSizeMultiplier: TEXT_MAX_SCALE };

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
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: asyncStoragePersister,
            maxAge: PERSIST_MAX_AGE_MS,
            buster: PERSIST_BUSTER,
          }}
          onSuccess={() => {
            void queryClient.resumePausedMutations();
          }}
        >
          <PaperProvider theme={theme}>
            <StatusBar style="light" />
            <NumpadProvider>
              <RootNavigator />
            </NumpadProvider>
            <Toast config={toastConfig} />
          </PaperProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
