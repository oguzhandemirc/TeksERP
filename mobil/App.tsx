import React, { useEffect, useRef } from 'react';
import {
  AppState,
  type AppStateStatus,
  Text as RNText,
  TextInput as RNTextInput,
} from 'react-native';
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
import { FLAGS_KEY } from './src/hooks/useFeatureFlags';
import { colors } from './src/theme/tokens';

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
    primary: colors.brand,
    primaryContainer: colors.brandContainer,
  },
};

export default function App() {
  // Uygulama arka plandan/inaktiften ÖNE döndüğünde feature flag'leri tazele.
  // Admin Electron'dan bir flag'i toggle edince (örn. boyahane notu mobil giriş),
  // operatör uygulamayı öne getirince 5 dk staleTime'ı beklemeden yansır.
  // invalidate aktif observer'ı hemen refetch'e zorlar; offline ise (queries
  // networkMode='online') refetch beklemeye alınır, son persisted değer korunur.
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appState.current;
      appState.current = next;
      if (next === 'active' && prev !== 'active') {
        void queryClient.invalidateQueries({ queryKey: FLAGS_KEY });
      }
    });
    return () => sub.remove();
  }, []);

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
          </PaperProvider>
          {/* Toast, PaperProvider'ın DIŞINDA ve ondan SONRA durur. Tüm modallar
              (AppModal → react-native-paper Portal) PaperProvider'ın Portal.Host'una
              mount olur; Portal içeriği host'un normal çocuklarının üstüne biner.
              Toast host'un içindeyken (eski hali) modalın ARKASINDA kalıyordu. Burada
              host dışında ve sonra render edildiğinden her zaman modalların üstünde
              görünür. toastConfig yalnız react-native-toast-message + View kullanır,
              Paper context'ine ihtiyacı yok. */}
          <Toast config={toastConfig} />
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
