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
import { CANCEL_REASON_PRESETS, CANCEL_MIN_REASON } from '../../../constants/cancelReasons';
import NumpadInput from '../../../components/NumpadInput';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import { useTruncationWarning } from '../../../hooks/useTruncationWarning';
import { useRawWidthEnabled, useKk1WeightEntryEnabled } from '../../../hooks/useFeatureFlags';
import { NumpadHost } from '../../../components/NumpadProvider';
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh, type ManualRefresh } from '../../../hooks/useManualRefresh';
import { LabelPrinter } from '../../../components/LabelPrinter';
import { isWorkSessionLost } from '../../../services/api';
import { useSessionEntriesStore } from '../../../store/sessionEntriesStore';
import { useSessionStore } from '../../../store/sessionStore';
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
import { offlineReason } from '../../../offline/serverReachability';
import { usePermissions } from '../../../hooks/usePermission';
import SyncStatusChip from '../../../components/SyncStatusChip';
import { opIdFor, useFailedOps } from '../../../offline/failedOps';
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
  const sessionBucket = useSessionEntriesStore((s) => s.buckets['RAW_QC']);
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
  // ref'ten (emsal: `activePrintRollRef`), yazma fonksiyonel `setAttempt` ile.
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
  // Etiket basımı — sıralı kuyruk. activePrintRoll = şu an LabelPrinter'a verilen
  // (null = boşta). printQueue = sırada bekleyenler. Offline'da N entry toplu
  // sync olduğunda hepsi print edilebilsin diye queue mantığı; ayrıca manuel
  // "Bas" tetikleri de aynı kuyruğa düşer.
  const [activePrintRoll, setActivePrintRoll] = useState<Roll | null>(null);
  const [printQueue, setPrintQueue] = useState<Roll[]>([]);

  // activePrint null ve queue dolu ise → bir sonrakini başlat. Print finish'te
  // activePrint = null olur, bu effect bir sonrakini alır. Sonsuz cycle yok
  // (queue boşalırsa effect no-op).
  // OFFLINE: LabelPrinter etiket HTML'ini backend'den çekiyor → offline basamaz.
  // Bu yüzden offline'da kuyruğu İLERLETME; entry'ler birikir, ağ gelince
  // (isOnline → true, effect tekrar çalışır) sırayla basılır.
  useEffect(() => {
    if (isOnline && activePrintRoll === null && printQueue.length > 0) {
      setActivePrintRoll(printQueue[0]);
      setPrintQueue((q) => q.slice(1));
    }
  }, [isOnline, activePrintRoll, printQueue]);

  const enqueuePrint = useCallback((roll: Roll) => {
    setPrintQueue((q) => [...q, roll]);
  }, []);

  const handlePrintDone = useCallback(() => {
    setActivePrintRoll(null); // useEffect bir sonrakini alır
  }, []);

  // ── Başarısız baskılar + kuyruk görünümü ──
  // BT hatası / zaman aşımında etiket KAYBOLMAZ: top "başarısızlar"a düşer,
  // kuyruk çipine dokununca açılan görünümden Tekrar Dene ile yeniden sıraya
  // alınır. İptal (yazdırma diyaloğu kapatıldı) hata SAYILMAZ.
  const [failedPrints, setFailedPrints] = useState<{ roll: Roll; error: string }[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  // "Bu oturum" rozetine dokununca oturum listesi modalı (veri sessionEntriesStore'da).
  const [sessionListOpen, setSessionListOpen] = useState(false);

  // onResult anında activePrintRoll state'i closure'da bayat olabilir → ref.
  const activePrintRollRef = useRef<Roll | null>(null);
  useEffect(() => {
    activePrintRollRef.current = activePrintRoll;
  }, [activePrintRoll]);
  const handlePrintResult = useCallback(
    (r: { ok: boolean; cancelled: boolean; error?: string }) => {
      const roll = activePrintRollRef.current;
      if (!roll) return;
      if (r.ok) {
        setFailedPrints((f) => f.filter((x) => x.roll.id !== roll.id));
      } else if (!r.cancelled) {
        setFailedPrints((f) => [
          { roll, error: r.error || 'Yazdırma hatası' },
          ...f.filter((x) => x.roll.id !== roll.id),
        ]);
      }
    },
    [],
  );
  const retryFailedPrint = useCallback((roll: Roll) => {
    setFailedPrints((f) => f.filter((x) => x.roll.id !== roll.id));
    setPrintQueue((q) => [...q, roll]);
  }, []);
  const dismissFailedPrint = useCallback((id: string) => {
    setFailedPrints((f) => f.filter((x) => x.roll.id !== id));
  }, []);
  const removeFromQueue = useCallback((id: string) => {
    setPrintQueue((q) => q.filter((r) => r.id !== id));
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
  const recentRollsQuery = useQuery({
    queryKey: ['rolls', 'kk1', 'recent'],
    queryFn: () =>
      rollService.getAll({
        page: 1,
        pageSize: RECENT_PAGE_SIZE,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        filters: { entrySource: 'SUPPLIER_RECEIPT,MANUAL_ENTRY' },
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
    onMutate: (vars) => {
      const prevForm = form;
      // Kuyruğa mı düşüyor? `onlineManager.isOnline()` ile retryer'ın `isPaused`
      // kararı AYNI predicate'ten gelir — okuma deterministik.
      const queued = !onlineManager.isOnline();
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
      useSessionEntriesStore.getState().addPending('RAW_QC');
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
      useSessionEntriesStore.getState().confirmRoll('RAW_QC', res.data as Roll);
      qc.invalidateQueries({ queryKey: ['rolls', 'kk1'] });
    },
    onError: (err, vars, context) => {
      // Kayıt reddedildi → oturum sayacındaki pending geri alınır (sayaç şişmesin).
      useSessionEntriesStore.getState().failPending('RAW_QC');
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
    // `reason` doluysa etiketi basılmış topun iptalidir → backend ayrıca
    // confirmLabelPrinted bekler; ikisi birlikte gider (bkz. offline/mutations).
    { id: string; confirmActive: boolean; reason?: string },
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
      Toast.show({
        type: 'success',
        text1: 'Top iptal edildi',
        text2: onlineManager.isOnline() ? undefined : 'Çevrimdışı — sync bekliyor',
      });
      return { snapshots };
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
      scrapMutation.mutate({ id: scrapTarget.id, confirmActive, reason });
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
    // Modal ile çözülen çakışma kutuda ÖLÜ SATIR bırakmasın: `MutationCache`
    // her kalıcı düşüşü kutuya yazar (ekran mount olsun olmasın) — modal
    // burada kararı verdiğine göre satırın işi bitti. Çift yüzey bilinçli:
    // modal geçici, kutu kalıcı; ama ikisi aynı kaydı iki kez sordurmamalı.
    if (conflict) {
      useFailedOps.getState().clear(opIdFor(STATION_MUT.KK1_CREATE_ENTRY, conflict.vars));
    }
    setConflict(null);
  };

  /**
   * Barkoddan etiket bas — sunucudan topu okur, yazıcı kuyruğuna atar.
   * Çakışma modalı VE ölü mektup kutusu (`SyncStatusChip → OutboxModal`) aynı
   * yeteneği kullanır; kutu her ekrandan açılabildiği için yetenek oraya
   * KK1'den enjekte edilir (yazıcı kuyruğu bu ekrana ait).
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
    // Modal kararı verdi → kutudaki ölü satır düşer (bkz. clearConflict notu).
    useFailedOps.getState().clear(opIdFor(STATION_MUT.KK1_CREATE_ENTRY, vars));
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
          {(printingCount > 0 || failedPrints.length > 0) && (
            <Animated.View
              entering={FadeInUp.duration(180)}
              exiting={FadeOutUp.duration(140)}
            >
              {/* Dokununca yazıcı kuyruğu görünümü: basılıyor / sırada / başarısız. */}
              <TouchableRipple
                borderless
                onPress={() => setQueueOpen(true)}
                rippleColor="rgba(255,255,255,0.2)"
                style={[styles.printChip, failedPrints.length > 0 && styles.printChipFailed]}
                accessibilityLabel="Yazıcı kuyruğunu göster"
              >
                <View style={styles.printChipInner}>
                  {printingCount > 0 && <Pulse color="#fff" size={7} />}
                  <Text style={styles.printChipText}>
                    {printingCount > 0
                      ? `${printingCount} etiket${!isOnline ? ' · çevrimdışı' : ''}`
                      : ''}
                    {printingCount > 0 && failedPrints.length > 0 ? ' · ' : ''}
                    {/* "ETİKET" kelimesi LOAD-BEARING: yan taraftaki SyncStatusChip
                        "N KAYIT HATALI" diyor ve o SUNUCUYA YAZILAMAMIŞ kaydı
                        anlatıyor. İkisi aynı header'da yan yana durduğu için
                        çıplak "N HATALI" operatörü yanıltırdı. */}
                    {failedPrints.length > 0 ? `${failedPrints.length} ETİKET HATALI` : ''}
                  </Text>
                </View>
              </TouchableRipple>
            </Animated.View>
          )}
          {/* Ölü mektup kutusundaki "Etiketi Bas" yeteneği yalnız burada var —
              yazıcı kuyruğu KK1'e ait. Diğer ekranlarda buton hiç çıkmaz. */}
          <SyncStatusChip onPrintBarcode={printBarcode} />
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
                    autoActivate={!compact}
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
            disabled={pulling}
            buttonColor={
              justSaved ? colors.success : retrying ? colors.warningDark : undefined
            }
            style={styles.submitBtn}
            contentStyle={[styles.submitBtnContent, !compact && styles.submitBtnContentTablet]}
            labelStyle={[styles.submitBtnLabel, !compact && styles.submitBtnLabelTablet]}
          >
            {pulling
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

      {/* ── Scrap onay modal'ı (kendi modalımız; native Alert'i değiştirdi) ── */}
      <ScrapConfirmModal
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
  const q = useInfiniteQuery({
    queryKey: ['rolls', 'kk1', 'history'],
    queryFn: ({ pageParam }) =>
      rollService.getAllCursor({
        limit: HISTORY_PAGE_SIZE,
        cursor: pageParam,
        // Bkz. yukarıdaki "Son kayıtlar" sorgusu — aynı CSV kapsam gerekçesi.
        filters: { entrySource: 'SUPPLIER_RECEIPT,MANUAL_ENTRY' },
        withTotal: !pageParam,
      }),
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
// Kapatılamaz (dismissable={false}): iki çıkış da veri açısından güvenli ve
// açıktır. Belirsiz bir "kapat" ya sonsuz 409 döngüsü (aynı istek tekrar gider)
// ya da operatörün farkında olmadığı bir kopya üretirdi.
//
// Görsel dil `scrapStyles` ile paylaşılır — stil adları jeneriktir (sheet/title/
// infoBox/actions) ve ikinci bir kopya blok bakımı zorlaştırırdı.
// =============================================================================
interface EntryConflictModalProps {
  kind: 'TOKEN_COLLISION' | 'POSSIBLE_DUPLICATE';
  barcode: string | null;
  visible: boolean;
  printing: boolean;
  onPrintExisting: () => void;
  onSaveAsNew: () => void;
}

function EntryConflictModal({
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

  return (
    <AppModal visible={visible} onDismiss={() => {}} dismissable={false}>
      <View style={[scrapStyles.sheet, { width: sheetWidth }]}>
        <View style={[scrapStyles.iconCircle, { backgroundColor: '#fffbeb' }]}>
          <Icon source="content-duplicate" size={36} color={colors.warningDark} />
        </View>
        <Text variant="titleLarge" style={scrapStyles.title}>
          {suspected ? 'AYNI TOP TEKRAR MI GİRİLDİ?' : 'BU TOP ZATEN KAYDEDİLMİŞ'}
        </Text>

        <View style={scrapStyles.infoBox}>
          <View style={scrapStyles.infoRow}>
            <Text style={scrapStyles.infoLabel}>Kayıtlı barkod</Text>
            <Text style={scrapStyles.infoValue}>{barcode ?? '—'}</Text>
          </View>
        </View>

        <Text style={scrapStyles.hint}>
          {suspected
            ? 'Az önce aynı kumaş, aynı metraj ve aynı en kaydedilmiş.\n\nElindeki top yukarıdaki barkodla AYNI mı, yoksa ikinci bir top mu?'
            : 'Gönderilemedi sanılan kayıt aslında ulaşmış. Yeni top oluşturulmadı — kopya kayıt önlendi.\n\nElindeki top yukarıdaki barkodla AYNI mı, yoksa ikinci bir top mu?'}
        </Text>

        {/* RENK = SONUÇ. MAVİ: yalnız kâğıt basar, veriye dokunmaz.
            AMBER: YENİ bir stok kaydı doğurur — geri alması zor, o yüzden
            "devam" gibi nötr değil, dikkat rengi. İkisi de büyük ve dolgun:
            eldivenli operatör metni okumasa da renkten ayırt edebilmeli. */}
        <View style={scrapStyles.actions}>
          <Button
            mode="contained"
            icon="printer"
            buttonColor={colors.infoDark}
            textColor="#fff"
            onPress={onPrintExisting}
            loading={printing}
            disabled={printing}
            style={scrapStyles.actionBtn}
            contentStyle={scrapStyles.actionBtnContent}
          >
            AYNI TOP — Etiketini Bas
          </Button>
          <Button
            mode="contained"
            icon="plus-box"
            buttonColor={colors.warningDark}
            textColor="#fff"
            onPress={onSaveAsNew}
            disabled={printing}
            style={scrapStyles.actionBtn}
            contentStyle={scrapStyles.actionBtnContent}
          >
            AYRI TOP — Yine de Kaydet
          </Button>
        </View>
      </View>
    </AppModal>
  );
}

interface ScrapConfirmModalProps {
  roll: Roll | null;
  /** Backend iptal önizlemesi (null = henüz gelmedi). */
  preview: RollCancelPreview | null;
  previewLoading: boolean;
  previewError: Error | null;
  /** Çevrimdışı → önizleme yok; iptal kuyruğa alınır, bağlanınca uygulanır. */
  offline: boolean;
  loading: boolean;
  onDismiss: () => void;
  /** Etiketli iptalde sebep taşınır; etiketsizde `undefined`. */
  onConfirm: (reason?: string) => void;
}

/** "X iş emrinin Y adımında aktif" gibi okunur cümle. */
function activeAtText(activeAt: RollCancelPreview['activeAt']): string {
  if (!activeAt) return 'Bu top bir istasyonda/iş emrinde aktif.';
  const wo = activeAt.batchNumber ? `"${activeAt.batchNumber}"` : 'bir';
  const station = activeAt.stationName ?? 'bir istasyon';
  return `Bu top ${wo} iş emrinin "${station}" adımında aktif.`;
}

function ScrapConfirmModal({
  roll,
  preview,
  previewLoading,
  previewError,
  offline,
  loading,
  onDismiss,
  onConfirm,
}: ScrapConfirmModalProps) {
  const { width: winW } = useWindowDimensions();
  const sheetWidth = Math.min(winW * 0.9, 460);

  // Önizleme henüz gelmedi → güvenli tarafta kal (onay butonu beklemede).
  const blocked = !offline && !!preview && !preview.canCancel;
  const needsConfirm = !!preview && preview.canCancel && preview.requiresConfirm;

  // ── ÖLÜ ETİKET EKSENİ (2026-08-05) ────────────────────────────────────────
  // `needsConfirm`'den AYRI soru: o "mal bir istasyonda mı" (sistem içi etki),
  // bu "sahaya geçersiz bir kâğıt bırakıyor muyum" (sistem DIŞI etki). Bir top
  // ikisini birden tetikleyebilir; ikisi de kendi uyarısını gösterir.
  const labelPrinted = !offline && !!preview && preview.canCancel && preview.labelPrinted;
  const [reason, setReason] = useState('');
  const [otherOpen, setOtherOpen] = useState(false);
  // Modal her açılışta temiz başlamalı — önceki topun sebebi yenisine sızmasın.
  useEffect(() => {
    if (roll) {
      setReason('');
      setOtherOpen(false);
    }
  }, [roll?.id]);
  const reasonOk = reason.trim().length >= CANCEL_MIN_REASON;

  // Hard-block iken hiç gönderme. Önizleme yüklenirken de butonu kilitle ki
  // operatör requiresConfirm bilinmeden iptal etmesin. Offline'da önizleme yok →
  // butonu kilitleme (kuyruğa alınır, backend replay'de güvenliği uygular).
  // Etiketli topta sebep girilmeden buton açılmaz (backend zaten reddeder;
  // burada kilitlemek operatörü boş bir 400'e yürütmemek içindir).
  const confirmDisabled =
    loading || (!offline && previewLoading) || blocked || (labelPrinted && !reasonOk);
  // Onay rengi/etiketi duruma göre.
  const accent = blocked
    ? colors.danger
    : needsConfirm || labelPrinted
      ? colors.warningDark
      : '#dc2626';

  return (
    <AppModal visible={!!roll} onDismiss={onDismiss} dismissable={!loading}>
      <View style={[scrapStyles.sheet, { width: sheetWidth }]}>
        <View
          style={[
            scrapStyles.iconCircle,
            needsConfirm && { backgroundColor: '#fffbeb' },
          ]}
        >
          <Icon
            source={blocked ? 'cancel' : 'alert-circle-outline'}
            size={36}
            color={accent}
          />
        </View>
        <Text variant="titleLarge" style={scrapStyles.title}>
          {blocked ? 'Top iptal edilemez' : 'Topu iptal et?'}
        </Text>

        {roll && (
          <View style={scrapStyles.infoBox}>
            <View style={scrapStyles.infoRow}>
              <Text style={scrapStyles.infoLabel}>Barkod</Text>
              <Text style={scrapStyles.infoValue}>{roll.barcode ?? '—'}</Text>
            </View>
            <View style={scrapStyles.infoRow}>
              <Text style={scrapStyles.infoLabel}>Ürün</Text>
              <Text style={scrapStyles.infoValue} numberOfLines={2}>
                {roll.item?.name ?? '—'}
                {roll.color?.name ? ` · ${roll.color.name}` : ''}
              </Text>
            </View>
            <View style={scrapStyles.infoRow}>
              <Text style={scrapStyles.infoLabel}>Metraj</Text>
              <Text style={scrapStyles.infoValue}>
                {roll.initialQty} mt
                {roll.width != null ? ` · ${roll.width} cm` : ''}
              </Text>
            </View>
          </View>
        )}

        {/* Önizleme durum bölümü */}
        {offline ? (
          <View style={scrapStyles.warnBox}>
            <Icon source="wifi-off" size={18} color={colors.warningDark} />
            <View style={{ flex: 1 }}>
              <Text style={scrapStyles.warnText}>
                Çevrimdışısın — durum önizlemesi yok.
              </Text>
              <Text style={scrapStyles.warnSub}>
                İptal sıraya alınır, bağlanınca uygulanır. Top bu sırada bir
                istasyonda aktifleştiyse sunucu reddedebilir.
              </Text>
            </View>
          </View>
        ) : previewLoading ? (
          <View style={scrapStyles.previewLoadingRow}>
            <ActivityIndicator size="small" color="#64748b" />
            <Text style={scrapStyles.previewLoadingText}>
              Durum kontrol ediliyor…
            </Text>
          </View>
        ) : blocked ? (
          <View style={scrapStyles.blockBox}>
            <Icon source="information-outline" size={18} color={colors.danger} />
            <Text style={scrapStyles.blockText}>{preview!.blockReason}</Text>
          </View>
        ) : needsConfirm ? (
          <View style={scrapStyles.warnBox}>
            <Icon source="alert" size={18} color={colors.warningDark} />
            <View style={{ flex: 1 }}>
              <Text style={scrapStyles.warnText}>
                {activeAtText(preview!.activeAt)}
              </Text>
              <Text style={scrapStyles.warnSub}>
                İptal edilirse bu adımdan düşülür ve adım durumu geri sarılır.
                Yine de iptal etmek istiyor musun?
              </Text>
            </View>
          </View>
        ) : (
          <>
            {previewError && (
              <Text style={scrapStyles.previewErrText}>
                Durum doğrulanamadı — yine de deneyebilirsin.
              </Text>
            )}
            <Text style={scrapStyles.hint}>
              Yanlış giriş için kullan. İptal edilen toplar fire sayılmaz, sadece
              kayıt geri alınır.
            </Text>
          </>
        )}

        {/* ── ÖLÜ ETİKET UYARISI + SEBEP ──────────────────────────────────────
            Etiket basmak fiziksel dünyada geri alınamaz; kayıt geri alınabilir.
            Bu kutu tam o farkı operatöre söyler: kâğıt topun üstünde KALACAK.
            Sahada olan buydu — uyarı yoktu, kayıt öldü, kâğıt kaldı, aynı top
            saatler sonra ikinci bir barkodla yeniden girildi. */}
        {labelPrinted && (
          <View style={scrapStyles.deadLabelBox}>
            <View style={scrapStyles.deadLabelHead}>
              <Icon source="label-off-outline" size={18} color={colors.warningDark} />
              <Text style={scrapStyles.deadLabelTitle}>Bu topun etiketi basıldı</Text>
            </View>
            <Text style={scrapStyles.warnSub}>
              Kâğıt büyük ihtimalle topun üstünde. İptal edersen orada GEÇERSİZ bir
              etiket kalır — sonraki okutmada &quot;stokta değil&quot; der.
              {'\n'}Önce etiketi toptan sök.
            </Text>

            <Text style={scrapStyles.reasonLabel}>İptal sebebi (zorunlu)</Text>
            <View style={scrapStyles.reasonChips}>
              {CANCEL_REASON_PRESETS.map((p) => {
                const selected = reason === p && !otherOpen;
                return (
                  <TouchableRipple
                    key={p}
                    onPress={() => {
                      setReason(p);
                      setOtherOpen(false);
                    }}
                    style={[scrapStyles.reasonChip, selected && scrapStyles.reasonChipOn]}
                    borderless
                  >
                    <Text
                      style={[
                        scrapStyles.reasonChipText,
                        selected && scrapStyles.reasonChipTextOn,
                      ]}
                    >
                      {p}
                    </Text>
                  </TouchableRipple>
                );
              })}
              {/* Serbest yazım kaldırılmadı, "Diğer"in altına alındı: hazır
                  seçenek sürtünmeyi kaldırır ve veriyi sayılabilir yapar, ama
                  katalog dışı gerçek durumlar da olur. */}
              <TouchableRipple
                onPress={() => {
                  setOtherOpen(true);
                  setReason('');
                }}
                style={[scrapStyles.reasonChip, otherOpen && scrapStyles.reasonChipOn]}
                borderless
              >
                <Text
                  style={[scrapStyles.reasonChipText, otherOpen && scrapStyles.reasonChipTextOn]}
                >
                  Diğer…
                </Text>
              </TouchableRipple>
            </View>
            {otherOpen && (
              <PaperTextInput
                mode="outlined"
                dense
                autoFocus
                placeholder="Sebebi yaz (en az 3 karakter)"
                value={reason}
                onChangeText={setReason}
                maxLength={500}
                style={scrapStyles.reasonInput}
              />
            )}
          </View>
        )}

        <View style={scrapStyles.actions}>
          <Button
            mode="outlined"
            onPress={onDismiss}
            disabled={loading}
            style={scrapStyles.actionBtn}
            contentStyle={scrapStyles.actionBtnContent}
          >
            {blocked ? 'Kapat' : 'Vazgeç'}
          </Button>
          {!blocked && (
            <Button
              mode="contained"
              buttonColor={needsConfirm || labelPrinted ? colors.warningDark : '#dc2626'}
              textColor="#fff"
              icon="trash-can-outline"
              onPress={() => onConfirm(labelPrinted ? reason.trim() : undefined)}
              loading={loading}
              disabled={confirmDisabled}
              style={scrapStyles.actionBtn}
              contentStyle={scrapStyles.actionBtnContent}
            >
              {labelPrinted
                ? 'Etiketi Söktüm, İptal Et'
                : needsConfirm
                  ? 'Yine de İptal Et'
                  : 'İptal Et'}
            </Button>
          )}
        </View>
      </View>
    </AppModal>
  );
}

const scrapStyles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    alignItems: 'stretch',
    gap: 12,
  },
  iconCircle: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontWeight: '700', color: '#0f172a', textAlign: 'center' },
  infoBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  infoLabel: { width: 70, fontSize: 13, color: '#64748b', fontWeight: '600' },
  infoValue: { flex: 1, fontSize: 14, color: '#0f172a', fontWeight: '600' },
  hint: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    textAlign: 'center',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn: { flex: 1, borderRadius: 10 },
  actionBtnContent: { height: 48 },
  previewLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  previewLoadingText: { fontSize: 13, color: '#64748b' },
  previewErrText: {
    fontSize: 12,
    color: colors.warningDark,
    textAlign: 'center',
  },
  // Engelli (hard-block): kırmızı bilgi kutusu
  blockBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
  },
  blockText: {
    flex: 1,
    fontSize: 13,
    color: '#991b1b',
    fontWeight: '600',
    lineHeight: 18,
  },
  // İstasyonda aktif uyarısı: kehribar kutu
  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  warnText: {
    fontSize: 14,
    color: '#92400e',
    fontWeight: '700',
    lineHeight: 19,
  },
  warnSub: {
    fontSize: 12.5,
    color: '#b45309',
    lineHeight: 17,
    marginTop: 3,
  },
  // ── Ölü etiket kutusu ──
  deadLabelBox: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  deadLabelHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deadLabelTitle: { fontSize: 14, fontWeight: '800', color: '#92400e' },
  reasonLabel: { fontSize: 12, fontWeight: '700', color: '#92400e', marginTop: 2 },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reasonChip: {
    borderWidth: 1,
    borderColor: '#fcd34d',
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 12,
    // 40dp: modal içi ikincil seçim; ana aksiyonlar (Vazgeç/İptal Et) 56dp kalır.
    minHeight: 40,
    justifyContent: 'center',
  },
  reasonChipOn: { backgroundColor: colors.warningDark, borderColor: colors.warningDark },
  reasonChipText: { fontSize: 12.5, color: '#92400e', fontWeight: '600' },
  reasonChipTextOn: { color: '#fff' },
  reasonInput: { backgroundColor: '#fff' },
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
        elevation={1}
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
              <Text style={styles.recentOperatorText} numberOfLines={1}>
                {operator}
              </Text>
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
      elevation={1}
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
            <Text style={styles.recentOperatorText} numberOfLines={1}>
              {operator}
            </Text>
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

  recentItem: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
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
