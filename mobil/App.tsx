import React, { useEffect, useRef } from 'react';
import {
  AppState,
  type AppStateStatus,
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  View,
} from 'react-native';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RootNavigator from './src/navigation/RootNavigator';
import { NumpadProvider } from './src/components/NumpadProvider';
import { SimplePortalHost, SimplePortalScope } from './src/components/SimplePortal';
import { toastConfig } from './src/components/ToastConfig';
import {
  queryClient,
  asyncStoragePersister,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE_MS,
} from './src/offline/queryClient';
import { registerStationMutationDefaults } from './src/offline/mutations';
import { isPersistedQueryKey, shouldPersistMutation } from './src/offline/persistPolicy';
import { FLAGS_KEY } from './src/hooks/useFeatureFlags';
import { colors } from './src/theme/tokens';
import { recordActivity } from './src/store/lockStore';
import IdleLockGate from './src/components/lock/IdleLockGate';
import UpdateGate from './src/components/UpdateGate';

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
  // Uygulama arka plandan/inaktiften ÖNE döndüğünde MENÜYÜ ÇİZEN verileri tazele.
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
        // Yalnız FEATURE FLAG'ler tazelenir. Kurşun görünürlük sayacı
        // (`['kursun-bypass','visibility']`) 2026-08-05'te kaldırıldı: Kurşun
        // Dağıtım karosu artık bayrak/sayaçtan bağımsız, yalnız izne bağlı.
        void queryClient.invalidateQueries({ queryKey: FLAGS_KEY });
      }
    });
    return () => sub.remove();
  }, []);

  // Etiket Stüdyosu v2 geçişi: eski kind-anahtarlı şablon cache'i ('@label-template:*')
  // kaldırıldı — bayat cache yanlış şablon bilgisi göstermesin diye açılışta bir kez
  // temizlenir (anahtar kalmayınca no-op; kalıcı maliyeti yok).
  useEffect(() => {
    void (async () => {
      try {
        const keys = await AsyncStorage.getAllKeys();
        const stale = keys.filter((k) => k.startsWith('@label-template:'));
        if (stale.length > 0) await AsyncStorage.multiRemove(stale);
      } catch {
        // best-effort — temizlik başarısızlığı açılışı engellemez
      }
    })();
  }, []);

  // Kök dokunma izleme (idle kilit) — capture fazında HER dokunma başında
  // aktiviteyi tazeler, false döndürerek responder'ı çocuklara bırakır (dokunmayı
  // yutmaz). Wrapper View, Paper Portal modalları + Toast + kilit dahil TÜM ağacı
  // sardığı için her etkileşim sayılır.
  const trackTouch = React.useCallback(() => {
    recordActivity();
    return false;
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Klavye yönetimi (react-native-keyboard-controller): odaklanan input'u
          klavyenin üstüne otomatik + yumuşak kaydırır. edge-to-edge otomatik
          algılanır (react-native-is-edge-to-edge). Ekranlar KeyboardAwareScrollView
          / KeyboardStickyView kullanır. Native rebuild gerekir (expo run:android). */}
      <KeyboardProvider>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: asyncStoragePersister,
            maxAge: PERSIST_MAX_AGE_MS,
            buster: PERSIST_BUSTER,
            // Persist kapsamı DARALTILDI (persistPolicy.ts): yalnız login
            // bootstrap'ı + tercihler diske yazılır — üretim ekran verileri
            // app restart'ta "dünkü haliyle" görünmez (hayalet veri biter).
            // Mutation tarafı GENİŞLETİLDİ: paused ∪ pending-istasyon — aktif
            // retry'daki kayıt app kill'de kaybolmaz (istasyon uçları idempotent).
            dehydrateOptions: {
              shouldDehydrateQuery: (q) =>
                q.state.status === 'success' && isPersistedQueryKey(q.queryKey),
              shouldDehydrateMutation: (m) => shouldPersistMutation(m),
            },
          }}
          onSuccess={() => {
            // Restore sonrası kuyruk dürtülür; token henüz yoksa mutations.ts
            // NoAuth guard'ı HTTP'ye çıkmadan bekletir (girişte akar).
            void queryClient.resumePausedMutations();
          }}
        >
          <View style={{ flex: 1 }} onStartShouldSetResponderCapture={trackTouch}>
            <PaperProvider theme={theme}>
              <StatusBar style="light" />
              <NumpadProvider>
                <RootNavigator />
              </NumpadProvider>
              {/* Modal katmanı (AppModal → SimplePortal). RootNavigator'ın KARDEŞİ
                  ve ondan SONRA → modallar ekranın üstüne biner. Konumu üç sınırla
                  çevrili, üçü de bilinçli:
                  • PaperProvider'ın İÇİNDE → portal içeriği paper tema + settings
                    context'ini görür (paper `Portal` bunu ThemeProvider ile elle
                    taşıyordu; burada ağaçtan gelir). Dışarı alınsaydı modallardaki
                    Paper bileşenleri varsayılan MD3 moruna düşerdi.
                  • NumpadProvider'ın DIŞINDA → modal içeriği ekranın numpad/navigation
                    context'ini GÖRMEZ; paper Portal.Host da tam burada duruyordu,
                    yani context görünürlüğü BİREBİR korunur (AppModal.tsx uyarısı).
                  • Toast ve IdleLockGate'in ALTINDA → onlar PaperProvider'dan sonra
                    gelmeye devam eder, yani her zaman modalların üstünde çizilir.
                  Kayıt yokken hiçbir şey render etmez; her kayıt kendi absoluteFill
                  + box-none katmanında (paper PortalManager yerleşiminin aynısı). */}
              <SimplePortalHost />
            </PaperProvider>
            {/* Toast, PaperProvider'ın DIŞINDA ve ondan SONRA durur. Tüm modallar
                (AppModal → SimplePortal) PaperProvider içindeki SimplePortalHost'a
                mount olur. Toast host'un içindeyken (eski hali) modalın ARKASINDA
                kalıyordu; host dışında ve sonra render edildiğinden artık her zaman
                modalların üstünde görünür. toastConfig yalnız
                react-native-toast-message + View kullanır, Paper context'ine
                ihtiyacı yok. */}
            <Toast config={toastConfig} />
            {/* Idle kilit / geri sayım / auto-logout — Toast ile AYNI slotta (modal
                katmanının üstünde). Kendi PaperProvider'ı ile sarılı ki kilit ekranı
                Paper bileşenlerini + kendi Portal.Host'unu kullanabilsin.
                absoluteFill + box-none: PaperProvider'ın Portal.Host'u flex:1 olduğu
                için düz sibling bırakılırsa ana app ile ekranı BÖLERdi; mutlak konum
                flex akışından çıkarır, box-none boşken dokunmayı ana app'e geçirir (kilitliyken
                LockScreen kendi dokunmasını yutar). */}
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              <PaperProvider theme={theme}>
                {/* ⚠️ KİLİT KATMANININ KENDİ PORTAL KATMANI — süs değil.
                    LockScreen, LoginScreen'i `lock` prop'uyla çizer ve orada
                    "sunucu adresi" sheet'i (ServerAddressSheet → AppModal)
                    açılabilir. Kapsam olmadan o modal KÖK host'a düşerdi; kök
                    host kilit katmanının ALTINDA olduğu için sheet kilit
                    ekranının ARKASINDA kalır, yanlış IP girmiş operatör
                    ayarlara hiç ulaşamazdı. Paper döneminde bu işi buradaki
                    ikinci PaperProvider'ın kendi Portal.Host'u görüyordu. */}
                <SimplePortalScope>
                  <IdleLockGate />
                </SimplePortalScope>
              </PaperProvider>
            </View>
            {/* Uzaktan güncelleme kapısı — EN ÜST katman, kilit katmanından da
                SONRA. Yenileme örtüsü her şeyin üstünde görünmeli: `reloadAsync`
                uygulamayı aniden yeniden başlatır ve altta kalan bir örtü,
                operatörün bunu çökme sanmasını engelleyemez. Kayıt yokken
                hiçbir şey çizmez (null döner). */}
            <UpdateGate />
          </View>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
