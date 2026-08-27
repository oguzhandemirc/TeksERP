import React, { useEffect } from 'react';
import { markLinkSuspect } from '../services/hal/btClassic.transport';
import { AppState, View, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { useDeviceStore } from '../store/deviceStore';
import { useBaseUrlStore } from '../store/baseUrlStore';
import { useDeviceSettingsStore } from '../store/deviceSettingsStore';
import { useSessionStore } from '../store/sessionStore';
import { setUnauthorizedHandler, setWorkSessionRequiredHandler } from '../services/api';
import { nudgeOutbox, clearUserScopedQueries } from '../offline/sessionSwitch';
import { deviceService } from '../services/device.service';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { usePermissions } from '../hooks/usePermission';
import LoginScreen from '../screens/Auth/LoginScreen';
import AwaitingAssignmentScreen from '../screens/Auth/AwaitingAssignmentScreen';
import NoAccessScreen from '../screens/Common/NoAccessScreen';
import SettingsScreen from '../screens/Common/SettingsScreen';
import ServerSettingsScreen from '../screens/Common/settings/ServerSettingsScreen';
import PlaceHardwareScreen from '../screens/Common/settings/PlaceHardwareScreen';
import ScannerSettingsScreen from '../screens/Common/settings/ScannerSettingsScreen';
import UpdateSettingsScreen from '../screens/Common/settings/UpdateSettingsScreen';
import { SurumNotlariScreen } from '../screens/Common/settings/SurumNotlariScreen';
import WorkPreferencesScreen from '../screens/Common/settings/WorkPreferencesScreen';
import DevicePairingScreen from '../screens/Common/DevicePairingScreen';
import MainNavigator from './MainNavigator';
import { rootNavigationRef } from './navigationRef';
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
  const { hasAnyMobileScreen } = usePermissions();

  // Cihaz onayı/ataması zorunlu mu? Public gate (login öncesi). false (default) →
  // pasif; tablet onaysız da Login'e geçer (atıf null). Hata/erişimsizlikte false.
  const assignmentRequired =
    useQuery({
      queryKey: ['device', 'assignment-required'],
      queryFn: deviceService.getAssignmentRequired,
      staleTime: 5 * 60 * 1000,
    }).data ?? false;

  // Atama durumu — SÜREKLİ poll'lanır (APPROVED olduktan SONRA da). Böylece cihaz
  // sonradan panelden pasifleştirilir/silinir/onayı geri alınırsa tablet bunu fark
  // eder ve "Cihaz Atama Bekliyor" ekranına KENDİLİĞİNDEN döner (operatör Ayarlar'dan
  // "kendini bildir" aramaz). Onaylıyken seyrek (45s — sadece durum kaybını yakala;
  // pasifleştirme zaten anlık değil, 45s çözünürlük yeterli, taban poll yükü ~3x düşer),
  // beklerken sık (5s — onay anında hızlı geç).
  const assignment = useQuery({
    queryKey: ['device', 'status'],
    queryFn: deviceService.getStatus,
    enabled: assignmentRequired,
    // Hata halinde 30sn'e geriler — ölü/boğulmuş sunucuda sık poll askıda soket
    // biriktirip yükü büyütmesin; sunucu toparlanınca normal tempoya döner.
    refetchInterval: (q) =>
      q.state.fetchFailureCount > 0
        ? 30_000
        : q.state.data?.status === 'APPROVED'
          ? 45_000
          : 5_000,
  }).data;

  useEffect(() => {
    let disposed = false;
    let announceRetry: ReturnType<typeof setTimeout> | null = null;

    // Tablet kendini bildirir (bilinmiyorsa PENDING kaydı açılır → admin onaylar).
    // SAHA BUG'ı (test #1): tek atışlık announce açılış yarışlarında sessizce
    // düşüyordu — (a) initBaseUrl beklenmeden ateşleniyordu (istek yanlış/varsayılan
    // adrese gidebiliyor), (b) Wi-Fi/sunucu henüz hazır değilse hata yutulup bir
    // daha DENENMİYORDU, (c) Android'de "kapat/aç" çoğu zaman resume'dur — açılış
    // kodu hiç çalışmaz. Artık: baseUrl yüklendikten SONRA, başarılı olana dek
    // 5 sn arayla dener + uygulama öne her gelişinde tazelenir (kalıcı silinen
    // cihaz, uygulama açılınca kendiliğinden yeniden PENDING listesine düşer).
    // Ardışık hata sayısına göre 5sn→60sn üstel geri çekilme: ölü sunucuda
    // sabit 5sn'lik denemeler askıda soket biriktirip yükü büyütmesin.
    // Başarıda ve uygulama öne gelince sayaç sıfırlanır (hızlı toparlanma).
    let announceFailures = 0;
    const announce = async () => {
      if (disposed) return;
      try {
        const deviceId = await getOrCreateDeviceId();
        await deviceService.announce({ deviceId });
        announceFailures = 0;
      } catch {
        announceFailures += 1;
        const delay = Math.min(5000 * 2 ** Math.min(announceFailures - 1, 4), 60_000);
        if (!disposed) announceRetry = setTimeout(() => void announce(), delay);
      }
    };

    void initDevice();
    void initDeviceSettings();
    loadStoredAuth();
    void initBaseUrl().then(() => void announce());

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (announceRetry) {
          clearTimeout(announceRetry);
          announceRetry = null;
        }
        announceFailures = 0; // öne geliş = taze başlangıç, backoff sıfırlanır
        void announce();
      } else {
        // Arka planda Android RFCOMM soketini koparabilir ama HC-06 köprüsü bunu
        // her zaman görmez → `isDeviceConnected` "bağlı" der, yazma ÖLÜ sokete
        // gider ve etiket çıkmaz (2026-08-17 Tambur saha vakası). Burada yalnız
        // İŞARETLERİZ; temizlik bir sonraki baskıda, tek sefer yapılır.
        markLinkSuspect();
      }
    });

    setUnauthorizedHandler(() => {
      // 401 → sadece kullanıcıyı çıkar, atamayı koru. Çalışma oturumu state'i de
      // sıfırlanır — yeni giriş taze GET current ile yükler (sunucudaki açık oturum
      // yeni girişte NEW_LOGIN ile devrolur, kaybolmaz).
      useSessionStore.getState().reset();
      void clearAuth();
      // İstemsiz çıkışta da kullanıcıya-özel cache düşmeli (paylaşımlı tablette
      // sonraki operatör A'nın listelerini/tercihlerini görmesin) — normal
      // logout'la aynı seçici temizlik: bootstrap + outbox korunur.
      clearUserScopedQueries();
    });
    // 409 WORK_SESSION_REQUIRED (idle/devralındı/panelden kapatıldı) → yerel oturumu
    // düşür; SessionGate yer onayını yeniden ister (login'e ATMAZ).
    setWorkSessionRequiredHandler(() => {
      useSessionStore.getState().clearActive();
    });

    return () => {
      disposed = true;
      if (announceRetry) clearTimeout(announceRetry);
      appStateSub.remove();
    };
  }, []);

  // Girişten hemen sonra bekletilen outbox dürtülür — logout tavanında paused
  // kalan / restore edilen istasyon kayıtları taze token'la hemen akar
  // (NoAuth-bekleyenler zaten ≤15sn içinde kendiliğinden dener).
  useEffect(() => {
    if (user) nudgeOutbox();
  }, [user]);

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
    <NavigationContainer ref={rootNavigationRef}>
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
        {/* Ayarlar menüsü + alt sayfaları — hepsi sağdan kayar (menü → detay). */}
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="SettingsServer"
          component={ServerSettingsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="SettingsPlaceHardware"
          component={PlaceHardwareScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="SettingsScanner"
          component={ScannerSettingsScreen}
          options={{ animation: "slide_from_right" }}
        />
        <Stack.Screen
          name="SettingsUpdate"
          component={UpdateSettingsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="SettingsSurumNotlari"
          component={SurumNotlariScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="SettingsWorkPreferences"
          component={WorkPreferencesScreen}
          options={{ animation: "slide_from_right" }}
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
