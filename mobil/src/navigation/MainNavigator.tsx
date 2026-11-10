import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MainStackParamList } from './types';
import { useQuery } from '@tanstack/react-query';
import { useVisibleScreens } from '../hooks/useVisibleScreens';
import { usePermissions } from '../hooks/usePermission';
import { workSessionService } from '../services/workSession.service';
import { useQualityStationStore } from '../store/qualityStationStore';
import { useSessionStore } from '../store/sessionStore';
import { useDeviceSettingsStore } from '../store/deviceSettingsStore';
import { withWorkSession, type GatedScreen } from '../components/session/SessionGate';
import { isSessionScreen, screenForStation } from '../constants/stationScreens';
import ModuleSelectScreen from '../screens/Common/ModuleSelectScreen';
import LoomAlarmNotifier from '../components/alarm/LoomAlarmNotifier';
import type { MobileScreenKey } from '../types/permissions';

const Stack = createNativeStackNavigator<MainStackParamList>();

// Her modül ekranı yalnızca o ekrana navigate edildiğinde require ediliyor.
// Operatörün yetkisi olmayan ekranların modül-level kodu hiç parse edilmez.
const SCREEN_LOADERS: Record<MobileScreenKey, () => GatedScreen> = {
  KK1: () => require('../screens/Modules/KK1/KK1Screen').default,
  KursunQc: () => require('../screens/Modules/KursunQc/KursunQcScreen').default,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- tembel yükleyici deseni; aynı ekran kurşun kipi kapalı (route adı)
  KaliteKontrol: () => require('../screens/Modules/KursunQc/KursunQcScreen').default,
  Tambur: () => require('../screens/Modules/Tambur/TamburScreen').default,
  Depo: () => require('../screens/Modules/Depo/DepoScreen').default,
  TartiPaket: () => require('../screens/Modules/TartiPaket/TartiPaketScreen').default,
  Sevkiyat: () => require('../screens/Modules/Sevkiyat/SevkiyatScreen').default,
  FasonSevk: () => require('../screens/Modules/FasonSevk/FasonSevkScreen').default,
  FasonKabul: () => require('../screens/Modules/FasonKabul/FasonKabulScreen').default,
  KartelaSevk: () => require('../screens/Modules/KartelaSevk/KartelaSevkScreen').default,
  KartelaKabul: () => require('../screens/Modules/KartelaKabul/KartelaKabulScreen').default,
  IadeGirisi: () => require('../screens/Modules/IadeGirisi/IadeGirisiScreen').default,
  HizliIsEmri: () => require('../screens/Modules/HizliIsEmri/HizliIsEmriScreen').default,
  // Lazy `require` bu tablonun kalıbı (üstteki 15 satırla aynı); tavan sabit kalsın diye adlı muaf.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Dokuma: () => require('../screens/Modules/Dokuma/DokumaScreen').default,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Devere: () => require('../screens/Modules/Devere/DevereScreen').default,
  // Tembel yükleyici deseni (dosya başlığı); tavan 25'te doluydu — yeni satır tavanı yükseltmek yerine gerekçeli istisna.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- ekran yalnız navigate edilince parse edilir, statik import deseni bozar
  FasonDokuma: () => require('../screens/Modules/FasonDokuma/FasonDokumaScreen').default,
  Siparis: () => require('../screens/Modules/Siparis/SiparisScreen').default,
  Kumas: () => require('../screens/Modules/Kumas/KumasScreen').default,
  KursunDagitim: () => require('../screens/Modules/KursunDagitim/KursunDagitimScreen').default,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- tembel yükleyici deseni (dosya başlığı); ekran yalnız navigate edilince parse edilir
  Uyarilar: () => require('../screens/Modules/Uyarilar/UyarilarScreen').default,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- tembel yükleyici deseni (dosya başlığı); ekran yalnız navigate edilince parse edilir
  Muayene: () => require('../screens/Modules/Muayene/InspectionScreen').default,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- tembel yükleyici deseni (dosya başlığı); ekran yalnız navigate edilince parse edilir
  GelenBelge: () => require('../screens/Modules/GelenBelge/woCreate/WoCreateScreen').default,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- tembel yükleyici deseni (dosya başlığı); ekran yalnız navigate edilince parse edilir
  IsEmirleri: () => require('../screens/Modules/IsEmirleri/IsEmirleriScreen').default,
};

// Oturumlu ekranlar (KK1/KursunQc/Tambur/TartiPaket) SessionGate ile sarılır —
// yer onayı olmadan ekran render edilmez (fail-closed). Sarılmış bileşen modül
// kapsamında BİR KEZ üretilir (her render'da yeni tip → remount olmasın).
const GATED_COMPONENTS: Partial<Record<MobileScreenKey, GatedScreen>> = {};
function componentLoaderFor(key: MobileScreenKey): () => GatedScreen {
  if (!isSessionScreen(key)) return SCREEN_LOADERS[key];
  return () => {
    if (!GATED_COMPONENTS[key]) {
      GATED_COMPONENTS[key] = withWorkSession(key, SCREEN_LOADERS[key]);
    }
    return GATED_COMPONENTS[key]!;
  };
}

export default function MainNavigator() {
  // GÖRÜNÜR ekranlar (izin ∖ bayrağı kapalı olanlar) — kayıt da ilk rota da BUNDAN
  // türer. Ham izinle kaydetseydik bayrak kapalıyken tek ekranı Kurşun Dağıtım olan
  // kullanıcı gizlemek istediğimiz ekrana düşerdi.
  const { visibleScreens } = useVisibleScreens();
  const hasSessionScreens = visibleScreens.some((s) => isSessionScreen(s.key));
  const sessionLoaded = useSessionStore((s) => s.isLoaded);
  const active = useSessionStore((s) => s.active);
  const lastPlace = useSessionStore((s) => s.lastPlace);
  const docDeskDevice = useDeviceSettingsStore((s) => s.docDeskDevice);

  // Kalite Kontrol düğmesi yer listesinden doğar (kurşunsuz kalite istasyonu yoksa gizli).
  const canQuality = usePermissions().allowedScreens.some((s) => s.key === 'KaliteKontrol');
  const placesQ = useQuery({
    queryKey: ['work-session', 'places'],
    queryFn: workSessionService.places,
    staleTime: 5 * 60 * 1000,
    enabled: canQuality,
  });
  useEffect(() => {
    if (placesQ.data) useQualityStationStore.getState().setFromPlaces(placesQ.data);
  }, [placesQ.data]);

  // Oturum durumu login SONRASI yüklenir (auth'suz çağrı 401 üretirdi). Gezici
  // kullanıcı (oturumlu ekranı yok) hiç sorgulamaz — yer sorusu görmez.
  useEffect(() => {
    if (hasSessionScreens && !useSessionStore.getState().isLoaded) {
      void useSessionStore.getState().init();
    }
  }, [hasSessionScreens]);

  if (hasSessionScreens && !sessionLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' }}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  // Tek ekran görünüyorsa direkt o ekrana git, ModuleSelect'i atla. Sıfır görünür
  // ekran (izin var ama düzen bayrağı kapalı) da ModuleSelect'e düşer — boş grid
  // "burada bir şey yok" der; kapalı ekrana zorla girilmez.
  const soloScreen = visibleScreens.length === 1 ? visibleScreens[0] : null;
  let initialRouteName: keyof MainStackParamList = soloScreen?.key ?? 'ModuleSelect';

  // Login-sonrası kısayol: aktif oturum ya da cihazın SON yeri izinli bir oturumlu
  // ekrana işaret ediyorsa doğrudan o ekran açılır — gate tek dokunuş onayı gösterir
  // (yer = ekran; operatör ModuleSelect'te ekran aramaz).
  const hintStation = active?.station ?? lastPlace?.station;
  // K23 "Bu cihaz belge masası" (cihaz beyanı): aktif istasyon oturumu yoksa açılış İE oluştur (ekran masa kipinde açılır).
  if (docDeskDevice && !active && visibleScreens.some((s) => s.key === 'GelenBelge')) initialRouteName = 'GelenBelge';
  else {
    const target = screenForStation(hintStation);
    if (target && visibleScreens.some((s) => s.key === target)) initialRouteName = target;
  }

  return (
    <>
    {/* Tezgah alarmı bildiricisi — erişimi (izin + bayrak) olmayan kullanıcıda hiçbir şey yapmaz. */}
    <LoomAlarmNotifier />
    <Stack.Navigator
      initialRouteName={initialRouteName}
      // Modüle girerken sağdan kayar, geri dönerken geri kayar — fade yerine
      // uzamsal hiyerarşi (ModuleSelect = ana sayfa, istasyon = üstüne push).
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: 260,
      }}
    >
      {!soloScreen && (
        // Ana sayfaya dönüş yumuşak fade ile (kayma değil) — "üst seviye" hissi.
        <Stack.Screen
          name="ModuleSelect"
          component={ModuleSelectScreen}
          options={{ animation: 'fade' }}
        />
      )}
      {visibleScreens.map((s) => (
        <Stack.Screen key={s.key} name={s.key} getComponent={componentLoaderFor(s.key)} />
      ))}
      {/* Alt sayfalar — Tartı/Paket & Sevkiyat'tan push edilir (modül değil, yetki-bağımsız). */}
      <Stack.Screen
        name="SevkiyatGecmisi"
        getComponent={() => require('../screens/Modules/Sevkiyat/SevkiyatGecmisiScreen').default}
      />
      <Stack.Screen
        name="SevkiyatDetay"
        getComponent={() => require('../screens/Modules/Sevkiyat/SevkiyatDetayScreen').default}
      />
      <Stack.Screen
        name="Paketleme"
        getComponent={() => require('../screens/Modules/TartiPaket/PaketlemeScreen').default}
      />
      <Stack.Screen
        name="CuvalDuzelt"
        getComponent={() => require('../screens/Modules/TartiPaket/CuvalDuzeltScreen').default}
      />
      <Stack.Screen
        name="CuvalsizSevk"
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- tembel yükleyici deseni
        getComponent={() => require('../screens/Modules/TartiPaket/CuvalsizSevkScreen').default}
      />
      <Stack.Screen
        name="SevkCariSec"
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- tembel yükleyici deseni
        getComponent={() => require('../screens/Modules/Sevkiyat/SevkCariSecScreen').default}
      />
      <Stack.Screen
        name="SevkOkut"
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- tembel yükleyici deseni
        getComponent={() => require('../screens/Modules/Sevkiyat/SevkOkutScreen').default}
      />
      <Stack.Screen
        name="HizliSiparis"
        getComponent={() => require('../screens/Modules/TartiPaket/HizliSiparisScreen').default}
      />
      <Stack.Screen
        name="KartelaSevkGecmisi"
        getComponent={() => require('../screens/Modules/KartelaSevk/KartelaSevkGecmisiScreen').default}
      />
      <Stack.Screen
        name="KartelaKabulGecmisi"
        getComponent={() => require('../screens/Modules/KartelaKabul/KartelaKabulGecmisiScreen').default}
      />
      <Stack.Screen
        name="FasonSevkGecmisi"
        getComponent={() => require('../screens/Modules/FasonSevk/FasonSevkGecmisiScreen').default}
      />
      <Stack.Screen
        name="IadeGecmisi"
        getComponent={() => require('../screens/Modules/IadeGirisi/IadeGecmisiScreen').default}
      />
      {/* Tezgah alarmı sayfası — Uyarılar / Tezgah şeridi / bildirim (derin bağlantı); veri kapısı sunucuda (izin). */}
      <Stack.Screen
        name="UyariDetay"
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- tembel yükleyici deseni
        getComponent={() => require('../screens/Modules/Uyarilar/UyariDetayScreen').default}
      />
    </Stack.Navigator>
    </>
  );
}
