import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Keyboard,
  useWindowDimensions,
  TextInput as RNTextInput,
} from 'react-native';
import {
  Text,
  Button,
  ActivityIndicator,
  Surface,
  IconButton,
  Icon,
  TouchableRipple,
  Switch,
  TextInput as PaperTextInput,
} from 'react-native-paper';
import Animated, {
  FadeInUp,
  FadeOutUp,
  Easing,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
} from 'react-native-reanimated';
import {
  KeyboardAwareScrollView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
  onlineManager,
} from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import AppModal from '../../../components/AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import dayjs from 'dayjs';

import ScreenChrome from '../../../components/ScreenChrome';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import {
  DUPLICATE_CHOICE_SAME,
  DUPLICATE_CHOICE_NEW,
  type DuplicateEntryChoice,
} from '../../../constants/duplicateEntryChoice';
import RollCancelModal, {
  rollCancelStyles,
} from '../../../components/RollCancelModal';
import NumpadInput from '../../../components/NumpadInput';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import { useTruncationWarning } from '../../../hooks/useTruncationWarning';
import {
  useRawWidthEnabled,
  useKk1WeightEntryEnabled,
  useKk1OnlineOnlyEnabled,
  useKk1HistoryAllEntriesEnabled,
  useKk1LabelScanVerifyEnabled,
} from '../../../hooks/useFeatureFlags';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { NumpadHost, useOptionalNumpadContext } from '../../../components/NumpadProvider';
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh, type ManualRefresh } from '../../../hooks/useManualRefresh';
import { LabelPrinter } from '../../../components/LabelPrinter';
import { isWorkSessionLost } from '../../../services/api';
import { sessionBucketKey, useSessionEntriesStore } from '../../../store/sessionEntriesStore';
import { useSessionStore } from '../../../store/sessionStore';
import { useAuthStore } from '../../../store/authStore';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { itemService } from '../../../services/item.service';
import {
  rollService,
  InitialEntryRequest,
  type RollCancelPreview,
} from '../../../services/roll.service';
import {
  useMachinePeripherals,
  primaryMeterFor,
} from '../../../hooks/useMachinePeripherals';
import { buildIoFromPeripheral } from '../../../hooks/usePeripheralIO';
import { qualityGradeService } from '../../../services/qualityGrade.service';
import { STATION_MUT } from '../../../offline/mutations';
import {
  IDLE_ATTEMPT,
  decideSubmit,
  entryFingerprint,
  freshEntryIdentity,
  isAmbiguousFailure,
  isRetrying,
  onAttemptDetached,
  onAttemptFailed,
  onAttemptSettled,
  onAttemptStarted,
  onAttemptSucceeded,
  onCollisionResolvedAsNew,
  shouldReleaseInFlight,
  tokenForSubmit,
  type EntryAttemptState,
} from '../../../offline/entryAttempt';
import { useIsOnline, useOfflineReason } from '../../../offline/hooks';
// `onMutate` içinde HOOK okunamaz (render dışı) — modül seviyesindeki anlık
// okuyucu kullanılır; `useOfflineReason` yalnız render için.
import { offlineReason, revalidateServer } from '../../../offline/serverReachability';
import RollFilterBar from '../../../components/filters/RollFilterBar';
import {
  EMPTY_ROLL_FILTER,
  buildRollQueryParams,
  filterQueryKey,
  forcedCreatorFilter,
  type RollHistoryFilterState,
} from '../../../components/filters/rollHistoryFilter';
import { usePermissions } from '../../../hooks/usePermission';
import SyncStatusChip from '../../../components/SyncStatusChip';
import {
  usePrintQueue,
  requeueOnReconnect,
  type PrintResult,
} from '../../../offline/printQueue';
import { signalScan } from '../../../services/scanFeedback';
import type { ScanFlash } from '../../../components/BarcodeScannerView';
import ConfirmDialog from '../../../components/ConfirmDialog';
import {
  AnimatedEntrance,
  SkeletonList,
  AnimatedCounter,
  Pulse,
} from '../../../components/motion';
import { colors, radius, spacing } from '../../../theme';
import type { Item, QualityGrade, Roll } from '../../../types/models';

const RECENT_PAGE_SIZE = 6;
const HISTORY_PAGE_SIZE = 20;

interface FormState {
  itemId: string;
  itemLabel: string;
  /** EN (cm) — kaydetler ARASI korunur (aynı en toptan onlarca seri giriş). */
  width: string;
  qualityGrade: string;
}

const EMPTY_FORM: FormState = {
  itemId: '',
  itemLabel: '',
  width: '',
  qualityGrade: '',
};

// ── "Yeni Desen" ad girişi (inline, "Desen Seç" picker'ı içinde) ─────────────
// Yalnız `mobile:kk1-desen` yetkili operatöre gösterilir (parent gate eder).
// YALNIZ ad girer → backend FABRIC/STK-/MT/pendingReview üretir. Çevrimiçi-only:
// plain useMutation (global default networkMode 'always') → offline'da KUYRUĞA
// ALINMAZ, anında ağ hatası verir; ayrıca `disabled` (=!isOnline) ile kilitli.
// Başarıda onCreated ile yeni desen otomatik seçilir + liste tazelenir.
//
// TETİK BURADA DEĞİL: eskiden bu bileşenin içinde bir "Yeni Desen" outlined
// butonu vardı; artık tetik picker listesinin ilk hücresindeki mor aksiyon
// kartıdır (PickerModal `leadingAction`). Bu bileşen sadece o karta basılınca
// açılan kontrollü ad girişi satırıdır → görünürlüğü parent yönetir.
function QuickAddDesenRow({
  disabled,
  onCreated,
  onCancel,
}: {
  disabled: boolean;
  onCreated: (item: Item) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');

  const mutation = useMutation({
    mutationFn: (n: string) => itemService.quickCreateFabric(n),
    onSuccess: (res) => {
      if (!res.data) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: `Desen eklendi: ${res.data.name}` });
      setName('');
      onCreated(res.data);
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // api.ts backend TR mesajını err.message'a koyar (409 mükerrer vb.).
      Toast.show({ type: 'error', text1: 'Desen oluşturulamadı', text2: err.message });
    },
  });

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed || mutation.isPending || disabled) return;
    mutation.mutate(trimmed);
  };

  return (
    <View style={quickAddStyles.row}>
      <PaperTextInput
        mode="outlined"
        dense
        autoFocus
        placeholder="Yeni desen adı"
        value={name}
        onChangeText={setName}
        onSubmitEditing={submit}
        returnKeyType="done"
        maxLength={100}
        style={quickAddStyles.input}
      />
      <Button
        mode="contained"
        onPress={submit}
        loading={mutation.isPending}
        disabled={!trimmed || mutation.isPending || disabled}
      >
        Ekle
      </Button>
      <Button
        mode="text"
        onPress={() => {
          setName('');
          onCancel();
        }}
        disabled={mutation.isPending}
      >
        Vazgeç
      </Button>
    </View>
  );
}

const quickAddStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { flex: 1, backgroundColor: '#fff', height: 44 },
});

// Koyu header'da etiketli pill aksiyon (Tambur ile aynı stil) — tablette sağ
// kolon başlığındaki butonları yukarı taşımak için.
// `spinning` true iken ikon kesintisiz döner (Yenile için fetch sırasında).
function HeaderChip({
  icon,
  label,
  onPress,
  spinning,
  fill,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  spinning?: boolean;
  /** true: telefon 2. katında satırı YARI YARIYA paylaşır (flex:1 + ortalı). */
  fill?: boolean;
}) {
  const rot = useSharedValue(0);
  const wasSpinning = useRef(false);
  useEffect(() => {
    if (spinning) {
      wasSpinning.current = true;
      rot.value = withRepeat(
        withTiming(1, { duration: 800, easing: Easing.linear }),
        -1,
        false,
      );
    } else if (wasSpinning.current) {
      wasSpinning.current = false;
      // Mevcut turu tamamla, sonra sıfırla — ortada kesilme yok
      const remaining = Math.max(0, 1 - rot.value);
      rot.value = withTiming(1, {
        duration: Math.max(80, remaining * 800),
        easing: Easing.linear,
      }, (finished) => {
        'worklet';
        if (finished) rot.value = 0;
      });
    }
  }, [spinning, rot]);
  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value * 360}deg` }],
  }));

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <TouchableRipple
      onPress={handlePress}
      style={[styles.headerChip, fill && styles.headerChipFill]}
      borderless
      rippleColor="rgba(255,255,255,0.2)"
      accessibilityLabel={label}
    >
      <View style={[styles.headerChipInner, fill && styles.headerChipInnerFill]}>
        <Animated.View style={spinStyle}>
          <Icon source={icon} size={18} color="#fff" />
        </Animated.View>
        <Text style={styles.headerChipText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </TouchableRipple>
  );
}

export default function KK1Screen() {
  // Telefon ekranında (kısa kenar < 600px) landscape kilidini kaldır —
  // kullanıcı portrait/landscape arasında serbestçe dönebilsin. Tabletlerde
  // önceki gibi landscape sabit.
  const device = useDeviceType();
  const compact = device === 'phone';
  useLandscapeLock(!compact);

  // Bulunulan makine adı — telefonda başlık subtitle'ı olarak gösterilir (üst
  // barda ⚙ çip yerine). SessionGate sayesinde oturum daima RAW_QC ile eşleşir.
  const activeSession = useSessionStore((s) => s.active);
  const machineName =
    activeSession?.machine?.name ||
    activeSession?.machine?.code ||
    activeSession?.station?.name ||
    undefined;

  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const isOnline = useIsOnline();
  /** Çevrimdışıysak SEBEBİ — 'link' (ağ yok) ile 'server' (sunucu ölü) uçuş
   *  kimliği açısından farklı davranır; bkz. aşağıdaki detach effect'i. */
  const offlineWhy = useOfflineReason();
  /** "Şimdi dene" — çevrimdışı kilidinin elle açılan kapısı (bkz. bant yorumu). */
  const [retryingLink, setRetryingLink] = useState(false);
  const handleRetryConnection = useCallback(async () => {
    setRetryingLink(true);
    try {
      const ok = await revalidateServer();
      Toast.show(
        ok
          ? { type: 'success', text1: 'Bağlantı geri geldi', text2: 'Kayıt girebilirsiniz.' }
          : {
              type: 'error',
              text1: 'Hâlâ ulaşılamıyor',
              // Sonraki adımı SÖYLE: sunucu adresi tabletten değiştirilebiliyor
              // ve saha vakalarının çoğu (IP değişimi) tam olarak orada çözülüyor.
              text2: 'Sunucu kapalı olabilir; adres doğruysa yetkiliye haber verin.',
            },
      );
    } finally {
      setRetryingLink(false);
    }
  }, []);
  // "Yeni Desen" yalnız seçili operatörlere (mobile:kk1-desen; mobile:*/admin:* devralır).
  const { has } = usePermissions();
  const canAddDesen = has('mobile:kk1-desen');
  // Desen picker'ındaki mor aksiyon kartına basıldı mı → ad girişi satırı açık.
  // Picker kapanınca sıfırlanır (onDismiss), böylece bir dahaki açılışta yine
  // sade liste görünür.
  const [desenAddOpen, setDesenAddOpen] = useState(false);
  // Ham kumaşın eni önemsiz → en girişi feature flag'e bağlı (default kapalı).
  // Kapalıyken alan tamamen gizlidir (elle açma yok); yalnızca flag açıkken görünür.
  const rawWidthEnabled = useRawWidthEnabled();
  const weightEntryEnabled = useKk1WeightEntryEnabled();
  // ONLINE-ONLY REJİM (2026-08-11 saha kararı, bayrak varsayılan KAPALI):
  // açıkken KK1 çevrimdışıyken kayıt ALMAZ — form kilitlenir, sebep bandı çıkar
  // ve kayıt asla offline kuyruğa düşmez (mutation networkMode 'always').
  // Gerekçe: kesintide kuyruğa giren kayıtların etiketi sonradan basılamayınca
  // operatör aynı topu YENİDEN giriyordu (07.08 vakası — 4 top ikizlendi).
  const onlineOnly = useKk1OnlineOnlyEnabled();
  // SCAN-BACK (print & verify, bayrak varsayılan KAPALI — kapalıyken ekranda
  // HİÇBİR iz yok): basılan etiket GERİ OKUTULMADAN yeni top girilemez.
  // "Etiket çıktı" sinyali yazılımdan alınamaz (BT yazıcı onay döndürmez) —
  // tek güvenilir kanıt kâğıttaki barkodun tarayıcıdan geçmesidir.
  const scanVerifyEnabled = useKk1LabelScanVerifyEnabled();
  // Otomatik metraj okuması için bu makineye atanmış METER cihaz(lar)ı (HAL).
  // Tablet hangi makineye atanmışsa onun cihazları gelir (backend for-device).
  const meterPeripherals = useMachinePeripherals('METER');
  // Telefon dikey: son kayıtlar tetiği header'a taşınır, body'deki buton gizlenir.
  const { width: winW, height: winH } = useWindowDimensions();
  const portraitPhone = compact && winH > winW;

  // Klavye (yalnız telefon) — "Kaydet ve Etiket Bas" footer'ını klavye açılınca
  // YUMUŞAKÇA üstüne kaldır, kapanınca geri indir. useReanimatedKeyboardAnimation
  // (react-native-keyboard-controller) klavyeyle akan bir shared value verir →
  // uygulama genelinde TEK klavye sistemi (App.tsx KeyboardProvider); eski reanimated
  // useAnimatedKeyboard rakip 2. sistemdi, kaldırıldı. DİKKAT: bu hook'un height'ı
  // 0 → -klavyeYüksekliği akar (NEGATİF; eski useAnimatedKeyboard pozitifti) —
  // pozitife çevirip kullan. Footer absolute olduğundan `bottom`'u animasyonluyoruz
  // (edge-to-edge'de pencere küçülmüyor; insets.bottom ScreenChrome içeriğinde
  // zaten uygulanıyor → onu düş).
  const keyboard = useReanimatedKeyboardAnimation();
  const footerAnimStyle = useAnimatedStyle(() => ({
    bottom: Math.max(0, -keyboard.height.value - insets.bottom),
  }));

  // Compact'ta sağ panel drawer'a taşınır.
  const [recentsDrawerOpen, setRecentsDrawerOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pickerOpen, setPickerOpen] = useState<'item' | null>(null);
  const [pulling, setPulling] = useState(false);
  // Manuel mod: makine arızasında operatör mt + kg'yi elle girer. Varsayılan
  // kapalı (normalde değerler "Kaydet"e basınca makineden çekilir).
  // CİHAZDA KALICI: metre makinesi arızalı bir istasyonda operatör her top
  // girişinde anahtarı yeniden açmak zorunda kalmasın — tercih son bıraktığı
  // gibi geri gelir (deviceSettingsStore; oturum değil CİHAZ ömürlü).
  const manualMode = useDeviceSettingsStore((s) => s.kk1ManualEntry);
  const setManualMode = useDeviceSettingsStore((s) => s.setKk1ManualEntry);
  const [manualQty, setManualQty] = useState('');
  const [manualWeight, setManualWeight] = useState('');
  // "Bu oturumda girilenler" — GİRİŞ OTURUMU ömürlü store (sessionEntriesStore):
  // Bölüm Değiş/aynı bölüme dönüş, makine-istasyon değişimi, araya başka bölüme
  // bakmak listeyi SIFIRLAMAZ; yalnız çıkış/operatör değişimi temizler.
  // Sayaç = onaylı kayıtlar + gönderimde bekleyenler (çevrimdışı dahil).
  // Kova = tür + istasyon kimliği: ikinci ham giriş istasyonu açıldığında
  // listeler karışmasın (sessionBucketKey açıklaması store'da).
  const activeStationId = useSessionStore((st) => st.active?.stationId ?? null);
  const bucketKey = sessionBucketKey('RAW_QC', activeStationId);
  const sessionBucket = useSessionEntriesStore((s) => s.buckets[bucketKey]);
  const sessionRolls = sessionBucket?.rolls ?? [];
  const sessionCount = sessionRolls.length + (sessionBucket?.pending ?? 0);
  // Kaydet sonrası kısa "✓ Kaydedildi" başarı flaşı (CTA).
  const [justSaved, setJustSaved] = useState(false);
  // İDEMPOTENCY (2026-08-03 saha vakası): mantıksal kayıt denemesinin durumu.
  // `idle` → basış yeni bir topu anlatır (taze token); `failed` → basış bilinen
  // başarısız denemenin TEKRARIDIR (aynı token) ve CTA "Tekrar Dene"ye döner.
  // Sözleşmenin tamamı + neden "yapışkan tek ref" olmadığı: offline/entryAttempt.ts
  const [attempt, setAttempt] = useState<EntryAttemptState>(IDLE_ATTEMPT);
  // Mutation geri çağrıları `mutate()` ANINDAKİ closure'ı taşır; uçuş penceresi
  // 47 sn'ye kadar sürebildiği için o closure'daki `attempt` bayat olur. Okuma
  // ref'ten, yazma fonksiyonel `setAttempt` ile. (Baskı tarafındaki aynı sınıf
  // sorun store'a taşınarak çözüldü — `usePrintQueue.resolveActive`.)
  const attemptRef = useRef<EntryAttemptState>(attempt);
  useEffect(() => {
    attemptRef.current = attempt;
  }, [attempt]);
  // Backend'in İKİ 409'u da aynı soruyu sorar: "aradığın top zaten var mı?"
  //  • CLIENT_TOKEN_COLLISION → önceki deneme aslında COMMIT olmuştu
  //  • POSSIBLE_DUPLICATE     → sunucu tuzağı "az önce birebir aynısı girildi" dedi
  // İkisinde de karar operatörün: var olanın etiketini bas, ya da "bu ayrı bir
  // top" deyip devam et. Tek modal, iki metin.
  const [conflict, setConflict] = useState<{
    kind: 'TOKEN_COLLISION' | 'POSSIBLE_DUPLICATE';
    barcode: string | null;
    vars: InitialEntryRequest;
  } | null>(null);
  /** Ortada tekrarlanmayı bekleyen düşmüş bir deneme var mı (CTA'yı değiştirir). */
  const retrying = isRetrying(attempt);
  /** ONLINE bir deneme uçuşta mı — CTA "Gönderiliyor…" der (B4: dürüst geri
   *  bildirim). Sağlıklı ağda ~300 ms sürer ve görünmez; yalnız gerçekten bozuk
   *  anlarda belirir ve orada zaten kaydedilecek bir şey yoktur. */
  const sending = attempt.inFlight !== null;
  // Düşen denemenin payload'ı — "Tekrar Dene" formu/makineyi YENİDEN OKUMAZ,
  // bunu birebir gönderir. Otomatik modda yeniden okumak metrajı değiştirir
  // (kumaş bu arada oynamış olabilir) → aynı token + farklı payload = gereksiz
  // 409 çakışması. Aynı deneme = aynı bayt.
  const failedVarsRef = useRef<InitialEntryRequest | null>(null);
  // Listede yeni beliren topu kısa süre vurgulamak için.
  const [flashRollId, setFlashRollId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Etiket basımı — KALICI sıralı kuyruk (`offline/printQueue.ts`: zustand +
  // AsyncStorage). Eskiden ekran state'iydi ve uygulama kapanınca "Başarısız"
  // listesi SİLİNİYORDU (07.08 vakası: kesintide biriken 4 etiketin izi kayboldu,
  // operatör topları yeniden girdi → stokta hayalet toplar). Bekleyen + başarısız
  // artık diskte yaşar; POMPA (aşağıdaki effect) yalnız bu ekran mount'ken
  // çalışır — yazıcı çalışma oturumundan çözüldüğü için başka ekranda basmaya
  // kalkmak for-session fail-closed sözleşmesini bozardı.
  const printJobs = usePrintQueue((s) => s.jobs);
  const printActiveId = usePrintQueue((s) => s.activeId);
  const printHydrated = usePrintQueue((s) => s.hydrated);
  // Scan-back bekleyenleri — bayrak KAPALIYKEN liste boş kalır (addVerify hiç
  // çağrılmaz) ve `verifyPending` false olduğu için ekranda tek öğe çizilmez.
  const verifies = usePrintQueue((s) => s.verifies);
  const verifyPending = scanVerifyEnabled && verifies.length > 0;
  const [verifyScanOpen, setVerifyScanOpen] = useState(false);
  // useMemo: 3000+ satırlık ekranda her render'da taze dizi kimliği üretmek
  // alt bileşen memoizasyonunu boşa düşürür (inceleme bulgusu — perf).
  const activePrintRoll = useMemo(
    () => printJobs.find((j) => j.roll.id === printActiveId)?.roll ?? null,
    [printJobs, printActiveId],
  );
  const printQueue = useMemo(
    () =>
      printJobs
        .filter((j) => !j.error && j.roll.id !== printActiveId)
        .map((j) => j.roll),
    [printJobs, printActiveId],
  );
  const failedPrints = useMemo(
    () =>
      printJobs.filter((j) => j.error).map((j) => ({ roll: j.roll, error: j.error! })),
    [printJobs],
  );

  // Diskten yükle (idempotent) — restart sonrası bekleyen/başarısız işler geri gelir.
  useEffect(() => {
    void usePrintQueue.getState().hydrate();
  }, []);

  // POMPA: aktif iş yok + bekleyen var + ONLINE → sıradakini başlat.
  // OFFLINE: LabelPrinter etiket içeriğini backend'den çekiyor → offline basamaz.
  // Kuyruk İLERLETİLMEZ; ağ gelince effect yeniden koşar, sırayla basılır.
  useEffect(() => {
    if (isOnline && printHydrated && printActiveId === null) {
      usePrintQueue.getState().startNext();
    }
  }, [isOnline, printHydrated, printActiveId, printJobs]);

  // AĞ DÖNÜŞÜ: ağ kaynaklı düşen işler (retryable) otomatik yeniden kuyruğa
  // alınır — tavan PRINT_AUTO_RETRY_MAX (flap eden sunucuda osilasyon kesici).
  // BT/yapılandırma hataları burada DÖNMEZ; onlar ağla düzelmez, elle
  // "Tekrar Dene" ister. ⚠️ KENAR tetikli (requeueOnReconnect, modül-ömürlü
  // kurma bayrağı): doğrudan requeueRetryable çağrılsaydı HER ekran ziyareti
  // bir otomatik deneme hakkı yakardı — kalıcı 5xx'te 3 giriş-çıkış hakları
  // bitirir, operatör "kendiliğinden basılır"ı boşuna beklerdi (inceleme bulgusu).
  useEffect(() => {
    requeueOnReconnect(isOnline, printHydrated);
  }, [isOnline, printHydrated]);

  // Aynı top zaten bekliyorsa store dedup eder (çift dokunuş 2 kâğıt basmaz).
  const enqueuePrint = useCallback((roll: Roll) => {
    usePrintQueue.getState().enqueue(roll);
  }, []);

  // onDone güvenlik ağı — onResult ÇAĞRILMAYAN yol (barkodsuz top erken dönüşü)
  // aktif işi askıda bırakmasın. onResult zaten çözdüyse store no-op yapar.
  const handlePrintDone = useCallback((printed: Roll) => {
    usePrintQueue.getState().finishActive(printed.id);
  }, []);

  // ── Başarısız baskılar + kuyruk görünümü ──
  // BT hatası / zaman aşımında etiket KAYBOLMAZ: top "başarısızlar"a düşer,
  // kuyruk çipinden / footer'daki kırmızı banttan yeniden sıraya alınır.
  // İptal (yazdırma diyaloğu kapatıldı) hata SAYILMAZ.
  const [queueOpen, setQueueOpen] = useState(false);
  // "Bu oturum" rozetine dokununca oturum listesi modalı (veri sessionEntriesStore'da).
  const [sessionListOpen, setSessionListOpen] = useState(false);

  // Baskı sonucu STORE'da çözülür — aktif işi o bilir (bayat closure derdi yok).
  const handlePrintResult = useCallback(
    (r: PrintResult) => {
      const res = usePrintQueue.getState().resolveActive(r);
      // SCAN-BACK: gerçek baskı başarısı okutma borcu doğurur (yalnız bayrak
      // açıkken — kapalıyken addVerify hiç çağrılmaz, liste hep boş).
      if (res.printedRoll && scanVerifyEnabled) {
        usePrintQueue.getState().addVerify(res.printedRoll);
      }
      // ONLINE-ONLY: baskı hatası köşede çip olarak bekleyemez — kuyruk
      // görünümü KENDİLİĞİNDEN açılır ve operatör "Tekrar Dene / çıkar"
      // kararını vermeden geçemez. İSTİSNA: OTOMATİK yeniden denemenin düşüşü
      // modalı tekrar AÇMAZ (operatör tetiklemedi, spam olur — çip + bant
      // zaten kırmızı). Kuyruklu rejimde davranış eskisi gibi: çip/bant yanar.
      if (res.failed && onlineOnly && !res.wasAuto) setQueueOpen(true);
    },
    [onlineOnly, scanVerifyEnabled],
  );
  // Scan-back okutması: kod listedeki bir etiketle eşleşirse borç düşer.
  // Geri bildirim ORTAK katmandan (mobil CLAUDE.md sözleşmesi): ses+titreşim
  // `signalScan` (ekran Haptics'i DOĞRUDAN çağırmaz), görsel sonuç tarayıcı
  // AÇIKKEN ekran-içi flash'tır — operatörün gözü kadrajda, arkada kalan toast
  // görülmez ("Fason Sevk'te kaybolan toast" vakasının birebir dersi).
  const verifyFlashSeq = useRef(0);
  const [verifyFlash, setVerifyFlash] = useState<ScanFlash | null>(null);
  const handleVerifyScan = useCallback((code: string) => {
    const result = usePrintQueue.getState().confirmVerify(code);
    if (result === 'ok') {
      signalScan('accept');
      setVerifyFlash(null); // varsa eski ret bandı düşsün, yeşil tik görünsün
      // Son borç da kapandıysa tarayıcıyı kapat — kapanınca toast serbesttir.
      if (usePrintQueue.getState().verifies.length === 0) {
        setVerifyScanOpen(false);
        Toast.show({ type: 'success', text1: 'Etiketler doğrulandı ✓' });
      }
    } else {
      signalScan('reject');
      verifyFlashSeq.current += 1;
      setVerifyFlash({
        kind: 'reject',
        title: 'LİSTEDE YOK',
        detail: `${code.trim()} — çıkan kâğıttaki barkodu okutun`,
        seq: verifyFlashSeq.current,
      });
    }
  }, []);
  const retryFailedPrint = useCallback((roll: Roll) => {
    usePrintQueue.getState().retryJob(roll.id);
  }, []);
  const dismissFailedPrint = useCallback((id: string) => {
    usePrintQueue.getState().removeJob(id);
  }, []);
  const removeFromQueue = useCallback((id: string) => {
    usePrintQueue.getState().removeJob(id);
  }, []);
  // Scrap onay modal'ı — native Alert yerine kendi modalımız (alert telefon yönünü değiştiriyordu).
  const [scrapTarget, setScrapTarget] = useState<Roll | null>(null);
  // react-native-modal aynı anda iki modal'ı doğru stack edemiyor (Android Dialog
  // çakışması). Drawer / history açıkken scrap tıklanırsa hedef ref'e yazılır,
  // önce mevcut modal kapanır, onModalHide'da scrapTarget set edilir.
  const pendingScrapRef = useRef<Roll | null>(null);
  // Aynı iki-modal çakışması: drawer'dan "Tümünü Gör" → drawer kapanış
  // animasyonu bitmeden history açılırsa görünmez. Niyeti ref'e yaz, drawer
  // kapanınca (onModalHide) history'yi aç.
  const pendingHistoryRef = useRef(false);

  const widthRef = useRef<RNTextInput>(null);
  const manualQtyRef = useRef<RNTextInput>(null);
  const manualWeightRef = useRef<RNTextInput>(null);
  const recentsListRef = useRef<FlashListRef<Roll>>(null);

  // Numpad (tablet, sağ sütun): NumpadHost HER ZAMAN aktif kalır — varsayılan
  // hedef EN; manuel açıkken mt/kg'ye dokununca oraya yönlenir. blurAll artık
  // closeTarget ÇAĞIRMAZ (numpad disable olmasın); sadece native klavyeyi kapatır.
  const blurAll = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  // Manuel kapanınca (ve mount'ta) numpad varsayılan hedefi EN'e döner (tablet).
  // Operatör mt/kg'den çıkınca tuşlar yine En'i değiştirir. En girişi flag ile
  // kapalıysa odaklanacak alan yok → atla (numpad zaten render edilmez).
  useEffect(() => {
    if (!compact && !manualMode && rawWidthEnabled) {
      requestAnimationFrame(() => widthRef.current?.focus());
    }
  }, [compact, manualMode, rawWidthEnabled]);

  // NUMPAD ASLA ÖLÜ KALMASIN (2026-08-12 saha isteği). `NumpadHost`
  // `disabled = !target` çalışıyor: hedef boşalırsa tuşlar gri olur ve operatör
  // "klavye bozuldu" der. Bugün `closeTarget`ı kimse çağırmıyor, yani bu yol
  // pratikte tetiklenmiyor — ama tek satırlık bir değişiklik (bir modalın
  // kapanışta hedefi bırakması) numpad'i sessizce öldürebilirdi. Manuel modda
  // toparlanma hedefi METRAJDIR; operatörün oraya dokunması beklenmez.
  const numpadCtx = useOptionalNumpadContext();
  const numpadTarget = numpadCtx?.target ?? null;
  useEffect(() => {
    if (compact || !manualMode || numpadTarget !== null) return;
    requestAnimationFrame(() => manualQtyRef.current?.focus());
  }, [compact, manualMode, numpadTarget]);

  // ── Items: kumaş (Variant kaldırıldı; RAW/DYED ayrımı yok artık) ──
  const itemsQuery = useQuery({
    queryKey: ['items', 'kk1', 'FABRIC'],
    queryFn: () =>
      itemService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: 'code',
        sortOrder: 'asc',
        filters: { isActive: 'true', itemType: 'FABRIC' },
      }),
  });

  useTruncationWarning(itemsQuery.data?.pagination, 'Kumaş');

  // Item picker'ı her açıldığında listeyi tazele — admin yeni kumaş eklediyse
  // operatör Pull-to-refresh basmadan görsün.
  useRefetchOnOpen(itemsQuery.refetch, pickerOpen === 'item');

  const itemOptions = useMemo<PickerOption[]>(
    () =>
      (itemsQuery.data?.data ?? []).map((i) => ({
        value: i.id,
        label: i.name,
        sublabel: i.code,
      })),
    [itemsQuery.data]
  );

  // ── Kalite dereceleri (admin yönetimli katalog) ──
  const qualityGradesQuery = useQuery({
    queryKey: ['quality-grades', 'active'],
    queryFn: () => qualityGradeService.list({ pageSize: 100 }),
    staleTime: 10 * 60 * 1000,
  });
  // Stable referans: query.data undefined iken her render'da yeni `[]` üretmesin.
  const qualityGrades = useMemo(
    () => qualityGradesQuery.data?.data ?? [],
    [qualityGradesQuery.data],
  );

  // Kalite: KK1 ham girişte "1. Kalite" DEFAULT seçili gelir (operatör isteği). Katalog
  // (async) yüklenince, form boşsa BİR KEZ ön-seçilir; operatör sonra toggle ile kaldırıp
  // "Belirsiz" (backend null) yapabilir → tekrar zorlamayız. 1.Kalite katalogda yoksa
  // (admin kaldırmışsa) boş kalır. Kalite hâlâ OPSİYONEL — yalnız varsayılan değişti.
  const didPreselectQualityRef = useRef(false);
  useEffect(() => {
    if (didPreselectQualityRef.current || qualityGrades.length === 0) return;
    didPreselectQualityRef.current = true;
    const first = qualityGrades.find(
      (qg) => qg.code === '1.KALITE' || /1\s*\.?\s*kalite/i.test(qg.name),
    );
    if (first) setForm((f) => (f.qualityGrade === '' ? { ...f, qualityGrade: first.code } : f));
  }, [qualityGrades]);

  const handleQualityGradeSelect = useCallback(
    (code: string) => {
      blurAll();
      // Toggle: seçili kaliteye tekrar dokun → kaldır (Belirsiz'e dön). Kalite opsiyonel.
      setForm((f) => ({ ...f, qualityGrade: f.qualityGrade === code ? '' : code }));
    },
    [blurAll],
  );

  // ── Son kayıtlar (inline): SADECE 1. sayfa, az kayıt ──
  // entrySource=SUPPLIER_RECEIPT,MANUAL_ENTRY → KK1 taramasıyla VEYA Electron admin
  // "Manuel Top Ekle" ile gelen toplar (ham + bitmiş) — 2026-07-15'te ikisi ayrı enum
  // değeri oldu, CSV ile ikisi de kapsanır (backend buildWhereClause virgülü `in`'e çevirir).
  // Backend enum'unda 'ALL' / 'PRODUCTION' YOK — status filtresi vermiyoruz ki
  // tüm statüsler (STOCK ham, WAREHOUSE renkli, vs.) görünsün.
  // KİŞİYE ÖZEL (2026-08-12 saha kararı): sağdaki liste operatörün KENDİ
  // girdikleridir — bayraktan bağımsız. İki operatör aynı tablette dönüşümlü
  // çalışırken "benim girdiğim kayboldu / bu benim değil" karışıklığı bitmeli;
  // başkalarının girişleri "Tüm Girişler"de (bayrak açıksa) durur. Süzme
  // SUNUCUDA (filter[createdById] — generic buildWhereClause yolu, bekçi:
  // test_filter_multi_select §2b); istemcide süzmek sayfalı listede yanıltır.
  const authUserId = useAuthStore((st) => st.user?.userId) ?? null;
  const recentRollsQuery = useQuery({
    queryKey: ['rolls', 'kk1', 'recent', authUserId],
    queryFn: () =>
      rollService.getAll({
        page: 1,
        pageSize: RECENT_PAGE_SIZE,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        filters: {
          entrySource: 'SUPPLIER_RECEIPT,MANUAL_ENTRY',
          // Kimlik henüz yüklenmediyse (teorik açılış yarışı) filtre GÖNDERME —
          // boş string tüm listeyi sessizce boşaltırdı.
          ...(authUserId ? { createdById: authUserId } : {}),
        },
      }),
  });

  // Manuel "Yenile" — standart hook (offline guard + zaman aşımı + tek tip
  // animasyon/haptic/toast). Hem tablet header'ı hem telefon drawer'ı paylaşır.
  const refresh = useManualRefresh(
    () => recentRollsQuery.refetch(),
    'Liste güncellendi',
  );

  // ── Tüm kayıtlar (modal): cursor + infinite scroll ──
  // Sorgu artık modal bileşeninin içinde (RollHistoryModal). Offset/sayfa state'i
  // yok — derin sayfada MAX_OFFSET guard'ı + her sayfada COUNT(*) maliyeti kalktı.

  const totalCount = recentRollsQuery.data?.pagination.total ?? 0;
  const recentRolls = recentRollsQuery.data?.data ?? [];

  // Listede yeni kayıt belirdiğinde otomatik tepeye kaydır
  const topIdRef = useRef<string | null>(null);
  useEffect(() => {
    const newTopId = recentRolls[0]?.id ?? null;
    if (
      topIdRef.current !== null &&
      newTopId !== null &&
      topIdRef.current !== newTopId
    ) {
      // Render tamamlanmış olsun diye küçük gecikme — iOS'ta scrollToOffset bazen erken çalışıyor
      requestAnimationFrame(() => {
        recentsListRef.current?.scrollToOffset({ offset: 0, animated: true });
      });
      // Yeni gelen topu kısa süre vurgula (kaydın "düştüğü" net hissedilsin).
      setFlashRollId(newTopId);
    }
    topIdRef.current = newTopId;
  }, [recentRolls]);

  // AĞ LİNKİ koptu → uçuştaki deneme artık OUTBOX'ın işi; uçuş kilidi kalkar ve
  // offline seri giriş bugünkü hızıyla sürer (operatör çevrimdışı olduğunu
  // BİLİYOR, çip söylüyor).
  //
  // ⚠️ SUNUCU erişilemezliğinde (B6) DETACH ETME: orada kesinti yeni fark
  // ediliyordur, basışlar panik olabilir ve uçuş kimliği korunmazsa B6 saha
  // vakasını kuyruk üzerinden geri getirir. Koruma `INFLIGHT_REUSE_WINDOW_MS`
  // (90 sn) ile sınırlı — uzun kesintide sıradaki gerçek top yutulmaz.
  useEffect(() => {
    if (shouldReleaseInFlight(offlineWhy)) setAttempt(onAttemptDetached);
  }, [offlineWhy]);

  // "✓ Kaydedildi" CTA flaşını ~900ms sonra söndür.
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 900);
    return () => clearTimeout(t);
  }, [justSaved]);

  // Yeni-kayıt vurgusunu ~1.6sn sonra temizle.
  useEffect(() => {
    if (!flashRollId) return;
    const t = setTimeout(() => setFlashRollId(null), 1600);
    return () => clearTimeout(t);
  }, [flashRollId]);

  // ── Mutation ──
  // OFFLINE-AWARE: mutationFn `setMutationDefaults`'ta tanımlı; persist sonrası
  // app restart'ında resolve. Client-üretimi idempotency anahtarı (UUID clientToken)
  // `tokenForSubmit` ile ÇÖZÜLÜP vars'a gömülür (ARTIK her basışta yeniden
  // ÜRETİLMEZ — 2026-08-03 saha vakası) — backend clientToken @unique + P2002
  // catch → cached Roll (mükerrer top yok). Barkod SUNUCU'da sıralı atanır.
  // onMutate'te form anında temizlenir. onError'da form geri yüklenir. Etiket basımı
  // onSuccess'te (res.data'nın gerçek barkoduyla) tetiklenir — offline'da paused
  // mutation online dönünce çalışır.
  const createMutation = useMutation<
    Awaited<ReturnType<typeof rollService.createInitialEntry>>,
    Error,
    InitialEntryRequest,
    {
      prevForm: FormState;
      prevManualQty: string;
      prevManualWeight: string;
    } | undefined
  >({
    mutationKey: STATION_MUT.KK1_CREATE_ENTRY,
    // ONLINE-ONLY: 'always' → mutation offline'da PAUSE OLMAZ, kuyruğa girmez.
    // Çevrimdışı basış zaten handleSubmit kapısında engelli; uçuş ortasında
    // kopan ağda istek düşer, stationRetry dener, kalıcı düşüş görünür hata +
    // yapışkan token olur (sıradaki basış AYNI kimlikle gider → kopya yok).
    // Bayrak kapalıyken defaults'taki 'online' (kuyruklu) davranış birebir sürer.
    ...(onlineOnly ? { networkMode: 'always' as const } : {}),
    onMutate: (vars) => {
      const prevForm = form;
      // Kuyruğa mı düşüyor? `onlineManager.isOnline()` ile retryer'ın `isPaused`
      // kararı AYNI predicate'ten gelir — okuma deterministik. Online-only
      // rejimde mutation hiç pause olmadığı için kuyruk dalı da kapalıdır.
      const queued = !onlineOnly && !onlineManager.isOnline();
      // ⚠️ UÇUŞ KAYDI İÇİN AYRI SORU: kayıt yalnız operatörün BİLDİĞİ bir
      // çevrimdışılıkta (ağ linki yok) açılmaz. "Sunucuya ulaşılamıyor"da
      // (B6) açılır — orada basışlar panik olabilir ve aynı yük 90 sn içinde
      // tek kimliğe toplanmalı.
      const knownOffline = offlineReason() === 'link';
      // Yeni deneme → eski yeşil flaş söner (aksi hâlde "Kaydedildi ✓" hâlâ
      // ekranda dururken ikinci basış gönderilirdi).
      setJustSaved(false);
      if (vars.clientToken) {
        const identity = {
          clientToken: vars.clientToken,
          clientEnteredAt: vars.clientEnteredAt ?? new Date().toISOString(),
        };
        const fp = entryFingerprint({
          itemId: vars.itemId,
          initialQty: vars.initialQty,
          width: vars.width ?? null,
        });
        setAttempt((s) => {
          const next = onAttemptStarted(s, identity, fp, { queued: knownOffline });
          // Ref'i SENKRON yaz: `onSuccess`'in "bu benim beklediğim deneme mi"
          // kontrolü ref'ten okuyor ve çok hızlı bir yanıt, `useEffect`'in
          // ref'i tazelemesinden ÖNCE gelebilir. O durumda yeşil "Kaydedildi ✓"
          // sessizce düşerdi. Fonksiyon saf ve idempotent → updater iki kez
          // çağrılsa da (StrictMode) sonuç aynı.
          attemptRef.current = next;
          return next;
        });
      }
      if (queued) {
        // ÇEVRİMDIŞI: kayıt gerçekten diske alındı, kuyruk dürüst konuşuyor.
        // Sebep AYRI anlatılır: "wifi'yi aç" ile "sunucu kapalı, IT'ye haber
        // ver" operatör için farklı işlerdir.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Toast.show({
          type: 'success',
          text1: knownOffline ? 'Top alındı (çevrimdışı)' : 'Top alındı (sunucuya ulaşılamıyor)',
          text2: knownOffline
            ? 'Ağ gelince kendiliğinden gönderilecek — etiket o zaman çıkar'
            : 'Sunucu dönünce kendiliğinden gönderilecek — etiket o zaman çıkar',
        });
        setJustSaved(true);
      } else {
        // ONLINE: HENÜZ KAYDEDİLMEDİ. 2026-08-03 saha vakasında operatörü tekrar
        // basmaya davet eden şey tam da buradaki koşulsuz yeşil "Top kaydedildi"
        // toast'ıydı: sunucu ölüyken bile "kaydedildi" diyor, etiket çıkmıyor,
        // operatör tekrar basıyordu. Yeşil ve başarı haptiği artık `onSuccess`'te.
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        Toast.show({
          type: 'info',
          text1: 'Kaydediliyor…',
          text2: 'Etiket, kayıt tamamlanınca çıkacak — bekle, tekrar basma',
        });
      }
      // Oturum sayacı (pending) — offline'da da çalışır.
      useSessionEntriesStore.getState().addPending(bucketKey);
      // Form'daki her alan KALICI (ürün, en, kalite) — aynı en'den seri giriş.
      // Yalnızca per-roll manuel değerler (mt/kg) temizlenir.
      const prevManualQty = manualQty;
      const prevManualWeight = manualWeight;
      setManualQty('');
      setManualWeight('');
      return {
        prevForm,
        prevManualQty,
        prevManualWeight,
      };
    },
    onSuccess: (res, vars) => {
      // Sunucu onayladı → yapışkanlık bırakılır, SIRADAKİ gerçek top taze token
      // alır. `res.data` boş gelse bile bırakılır: başarı başarıdır, aksi hâlde
      // operatör bir sonraki topu ölü bir token'la göndermeye devam ederdi.
      if (vars.clientToken) {
        const token = vars.clientToken;
        setAttempt((s) => onAttemptSucceeded(s, token));
      }
      failedVarsRef.current = null;
      // YEŞİL BURADA (B4): yalnız operatörün ŞU AN beklediği deneme onaylandıysa.
      // Dakikalar önce kuyruğa girmiş bir kayıt şimdi flush olduysa operatör 5 top
      // ileridedir — o an "Kaydedildi ✓" basmak hangi topun onaylandığı konusunda
      // yanıltırdı (o kayıt kendi toast'ını basış anında zaten aldı).
      if (vars.clientToken && attemptRef.current.inFlight?.identity.clientToken === vars.clientToken) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setJustSaved(true);
        Toast.show({
          type: 'success',
          text1: 'Kaydedildi ✓',
          text2: res.data?.barcode
            ? `${res.data.barcode} — etiket basılıyor`
            : undefined,
        });
      }
      if (!res.data) return;
      // "Kaydet ve Etiket Bas" — başarılı kayıttan sonra otomatik etiket basımı.
      // Offline'da pause olduysa burası ancak online dönünce çalışır.
      // Queue'ya at: birden fazla mutation sırayla resume olduğunda hepsi basılır
      // (eskiden setPrintRoll overwrite ediyordu, sadece son etiket basıyordu).
      enqueuePrint(res.data);
      // "Bu oturum" listesi — sunucu onayı: pending → onaylı kayda dönüşür.
      useSessionEntriesStore.getState().confirmRoll(bucketKey, res.data as Roll);
      qc.invalidateQueries({ queryKey: ['rolls', 'kk1'] });
    },
    onError: (err, vars, context) => {
      // Kayıt reddedildi → oturum sayacındaki pending geri alınır (sayaç şişmesin).
      useSessionEntriesStore.getState().failPending(bucketKey);
      // CTA "Kaydedildi ✓" flaşında takılı kalmasın — hata durumunu ezerdi.
      setJustSaved(false);
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      // "Ürün ... pasif/silinmiş" → ürün başka yerden soft-delete edilmiş.
      // Seçimi temizle ki operatör aynı silinmiş ürünle tekrar tekrar
      // denemesin (picker'da artık görünmüyor, kafası karışır). Renk/özellik
      // "pasif" hataları 'Ürün' içermez → yanlışlıkla temizlemeyiz.
      const msg = err.message ?? '';
      const itemDeleted =
        msg.includes('Ürün') && (msg.includes('pasif') || msg.includes('silin'));
      // Form'u + manuel değerleri geri yükle ki operatör veriyi kaybetmesin
      // (özellikle offline'da beklenmedik backend reddi durumunda kritik).
      if (context) {
        setForm(
          itemDeleted
            ? { ...context.prevForm, itemId: '', itemLabel: '' }
            : context.prevForm,
        );
        setManualQty(context.prevManualQty);
        setManualWeight(context.prevManualWeight);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      // Sunucunun iki 409'u da "aradığın top zaten var" der. Sessiz toast
      // YETMEZ — operatörün görmesi gereken şey BARKOD ve bir karar. Modal.
      const e = err as Error & {
        status?: number;
        details?: Record<string, unknown>;
      };
      const code = e.details?.code;
      if (
        e.status === 409 &&
        (code === 'CLIENT_TOKEN_COLLISION' || code === 'POSSIBLE_DUPLICATE')
      ) {
        const barcode =
          typeof e.details?.barcode === 'string' ? e.details.barcode : null;
        setConflict({
          kind: code === 'POSSIBLE_DUPLICATE' ? 'POSSIBLE_DUPLICATE' : 'TOKEN_COLLISION',
          barcode,
          vars,
        });
        // Var olan kayıt listeye düşsün ki operatör oradan da görebilsin.
        qc.invalidateQueries({ queryKey: ['rolls', 'kk1'] });
        return; // toast YOK — modal konuşuyor
      }

      // YAPIŞKANLIK YALNIZ BELİRSİZ SONUÇTA. Ağ hatası / zaman aşımı / 5xx →
      // sunucu COMMIT etmiş OLABİLİR, o yüzden sonraki basış aynı token'la
      // gitmeli (kopya değil retry). Kesin 4xx'te (ürün pasif, doğrulama, izin)
      // hiçbir şey yazılmadığı KESİNDİR — orada yapışmak, aynı payload'ı sonsuza
      // dek yeniden gönderen bir "Tekrar Dene" döngüsü kurardı: operatör silinmiş
      // ürünü değiştiremeden aynı hatayı alırdı.
      const ambiguous = isAmbiguousFailure(e);
      if (ambiguous && vars.clientToken) {
        const token = vars.clientToken;
        setAttempt((s) => onAttemptFailed(s, token));
        failedVarsRef.current = vars; // retry BUNU birebir gönderir
      } else {
        setAttempt(IDLE_ATTEMPT);
        failedVarsRef.current = null;
      }
      Toast.show({
        type: 'error',
        text1: itemDeleted ? 'Ürün silinmiş' : 'Kayıt başarısız',
        text2: itemDeleted
          ? 'Seçili ürün artık aktif değil — lütfen yeniden seçin'
          : ambiguous
            ? `${err.message} — "Tekrar Dene" ile AYNI kayıt yeniden gönderilir.`
            : err.message,
      });
    },
    // UÇUŞ KAYDININ TEK KAPANIŞ NOKTASI. `onError`'ın erken dönüş dalları
    // (`isWorkSessionLost`, 409 modalı) uçuşu temizlemeden çıkıyor; `onSettled`
    // her yolda koşar. Yalnız BEKLENEN token kapatılır (gecikmiş yanıt yeni bir
    // uçuşu düşürmesin).
    onSettled: (_res, _err, vars) => {
      setAttempt((s) => onAttemptSettled(s, vars?.clientToken));
    },
  });

  // İptal önizlemesi — scrapTarget set olunca çağrılır. Modalda somut etki
  // (hard-block neden / hangi istasyonda aktif) gösterilir. staleTime 0:
  // her açılışta taze (top başka adıma geçmiş olabilir).
  const cancelPreviewQuery = useQuery({
    queryKey: ['rolls', 'cancel-preview', scrapTarget?.id],
    queryFn: () => rollService.getCancelPreview(scrapTarget!.id),
    // Önizleme online-only (sunucu durumu). Offline'da çekmeye çalışıp paused
    // kalmasın → modal offline notuyla sade onaya düşer.
    enabled: !!scrapTarget && isOnline,
    staleTime: 0,
    gcTime: 0,
  });
  const cancelPreview: RollCancelPreview | null =
    cancelPreviewQuery.data?.data ?? null;

  /**
   * İPTALİ GERİ AL — tek dokunuşla iptalin karşılığı (iptal toast'ındaki buton).
   * Kapsam backend'de dar (hareketsiz/partisiz/çuvalsız/kesilmemiş top); az önce
   * girilmiş bir KK1 topu tam olarak o kapsamdadır. Reddedilirse SEBEBİ gösterilir:
   * sessiz başarısızlık operatöre "geri aldım" sanısı verirdi.
   */
  const undoScrap = useCallback(
    (rollId: string) => {
      rollService
        .restoreCancel(rollId)
        .then(() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => {},
          );
          Toast.show({ type: 'success', text1: 'İptal geri alındı' });
          qc.invalidateQueries({ queryKey: ['rolls', 'kk1'] });
        })
        .catch((err: Error) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
            () => {},
          );
          Toast.show({ type: 'error', text1: 'Geri alınamadı', text2: err.message });
        });
    },
    [qc],
  );

  // Yanlış giriş / hurda — top CANCELLED'a çekilir, open movement'lar kapatılır.
  // İstasyonda aktif top için backend confirmActive ister (önizlemeden gelir).
  //
  // OFFLINE-AWARE: mutationKey ile registry'deki default fn'e bağlı (KK1_SCRAP,
  // networkMode 'online' → offline'da pause + persist + online resume). onMutate'te
  // optimistic: top listelerden anında düşer; onError'da geri yüklenir. Backend
  // softDelete idempotent (zaten iptal = no-op), bu yüzden replay güvenli.
  const scrapMutation = useMutation<
    Awaited<ReturnType<typeof rollService.scrap>>,
    Error,
    // ⚠️ `confirmLabelPrinted` AÇIKÇA taşınır — sebep 2026-08-06'da opsiyonel
    // oldu, "sebep varsa onay da vardır" çıkarımı artık geçersiz.
    { id: string; confirmActive: boolean; confirmLabelPrinted?: boolean; reason?: string },
    { snapshots: [readonly unknown[], unknown][] }
  >({
    mutationKey: STATION_MUT.KK1_SCRAP,
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['rolls', 'kk1'] });
      const snapshots = qc.getQueriesData({ queryKey: ['rolls', 'kk1'] });
      snapshots.forEach(([key, data]) => {
        const d = data as { data?: Roll[] } | undefined;
        if (d && Array.isArray(d.data)) {
          qc.setQueryData(key, { ...d, data: d.data.filter((r) => r.id !== id) });
        }
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // ⚠️ ÇEVRİMDIŞI ONAYI BURADA, ÇEVRİMİÇİ ONAYI `onSuccess`'te. Sunucu
      // varken "iptal edildi" demek, sunucu daha bakmadan verilmiş bir sözdür
      // (KK1 giriş toast'ında öğrenilen ders). Offline'da sunucu YOK: söz
      // verilebilecek tek şey kuyruğa alındığıdır ve onu şimdi söylemek gerekir.
      if (!onlineManager.isOnline()) {
        Toast.show({
          type: 'success',
          text1: 'İptal sıraya alındı',
          text2: 'Çevrimdışı — bağlanınca uygulanacak',
        });
      }
      return { snapshots };
    },
    // Tek dokunuşla iptalin emniyeti: sunucu onayladıktan sonra GERİ AL.
    // (`restoreCancel` offline-aware DEĞİL; zaten yalnız online yolda basılır.)
    onSuccess: (_res, vars) => {
      Toast.show({
        type: 'undoable',
        text1: 'Top iptal edildi',
        text2: vars.reason ?? 'Sebep: seçilmedi',
        visibilityTime: 6000,
        props: { actionLabel: 'GERİ AL', onAction: () => undoScrap(vars.id) },
      });
    },
    onError: (err, _vars, context) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      context?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'İptal edilemedi',
        text2: err.message,
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['rolls', 'kk1'] });
    },
  });

  const handleScrapRoll = useCallback(
    (roll: Roll) => {
      if (recentsDrawerOpen || historyOpen) {
        // Modal açıkken: hedefi sıraya al, açık olanı kapat. Kapanma animasyonu
        // bittiğinde (onModalHide) drainPendingScrap çalışıp scrapTarget set eder.
        pendingScrapRef.current = roll;
        setRecentsDrawerOpen(false);
        setHistoryOpen(false);
      } else {
        setScrapTarget(roll);
      }
    },
    [recentsDrawerOpen, historyOpen],
  );

  const drainPendingScrap = useCallback(() => {
    if (pendingScrapRef.current) {
      setScrapTarget(pendingScrapRef.current);
      pendingScrapRef.current = null;
    }
  }, []);

  // Drawer kapanınca (onModalHide) bekleyen niyetleri uygula — scrap onayı veya
  // "Tümünü Gör" → history. İkisi de aynı anda iki-modal çakışmasını önler.
  const handleDrawerClosed = useCallback(() => {
    drainPendingScrap();
    if (pendingHistoryRef.current) {
      pendingHistoryRef.current = false;
      setHistoryOpen(true);
    }
  }, [drainPendingScrap]);

  const confirmScrap = useCallback(
    (reason?: string) => {
      if (!scrapTarget) return;
      // Hard-block (fason/sevkiyat/zaten iptal) → hiç gönderme.
      if (cancelPreview && !cancelPreview.canCancel) return;
      // İstasyonda aktif top için bilinçli onay bayrağı.
      const confirmActive = cancelPreview?.requiresConfirm ?? false;
      // "Kâğıdı söktüm" beyanı: modalın uyarıyı gösterme koşuluyla AYNI önizleme
      // alanından türer. Offline'da önizleme yok → bayrak gitmez ve backend
      // etiketli topu reddeder; bu fail-closed davranış BİLİNÇLİ (operatör o
      // uyarıyı hiç görmemiştir).
      const confirmLabelPrinted = cancelPreview?.labelPrinted ?? false;
      scrapMutation.mutate({
        id: scrapTarget.id,
        confirmActive,
        confirmLabelPrinted,
        reason,
      });
      setScrapTarget(null);
    },
    [scrapTarget, cancelPreview, scrapMutation],
  );


  // ── Actions ──
  // En'i tek tuşla temizle — operatör değiştirmek isterse defalarca silmesin.
  const handleClearWidth = useCallback(() => {
    setForm((f) => ({ ...f, width: '' }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    widthRef.current?.focus();
  }, []);

  // Manuel modu aç (Manuel Giriş anahtarından). Kalıcılaştırma diske yazar →
  // beklenmez (void): anahtar anında döner, yazma arka planda biter.
  const openManual = useCallback(() => {
    void setManualMode(true);
    requestAnimationFrame(() => manualQtyRef.current?.focus());
  }, [setManualMode]);

  // Otomatik modda metrajı makineden oku (HAL). Cihaz yoksa/okunamazsa NET
  // Türkçe hata gösterir ve null döner — sessiz sahte değer YOK (Tambur deseni).
  // Yalnız cihazın simulate bayrağı açıkken sahte değer üretir (test/donanımsız).
  const measureFromMachine = async (): Promise<number | null> => {
    const simMeterage = () => Math.round((100 + Math.random() * 400) * 10) / 10;
    const p = primaryMeterFor(meterPeripherals);
    if (!p) {
      Toast.show({
        type: 'error',
        text1: 'Metre cihazı tanımlı değil',
        text2: 'Admin → Cihaz Kaydı’ndan bu makineye METER cihazı ekleyin (veya Manuel moda geçin).',
        visibilityTime: 6000,
      });
      return null;
    }
    // Cihazın simülasyon bayrağı açıksa (admin) sahte değer.
    if (p.simulate) return simMeterage();

    const io = buildIoFromPeripheral(p);
    if (!io.supported || !io.transport || !io.codec) {
      Toast.show({
        type: 'error',
        text1: 'Metre okunamıyor',
        text2: 'Bu derlemede/bağlantı türünde desteklenmiyor (native build / connectionType).',
        visibilityTime: 6000,
      });
      return null;
    }
    try {
      const raw = await io.transport.read({
        readMode: p.readMode,
        pollCommand: p.pollCommand ?? undefined,
        terminator: p.terminator ?? undefined,
        timeoutMs: p.timeoutMs ?? undefined,
        framePattern: p.identifyPattern ?? undefined,
      });
      const v = io.codec.decode(raw);
      if (v != null && v > 0) return v;
      throw new Error('Geçerli metre yanıtı gelmedi');
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Metre makinesi okunamadı',
        text2: e instanceof Error ? e.message : 'Makine kapalı/menzil dışı veya komut yanlış olabilir',
        visibilityTime: 6000,
      });
      return null;
    }
  };

  const handleSubmit = async () => {
    if (pulling) return; // makineden okuma sürerken çift tetikleme yok
    // ONLINE-ONLY KAPISI: çevrimdışıyken kayıt HİÇ alınmaz (kuyruk yok). Buton
    // zaten disabled ama bu guard yarış penceresini de kapatır (basış anında
    // bağlantı düşmüş olabilir). Sebep ayrı anlatılır — "wifi'yi aç" ile
    // "sunucu kapalı, IT'ye haber ver" operatör için farklı işlerdir.
    if (onlineOnly && !onlineManager.isOnline()) {
      const why = offlineReason();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Toast.show({
        type: 'error',
        text1: why === 'server' ? 'Sunucuya ulaşılamıyor' : 'Ağ bağlantısı yok',
        text2:
          'Kayıt ALINMADI — bu ekranda çevrimdışı giriş kapalı. ' +
          'Bağlantı gelince topu girin; sıraya alınan hiçbir şey yok.',
      });
      return;
    }
    // SCAN-BACK KAPISI: okutulmamış etiket varken yeni top girilemez — buton
    // görünürde basılabilir kalır (disabled buton "dondu" hissi verir) ama
    // basış doğrudan TARAYICIYI açar: en hızlı uyum yolu engelin kendisidir.
    if (verifyPending) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      Toast.show({
        type: 'info',
        text1: 'Önce etiketi okut',
        text2: `${verifies.length} basılı etiket doğrulama bekliyor — çıkan kâğıdı okutun`,
      });
      setVerifyScanOpen(true);
      return;
    }
    // TEKRAR DENE: düşen deneme birebir yeniden gönderilir — form okunmaz,
    // makineye gidilmez, doğrulama tekrarlanmaz (payload zaten geçerliydi).
    // Aynı token + aynı içerik → backend idempotent yolu → kopya doğmaz.
    if (retrying && failedVarsRef.current) {
      createMutation.mutate(failedVarsRef.current);
      return;
    }
    if (!form.itemId) {
      Toast.show({ type: 'error', text1: 'Ürün seçimi zorunlu' });
      return;
    }
    // En opsiyonel (ham kumaşın eni önemsiz). Girilmişse pozitif olmalı; boş
    // bırakılırsa null gönderilir — bitmiş topun eni Tambur'da WO'dan gelir.
    const widthNum = Number(form.width);
    const width = widthNum > 0 ? widthNum : undefined;
    if (form.width.trim() !== '' && !(widthNum > 0)) {
      Toast.show({ type: 'error', text1: 'En (cm) geçersiz' });
      return;
    }
    // Kalite OPSİYONEL — boş bırakılabilir (Belirsiz); "kalite seçilmedi" guard'ı YOK.

    // Metraj (+ağırlık) kaynağı: manuel modda elle, otomatik modda makineden
    // ("Kaydet"e basınca paralel okunur).
    let qty: number;
    let weightKg: number | undefined;
    if (manualMode) {
      qty = Number(manualQty);
      if (!qty || qty <= 0) {
        Toast.show({ type: 'error', text1: 'Manuel metraj (mt) girilmeli' });
        return;
      }
      // Ağırlık yalnız flag açıkken payload'a girer — kapalıyken (alan gizli)
      // eski/kalıntı kg değeri sızmasın. Backend de reddeder; client de temiz gönderir.
      const w = weightEntryEnabled ? Number(manualWeight) : NaN;
      weightKg = w > 0 ? w : undefined;
    } else {
      blurAll();
      setPulling(true);
      try {
        // Otomatik modda yalnız METRAJ makineden okunur (HAL). kg sadece manuel
        // modda (opsiyonel) girilir — weightKg burada set EDİLMEZ (undefined).
        // Hata mesajları measureFromMachine içinde (cihaz/bağlantı/komut bazında).
        const measured = await measureFromMachine();
        if (measured == null) return;
        qty = measured;
      } finally {
        setPulling(false);
      }
    }

    // Offline-aware idempotency: KİMLİK (token + giriş damgası) ÜRETİLMEZ,
    // ÇÖZÜLÜR (2026-08-03 saha vakası — eskiden her basış yeni token üretiyordu
    // ve koruma hiç devreye girmiyordu). Üç dal:
    //   • resend-failed   → düşmüş deneme; yukarıdaki erken dönüş bunu zaten
    //     `failedVarsRef` ile birebir gönderdi (buraya normalde düşülmez).
    //   • reuse-inflight  → ONLINE bir deneme uçuşta ve yük BİREBİR aynı: aynı
    //     kimlik gider → backend `clientToken @unique` P2002 → tek kayıt.
    //   • send-new        → taze kimlik → yeni top.
    // Mutate paused olursa persist edilen vars sabit kalır → resume'da da aynı
    // kimlik. Barkod SUNUCU'da sıralı atanır; etiket res.data ile basılır.
    //
    // ⚠️ DAMGA TAZELENMEZ. `clientEnteredAt` operatörün BASTIĞI andır; retry ya da
    // uçuş tekrarı onu yenilerse backend'in 90 sn'lik mükerrer penceresi kayar ve
    // koruma tam da en çok gerektiği anda kapanır (bkz. entryAttempt sözleşmesi).
    const fingerprint = entryFingerprint({
      itemId: form.itemId,
      initialQty: qty,
      width: width ?? null,
    });
    const action = decideSubmit(attempt, fingerprint);
    const fresh = freshEntryIdentity();
    const identity =
      action === 'reuse-inflight' && attempt.inFlight
        ? attempt.inFlight.identity
        : // `resend-failed` normalde yukarıdaki erken dönüşte `failedVarsRef` ile
          // karşılanır; buraya yalnız ref boşsa (payload kaybolmuşsa) düşülür —
          // o durumda form yeniden okunduğu için damga da yeni olmak DURUMUNDA,
          // ama token yapışkan kalır ki backend kopyayı yine de eritsin.
          { clientToken: tokenForSubmit(attempt, () => fresh.clientToken), clientEnteredAt: fresh.clientEnteredAt };
    createMutation.mutate({
      itemId: form.itemId,
      initialQty: qty,
      width,
      weightKg,
      qualityGrade: form.qualityGrade || undefined,
      clientToken: identity.clientToken,
      clientEnteredAt: identity.clientEnteredAt,
    });
  };

  // ── 409 çakışma çözümü (iki kod da buraya düşer) ───────────────────────────
  // Modal DİSMISS EDİLEMEZ (iki net çıkış): ya var olan topun etiketi basılır
  // (operatörün asıl derdi genelde budur), ya da "bu ayrı bir top" denip kayıt
  // sürdürülür. Sessiz kapanış bilinçli olarak yok — belirsiz çıkış ya sonsuz
  // 409 döngüsü ya da farkında olunmayan kopya üretirdi.
  const [conflictPrinting, setConflictPrinting] = useState(false);

  const clearConflict = () => {
    setAttempt(onCollisionResolvedAsNew());
    failedVarsRef.current = null;
    setConflict(null);
  };

  /**
   * Barkoddan etiket bas — sunucudan topu okur, yazıcı kuyruğuna atar.
   * Çakışma modalının "var olanın etiketini bas" yolu bunu kullanır.
   */
  const printBarcode = useCallback(
    async (barcode: string): Promise<boolean> => {
      try {
        const res = await rollService.getByBarcode(barcode);
        if (!res.data) throw new Error('Top bulunamadı');
        enqueuePrint(res.data);
        return true;
      } catch {
        Toast.show({
          type: 'error',
          text1: 'Etiket alınamadı',
          text2: `${barcode} — "Son Kayıtlar" listesinden de basabilirsiniz`,
        });
        return false;
      }
    },
    [enqueuePrint],
  );

  const printConflictingRoll = async () => {
    const barcode = conflict?.barcode;
    if (!barcode) {
      clearConflict();
      return;
    }
    setConflictPrinting(true);
    try {
      // Başarısızsa modal AÇIK kalır; operatör diğer yolu seçebilir.
      if (await printBarcode(barcode)) clearConflict();
    } finally {
      setConflictPrinting(false);
    }
  };

  /** "Bu ayrı bir top" — kaydı sürdür. İki kodun çözümü FARKLI:
   *   • TOKEN_COLLISION  → önceki kayıt var; kimlik tükenmiş → TAZE token
   *   • POSSIBLE_DUPLICATE → hiçbir şey yazılmadı; kimlik hâlâ geçerli →
   *     AYNI token + `confirmDuplicate` (tuzağı açık onayla geç) */
  const saveConflictAsNew = () => {
    if (!conflict) return;
    const { kind, vars } = conflict;
    setConflict(null);
    const next = onCollisionResolvedAsNew();
    setAttempt(next);
    failedVarsRef.current = null;
    createMutation.mutate(
      kind === 'POSSIBLE_DUPLICATE'
        ? // Aynı FİZİKSEL giriş, operatör "bu ayrı bir top" dedi → kimlik AYNEN
          // korunur (damga da), yalnız tuzak açık onayla atlanır.
          { ...vars, confirmDuplicate: true }
        : // TOKEN_COLLISION → önceki deneme aslında COMMIT olmuştu; bu YENİ bir
          // mantıksal toptur → token VE damga birlikte tazelenir (ikisi tek kimlik).
          { ...vars, ...freshEntryIdentity() },
    );
  };

  const handlePrintLabel = (roll: Roll) => {
    // Satır kendi Roll'unu verir (recents + history modalı aynı). Operatör başka
    // top için printi tekrar tetikleyene kadar tek print akışı çalışır.
    enqueuePrint(roll);
    // Offline'da basılamaz; kuyruğa alınır, ağ gelince otomatik basılır.
    if (!isOnline) {
      Toast.show({
        type: 'info',
        text1: 'Çevrimdışı',
        text2: 'Etiket kuyruğa alındı — bağlanınca basılacak',
      });
    }
  };

  // Basılıyor + sırada bekleyen etiket sayısı (offline'da birikebilir).
  const printingCount = (activePrintRoll ? 1 : 0) + printQueue.length;

  // "Bu oturum" rozeti — hem tablet birincil barında hem telefon 2. katında.
  // fill (yalnız compact/telefon): 2. katta "Son Kayıtlar" ile satırı YARI
  // YARIYA paylaşır (flex:1 + içerik ortalı). Tablette (compact=false) fill yok.
  const sessionCountChip = sessionCount > 0 && (
    // Dokununca bu oturumda girilen topların listesi açılır.
    <TouchableRipple
      borderless
      onPress={() => setSessionListOpen(true)}
      rippleColor="rgba(255,255,255,0.2)"
      style={[styles.headerSessionChip, compact && styles.headerSessionChipFill]}
      accessibilityLabel="Bu oturumda girilenleri göster"
    >
      <View style={[styles.headerSessionChipInner, compact && styles.headerChipInnerFill]}>
        <Icon source="check-circle" size={14} color="#86efac" />
        <Text style={styles.headerSessionLabel}>Bu oturum</Text>
        <AnimatedCounter value={sessionCount} style={styles.headerSessionCount} />
      </View>
    </TouchableRipple>
  );

  // Tablet birincil barı — "Bu oturum" + "Tüm Girişler" + "Yenile" (yer var).
  const sessionActionsRow = (
    <>
      {sessionCountChip}
      <HeaderChip
        icon="format-list-bulleted"
        label="Tüm Girişler"
        onPress={() => setHistoryOpen(true)}
      />
      <RefreshButton
        headerStyle
        label="Yenile"
        onPress={refresh.onRefresh}
        refreshing={refresh.refreshing}
        isError={refresh.isError}
        errorMessage={refresh.errorMessage}
        successMessage={refresh.successMessage}
      />
    </>
  );

  // Telefon 2. katı: "Bu oturum" (sol) + "Son Kayıtlar" (sağ) satırı YARI YARIYA
  // paylaşır — her çip fill (flex:1). Biri yoksa (sayaç 0 / yatay) diğeri tüm
  // satırı kaplar. Makine adı BURADA DEĞİL — başlık subtitle'ına taşındı
  // (hidePlaceChip). "Tüm Girişler" + "Yenile" burada YOK (çekmecede var).
  const phoneSecondRow = (
    <>
      {sessionCountChip}
      {portraitPhone && (
        <HeaderChip
          icon="format-list-bulleted"
          label={`Son Kayıtlar · ${totalCount}`}
          onPress={() => setRecentsDrawerOpen(true)}
          fill
        />
      )}
    </>
  );

  return (
    <ScreenChrome
      title="Ham Giriş"
      // Telefon: makine adı başlık altında subtitle olarak (üst bardaki ⚙ çip
      // yerine); tablet eskisi gibi çipi başlığın yanında gösterir.
      subtitle={compact ? machineName : undefined}
      hidePlaceChip={compact}
      headerExtras={
        <View style={styles.headerExtrasRow}>
          {/* ÇİP YALNIZ "AKIYOR" DURUMUNU GÖSTERİR — hata kısmı 2026-08-12'de
              buradan ÇIKARILDI ve tek yüzey olarak aşağıdaki kırmızı banda
              indirildi. Gerekçe: aynı hata hem burada ("N ETİKET HATALI") hem
              Kaydet butonunun üstündeki bantta duruyordu; header'da ayrıca
              SyncStatusChip'in kırmızısı da olabildiği için operatörden üç
              kırmızı kutucuğu birbirinden ayırt etmesi bekleniyordu (sahada
              gözlendi). Basım göstergesi KALDI: anlıktır, nötr renktir ve
              "şu an bir şey oluyor" bilgisini başka hiçbir yüzey vermiyor. */}
          {printingCount > 0 && (
            <Animated.View
              entering={FadeInUp.duration(180)}
              exiting={FadeOutUp.duration(140)}
            >
              {/* Dokununca yazıcı kuyruğu görünümü: basılıyor / sırada / başarısız. */}
              <TouchableRipple
                borderless
                onPress={() => setQueueOpen(true)}
                rippleColor="rgba(255,255,255,0.2)"
                style={styles.printChip}
                accessibilityLabel="Yazıcı kuyruğunu göster"
              >
                <View style={styles.printChipInner}>
                  <Pulse color="#fff" size={7} />
                  <Text style={styles.printChipText}>
                    {`${printingCount} etiket${!isOnline ? ' · çevrimdışı' : ''}`}
                  </Text>
                </View>
              </TouchableRipple>
            </Animated.View>
          )}
          <SyncStatusChip />
          {!compact && sessionActionsRow}
          {/* Dikey telefonda "Son Kayıtlar" çekmece tetiği artık 2. katta
              (phoneSecondRow) — yan menü açan tuş burada değil. */}
        </View>
      }
      // 2. katı yalnız içerik varken göster: dikey telefon (Son Kayıtlar hep
      // var) VEYA sayaç>0 (Bu oturum). Yatay telefonda + sayaç 0 → boş şerit
      // olmasın (Son Kayıtlar yatayda form gövdesinde).
      secondRow={compact && (portraitPhone || sessionCount > 0) ? phoneSecondRow : undefined}
      secondRowSpread={compact}
    >
      <View
        style={[
          styles.body,
          // Compact'ta yalnız güvenli-alan (notch) kadar dış boşluk — form
          // neredeyse kenara yaslanır, içerik "ortada emanet" durmaz. İç nefes
          // payı formContentCompact'ta.
          compact && {
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        {/* ── SOL: Form (kaydırılabilir — küçük ekranda taşmasın) ── */}
        {/* Sistem-klavyeli inputlar (compact'ta NumpadInput useNativeKeyboard=true
            ile decimal/number-pad açar) klavye altında kalmasın diye
            KeyboardAwareScrollView: odaklı input'u klavyenin + yüzen "Kaydet ve
            Etiket Bas" footer'ının üstüne kaydırır. Footer ScrollView'in DIŞINDA
            (sibling) olduğundan kendi lift'ini korur — çift telafi yok. */}
        <View style={styles.formCol}>
        <KeyboardAwareScrollView
          style={styles.formScroll}
          contentContainerStyle={[
            styles.formContent,
            compact ? styles.formContentCompact : styles.formContentTablet,
          ]}
          bottomOffset={compact ? 80 : 0}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {/* Compact'ta sağ panel yok — sağa kayan drawer aç/kapa tetiği.
              Portrait telefon'da bu tetik header'a taşındı (Appbar.Action). */}
          {compact && !portraitPhone && (
            <View style={styles.drawerTriggerBar}>
              <Button
                mode="contained-tonal"
                icon="format-list-bulleted"
                compact
                onPress={() => setRecentsDrawerOpen(true)}
              >
                Son Kayıtlar · {totalCount}
              </Button>
            </View>
          )}

          {/* ── Manuel giriş paneli (varsayılan KAPALI; makine arızasında elle
              mt/kg). Ürün tarafının en üstünde, açılıp-kapanır. ── */}
          <Surface
            style={[styles.manualBar, manualMode && styles.manualBarActive]}
            elevation={0}
          >
            <TouchableRipple
              borderless
              rippleColor="rgba(217,119,6,0.12)"
              onPress={() => {
                if (manualMode) void setManualMode(false);
                else openManual();
              }}
              style={styles.manualBarTouch}
            >
              <View style={[styles.manualBarInner, !compact && styles.manualBarInnerTablet]}>
                <Icon source="keyboard-outline" size={compact ? 20 : 28} color={colors.warningDark} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.manualBarTitle, !compact && styles.manualBarTitleTablet]}>Manuel Giriş</Text>
                </View>
                <View pointerEvents="none">
                  <Switch value={manualMode} color={colors.warningDark} />
                </View>
              </View>
            </TouchableRipple>
            {manualMode && (
              <Animated.View
                entering={FadeInUp.duration(180)}
                exiting={FadeOutUp.duration(140)}
                style={[styles.manualPanel, !compact && styles.manualPanelTablet]}
              >
                <View style={styles.manualField}>
                  {/* Telefonda üst etiket YOK (yer kazanmak için) — alan adı
                      placeholder'da; tablette etiket kalır. */}
                  {!compact && (
                    <Text style={[styles.manualFieldLabel, styles.manualFieldLabelTablet]}>
                      Metraj (mt) <Text style={styles.required}>*</Text>
                    </Text>
                  )}
                  <NumpadInput
                    ref={manualQtyRef}
                    mode="outlined"
                    value={manualQty}
                    onChangeText={setManualQty}
                    numpadLabel="Metraj (mt)"
                    placeholder={compact ? 'Metraj (mt)' : '0.0'}
                    style={styles.input}
                    contentStyle={[styles.manualInputContent, !compact && styles.manualInputContentTablet]}
                    useNativeKeyboard={compact}
                    // MANUEL MODDA NUMPAD'İN VARSAYILAN HEDEFİ BURASIDIR
                    // (2026-08-12 saha isteği). Öncesinde hiçbir alan hedef
                    // almıyordu: `NumpadHost` `disabled = !target` olduğu için
                    // manuel giriş açılınca tuşlar GRİ ve tıklanamaz kalıyor,
                    // operatör önce metraj kutusuna dokunmak zorunda kalıyordu.
                    // (En alanı bayrakla kapalıysa ekranda hedef alacak BAŞKA
                    // alan da yok — numpad tamamen ölüydü.)
                    autoActivate={!compact && manualMode}
                  />
                </View>
                {weightEntryEnabled && (
                  <View style={styles.manualField}>
                    {!compact && (
                      <Text style={[styles.manualFieldLabel, styles.manualFieldLabelTablet]}>Ağırlık (kg)</Text>
                    )}
                    <NumpadInput
                      ref={manualWeightRef}
                      mode="outlined"
                      value={manualWeight}
                      onChangeText={setManualWeight}
                      numpadLabel="Ağırlık (kg)"
                      placeholder={compact ? 'Ağırlık (kg)' : '0.0'}
                      style={styles.input}
                      contentStyle={[styles.manualInputContent, !compact && styles.manualInputContentTablet]}
                      useNativeKeyboard={compact}
                    />
                  </View>
                )}
              </Animated.View>
            )}
          </Surface>

          {/* ── Üretim ayarı: ürün + en + kalite (kaydetler ARASI kalıcı) ── */}
          <Surface style={[styles.card, !compact && styles.cardTablet]} elevation={1}>
            {compact ? (
              // Telefon: tablettekiyle AYNI dil ama YAN YANA — "Desen Seç" butonu
              // 1/4 (flex:1), "Seçilen Desen" kutusu 3/4 (flex:3). Dar butona
              // sığsın diye ikon yok + küçük yazı.
              <View style={styles.productRowCompact}>
                {/* Paper Button etiketi `\n`'i yutuyordu → TouchableRipple ile
                    2-satır ("Desen" / "Seç") ORTALI, dar 1/4 butona sığar. */}
                <TouchableRipple
                  borderless
                  onPressIn={blurAll}
                  onPress={() => {
                    blurAll();
                    setPickerOpen('item');
                  }}
                  rippleColor="rgba(79,70,229,0.16)"
                  style={styles.productBtnCompact}
                  accessibilityLabel="Desen seç"
                >
                  <View style={styles.productBtnCompactInner}>
                    <Text style={styles.productBtnCompactLabel}>{'Desen\nSeç'}</Text>
                  </View>
                </TouchableRipple>
                <View
                  style={[
                    styles.productSelectedBox,
                    styles.productSelectedBoxCompact,
                    !!form.itemId && styles.productSelectedBoxActive,
                  ]}
                >
                  <Text style={styles.productSelectedCaption}>Seçilen Desen</Text>
                  <View style={styles.productSelectedValueRow}>
                    {!!form.itemId && (
                      <Icon source="check-circle" size={18} color={colors.success} />
                    )}
                    <Text
                      style={[
                        styles.productSelectedName,
                        styles.productSelectedNameCompact,
                        !form.itemId && styles.productSelectedNameEmpty,
                      ]}
                      numberOfLines={1}
                    >
                      {form.itemLabel || 'Henüz desen seçilmedi'}
                    </Text>
                  </View>
                </View>
              </View>
            ) : (
              // Tablet: büyük "Ürün Seç" butonu + yanında seçili ürün adı (saha
              // kullanımı için büyük dokunma hedefi + tek bakışta okunur seçim).
              <View style={styles.productRowTablet}>
                <Button
                  mode="contained-tonal"
                  icon="cube-outline"
                  uppercase={false}
                  onPressIn={blurAll}
                  onPress={() => {
                    blurAll();
                    setPickerOpen('item');
                  }}
                  style={styles.productBtnTablet}
                  contentStyle={styles.productBtnTabletContent}
                  labelStyle={styles.productBtnTabletLabel}
                >
                  Desen Seç
                </Button>
                <View
                  style={[
                    styles.productSelectedBox,
                    !!form.itemId && styles.productSelectedBoxActive,
                  ]}
                >
                  <Text style={styles.productSelectedCaption}>Seçilen Desen</Text>
                  <View style={styles.productSelectedValueRow}>
                    {!!form.itemId && (
                      <Icon source="check-circle" size={20} color={colors.success} />
                    )}
                    <Text
                      style={[
                        styles.productSelectedName,
                        !form.itemId && styles.productSelectedNameEmpty,
                      ]}
                      numberOfLines={1}
                    >
                      {form.itemLabel || 'Henüz desen seçilmedi'}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {rawWidthEnabled && (
              <>
                <Text style={[styles.label, styles.labelSpaced]}>En (cm)</Text>
                <View style={styles.widthRow}>
                  <NumpadInput
                    ref={widthRef}
                    mode="outlined"
                    value={form.width}
                    onChangeText={(v) => setForm((f) => ({ ...f, width: v }))}
                    numpadLabel="En (cm)"
                    placeholder="örn: 280 (opsiyonel)"
                    style={[styles.input, styles.widthInput]}
                    contentStyle={styles.widthInputContent}
                    useNativeKeyboard={compact}
                    // ⚠️ MANUEL MODDA HEDEFİ METRAJA BIRAK. İki alan da
                    // `autoActivate` olsaydı kazanan MOUNT SIRASI olurdu (En
                    // sonra mount olduğu için o kazanırdı) ve operatör metraj
                    // beklerken tuşlar EN'i değiştirirdi — sessiz ve yanlış.
                    // Otomatik modda metraj kantardan/metreden gelir, operatörün
                    // gireceği tek sayı En'dir; orada varsayılan yine En.
                    autoActivate={!compact && !manualMode}
                  />
                  <IconButton
                    icon="backspace-outline"
                    mode="contained-tonal"
                    size={24}
                    onPress={handleClearWidth}
                    disabled={!form.width}
                    accessibilityLabel="En'i temizle"
                    style={styles.widthClearBtn}
                  />
                </View>
              </>
            )}

            {qualityGradesQuery.isLoading ? (
              <View style={styles.segmentLoading}>
                <ActivityIndicator size="small" color="#4f46e5" />
              </View>
            ) : qualityGrades.length === 0 ? (
              <Text style={styles.segmentEmpty}>
                {qualityGradesQuery.isError
                  ? 'Kalite listesi yüklenemedi'
                  : 'Tanımlı kalite sınıfı yok'}
              </Text>
            ) : (
              <View
                style={[
                  styles.segmentRow,
                  compact && styles.segmentRowCompact,
                  !compact && styles.segmentRowTablet,
                ]}
              >
                {qualityGrades.map((qg) => (
                  <QualitySegment
                    key={qg.id}
                    grade={qg}
                    selected={form.qualityGrade === qg.code}
                    onPress={handleQualityGradeSelect}
                    compact={compact}
                  />
                ))}
              </View>
            )}
          </Surface>

        </KeyboardAwareScrollView>

        {/* Sticky footer — "Kaydet ve Etiket Bas" forma kaydırmaya gerek
            kalmadan her zaman en altta görünür.
            OFFLINE-AWARE: mutation'a disabled binding YOK — paused mutation
            isPending kalsa da sıradaki kayıt engellenmesin. Yalnız `pulling`
            (makineden okuma, ~1sn) sırasında çift-tetiklemeyi kilitleriz.
            RETRY DURUMU (2026-08-03): son deneme düştüyse CTA "Tekrar Dene"ye
            döner ve AYNI token'ı gönderir. Operatörün refleksi zaten "aynı büyük
            tuşa basmak" — o refleks artık kopya değil retry üretir. Ayrı bir
            "tekrar" butonu KOYULMADI: kimse onu aramaz, herkes büyük tuşa basar. */}
        <Animated.View
          style={[
            styles.submitFooter,
            compact ? styles.submitFooterCompact : styles.submitFooterTablet,
            // Telefon: footer absolute + yumuşak klavye takibi (bottom animasyonlu).
            compact && footerAnimStyle,
          ]}
        >
          {/* SCAN-BACK BANDI (yalnız bayrak açıkken): basılan etiket geri
              okutulmadan yeni top girilemez. İndigo = "sıradaki adım" (kırmızı
              hata, amber durum bandlarından bilinçli ayrı kutup). Dokununca
              tarayıcı açılır; Kaydet butonu da aynı yere yönlendirir. */}
          {verifyPending && (
            <TouchableRipple
              borderless
              onPress={() => setVerifyScanOpen(true)}
              rippleColor="rgba(79,70,229,0.15)"
              style={styles.verifyBanner}
            >
              <View style={styles.verifyBannerInner}>
                <Icon source="barcode-scan" size={18} color="#4338ca" />
                <Text style={styles.verifyText}>
                  Çıkan etiketi OKUT ({verifies.length}):{' '}
                  {verifies
                    .slice(0, 2)
                    .map((v) => v.barcode)
                    .join(', ')}
                  {verifies.length > 2 ? '…' : ''}
                </Text>
                {/* KAÇIŞ YOLU (inceleme bulgusu): etiket lekeli/okunmuyor ya da
                    kayıpsa borç kapıyı SÜRESİZ kilitlerdi (48 sa kalıcı) ve tek
                    çıkış admin'in bayrağı kapatmasıydı. "Tekrar Bas" bekleyen
                    borçların etiketini yeniden basar → taze kâğıt okutulur,
                    borç normal yoldan kapanır. Borcu SİLME yolu bilinçli YOK. */}
                <Button
                  mode="outlined"
                  compact
                  textColor="#4338ca"
                  disabled={!isOnline}
                  onPress={() => {
                    for (const v of verifies) void printBarcode(v.barcode);
                  }}
                  style={{ borderColor: '#4f46e5', borderWidth: 1.5 }}
                  labelStyle={styles.labelFailBtnLabel}
                >
                  Tekrar Bas
                </Button>
                <Button
                  mode="contained"
                  compact
                  buttonColor="#4338ca"
                  textColor="#fff"
                  onPress={() => setVerifyScanOpen(true)}
                  labelStyle={styles.labelFailBtnLabel}
                >
                  Okut
                </Button>
              </View>
            </TouchableRipple>
          )}
          {/* ETİKET ÇIKMADI BANDI (her iki rejimde): köşedeki çip yeterince
              görünür değildi — operatör etiketi çıkmayan topu sistemde yok
              sanıp YENİDEN giriyordu (07.08 vakası). Bant operatörün baktığı
              yerde (Kaydet butonunun üstünde) durur ve iki şeyi söyler:
              top KAYITLI + tek dokunuşla tekrar bas. Kalıcı store'dan
              beslendiği için uygulama yeniden başlasa da görünür. */}
          {failedPrints.length > 0 && (
            // BANT ARTIK TEK YÜZEY (2026-08-12): header'daki "N ETİKET HATALI"
            // çipi kaldırıldı, onun tek işi olan detay listesi buraya bağlandı.
            // Banda dokunmak yazıcı kuyruğunu açar (hangi barkodlar, tek tek
            // tekrar/sil); "Tekrar Bas" ise hepsini tek dokunuşla dener ve
            // operatörün %90 durumda isteyeceği şey odur — o yüzden dışarıda.
            // ⚠️ TouchableRipple TEK element çocuk ister (2.5.0'daki
            // Children.only çökmesi) — sarılan View bilinçli olarak tek.
            <TouchableRipple
              onPress={() => setQueueOpen(true)}
              rippleColor="rgba(185,28,28,0.15)"
              style={styles.labelFailBannerTouch}
              accessibilityRole="button"
              accessibilityLabel={`Etiket çıkmadı, ${failedPrints.length} top. Listeyi açmak için dokun`}
            >
              <View style={styles.labelFailBanner}>
                <Icon source="printer-off" size={18} color="#b91c1c" />
                <Text style={styles.labelFailText}>
                  Etiket çıkmadı — {failedPrints.length} top. Top sistemde KAYITLI,
                  yeniden girme.
                </Text>
                <Button
                  mode="contained"
                  compact
                  buttonColor="#b91c1c"
                  textColor="#fff"
                  // Baskı içeriği sunucudan çekilir → çevrimdışıyken denemek
                  // anlamsız; kilit + (varsa) offline bandı sebebini söyler.
                  disabled={!isOnline}
                  onPress={() => usePrintQueue.getState().retryAllFailed()}
                  labelStyle={styles.labelFailBtnLabel}
                >
                  Tekrar Bas
                </Button>
                <Icon source="chevron-right" size={20} color="#b91c1c" />
              </View>
            </TouchableRipple>
          )}
          {/* ONLINE-ONLY: çevrimdışıyken buton kilitli + üstünde sebep bandı.
              Sebep operatörün yapacağı işi söyler — wifi mi, sunucu mu. */}
          {onlineOnly && !isOnline && (
            <View style={styles.offlineLockBanner}>
              <Icon source="wifi-off" size={18} color="#b45309" />
              <Text style={styles.offlineLockText}>
                {offlineWhy === 'server'
                  ? 'Sunucuya ulaşılamıyor — kayıt girilemez. Sunucu dönünce devam edin; sürerse yetkiliye haber verin.'
                  : 'Ağ bağlantısı yok — kayıt girilemez. Wifi bağlantısını kontrol edin; toplar bağlantı gelince girilir.'}
              </Text>
              {/* ÇIKIŞ KAPISI (2026-08-12): çevrimdışıyken sorgular duraklar,
                  yani hiçbir gerçek istek çıkmaz ve otomatik yoklama tek
                  tetikleyicidir. Yoklama bir sebeple tutmazsa ekran kalıcı
                  kilitlenir (gerçek vaka: yoklama yanlış adresi soruyordu).
                  Bu tuş operatöre backoff'u beklemeden deneme hakkı verir —
                  sunucu döndüğünde 10 sn'yi de beklemesin. */}
              <Button
                mode="contained"
                compact
                buttonColor="#b45309"
                textColor="#fff"
                loading={retryingLink}
                disabled={retryingLink}
                onPress={handleRetryConnection}
                labelStyle={styles.labelFailBtnLabel}
              >
                Şimdi dene
              </Button>
            </View>
          )}
          <Button
            mode="contained"
            icon={
              pulling || sending
                ? undefined
                : justSaved
                  ? 'check-bold'
                  : retrying
                    ? 'refresh'
                    : 'package-check'
            }
            onPress={handleSubmit}
            loading={pulling || sending}
            // `disabled` YALNIZ `pulling` — uçuşta buton BASILABİLİR kalır.
            // Disabled buton geri bildirim vermez, operatör "dondu" sanıp daha
            // sert basar; onun yerine aynı yükle gelen basış uçuştaki KİMLİĞİ
            // yeniden kullanır (entryAttempt: reuse-inflight) → tek kayıt.
            // İSTİSNA — online-only rejimde çevrimdışı: kayıt alınamayacak,
            // basılabilir buton yalan söylerdi; kilit + yukarıdaki bant birlikte.
            disabled={pulling || (onlineOnly && !isOnline)}
            buttonColor={
              justSaved ? colors.success : retrying ? colors.warningDark : undefined
            }
            style={styles.submitBtn}
            contentStyle={[styles.submitBtnContent, !compact && styles.submitBtnContentTablet]}
            labelStyle={[styles.submitBtnLabel, !compact && styles.submitBtnLabelTablet]}
          >
            {onlineOnly && !isOnline
              ? 'Çevrimdışı — kayıt kapalı'
              : verifyPending
                ? 'Önce Etiketi OKUT'
                : pulling
                  ? 'Makineden okunuyor…'
                  : justSaved
                    ? 'Kaydedildi ✓'
                    : sending
                      ? 'Kaydediliyor… bekle'
                      : retrying
                        ? 'Tekrar Dene (aynı top)'
                        : 'Kaydet ve Etiket Bas'}
          </Button>
        </Animated.View>
        </View>

        {/* ── SAĞ: Üstte son kayıtlar listesi + altta Numpad. Aksiyonlar header'da;
            "Son Kayıtlar" başlığı KALDIRILDI (kullanıcı isteği — liste kendini
            anlatıyor, başlık yer kaplıyordu). ── */}
        {!compact && (
          <View style={styles.recentsCol}>
            <View style={styles.recentsList}>
              {recentRollsQuery.isLoading ? (
                <SkeletonList count={6} />
              ) : recentRollsQuery.isError ? (
                <AnimatedEntrance direction="fade" style={styles.recentsEmpty}>
                  <Text style={styles.recentsEmptyText}>Liste yüklenemedi</Text>
                  <Text style={styles.recentsEmptyHint}>
                    {(recentRollsQuery.error as Error).message}
                  </Text>
                  <Button mode="outlined" onPress={() => recentRollsQuery.refetch()} style={{ marginTop: 12 }}>
                    Tekrar dene
                  </Button>
                </AnimatedEntrance>
              ) : recentRolls.length === 0 ? (
                <AnimatedEntrance direction="fade" style={styles.recentsEmpty}>
                  <Text style={styles.recentsEmptyText}>Henüz kayıt yok</Text>
                  <Text style={styles.recentsEmptyHint}>
                    Kaydedilen toplar burada görünecek
                  </Text>
                </AnimatedEntrance>
              ) : (
                <FlashList
                  ref={recentsListRef}
                  data={recentRolls}
                  keyExtractor={(r) => r.id}
                  extraData={flashRollId}
                  // FlashList v2'de "görünür pozisyonu koru" VARSAYILAN AÇIK: yeni
                  // kayıt tepeye eklenince liste mevcut bakış yerini sabit tutup
                  // bizim scrollToOffset(0)'ı eziyordu ("yeni kayıt düşüyor ama
                  // tepeye çıkmıyor"). Dev eşik = her prepend'de NATIVE tepeye kay.
                  maintainVisibleContentPosition={{ autoscrollToTopThreshold: 100000 }}
                  renderItem={({ item }) => (
                    <RollListItem
                      roll={item}
                      isNew={item.id === flashRollId}
                      onPrint={handlePrintLabel}
                      onScrap={handleScrapRoll}
                    />
                  )}
                  contentContainerStyle={styles.recentsListContent}
                  showsVerticalScrollIndicator
                />
              )}
            </View>

            {/* Numpad yalnızca sayısal alan varken: en girişi (flag) açık VEYA
                manuel mt/kg açık. İkisi de kapalıysa girilecek değer yok →
                numpad gizlenir, boşuna yer kaplamaz. Üstünde kalın marka-renkli
                ayraç → "Son Kayıtlar" ile numpad ayrımı net. */}
            {(rawWidthEnabled || manualMode) && (
              <>
                <View style={styles.numpadDivider} />
                <NumpadHost style={styles.numpadHost} />
              </>
            )}
          </View>
        )}
      </View>

      {/* Compact modda sağdan kayan son kayıtlar drawer'ı */}
      {compact && (
        <RecentsDrawer
          visible={recentsDrawerOpen}
          onDismiss={() => setRecentsDrawerOpen(false)}
          onClosed={handleDrawerClosed}
          totalCount={totalCount}
          rolls={recentRolls}
          loading={recentRollsQuery.isLoading}
          error={recentRollsQuery.isError ? (recentRollsQuery.error as Error) : null}
          refresh={refresh}
          onOpenHistory={() => {
            // Drawer kapanış animasyonu bitince history açılır (iki-modal çakışması).
            pendingHistoryRef.current = true;
            setRecentsDrawerOpen(false);
          }}
          onPrint={handlePrintLabel}
          onScrap={handleScrapRoll}
        />
      )}

      {/* ── Tüm kayıtlar modal'ı ── */}
      <RollHistoryModal
        visible={historyOpen}
        onDismiss={() => setHistoryOpen(false)}
        onClosed={drainPendingScrap}
        onPrint={handlePrintLabel}
        onScrap={handleScrapRoll}
      />

      {/* ── Yazıcı kuyruğu görünümü (çipe dokununca): basılıyor / sırada / başarısız ── */}
      {/* ── Scan-back tarayıcısı (yalnız bayrak açıkken açılabilir): basılan
            etiketin kâğıdını geri okut → borç düşer. continuous: birden fazla
            bekleyen varsa modal açık kalır, hepsi peş peşe okutulur.
            ⚠️ trigger="tap" — çok-okutmalı yüzey sözleşmesi (mobil CLAUDE.md):
            yazıcı çıkışında etiketler üst üste durur; kendiliğinden okuyan
            kamera KOMŞU etiketi yakalayıp onun borcunu düşürürdü — doğrulanan
            şey elindeki kâğıt olmalı, kadraja giren herhangi bir kâğıt değil.
            captureHaptic kapalı — kabul/ret sinyalini handleVerifyScan verir
            (signalScan); görsel sonuç ekran-içi flash. */}
      <BarcodeScannerModal
        visible={verifyScanOpen}
        onDismiss={() => {
          setVerifyScanOpen(false);
          setVerifyFlash(null);
        }}
        onScan={handleVerifyScan}
        title="Etiket Doğrulama — çıkan kâğıdı okut"
        notice={`Okutulacak ${verifies.length} etiket`}
        continuous
        trigger="tap"
        flash={verifyFlash}
        captureHaptic={false}
      />
      <PrintQueueModal
        visible={queueOpen}
        onDismiss={() => setQueueOpen(false)}
        active={activePrintRoll}
        queue={printQueue}
        failed={failedPrints}
        onRetry={retryFailedPrint}
        onRemove={removeFromQueue}
        onDismissFailed={dismissFailedPrint}
      />

      {/* ── Bu oturumda girilenler ("Bu oturum" rozetine dokununca) ── */}
      <SessionRollsModal
        visible={sessionListOpen}
        onDismiss={() => setSessionListOpen(false)}
        rolls={sessionRolls}
        sessionCount={sessionCount}
        onPrint={handlePrintLabel}
      />

      {/* ── Picker Modal'lar ── */}
      <PickerModal
        visible={pickerOpen === 'item'}
        title="Desen Seç"
        options={itemOptions}
        selectedValue={form.itemId}
        loading={itemsQuery.isLoading}
        onDismiss={() => {
          setPickerOpen(null);
          setDesenAddOpen(false);
        }}
        onSelect={(value) => {
          const item = itemOptions.find((o) => o.value === value);
          setForm((f) => ({
            ...f,
            itemId: value,
            // Yalnız kumaş adı görünsün (kod değil) — sublabel (kod) atlanır.
            itemLabel: item ? item.label : '',
          }));
        }}
        /* Tetik: listenin ilk hücresindeki MOR kart — diğer desen kartlarıyla aynı
           geometride ama beyaz yazılı, sıralama/arama ne olursa olsun ilk sırada.
           Basılınca picker kapanmaz, alttaki ad girişi satırı açılır. */
        leadingAction={
          canAddDesen
            ? {
                label: 'Yeni Desen',
                sublabel: isOnline ? 'Listede yok — hemen ekle' : 'Çevrimiçi gerekir',
                icon: 'plus',
                disabled: !isOnline,
                onPress: () => setDesenAddOpen(true),
              }
            : undefined
        }
        quickAddSlot={
          canAddDesen && desenAddOpen ? (
            <QuickAddDesenRow
              disabled={!isOnline}
              onCancel={() => setDesenAddOpen(false)}
              onCreated={(item) => {
                // Response'tan doğrudan seç (liste refetch/truncation yarışını atla),
                // listeyi tazele (sonraki açılışta görünsün) ve picker'ı kapat.
                setForm((f) => ({ ...f, itemId: item.id, itemLabel: item.name }));
                void itemsQuery.refetch();
                setDesenAddOpen(false);
                setPickerOpen(null);
              }}
            />
          ) : undefined
        }
      />

      {/* ── Etiket yazıcı (headless): activePrintRoll set olunca QR + A4 PDF üretir.
            onDone queue'dan bir sonrakini alır. Roll değişimi LabelPrinter'ın
            firedRef'ini reset edebilmesi için 'key' prop'una roll.id veriyoruz —
            her print için fresh mount. */}
      <LabelPrinter
        key={activePrintRoll?.id ?? 'idle'}
        roll={activePrintRoll}
        kind="ROLL_RAW"
        onDone={handlePrintDone}
        onResult={handlePrintResult}
      />

      {/* ── Scrap onay modal'ı (Depo "Stoktan Kaldır" ile ORTAK bileşen) ── */}
      <RollCancelModal
        roll={scrapTarget}
        preview={cancelPreview}
        previewLoading={cancelPreviewQuery.isLoading}
        previewError={
          cancelPreviewQuery.isError
            ? (cancelPreviewQuery.error as Error)
            : null
        }
        offline={!isOnline}
        loading={scrapMutation.isPending}
        onDismiss={() => setScrapTarget(null)}
        onConfirm={confirmScrap}
      />

      <EntryConflictModal
        kind={conflict?.kind ?? 'TOKEN_COLLISION'}
        barcode={conflict?.barcode ?? null}
        visible={!!conflict}
        printing={conflictPrinting}
        onPrintExisting={printConflictingRoll}
        onSaveAsNew={saveConflictAsNew}
      />

    </ScreenChrome>
  );
}

// ── Son Kayıtlar Drawer (compact / telefon) ──
interface RecentsDrawerProps {
  visible: boolean;
  onDismiss: () => void;
  /** Kapanma animasyonu bittiğinde — RNModal stack çakışmasını çözmek için. */
  onClosed?: () => void;
  totalCount: number;
  rolls: Roll[];
  loading: boolean;
  error: Error | null;
  refresh: ManualRefresh;
  onOpenHistory: () => void;
  onPrint: (roll: Roll) => void;
  onScrap: (roll: Roll) => void;
}

function RecentsDrawer({
  visible,
  onDismiss,
  onClosed,
  totalCount,
  rolls,
  loading,
  error,
  refresh,
  onOpenHistory,
  onPrint,
  onScrap,
}: RecentsDrawerProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Telefon dar; drawer genişliği ekranın %85'i veya max 380px
  const drawerWidth = Math.min(winW * 0.85, 380);

  return (
    <AppModal
      visible={visible}
      onDismiss={onDismiss}
      position="right"
      onHidden={onClosed}
    >
      <View
        style={[
          drawerStyles.sheet,
          {
            width: drawerWidth,
            height: '100%',
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 12,
            paddingRight: Math.max(insets.right, 12),
          },
        ]}
      >
        <View style={drawerStyles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="titleLarge" style={drawerStyles.title}>
              Son Kayıtlar
            </Text>
            <Text variant="bodySmall" style={drawerStyles.subtitle}>
              Toplam {totalCount} kayıt
            </Text>
          </View>
          <RefreshButton
            onPress={refresh.onRefresh}
            refreshing={refresh.refreshing}
            isError={refresh.isError}
            errorMessage={refresh.errorMessage}
            successMessage={refresh.successMessage}
          />
          <IconButton icon="close" size={24} onPress={onDismiss} accessibilityLabel="Kapat" />
        </View>

        <View style={drawerStyles.listBox}>
          {loading ? (
            <SkeletonList count={7} />
          ) : error ? (
            <AnimatedEntrance direction="fade" style={drawerStyles.empty}>
              <Text style={drawerStyles.emptyText}>Liste yüklenemedi</Text>
              <Text style={drawerStyles.emptyHint}>{error.message}</Text>
              <Button mode="outlined" onPress={refresh.onRefresh} style={{ marginTop: 12 }}>
                Tekrar dene
              </Button>
            </AnimatedEntrance>
          ) : rolls.length === 0 ? (
            <AnimatedEntrance direction="fade" style={drawerStyles.empty}>
              <Text style={drawerStyles.emptyText}>Henüz kayıt yok</Text>
              <Text style={drawerStyles.emptyHint}>
                Kaydedilen toplar burada görünecek
              </Text>
            </AnimatedEntrance>
          ) : (
            <FlashList
              data={rolls}
              keyExtractor={(r) => r.id}
              renderItem={({ item }) => (
                <RollListItem roll={item} onPrint={onPrint} onScrap={onScrap} compactLayout={true} />
              )}
              contentContainerStyle={drawerStyles.listContent}
              showsVerticalScrollIndicator
            />
          )}
        </View>

        <Button
          mode="outlined"
          icon="format-list-bulleted"
          onPress={onOpenHistory}
          style={drawerStyles.historyBtn}
        >
          Tüm Girişler
        </Button>
      </View>
    </AppModal>
  );
}

const drawerStyles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    paddingLeft: 16,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginBottom: 8,
  },
  title: { fontWeight: '700', color: '#0f172a' },
  subtitle: { color: '#64748b', marginTop: 2 },
  listBox: { flex: 1, minHeight: 0 },
  listContent: { paddingVertical: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 4 },
  emptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#cbd5e1' },
  historyBtn: { marginTop: 10 },
});

// ── Tüm Kayıtlar Modal ──
interface RollHistoryModalProps {
  visible: boolean;
  onDismiss: () => void;
  /** Kapanma animasyonu bittiğinde — RNModal stack çakışmasını çözmek için. */
  onClosed?: () => void;
  onPrint: (roll: Roll) => void;
  onScrap: (roll: Roll) => void;
}

function RollHistoryModal({
  visible,
  onDismiss,
  onClosed,
  onPrint,
  onScrap,
}: RollHistoryModalProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isPhone = useDeviceType() === 'phone';

  // ── Cursor + infinite scroll (offset/sayfa YOK) ──
  // Liste sona yaklaşınca bir sonraki sayfa keyset cursor ile çekilir; derin
  // sayfada offset taraması + her sayfada COUNT(*) yok. Toplam yalnız ilk
  // sayfada (withTotal) yaklaşık olarak gelir.
  // ── Filtre (zaman + kumaş) — Tambur listesiyle ORTAK bileşen ──
  // Süzme SUNUCUDA yapılır: liste cursor'lu sonsuz kaydırma olduğu için
  // istemcide süzmek yalnız o anki sayfayı süzer ve operatör "kayıt yok"
  // sanardı — oysa kayıt bir sonraki sayfadadır.
  const [filter, setFilter] = useState<RollHistoryFilterState>(EMPTY_ROLL_FILTER);
  const filterKey = filterQueryKey(filter);
  // KAPSAM (2026-08-12 saha kararı): bayrak KAPALIYKEN (varsayılan) liste yalnız
  // oturumdaki operatörün KENDİ girdiği toplar — sunucuya zorunlu
  // filter[createdById] gider ve "Personel" çipi HİÇ ÇİZİLMEZ (ölü filtre
  // "bastım, olmadı" üretir). Bayrak AÇIKKEN herkesin kayıtları + Personel çipi.
  // ENFORCE istemcide: bu bir yetki duvarı değil ekran sadeleştirmesi (panel
  // roll:read ile aynı veriyi zaten görür); bayrak yüklenemezse DAR kapsama
  // düşülür — az göstermek, yanlışlıkla fazla göstermekten iyidir.
  const allEntries = useKk1HistoryAllEntriesEnabled();
  const authUserId = useAuthStore((st) => st.user?.userId) ?? null;
  const forcedCreatorId = allEntries ? null : authUserId;

  const itemsQuery = useQuery({
    queryKey: ['items', 'filter', 'FABRIC'],
    queryFn: () =>
      itemService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: 'code',
        sortOrder: 'asc',
        filters: { isActive: 'true', itemType: 'FABRIC' },
      }),
    enabled: visible,
  });
  // Personel seçenekleri yalnız bayrak açıkken çekilir (kapalıyken çip yok).
  const operatorsQuery = useQuery({
    queryKey: ['rolls', 'entry-users'],
    queryFn: () => rollService.getEntryUsers(),
    enabled: visible && allEntries,
    staleTime: 5 * 60 * 1000,
  });
  const operatorOptions = useMemo<PickerOption[] | undefined>(
    () =>
      allEntries
        ? (operatorsQuery.data?.data ?? []).map((u) => ({
            value: u.id,
            label: u.name,
            sublabel: u.code ?? undefined,
          }))
        : undefined,
    [allEntries, operatorsQuery.data],
  );
  const stationsQuery = useQuery({
    queryKey: ['rolls', 'entry-stations'],
    queryFn: () => rollService.getEntryStations(),
    enabled: visible,
    staleTime: 5 * 60 * 1000,
  });
  // Tek giriş istasyonu varken çip GEREKSİZ — ayırt edeceği bir şey yok; ikinci
  // istasyon açıldığı gün kendiliğinden belirir (seçenek listesi veriden gelir).
  const entryStationOptions = useMemo<PickerOption[] | undefined>(() => {
    const rows = stationsQuery.data?.data ?? [];
    if (rows.length < 2) return undefined;
    return rows.map((st) => ({ value: st.id, label: st.name, sublabel: st.code ?? undefined }));
  }, [stationsQuery.data]);
  const itemOptions = useMemo<PickerOption[]>(
    () =>
      (itemsQuery.data?.data ?? []).map((i) => ({
        value: i.id,
        label: i.name,
        sublabel: i.code,
      })),
    [itemsQuery.data],
  );

  const q = useInfiniteQuery({
    // Kapsam anahtara GİRER: bayrak panelden çevrildiğinde "kendi kayıtlarım"
    // önbelleği "herkes" listesi olarak geri gelmesin.
    queryKey: ['rolls', 'kk1', 'history', filterKey, forcedCreatorId ?? 'all'],
    queryFn: ({ pageParam }) => {
      // Gün sınırı SORGU ANINDA çözülür — `now` anahtara girmez, yoksa liste
      // her render'da yeniden çekilirdi.
      const fp = buildRollQueryParams(filter, new Date());
      return rollService.getAllCursor({
        limit: HISTORY_PAGE_SIZE,
        cursor: pageParam,
        // Bkz. yukarıdaki "Son kayıtlar" sorgusu — aynı CSV kapsam gerekçesi.
        // Zorunlu kapsam EN SONA yazılır: bayrak kapalıyken çipten sızabilecek
        // herhangi bir createdById'yi de ezer (savunma hattı — çip zaten yok).
        filters: {
          entrySource: 'SUPPLIER_RECEIPT,MANUAL_ENTRY',
          ...fp.filters,
          ...forcedCreatorFilter(allEntries, authUserId),
        },
        dateField: fp.dateField,
        dateFrom: fp.dateFrom,
        dateTo: fp.dateTo,
        withTotal: !pageParam,
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.nextCursor : undefined,
    enabled: visible,
    placeholderData: keepPreviousData,
  });
  // Modal her açılışta ilk sayfayı tazele — yeni KK1 girişleri hemen görünsün.
  useRefetchOnOpen(q.refetch, visible);

  const rolls = useMemo(
    () => q.data?.pages.flatMap((p) => p.data) ?? [],
    [q.data],
  );
  // withTotal ilk sayfada → totalEstimate. Cursor modunda yaklaşık (anlık).
  const totalCount = q.data?.pages[0]?.pagination.totalEstimate ?? 0;

  const refresh = useManualRefresh(() => q.refetch(), 'Liste güncellendi');

  // FlashList açılışta/önceki scroll konumunu koruyor → modal her AÇILDIĞINDA
  // başa sar (en yeni kayıt tepede). Sonraki sayfalar alta eklenir; viewport'u
  // oynatmaz, o yüzden sadece `visible`'a bağlı (sayfa eklenince başa atlamaz).
  const listRef = useRef<FlashListRef<Roll>>(null);
  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
  }, [visible]);

  return (
    <AppModal
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onClosed}
      // Boyutu contentStyle ile AppModal'a veriyoruz → sarmalayıcı genişliği
      // sheet'e eşitlenir ve ekranda DÜZGÜN ortalanır. (Boyutu içteki View'a
      // verince AppModal 560px "overflow-ortalama" yoluna düşüyor; tablette
      // geniş sheet tam ortalanmıyordu — telefon/tablet maxWidth/maxHeight ile
      // güvenli alanı, çubuk/çentik altından kurtarır.)
      contentStyle={[
        historyStyles.sheet,
        {
          width: winW * (isPhone ? 0.96 : 0.85),
          height: winH * (isPhone ? 0.86 : 0.92),
          maxWidth: winW - 2 * Math.max(insets.left, insets.right) - 24,
          maxHeight: winH - 2 * Math.max(insets.top, insets.bottom) - 24,
        },
      ]}
    >
        <View style={historyStyles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="titleLarge" style={historyStyles.title}>
              Tüm Ham Giriş Kayıtları
            </Text>
            <Text variant="bodySmall" style={historyStyles.subtitle}>
              Toplam {totalCount} kayıt
              {/* Kapsamı SÖYLE: dar listeye bakan operatör "kayıtlar silinmiş"
                  sanmasın — daralma bir ayardır ve burada yazar. */}
              {forcedCreatorId ? ' · yalnız senin girişlerin' : ''}
            </Text>
          </View>
          <RefreshButton
            onPress={refresh.onRefresh}
            refreshing={refresh.refreshing}
            isError={refresh.isError}
            errorMessage={refresh.errorMessage}
            successMessage={refresh.successMessage}
          />
          <IconButton icon="close" size={28} onPress={onDismiss} accessibilityLabel="Kapat" />
        </View>

        {/* Ortak filtre şeridi — Tambur "Son Çıkan Toplar" ile AYNI bileşen. */}
        <RollFilterBar
          value={filter}
          onChange={setFilter}
          itemOptions={itemOptions}
          itemsLoading={itemsQuery.isLoading}
          onItemPickerOpen={() => void itemsQuery.refetch()}
          operatorOptions={operatorOptions}
          operatorsLoading={operatorsQuery.isLoading}
          entryStationOptions={entryStationOptions}
          entryStationsLoading={stationsQuery.isLoading}
        />

        <View style={historyStyles.listBox}>
          {q.isLoading ? (
            <SkeletonList count={isPhone ? 8 : 10} />
          ) : q.isError ? (
            <View style={historyStyles.empty}>
              <Text style={historyStyles.emptyText}>Liste yüklenemedi</Text>
              <Text style={historyStyles.emptyHint}>{(q.error as Error)?.message}</Text>
              <Button mode="outlined" onPress={refresh.onRefresh} style={{ marginTop: 12 }}>
                Tekrar dene
              </Button>
            </View>
          ) : rolls.length === 0 ? (
            <View style={historyStyles.empty}>
              <Text style={historyStyles.emptyText}>Kayıt yok</Text>
            </View>
          ) : (
            <FlashList
              ref={listRef}
              data={rolls}
              keyExtractor={(r) => r.id}
              // Kart kenarlığı liste sınırına YAPIŞMASIN — 2px nefes payı.
              contentContainerStyle={historyStyles.listContent}
              // FlashList v2'de maintainVisibleContentPosition VARSAYILAN AÇIK:
              // modal açılırken refetch yeni kaydı başa eklediğinde liste eski
              // üst satıra "tutunup" yeni kaydı görüş alanının ÜSTÜNE itiyordu
              // (en yeni gizli, 2. sıradaki başta). Bu liste hep createdAt desc
              // ve hep tepeden başlamalı → tutunmayı kapat, scrollToOffset(0)
              // yarışı kaybetmesin. (Sonraki sayfalar ALTA eklenir; tutunma kapalı
              // olduğundan viewport'u oynatmaz.)
              maintainVisibleContentPosition={{ disabled: true }}
              onEndReachedThreshold={0.6}
              onEndReached={() => {
                if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
              }}
              ListFooterComponent={
                q.isFetchingNextPage ? (
                  <View style={historyStyles.loadingMore}>
                    <ActivityIndicator size="small" color="#64748b" />
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <RollListItem
                  roll={item}
                  onPrint={onPrint}
                  onScrap={onScrap}
                  compactLayout={isPhone}
                  singleLine={!isPhone}
                />
              )}
            />
          )}
        </View>
    </AppModal>
  );
}

const historyStyles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginBottom: 8,
  },
  title: { fontWeight: '700', color: '#0f172a' },
  subtitle: { color: '#64748b', marginTop: 2 },
  listBox: { flex: 1 },
  listContent: { paddingHorizontal: 2 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 4 },
  emptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#cbd5e1' },
  loadingMore: { paddingVertical: 16, alignItems: 'center' },
});

// ── Yazıcı Kuyruğu Modal ──
// Kuyruk çipine dokununca: ne basılıyor, sırada neler var, neler BAŞARISIZ.
// Başarısızlar Tekrar Dene ile yeniden kuyruğa alınır; sırada bekleyen çıkarılabilir
// (basılmakta olan durdurulamaz — HC-06'ya baytlar zaten akıyor olabilir).
function PrintQueueModal({
  visible,
  onDismiss,
  active,
  queue,
  failed,
  onRetry,
  onRemove,
  onDismissFailed,
}: {
  visible: boolean;
  onDismiss: () => void;
  active: Roll | null;
  queue: Roll[];
  failed: { roll: Roll; error: string }[];
  onRetry: (roll: Roll) => void;
  onRemove: (id: string) => void;
  onDismissFailed: (id: string) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const rollTitle = (r: Roll) =>
    r.item?.name ? `${r.item.name} · ${r.barcode ?? '—'}` : (r.barcode ?? '—');
  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <View style={[qmStyles.card, { width: Math.min(winW - 32, 620), maxHeight: winH * 0.85 }]}>
        <View style={qmStyles.header}>
          <Icon source="printer" size={22} color={colors.brand} />
          <Text style={qmStyles.title}>Yazıcı Kuyruğu</Text>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" size={20} onPress={onDismiss} accessibilityLabel="Kapat" />
        </View>
        <ScrollView contentContainerStyle={qmStyles.body} showsVerticalScrollIndicator>
          {failed.length > 0 && (
            <>
              <Text style={[qmStyles.section, qmStyles.sectionFailed]}>
                Başarısız ({failed.length})
              </Text>
              {failed.map(({ roll, error }) => (
                <View key={roll.id} style={[qmStyles.row, qmStyles.rowFailed]}>
                  <View style={qmStyles.rowText}>
                    <Text style={qmStyles.rowTitle} numberOfLines={1}>
                      {rollTitle(roll)}
                    </Text>
                    <Text style={qmStyles.rowError} numberOfLines={2}>
                      {error}
                    </Text>
                  </View>
                  <Button
                    mode="contained"
                    compact
                    buttonColor="#dc2626"
                    onPress={() => onRetry(roll)}
                    labelStyle={qmStyles.rowBtnLabel}
                  >
                    Tekrar Dene
                  </Button>
                  <IconButton
                    icon="close"
                    size={18}
                    onPress={() => onDismissFailed(roll.id)}
                    accessibilityLabel="Listeden çıkar"
                  />
                </View>
              ))}
            </>
          )}

          <Text style={qmStyles.section}>Basılıyor</Text>
          {active ? (
            <View style={qmStyles.row}>
              <ActivityIndicator size="small" color={colors.brand} />
              <View style={qmStyles.rowText}>
                <Text style={qmStyles.rowTitle} numberOfLines={1}>
                  {rollTitle(active)}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={qmStyles.empty}>Şu an basılan etiket yok</Text>
          )}

          <Text style={qmStyles.section}>Sırada ({queue.length})</Text>
          {queue.length === 0 ? (
            <Text style={qmStyles.empty}>Sırada bekleyen yok</Text>
          ) : (
            queue.map((r, i) => (
              <View key={r.id} style={qmStyles.row}>
                <Text style={qmStyles.rowIndex}>{i + 1}</Text>
                <View style={qmStyles.rowText}>
                  <Text style={qmStyles.rowTitle} numberOfLines={1}>
                    {rollTitle(r)}
                  </Text>
                </View>
                <IconButton
                  icon="close"
                  size={18}
                  onPress={() => onRemove(r.id)}
                  accessibilityLabel="Kuyruktan çıkar"
                />
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </AppModal>
  );
}

// ── Bu Oturumda Girilenler Modal ──
// "Bu oturum" rozetine dokununca: bu oturumda kaydedilen toplar (server-onaylı;
// çevrimdışı bekleyenler senkron olunca düşer). Satırdan etiket yeniden basılır.
function SessionRollsModal({
  visible,
  onDismiss,
  rolls,
  sessionCount,
  onPrint,
}: {
  visible: boolean;
  onDismiss: () => void;
  rolls: Roll[];
  sessionCount: number;
  onPrint: (roll: Roll) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const isPhone = useDeviceType() === 'phone';
  const pendingSync = Math.max(0, sessionCount - rolls.length);
  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <View style={[qmStyles.card, { width: Math.min(winW - 32, 720), maxHeight: winH * 0.85 }]}>
        <View style={qmStyles.header}>
          <Icon source="check-circle" size={22} color="#059669" />
          {/* Kayıt sayısı başlığın YANINDA (altında ayrı satır değil). */}
          <View style={qmStyles.titleRow}>
            <Text style={qmStyles.title}>Bu Oturumda Girilenler</Text>
            <Text style={qmStyles.titleCount}>
              · {rolls.length} kayıt
              {pendingSync > 0 ? ` · ${pendingSync} senkron bekliyor` : ''}
            </Text>
          </View>
          <IconButton icon="close" size={20} onPress={onDismiss} accessibilityLabel="Kapat" />
        </View>
        <ScrollView contentContainerStyle={qmStyles.body} showsVerticalScrollIndicator>
          {rolls.length === 0 ? (
            <Text style={qmStyles.empty}>
              {pendingSync > 0
                ? 'Kayıtlar çevrimdışı — senkron olunca burada listelenir.'
                : 'Bu oturumda henüz kayıt yok.'}
            </Text>
          ) : (
            rolls.map((r) => (
              // hideOperator: liste zaten yalnız AKTİF kullanıcının girişleri —
              // her satırda aynı adı tekrarlamak gürültü.
              <RollListItem key={r.id} roll={r} onPrint={onPrint} singleLine={!isPhone} hideOperator />
            ))
          )}
        </ScrollView>
      </View>
    </AppModal>
  );
}

const qmStyles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  // Başlık + sayı yan yana (baseline hizalı).
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  titleCount: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  body: { padding: 12, gap: 8 },
  section: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 6,
  },
  sectionFailed: { color: '#dc2626' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowFailed: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  rowIndex: { width: 18, textAlign: 'center', fontWeight: '800', color: '#64748b' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  rowError: { fontSize: 12, color: '#b91c1c', marginTop: 2 },
  rowBtnLabel: { fontSize: 12, fontWeight: '800' },
  empty: { fontSize: 13, color: '#94a3b8', paddingVertical: 4, paddingHorizontal: 2 },
});

// ── Scrap onay modal'ı ──
// Native Alert telefon yönüyle birlikte dönmüyordu (yan kalıyordu); kendi modal'ımız.
// =============================================================================
// EntryConflictModal — backend'in İKİ 409'unun ortak yüzü
// =============================================================================
// Her ikisi de aynı soruyu sorar: "aradığın top zaten var mı?"
//   • CLIENT_TOKEN_COLLISION — düştü sandığımız önceki deneme COMMIT olmuştu.
//     Kayıt VAR. Operatörün derdi genelde etikettir.
//   • POSSIBLE_DUPLICATE — sunucu tuzağı "az önce birebir aynısı girildi" dedi.
//     Bu kayıt YAZILMADI; onaylanırsa yazılır (engelleme değil onaylatma —
//     aynı partiden eşit metrajlı toplar arka arkaya meşru olarak girilir).
//
// Operatörün ekranda görmesi gereken şey hata metni değil, ARADIĞI TOPUN BARKODU.
//
// ── SADELEŞTİRME (2026-08-06) ───────────────────────────────────────────────
// Başlık artık iki teşhis için AYRI cümle kurmuyor: sorulan karar tek ("elimdeki
// top bu mu?") ve iki 409'un farkı tek satırlık alt metne indi. Eskiden 4 satırlık
// açıklamanın SONUNDA duran soru, eldivenli operatör tarafından okunmuyordu.
// Kimlik bloğu iptal modalıyla ORTAK (`idBox`) — aynı ekranda arka arkaya çıkan
// iki onay yüzeyi barkodu aynı yerde ve aynı boyutta göstermeli.
//
// Kapatılamaz (dismissable={false}): iki çıkış da veri açısından güvenli ve
// açıktır. Belirsiz bir "kapat" ya sonsuz 409 döngüsü (aynı istek tekrar gider)
// ya da operatörün farkında olmadığı bir kopya üretirdi.
//
// Görsel dil `rollCancelStyles` ile paylaşılır (bkz. `components/RollCancelModal`)
// — stil adları jeneriktir (sheet/title/infoBox/actions) ve ikinci bir kopya blok
// bakımı zorlaştırırdı.
// =============================================================================
interface EntryConflictModalProps {
  kind: 'TOKEN_COLLISION' | 'POSSIBLE_DUPLICATE';
  barcode: string | null;
  visible: boolean;
  printing: boolean;
  onPrintExisting: () => void;
  onSaveAsNew: () => void;
}

// `export` — render bekçisi için (EntryConflictModal.test.tsx): bu modal
// sahada İLK tetiklenişinde çökmüştü (Children.only) çünkü hiçbir test onu
// gerçekten ÇİZMİYORDU; metin sabitlerinin bekçisi (duplicateEntryChoice.test)
// render'ı göremez.
export function EntryConflictModal({
  kind,
  barcode,
  visible,
  printing,
  onPrintExisting,
  onSaveAsNew,
}: EntryConflictModalProps) {
  const { width: winW } = useWindowDimensions();
  const sheetWidth = Math.min(winW * 0.9, 460);
  const suspected = kind === 'POSSIBLE_DUPLICATE';

  /** İki seçenek de AYNI kalıptan çizilir — biri diğerinden sessizce ayrışmasın. */
  const renderChoice = (
    choice: DuplicateEntryChoice,
    onPress: () => void,
    busy: boolean,
    dimmed: boolean,
  ) => (
    <TouchableRipple
      onPress={busy || dimmed ? undefined : onPress}
      style={[
        conflictStyles.choice,
        { backgroundColor: choice.color, borderColor: choice.borderColor },
      ]}
      borderless
      accessibilityRole="button"
      accessibilityState={{ disabled: busy || dimmed }}
      accessibilityLabel={choice.a11y}
    >
      {/* ⚠️ TEK SARMALAYICI ZORUNLU (2026-08-12 saha çökmesi): TouchableRipple
          çocuğunu React.Children.only'den geçirir — [choiceInner, scrim] gibi
          İKİ doğrudan çocuk her açılışta FATAL çöker (scrim koşulu false'ken
          bile: [View, false] bir dizidir). Modal sahada ilk kez seri-birebir
          giriş testinde tetiklendi ve uygulamayı kapattı; render bekçisi:
          EntryConflictModal.test.tsx. */}
      <View style={conflictStyles.choiceWrap}>
      <View style={conflictStyles.choiceInner}>
        {/* ROZET — dilden bağımsız ayırt edici ve kartın EN YÜKSEK kontrastlı
            öğesi. Beyaz DOLGU + renkli içerik (12:1); saydam beyaz çip denendi
            ve ölçüldü: kart zemininden 1.4:1 ile ayrışıyordu, yani parlak ışıkta
            asıl buluş görünmez oluyordu. Baskı sürerken yerini göstergeye
            bırakır — operatör "oldu mu" diye ikinci kez basmasın. */}
        <View style={[conflictStyles.badge, { backgroundColor: choice.badgeBg }]}>
          {busy ? (
            <ActivityIndicator size="small" color={choice.badgeFg} />
          ) : (
            <>
              {choice.badgeIcon ? (
                <Icon source={choice.badgeIcon} size={26} color={choice.badgeFg} />
              ) : (
                <Text style={[conflictStyles.badgeText, { color: choice.badgeFg }]}>
                  {choice.badgeText}
                </Text>
              )}
              <Text style={[conflictStyles.badgeCaption, { color: choice.badgeFg }]}>
                {choice.badgeCaption}
              </Text>
            </>
          )}
        </View>
        <View style={conflictStyles.choiceText}>
          {/* numberOfLines YOK: metin SARSIN. Bu ekranın bilinen hatası kesilen
              etiketti; kart tam da onu yapısal olarak imkânsız kılmak için var. */}
          <Text style={[conflictStyles.choiceLabel, { color: choice.textColor }]}>
            {busy ? 'ETİKET BASILIYOR…' : choice.label}
          </Text>
          {/* Alt metin ana metinle AYNI renkte — hiyerarşi punto/ağırlıktan gelir.
              Saydam metin ölçüldü: amber üstünde 4.51:1 (AA'yı 0.01 payla geçiyor)
              ve parlamada 3.37'ye düşüyordu, hem de stok doğuran kartta. */}
          <Text style={[conflictStyles.choiceSub, { color: choice.textColor }]}>
            {busy ? 'Bekle, tekrar basma' : choice.sublabel}
          </Text>
        </View>
      </View>
      {/* SOLUKLAŞTIRMA DEĞİL PERDE, ve perde kartın KUTBUNU izler. `opacity`
          tüm alt ağacı beyaza doğru kompoze eder: koyu karttaki beyaz metnin
          kontrastı 5.0 → 2.3'e düşer, hem de tam operatörün ekrana kilitlendiği
          anda (baskı sürerken). Koyu kartta siyah, açık kartta beyaz perde ters
          yönde çalışır: kart söner, metin OKUNUR kalır. */}
      {dimmed && (
        <View
          style={[conflictStyles.scrim, { backgroundColor: choice.scrim }]}
          pointerEvents="none"
        />
      )}
      </View>
    </TouchableRipple>
  );

  return (
    <AppModal visible={visible} onDismiss={() => {}} dismissable={false}>
      <View style={[rollCancelStyles.sheet, { width: sheetWidth }]}>
        {/* ⚠️ Başlık dairesi NÖTR GRİ — eskiden amberdi. Aşağıdaki iki karttan
            biri amber ve anlamı kesin: "YENİ stok kaydı doğar". Başlıkta da amber
            olsaydı renk o ekranda iki farklı şey söylerdi ve ayırt ediciliğini
            kaybederdi. */}
        <View style={[rollCancelStyles.iconCircle, { backgroundColor: '#f1f5f9' }]}>
          <Icon source="content-duplicate" size={36} color={colors.textSecondary} />
        </View>
        {/* BAŞLIK = SORULAN SORU ve iki cevabı aşağıdaki iki kartta KELİMESİ
            KELİMESİNE bulunur ("kayıtlı" A'nın alt satırında, "yeni" B'nin
            başlığında) — okuması zor olan kişi eşleştirerek de seçebilsin.
            ⚠️ Başlık BİR ŞEY İDDİA ETMEZ: "Bu top zaten kayıtlı" demek
            POSSIBLE_DUPLICATE dalında YALAN olurdu (orada kayıt yazılmamıştır)
            ve B'yi seçmesi gereken operatör ekranın en büyük yazısını yalanlamak
            zorunda kalırdı — Türkçesi zayıf biri bunu yapmaz, otoriteye uyar.
            İki 409'un teşhis farkı tek satırlık alt metne indi; eskiden 4 satırdı
            ve sonundaki soru okunmadan kalıyordu. */}
        <Text variant="titleLarge" style={rollCancelStyles.title}>
          Bu top kayıtlı mı, yeni mi?
        </Text>

        <View style={rollCancelStyles.idBox}>
          <Text style={rollCancelStyles.idBarcode} numberOfLines={1}>
            {barcode ?? '—'}
          </Text>
          {/* Bu cümle İKİ 409'da da doğrudur: yazılmış olan, az önceki toptur.
              "Bu top az önce kaydedildi" dalların birinde yalan olurdu. */}
          <Text style={rollCancelStyles.idMeta}>Az önce birebir aynısı kaydedildi</Text>
        </View>

        {/* İKİ KART, ALT ALTA ve TAM GENİŞLİK. Yan yana düzende her kart ≈203dp
            kalıyor ve Paper Button metni SARMAZ, KESER — aynı ekranda "Etiketi
            Söktüm, İpta…" diye kesildi. Kart hem sonucu ikinci satırda anlatmaya
            yer bırakır hem rakam çipine. Sıra 1 → 2: okuma sırası sayı sırasıdır.
            Metin/renk/ikon/rakam seçimleri `constants/duplicateEntryChoice`de ve
            bekçisi var (`duplicateEntryChoice.test.ts`) — buraya ham dize yazma. */}
        <View style={conflictStyles.choices}>
          {renderChoice(DUPLICATE_CHOICE_SAME, onPrintExisting, printing, false)}
          {renderChoice(DUPLICATE_CHOICE_NEW, onSaveAsNew, false, printing)}
        </View>

        {/* Dipnot bir KURAL söyler, yönlendirme YAPMAZ.
            ⚠️ Buraya "emin değilsen etiket bas, stok bozulmaz" gibi bir tavsiye
            YAZMA. Yanlış vaattir: gerçekten iki top varsa (a) ikinci top kayda
            hiç girmez — eksik stok, kopyanın aynadaki ikizi ve ondan kötüsü — ve
            (b) basılan etiket ikinci topa yapışırsa sahada AYNI BARKODLU İKİ TOP
            dolaşır, geri alması hayalet kayıttan zordur. İki seçeneğin de kendi
            riski var; ekran taraf tutamaz. Söylenebilecek doğru şey, ayrımı
            operatörün kendi eline bağlayan değişmez kuraldır. */}
        <Text style={conflictStyles.footnote}>Her topun kendi barkodu olur.</Text>
      </View>
    </AppModal>
  );
}

const conflictStyles = StyleSheet.create({
  // ⚠️ 24dp: güvenli seçenek ile stok doğuran seçenek arasındaki FİZİKSEL pay.
  // 10dp ≈ 1.6mm idi ve eldivenli parmağın temas lekesi ~8-10mm — kartın alt
  // kenarından kayan bir dokunuş doğrudan "+1 stok" üretirdi.
  choices: { gap: 24 },
  // minHeight (sabit height DEĞİL): alt satır telefonda ve büyük sistem yazı
  // ölçeğinde iki satıra sarar; sabit yükseklik onu kırpardı — bu ekranın
  // bilinen hatası tam olarak kırpılan metindi.
  choice: {
    borderRadius: 14,
    // Kenarlık AÇIK kart için gerçek bir ihtiyaç: amber-500 beyaz sayfada kenarını
    // kaybeder. Koyu kartta da simetriyi bozmasın diye ikisinde de var.
    borderWidth: 2,
    minHeight: 88,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Children.only sarmalayıcısı — scrim absoluteFill'i kartın tamamını kaplasın
  // diye minHeight'ı ripple ile aynı taşır (içerik kısa kalırsa perde delik açmasın).
  choiceWrap: {
    minHeight: 84,
    justifyContent: 'center',
  },
  choiceInner: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 24, fontWeight: '900', lineHeight: 27 },
  badgeCaption: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.3 },
  choiceText: { flex: 1, gap: 3 },
  choiceLabel: { fontSize: 18, fontWeight: '800' },
  choiceSub: { fontSize: 13.5, fontWeight: '600', lineHeight: 18 },
  scrim: { ...StyleSheet.absoluteFillObject, borderRadius: 12 },
  // #334155: ekranın en soluk metni değil (10.3:1). Eski ipucu satırı #64748b
  // ile 4.76:1 idi — en zayıf kontrast, en karmaşık cümle, en kritik anda.
  footnote: { fontSize: 13, fontWeight: '600', color: '#334155', textAlign: 'center' },
});

// ── Liste satırı: Roll + kim girdi + ne zaman ──
function RollListItem({
  roll,
  onPrint,
  onScrap,
  compactLayout,
  singleLine,
  isNew,
  hideOperator,
}: {
  roll: Roll;
  onPrint: (roll: Roll) => void;
  onScrap?: (roll: Roll) => void;
  compactLayout?: boolean;
  /** Geniş tablet modalı: tüm bilgi tek satıra sığar. */
  singleLine?: boolean;
  /** Yeni kaydedilip listeye yeni düşen top — kısa süre vurgulanır. */
  isNew?: boolean;
  /** Operatör çipini gizle — liste ZATEN tek kişiye aitken (örn. "Bu Oturumda
   *  Girilenler": hepsi aktif kullanıcının) ad tekrarı gürültü olur. */
  hideOperator?: boolean;
}) {
  const operator = roll.createdBy?.fullName ?? roll.createdBy?.username ?? 'Bilinmiyor';
  const at = roll.createdAt ? dayjs(roll.createdAt) : null;
  const qty = `${roll.initialQty} mt`;
  const widthLabel = roll.width != null ? `${roll.width} cm` : null;
  const isInactive = roll.status === 'SCRAP';
  const barcode = roll.barcode ?? '—';
  const canPrint = !!roll.barcode;

  // Aksiyon tuşları. Tablette (labeled) personel kolay bassın diye yazılı + büyük;
  // telefonda yer olmadığından ikon-only.
  const renderActions = (labeled: boolean) => (
    <>
      {onScrap &&
        !isInactive &&
        (labeled ? (
          <Button
            mode="contained-tonal"
            icon="trash-can-outline"
            compact
            buttonColor="#fef2f2"
            textColor="#dc2626"
            onPress={() => onScrap(roll)}
            accessibilityLabel="Topu iptal et / hurda"
            style={styles.recentActionBtn}
            labelStyle={styles.recentActionLabel}
            contentStyle={styles.recentActionContent}
          >
            Sil
          </Button>
        ) : (
          <IconButton
            icon="trash-can-outline"
            mode="contained-tonal"
            size={compactLayout ? 16 : 20}
            containerColor="#fef2f2"
            iconColor="#dc2626"
            onPress={() => onScrap(roll)}
            accessibilityLabel="Topu iptal et / hurda"
            style={[styles.recentScrapBtn, compactLayout && { width: 24, height: 24 }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          />
        ))}
      {canPrint &&
        (labeled ? (
          <Button
            mode="contained-tonal"
            icon="printer"
            compact
            buttonColor="#eef2ff"
            textColor="#1e293b"
            onPress={() => onPrint(roll)}
            accessibilityLabel="Etiket bas"
            style={styles.recentActionBtn}
            labelStyle={styles.recentActionLabel}
            contentStyle={styles.recentActionContent}
          >
            Yazdır
          </Button>
        ) : (
          <IconButton
            icon="printer"
            mode="contained-tonal"
            size={compactLayout ? 20 : 35}
            containerColor="#eef2ff"
            iconColor="#000000ff"
            onPress={() => onPrint(roll)}
            accessibilityLabel="Etiket bas"
            style={[styles.recentPrintBtn, compactLayout && { width: 28, height: 28 }]}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          />
        ))}
    </>
  );

  // ── Geniş tablet modalı: her kayıt tek satır (ad · kod · boy · en · kalite
  //    … operatör · tarih · aksiyonlar). ──
  if (singleLine) {
    return (
      <Surface
        style={[
          styles.recentItem,
          styles.recentItemSingle,
          isInactive && styles.recentItemScrapped,
          isNew && !isInactive && styles.recentItemNew,
        ]}
        elevation={0}
      >
        <View style={styles.recentSingleRow}>
          {/* Sol blok: AD tam genişlik (uzun isim 2 satıra sarar, okunur kalır);
              barkod adın ALTINDA küçük — tek satırda adla yer kavgası yapmasın. */}
          <View style={styles.recentSingleLeft}>
            <Text
              style={[styles.recentItemName, isInactive && styles.recentBarcodeScrapped]}
              numberOfLines={2}
            >
              {roll.item?.name ?? '—'}
              {roll.color?.name ? ` · ${roll.color.name}` : ''}
            </Text>
            <Text
              style={[styles.recentBarcodeSub, isInactive && styles.recentBarcodeScrapped]}
              numberOfLines={1}
            >
              {barcode}
            </Text>
          </View>
          <View style={styles.recentBadge}>
            <Icon source="arrow-expand-vertical" size={14} color="#0f172a" />
            <Text style={styles.recentBadgeText}>{qty}</Text>
          </View>
          {widthLabel && (
            <View style={styles.recentBadge}>
              <Icon source="arrow-expand-horizontal" size={14} color="#0f172a" />
              <Text style={styles.recentBadgeText}>{widthLabel}</Text>
            </View>
          )}
          <View style={styles.recentBadge}>
            <Icon source="star-circle" size={14} color="#0f172a" />
            <Text style={styles.recentBadgeText}>{roll.qualityGrade}</Text>
          </View>

          {!hideOperator && (
            <View style={[styles.recentOperatorChip, styles.recentTimeRight]}>
              <View style={styles.recentOperatorAvatar}>
                <Icon source="account" size={14} color="#fff" />
              </View>
              {/* "Kim + nereden": ikinci ham giriş istasyonu açıldığında satırın
                  kökeni buradan okunur (Electron "Ekleyen" kolonuyla aynı dil).
                  Eski toplar entryStation taşımaz → tek satır, bugünkü görünüm. */}
              <View style={styles.recentOperatorTextWrap}>
                <Text style={styles.recentOperatorText} numberOfLines={1}>
                  {operator}
                </Text>
                {roll.entryStation?.name ? (
                  <Text style={styles.recentOperatorSub} numberOfLines={1}>
                    {roll.entryStation.name}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
          <Text style={[styles.recentTime, hideOperator && styles.recentTimeRight]}>
            {at ? at.format('DD.MM HH:mm') : ''}
          </Text>
          {renderActions(true)}
        </View>
      </Surface>
    );
  }

  return (
    <Surface
      style={[
        styles.recentItem,
        isInactive && styles.recentItemScrapped,
        isNew && !isInactive && styles.recentItemNew,
        compactLayout && { padding: 6, marginVertical: 2, gap: 2 },
      ]}
      elevation={0}
    >
      {/* Satır 1: SOL blok = ad (tam genişlik, kırpılmaz) + ALTINDA küçük barkod;
          sağda aksiyonlar. Adla barkod aynı satırı paylaşmıyor → ikisi de okunur.
          İki ince metin, buton yüksekliğine sığar — satır YÜKSELMEZ. */}
      <View style={[styles.recentItemHeader, compactLayout && { gap: 4 }]}>
        <View style={styles.recentHeadLeft}>
          <Text
            style={[
              styles.recentItemName,
              isInactive && styles.recentBarcodeScrapped,
              compactLayout && { fontSize: 12 },
            ]}
            numberOfLines={1}
          >
            {roll.item?.name ?? '—'}
            {roll.color?.name ? ` · ${roll.color.name}` : ''}
          </Text>
          <Text
            style={[
              styles.recentBarcodeSub,
              isInactive && styles.recentBarcodeScrapped,
              compactLayout && { fontSize: 10 },
            ]}
            numberOfLines={1}
          >
            {barcode}
          </Text>
        </View>
        <View style={styles.recentHeaderActions}>{renderActions(!compactLayout)}</View>
      </View>
      {/* Satır 2: boy · en · kalite · tarih (sol) — giriş yapan kişi (en sağ) */}
      <View style={[styles.recentBottomRow, compactLayout && { marginTop: 2, gap: 6 }]}>
        <View style={styles.recentBadgeRow}>
          <View style={[styles.recentBadge, compactLayout && styles.recentBadgeCompact]}>
            <Icon source="arrow-expand-vertical" size={compactLayout ? 12 : 14} color="#0f172a" />
            <Text style={[styles.recentBadgeText, compactLayout && { fontSize: 11 }]}>{qty}</Text>
          </View>
          {widthLabel && (
            <View style={[styles.recentBadge, compactLayout && styles.recentBadgeCompact]}>
              <Icon source="arrow-expand-horizontal" size={compactLayout ? 12 : 14} color="#0f172a" />
              <Text style={[styles.recentBadgeText, compactLayout && { fontSize: 11 }]}>{widthLabel}</Text>
            </View>
          )}
          <View style={[styles.recentBadge, compactLayout && styles.recentBadgeCompact]}>
            <Icon source="star-circle" size={compactLayout ? 12 : 14} color="#0f172a" />
            <Text style={[styles.recentBadgeText, compactLayout && { fontSize: 11 }]}>{roll.qualityGrade}</Text>
          </View>
          {/* Tarih — kalite rozetinin hemen sağında */}
          <Text style={[styles.recentTime, compactLayout && { fontSize: 11 }]}>
            {at ? at.format('DD.MM HH:mm') : ''}
          </Text>
        </View>

        {!hideOperator && (
          <View style={[styles.recentOperatorChip, compactLayout && { maxWidth: '42%' }]}>
            <View style={styles.recentOperatorAvatar}>
              <Icon source="account" size={14} color="#fff" />
            </View>
            <View style={styles.recentOperatorTextWrap}>
              <Text style={styles.recentOperatorText} numberOfLines={1}>
                {operator}
              </Text>
              {roll.entryStation?.name ? (
                <Text style={styles.recentOperatorSub} numberOfLines={1}>
                  {roll.entryStation.name}
                </Text>
              ) : null}
            </View>
          </View>
        )}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, flexDirection: 'row' },
  headerExtrasRow: { flexDirection: 'row', alignItems: 'center' },
  // Koyu header pill aksiyonu (Tambur ile aynı stil).
  headerChip: {
    borderRadius: 10,
    marginLeft: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  // fill (telefon 2. katı): satırı yarı yarıya paylaşmak için flex:1; dış boşluk
  // sıfır (aralığı HeaderSecondRow'un kendi gap'i belirler).
  headerChipFill: { flex: 1, marginLeft: 0 },
  headerChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  // fill: içerik yarım-genişlik pilde ortalansın.
  headerChipInnerFill: { justifyContent: 'center' },
  headerChipText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Sol — Form
  formCol: { flex: 1.4, backgroundColor: '#f8fafc' },
  formScroll: { flex: 1 },
  formContent: { padding: 16, gap: 12, flexGrow: 1, paddingBottom: 16 },
  // paddingTop: Manuel Giriş üst boşluğu; gap: Manuel ↔ ürün kartı arası;
  // paddingBottom: YÜZEN Kaydet butonunun altında içerik kalmasın (buton ~58 +
  // footer padding + pay).
  formContentCompact: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 80, gap: 8 },
  formContentTablet: { padding: 16, gap: 16, paddingBottom: 16 },
  // Sabit alt aksiyon şeridi — ScrollView'in dışında, hep görünür.
  submitFooter: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: '#f8fafc',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  // ONLINE-ONLY rejimde çevrimdışı kilit bandı — amber (uyarı, hata değil):
  // kayıt girilemez ama kaybolan da yok. Butonun hemen üstünde durur ki
  // "buton neden basılmıyor" sorusunun cevabı gözün gittiği yerde olsun.
  offlineLockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  offlineLockText: {
    flex: 1,
    color: '#78350f',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  // "Etiket çıkmadı" bandı — KIRMIZI (aksiyon ister), amber offline kilidiyle
  // (bilgi verir) bilinçli olarak ayrı kutup: ikisi aynı anda görünebilir ve
  // operatör metni okumadan da hangisinin "iş" hangisinin "durum" olduğunu
  // renkten ayırt edebilmeli.
  // Dış sarmalayıcı: ripple'ı köşelerden kırpar. Yerleşim ölçüleri (marginBottom,
  // borderRadius) BURADA yaşar — içeride kalsalardı ripple dikdörtgen taşardı.
  labelFailBannerTouch: {
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  labelFailBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#dc2626',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  labelFailText: {
    flex: 1,
    color: '#7f1d1d',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  labelFailBtnLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  // Scan-back bandı — İNDİGO ("sıradaki adım"): kırmızı (hata) ve amber (durum)
  // bandlarından üçüncü, ayrı kutup. Operatör renkten işi ayırt eder.
  verifyBanner: {
    borderRadius: 10,
    marginBottom: 8,
  },
  verifyBannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e0e7ff',
    borderWidth: 1,
    borderColor: '#4f46e5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  verifyText: {
    flex: 1,
    color: '#312e81',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  // Telefon: footer AKIŞTAN ÇIKAR — formCol'un altında YÜZER (absolute), arka
  // plan/çizgi YOK (sadece buton, gri şerit yok). İçerik full-height kayar,
  // formContentCompact.paddingBottom butonun altında kalmayı önler.
  submitFooterCompact: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: 'transparent',
    borderTopWidth: 0,
  },
  submitFooterTablet: {
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: 'transparent',
    borderTopWidth: 0,
  },
  // gap 12: telefon kartındaki blok arası (Desen Seç/Seçilen Desen satırı ↔ Fire
  // tuşları) eşit boşlukta olsun (ürün satırı + kalite arası aynı).
  card: { padding: 14, borderRadius: 12, backgroundColor: '#fff', gap: 12 },
  cardTablet: { padding: 16, gap: 12, borderRadius: 16 },

  // ── Manuel giriş paneli (üst, açılır-kapanır; amber = "anormal/dikkat") ──
  manualBar: {
    borderRadius: radius.md,
    backgroundColor: '#fffbeb', // amber 50
    borderWidth: 1,
    borderColor: '#fde68a', // amber 200
    overflow: 'hidden',
  },
  manualBarActive: { borderColor: colors.warningDark },
  manualBarTouch: { borderRadius: radius.md },
  // Telefon değerleri: klavye açılınca form altta kalmasın diye kompakt tutuldu
  // (tablet kendi büyük değerlerini kullanır).
  manualBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  manualBarInnerTablet: { paddingHorizontal: 16, paddingVertical: 14, gap: 16 },
  manualBarTitle: { fontSize: 16, fontWeight: '700', color: colors.warningDark },
  manualBarTitleTablet: { fontSize: 20 },
  manualPanel: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: 2,
  },
  manualPanelTablet: { gap: 16, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8 },
  manualField: { flex: 1 },
  manualFieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400e',
    marginBottom: 3,
  },
  manualFieldLabelTablet: { fontSize: 18, marginBottom: 8 },
  manualInputContent: { fontSize: 20, fontWeight: '700', textAlign: 'center', height: 42 },
  manualInputContentTablet: { fontSize: 36, height: 72 },

  // ── En satırı + tek-tuş temizleme ──
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  persistHint: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  widthRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  widthInput: { flex: 1 },
  widthInputContent: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  widthClearBtn: { margin: 0 },

  // ── Etiket kuyruğu çipi (header, dokununca kuyruk görünümü) ──
  printChip: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    marginRight: spacing.sm,
    overflow: 'hidden',
  },
  // Başarısız etiket varken kırmızı — göze çarpsın (Tekrar Dene içeride).
  printChipFailed: { backgroundColor: '#dc2626' },
  printChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  printChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // ── Oturum sayacı çipi (koyu header — dokununca oturum listesi) ──
  headerSessionChip: {
    marginLeft: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(16,185,129,0.20)',
    borderWidth: 1,
    borderColor: 'rgba(134,239,172,0.45)',
    overflow: 'hidden',
  },
  // fill (telefon 2. katı): "Son Kayıtlar" ile satırı yarı yarıya paylaş (flex:1).
  headerSessionChipFill: { flex: 1, marginLeft: 0 },
  headerSessionChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  headerSessionLabel: { fontSize: 13, fontWeight: '700', color: '#dcfce7' },
  headerSessionCount: { fontSize: 14, fontWeight: '800', color: '#fff' },

  // ── Yeni-kayıt vurgusu ──
  recentItemNew: {
    backgroundColor: colors.successContainer,
    borderWidth: 1.5,
    borderColor: colors.success,
  },

  // Compact (telefon) — form üstü sağa yaslı drawer tetiği
  drawerTriggerBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 2,
  },

  label: { fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 4 },
  labelSpaced: { marginTop: 8 },
  required: { color: '#dc2626' },

  // ── Telefon ürün seçimi: YAN YANA — "Desen Seç" 1/4 (flex:1), "Seçilen
  //    Desen" 3/4 (flex:3). Dar butona sığsın diye 2-satır ORTALI etiket. ──
  productRowCompact: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  // contained-tonal görünümü (açık indigo zemin + indigo yazı).
  productBtnCompact: { flex: 1, borderRadius: 12, backgroundColor: '#e0e7ff', overflow: 'hidden' },
  productBtnCompactInner: {
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  productBtnCompactLabel: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 19,
    textAlign: 'center',
    color: '#4338ca',
  },
  productSelectedBoxCompact: { flex: 3, height: 64 },
  productSelectedNameCompact: { fontSize: 20 },

  // ── Tablet ürün seçimi: büyük buton + yanında seçili ürün adı ──
  productRowTablet: { flexDirection: 'row', alignItems: 'stretch', gap: 16 },
  productBtnTablet: { borderRadius: 12 },
  productBtnTabletContent: { height: 96, paddingHorizontal: 24 },
  productBtnTabletLabel: { fontSize: 24, fontWeight: '700' },
  // Seçili ürün gösterimi — "form alanı içinde seçili değer" kalıbı: başlık
  // (caption) + değer; seçiliyken sol aksan çizgi + hafif marka rengi + tik.
  productSelectedBox: {
    flex: 1,
    height: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 14,
    gap: 3,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  productSelectedBoxActive: {
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
    borderLeftWidth: 4,
    borderLeftColor: '#4f46e5',
  },
  productSelectedCaption: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#64748b',
    textTransform: 'uppercase',
  },
  productSelectedValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  productSelectedName: {
    flex: 1,
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  productSelectedNameEmpty: {
    fontSize: 22,
    fontWeight: '600',
    color: '#94a3b8',
    fontStyle: 'italic',
  },

  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  rowSpaced: { marginTop: 8 },
  col: { flex: 1 },
  input: { backgroundColor: '#fff' },
  qtyInput: { flex: 1 },
  qtyInputContent: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  pullBtn: { borderColor: '#f59e0b', minWidth: 150 },
  pullBtnContent: { height: 50 },

  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Telefon: TEK SATIR, hepsi eşit (flex:1) — sarmaz, taşarsa küçülür.
  segmentRowCompact: { flexWrap: 'nowrap' },
  segmentRowTablet: { marginTop: 8 },
  segmentLoading: {
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentEmpty: {
    minHeight: 60,
    textAlign: 'center',
    textAlignVertical: 'center',
    color: '#94a3b8',
    fontSize: 13,
    fontStyle: 'italic',
  },
  segment: {
    flex: 1,
    minWidth: 0, // nowrap satırda taşmadan küçülebilsin (uzun etiket kırpılır)
    minHeight: 50,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  segmentSelected: {
    borderColor: '#4f46e5',
    backgroundColor: '#eef2ff',
    borderWidth: 4,
  },
  // Tablet: saha için daha büyük dokunma hedefi + yazı.
  segmentTablet: {
    minHeight: 96,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  // Telefon: yan yana tek satır (flex:1 base'ten). Birden çok sınıf sığsın diye
  // yatay dolgu küçük; taşarsa metin kırpılır (minWidth:0).
  segmentCompact: {
    minHeight: 56,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  segmentLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#475569',
    textAlign: 'center',
  },
  segmentLabelTablet: { fontSize: 26, fontWeight: '800' },
  segmentLabelCompact: { fontSize: 16, lineHeight: 18 },
  segmentLabelSelected: {
    color: '#4f46e5',
  },

  submitBtn: { borderRadius: 12, marginTop: 4 },
  // Telefon boyu (tablet kendi büyük değerini kullanır).
  submitBtnContent: { height: 58 },
  submitBtnContentTablet: { height: 112 },
  submitBtnLabel: { fontSize: 18, fontWeight: '700' },
  submitBtnLabelTablet: { fontSize: 30 },

  // Sağ — Son kayıtlar + Numpad
  recentsCol: {
    flex: 1,
    backgroundColor: '#fff',
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
  },
  recentsList: { flex: 1, minHeight: 0 },
  recentsListContent: { padding: 12 },
  recentsEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 4,
  },
  recentsEmptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  recentsEmptyHint: { fontSize: 13, color: '#cbd5e1' },

  // ⚠️ GÖLGE YOK, KENARLIK VAR (2026-08-12 saha bulgusu). Satır `Surface`
  // elevation=1 ile çiziliyordu; Android'de elevation gölgeyi kartın DIŞINA
  // taşırır ve liste satırı tam genişlikte olduğu için gölgenin sol/sağ ucu
  // liste sınırında KIRPILIYOR — ekranda "yarıda kesilmiş çerçeve" olarak
  // görünüyordu. Kenarlık kırpılmaz, kartın sınırını da daha net gösterir.
  recentItem: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginVertical: 4,
    gap: 4,
  },
  recentItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recentItemSingle: { paddingVertical: 8, gap: 0 },
  recentSingleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Tek-satır düzende sol blok: ad (2 satıra sarabilir) + altında küçük barkod.
  // flex:1 → uzun ürün adı, barkodla aynı satırı paylaşmak yerine tam genişlik alır.
  recentSingleLeft: { flex: 1, minWidth: 0, gap: 1 },
  // Normal (2 katlı) düzenin satır-1 sol bloğu — aynı prensip.
  recentHeadLeft: { flex: 1, minWidth: 0, gap: 1 },
  recentBarcodeSub: { fontFamily: 'monospace', fontSize: 11, color: '#64748b' },
  recentTime: { fontSize: 12, color: '#0d4a8fff' },
  recentTimeRight: { marginLeft: 'auto' },
  recentPrintBtn: { margin: 0, width: 35, height: 35 },
  recentScrapBtn: { margin: 0, width: 30, height: 30 },
  // Tablet: yazılı + büyük aksiyon tuşları (personel kolay bassın).
  recentActionBtn: { margin: 0, marginLeft: 4, borderRadius: 10 },
  recentActionContent: { height: 46, paddingHorizontal: 6 },
  recentActionLabel: { fontSize: 14, fontWeight: '700', marginHorizontal: 10, marginVertical: 0 },
  recentHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  recentItemScrapped: { opacity: 0.55, backgroundColor: '#f1f5f9' },
  recentBarcodeScrapped: {
    textDecorationLine: 'line-through',
    color: '#64748b',
    backgroundColor: '#e2e8f0',
  },
  recentItemName: { flexShrink: 1, minWidth: 0, fontSize: 14, fontWeight: '700', color: '#0f172a' },
  recentBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  recentBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, flexShrink: 1 },
  recentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recentBadgeText: { fontSize: 12, color: '#0f172a', fontWeight: '600' },
  recentBadgeCompact: { paddingVertical: 1, paddingHorizontal: 4 },
  recentOperatorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#eef2ff',
    paddingLeft: 4,
    paddingRight: 10,
    paddingVertical: 3,
    borderRadius: 999,
    flexShrink: 0,
    maxWidth: '50%',
  },
  recentOperatorAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentOperatorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3730a3',
    flexShrink: 1,
  },
  recentOperatorTextWrap: { minWidth: 0, flexShrink: 1 },
  recentOperatorSub: {
    fontSize: 10,
    color: '#6366f1',
  },

  // Sabit numpad — sağ sütunun altında
  // "Son Kayıtlar" ↔ numpad ayracı — kalın, marka renginde (Ürün Seç butonuyla aynı).
  numpadDivider: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.brand,
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 10,
  },
  numpadHost: {
    margin: 12,
    marginTop: 0,
    backgroundColor: '#f8fafc',
  },
});

// Kalite seçim segmenti — React.memo ile form'un başka alanları (qty, width)
// değişirken bu kartlar yeniden render olmasın diye izole.
const QualitySegment = React.memo(function QualitySegment({
  grade,
  selected,
  onPress,
  compact,
}: {
  grade: QualityGrade;
  selected: boolean;
  onPress: (code: string) => void;
  compact: boolean;
}) {
  const handlePress = useCallback(
    () => onPress(grade.code),
    [onPress, grade.code],
  );
  return (
    <TouchableRipple
      onPress={handlePress}
      borderless
      rippleColor="rgba(79, 70, 229, 0.15)"
      style={[
        styles.segment,
        compact && styles.segmentCompact,
        !compact && styles.segmentTablet,
        selected && styles.segmentSelected,
        selected && grade.color
          ? { backgroundColor: grade.color, borderColor: grade.color }
          : null,
      ]}
    >
      <Text
        numberOfLines={2}
        style={[
          styles.segmentLabel,
          compact && styles.segmentLabelCompact,
          !compact && styles.segmentLabelTablet,
          selected && styles.segmentLabelSelected,
          selected && grade.color ? { color: '#fff' } : null,
        ]}
      >
        {grade.name}
      </Text>
    </TouchableRipple>
  );
});
