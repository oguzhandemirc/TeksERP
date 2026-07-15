import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  Keyboard,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Surface,
  TouchableRipple,
  Icon,
  ActivityIndicator,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import {
  useQuery,
  useInfiniteQuery,
  keepPreviousData,
  useMutation,
  useQueryClient,
  onlineManager,
} from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ScreenChrome from '../../../components/ScreenChrome';
import CutActionBar from './CutActionBar';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { useSessionStore } from '../../../store/sessionStore';
import { useMachinePeripherals, meterPeripheralFor } from '../../../hooks/useMachinePeripherals';
import { buildIoFromPeripheral } from '../../../hooks/usePeripheralIO';
import RefreshButton from '../../../components/RefreshButton';
import RemoteListSheet from '../../../components/RemoteListSheet';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { useDrawerActionQueue } from '../../../hooks/useDrawerActionQueue';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import { useTruncationWarning } from '../../../hooks/useTruncationWarning';
import { useManualRefresh, type ManualRefresh } from '../../../hooks/useManualRefresh';
import NumpadInput from '../../../components/NumpadInput';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useTamburOverQuantityEnabled } from '../../../hooks/useFeatureFlags';
import { NumpadHost } from '../../../components/NumpadProvider';
import { RightPanelDrawer } from '../../../components/RightPanelDrawer';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import AppModal from '../../../components/AppModal';
import LabelTargetSheet, { type LabelTargetContext } from '../../../components/LabelTargetSheet';
import { LabelPreviewSheet } from '../../../components/labels/LabelPreviewSheet';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import RollPickerModal from '../../../components/RollPickerModal';
import { LabelPrinter } from '../../../components/LabelPrinter';
import { isWorkSessionLost } from '../../../services/api';
import { tamburService } from '../../../services/tambur.service';
import { rollService } from '../../../services/roll.service';
import { customerService } from '../../../services/customer.service';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { formatRelativeWait } from '../../../utils/relativeTime';
import {
  STATION_MUT,
  type TamburFinalizeOpenFabricVars,
} from '../../../offline/mutations';
import SyncStatusChip from '../../../components/SyncStatusChip';
import { SkeletonList, usePressScale, AnimatedEntrance } from '../../../components/motion';
import { colors, spacing, radius, shadow } from '../../../theme';
import Animated from 'react-native-reanimated';
import { defectTypeService } from '../../../services/defectType.service';
import { qualityGradeService } from '../../../services/qualityGrade.service';
import { generateClientUuid } from '../../../offline/barcode';
import type {
  TamburStepSummary,
  TamburRollSummary,
  TamburOpenCard,
  TamburFinalizeRequest,
  TamburErrorDecision,
  TamburDecision,
  TamburFoldType,
  TamburContext,
  TamburContextOrder,
  TamburRollDefect,
  TamburFinalizeRemainingAction,
  DefectType,
  QualityGrade,
  Roll,
  Customer,
} from '../../../types/models';

// =============================================================================
// Multi-job state — Tambur'da operatör paralel iş yürütebilir (KursunQc paralel).
// =============================================================================
interface OpenJob {
  cardId: string;
  cardBarcode: string;
  stepSummary: TamburStepSummary;
  /**
   * Refactor 9 + 11 — Tambur context (orders progress + LIFO açık kumaşlar +
   * plannedFoldType/layerCount). Bağımsız çağrı; backend uyumsuzluk halinde
   * (eski WO'lar) null kalabilir, eski akış bozulmasın.
   */
  context: TamburContext | null;
  selectedRollId: string | null;
}

interface ErrorEntryState {
  // Hata nokta (aralık değil): operatör sadece "kaç. metrede" girer.
  // Tambur kesim kararını voluntaryCuts üzerinden verir; defect listesi rehber.
  startMeter: string;
  defectTypeId: string;
}

// Yeni model: kesim = tek metre (uzunluk). Sayaç sıfırdan başladığı için
// her kesim bağımsız uzunlukta; toplam(lengths) ≤ Roll.currentQty olmalı.
interface VoluntaryCutDraft {
  id: string;
  length: number;       // bu parçanın uzunluğu (cihaz sayaç değeri)
  qualityGrade: string; // 1.KALITE / A1 / FIRE — operatör seçer
  qualityName?: string; // display only
}

interface VoluntaryEntryState {
  length: string;
  qualityGrade: string;
  qualityName?: string;
  /** Kesilen topun hedef sipariş kalemi (null = stok / müşteri hedefi). */
  targetOrderLineId: string | null;
  /** Sipariş dışı hedef müşteri — "Listeden Seç" ile (etiket bu müşteriye basılır). */
  targetCustomerId: string | null;
  targetCustomerName?: string;
}

interface RollWorkState {
  decisions: Record<string, { decision: TamburDecision; qualityGrade?: string }>;
  foldType: TamburFoldType | null;
  voluntaryCuts: VoluntaryCutDraft[];
  voluntaryEntry: VoluntaryEntryState;
  errorEntry: ErrorEntryState;
}

const EMPTY_ERROR_ENTRY: ErrorEntryState = {
  startMeter: '',
  defectTypeId: '',
};
// Default kesim girişi: kalite "1.KALITE" pre-select (seed sabit kayıt).
// Operatör çoğunlukla 1. kalite kesim yapar; A1/Fire ihtiyaç anında değiştirir.
const EMPTY_VOLUNTARY_ENTRY: VoluntaryEntryState = {
  length: '',
  qualityGrade: '1.KALITE',
  qualityName: '1. Kalite',
  targetOrderLineId: null,
  targetCustomerId: null,
  targetCustomerName: undefined,
};
const EMPTY_WORK: RollWorkState = {
  decisions: {},
  // Kat seçimi asla boş kalmaz — operatör değiştirebilir ama biri hep seçili.
  // İş emrinde plan varsa effect bunu override eder (bkz. defaultFold).
  foldType: '2-KAT',
  voluntaryCuts: [],
  voluntaryEntry: EMPTY_VOLUNTARY_ENTRY,
  errorEntry: EMPTY_ERROR_ENTRY,
};

// Koyu header'da etiketli aksiyon pill'i (ikon + ne olduğu yazısı). Salt-ikon
// yerine her aksiyonun adı görünür. `accent` = ayrık birincil aksiyon (Etiket
// Değiştir) için hafif vurgu.
function HeaderChip({
  icon,
  label,
  onPress,
  accent,
  fill,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  accent?: boolean;
  /** true: 2. kat satırını (secondRow) eşit paylaşır — taşmaz, kaydırma gerekmez. */
  fill?: boolean;
}) {
  return (
    <TouchableRipple
      onPress={onPress}
      style={[styles.headerChip, accent && styles.headerChipAccent, fill && styles.headerChipFill]}
      borderless
      rippleColor="rgba(255,255,255,0.2)"
      accessibilityLabel={label}
    >
      <View style={[styles.headerChipInner, fill && styles.headerChipInnerFill]}>
        <Icon source={icon} size={18} color="#fff" />
        <Text style={styles.headerChipText} numberOfLines={1}>{label}</Text>
      </View>
    </TouchableRipple>
  );
}

export default function TamburScreen() {
  // Telefon ekranında landscape kilidi kaldırılır + sağ panel drawer'a alınır.
  // Tabletlerde önceki davranış aynen korunur.
  const device = useDeviceType();
  const compact = device === 'phone';
  const manualBarcodeEntry = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  useLandscapeLock(!compact);
  const insets = useSafeAreaInsets();

  // Bulunulan makine adı — telefonda başlık subtitle'ı olarak gösterilir (Ham
  // Giriş/KK1 ve Kurşun ile aynı desen); tablette PlaceChip başlığın yanında kalır.
  const activeSession = useSessionStore((s) => s.active);
  const machineName =
    activeSession?.machine?.name ||
    activeSession?.machine?.code ||
    activeSession?.station?.name ||
    undefined;

  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  // Etiket "kime?" — baskı anında müşteri seçimi (gevşek model: top→sipariş bağı yok).
  const [labelContext, setLabelContext] = useState<LabelTargetContext | undefined>(undefined);
  const [targetSheet, setTargetSheet] = useState<{ roll: Roll; defaultLineId: string | null } | null>(null);
  const [pendingTargetRolls, setPendingTargetRolls] = useState<{ roll: Roll; defaultLineId: string | null }[]>([]);
  // NOT: "Etiket Değiştir" ayrı girişi kaldırıldı — yönlendirme artık "Çıkanlar"
  // önizlemesindeki "Yeni Etiket" butonundan yapılıyor (queueLabel → kime?).
  // Drawer + RNModal stack çakışmasını çözen ortak queue (hook).
  const drawerQueue = useDrawerActionQueue({
    drawerOpen: rightDrawerOpen,
    closeDrawer: () => setRightDrawerOpen(false),
    compact,
  });

  const qc = useQueryClient();

  const [cardBarcode, setCardBarcode] = useState('');
  const [resolvingCard, setResolvingCard] = useState(false);
  const [openJobs, setOpenJobs] = useState<OpenJob[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Aktif top'un çalışma state'i — top/sekme değişince sıfırlanır.
  const [work, setWork] = useState<RollWorkState>(EMPTY_WORK);
  // Kesim uzunluğu kaynağı. Faz 1'de MANUEL varsayılan (gerçek makine yok);
  // Otomatik'te uzunluk makineden ölçülür → input + numpad gizlenir.
  const [cutMode, setCutMode] = useState<'manual' | 'auto'>('manual');
  
  const pendingRecutCleanupRef = useRef<{ remainingChild: Roll | null } | null>(null);

  // Etiket basımı modal state — finalize veya post-split sonrası yeni Roll'lar.
  // Roller tam obje olarak tutulur (item.color, variant dahil) → LabelPrinter
  // doğrudan basabilsin.
  const [pendingPrintRolls, setPendingPrintRolls] = useState<Roll[]>([]);

  // Geçmiş çıktı listesi modal state
  const [recentOutputOpen, setRecentOutputOpen] = useState(false);

  // Yazdırılacak aktif rol — LabelPrinter bu state'i izler ve sıfırlanınca
  // hazır olur. Per-row "Bas" butonu bu state'i set eder.
  const [activePrintRoll, setActivePrintRoll] = useState<Roll | null>(null);

  // Kartelalık işareti — bu kesimde doğan çıktı topları depoda kartela sevki için
  // işaretlensin (yalnız WAREHOUSE çıktılarda etkili; sevki engellemez). Aynı topu
  // kartelaya kesen operatör için kesimler arası kalıcı, finalize'da sıfırlanır.
  const [markAsKartela, setMarkAsKartela] = useState(false);

  // Tambur'da çıkan top metresi kayıtlı kalanı aşabilir mi (admin flag, default
  // kapalı). Kapalıyken aşan giriş engellenir; açıkken aşımda onay diyaloğu çıkar
  // (parmak hatası koruması) ve onaylanınca backend kabul eder (parent tamamen tüketilir).
  const overQuantityEnabled = useTamburOverQuantityEnabled();
  // 2-kat / 4-kat metre cihazları — tabletin atandığı makineden backend çözer
  // (admin Cihaz Kaydı'nda tanımlar). foldType→role ile seçilir; cihazın `simulate`
  // bayrağı açıksa sahte, değilse HAL (BT/HC-06) ile gerçek okuma.
  const meterPeripherals = useMachinePeripherals('METER');
  // "Kes" (otomatik) → makineden okuma uçuşurken footer'ı kilitle (çift-tık koruması).
  const [measuring, setMeasuring] = useState(false);
  // Aşım onayı bekleyen kesim — onaylanınca onConfirm() çalışır (ilgili mutate).
  const [overCutConfirm, setOverCutConfirm] = useState<{
    recorded: number;
    entered: number;
    onConfirm: () => void;
  } | null>(null);

  // Top Kesme — sağdaki "Top Kesme" butonu → top-level kamera modal → barkod
  // tara → sol panelde "WAREHOUSE topu modu" açılır. Normal Tambur cutOpenFabric
  // akışıyla yapısal olarak aynı: multi-cut + finalize. Her kesim child doğurur,
  // parent.currentQty düşer; Bitir → parent TAMBUR_CONSUMED (arşive).
  const [recutResolvedRollId, setRecutResolvedRollId] = useState<string | null>(null);
  const [recutRollMeta, setRecutRollMeta] = useState<{
    barcode: string | null;
    currentQty: number;
    item: string;
    itemId: string;
    colorId: string | null;
    colorName: string | null;
    width: number | null;
    status: string;
  } | null>(null);
  const [recutCutLength, setRecutCutLength] = useState('');
  // Recut (Top Kesme) — açık kumaş akışıyla aynı: manuel/otomatik mod.
  const [recutMode, setRecutMode] = useState<'manual' | 'auto'>('manual');
  // Ham (renksiz STOCK) top kesiminde her parçanın hedefi: STOCK = üretime devam
  // (yeni iş emrine bağlanır), WAREHOUSE = sevke hazır ham-bitmiş. Bitmiş/renkli
  // top kesiminde yok sayılır.
  const [recutRawDestination, setRecutRawDestination] = useState<'STOCK' | 'WAREHOUSE'>('STOCK');
  // "Kime" — sipariş kısayollarına ek olarak listeden (müşteriye göre aranabilir)
  // açık sipariş satırı seçme picker'ı. Her iki kesim akışı paylaşır.
  const [kimePickerOpen, setKimePickerOpen] = useState(false);
  const [recutQualityGrade, setRecutQualityGrade] = useState<string>('1.KALITE');
  const [recutScannerOpen, setRecutScannerOpen] = useState(false);
  // "Kime?" — depo topundan kesilen parça hangi siparişe (null = stok). Etiket buradan basılır.
  const [recutTargetLineId, setRecutTargetLineId] = useState<string | null>(null);
  // Recut'ta sipariş DIŞI müşteri hedefi — "Listeden Seç" ile topa siparişi olmayan
  // herhangi bir müşteriye de kesilebilir (etiket o müşteriye basılır). Satır ↔ müşteri
  // karşılıklı dışlar (biri seçilince diğeri temizlenir).
  const [recutTargetCustomerId, setRecutTargetCustomerId] = useState<string | null>(null);
  const [recutTargetCustomerName, setRecutTargetCustomerName] = useState<string | undefined>(undefined);
  // Topun özelliğine (item+color+width) uyan açık sipariş kalemleri (Kime? picker'ı).
  const recutLinesQuery = useQuery({
    queryKey: [
      'recut-lines',
      recutRollMeta?.itemId ?? null,
      recutRollMeta?.colorId ?? null,
      recutRollMeta?.width ?? null,
    ],
    queryFn: async () => {
      const { orderService } = await import('../../../services/order.service');
      return orderService.getAvailableOrderLines({
        itemId: recutRollMeta!.itemId,
        colorId: recutRollMeta?.colorId ?? undefined,
        width: recutRollMeta?.width ?? undefined,
      });
    },
    enabled: !!recutRollMeta?.itemId,
    staleTime: 30_000,
  });
  const recutLineOptions = recutLinesQuery.data?.data ?? [];
  const [recutFinalizeOpen, setRecutFinalizeOpen] = useState(false);
  // Son kesimden dönen güncel parent — X kapat sırasında etiketi basıma kuyruğa
  // atılır (operatör fiziksel etiketi yenilemeli, eski metraj artık geçersiz).
  const [recutLastParentRoll, setRecutLastParentRoll] = useState<Roll | null>(null);
  // İş emri siparişleri modal'ı — operatör kalan ihtiyaçları görmek için açar
  const [ordersModalOpen, setOrdersModalOpen] = useState(false);
  // Hata noktaları detay modal'ı (cetvel + sıralı/filtreli liste) ve
  // Tambur adım notu modal'ı (sticky header kutusundan açılır).
  const [errorsModalOpen, setErrorsModalOpen] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);



  // ── Kataloglar ──
  const defectTypesQuery = useQuery({
    queryKey: ['defect-types', 'active'],
    queryFn: () => defectTypeService.list({ pageSize: 100 }),
    staleTime: 10 * 60 * 1000,
  });
  const defectTypes = defectTypesQuery.data?.data ?? [];

  const qualityGradesQuery = useQuery({
    queryKey: ['quality-grades', 'active'],
    queryFn: () => qualityGradeService.list({ pageSize: 100 }),
    staleTime: 10 * 60 * 1000,
  });
  const qualityGrades = qualityGradesQuery.data?.data ?? [];

  const openCardsQuery = useQuery({
    queryKey: ['tambur', 'open-cards'],
    queryFn: () => tamburService.listOpenCards(),
    enabled: listModalOpen,
    staleTime: 30 * 1000,
  });

  // Açık Kartlar modal'ı her açılışta force refresh — 30s cache stale dönmesin.
  useRefetchOnOpen(openCardsQuery.refetch, listModalOpen);
  // Açık Kartlar modalı içindeki manuel "Yenile" — toast + haptic feedback.
  const openCardsRefresh = useManualRefresh(
    () => openCardsQuery.refetch(),
    'Açık kartlar güncellendi',
  );

  const activeJob = useMemo(
    () => openJobs.find((j) => j.cardId === activeCardId) ?? null,
    [openJobs, activeCardId]
  );

  const selectedRoll: TamburRollSummary | null = useMemo(() => {
    if (!activeJob || !activeJob.selectedRollId) return null;
    return (
      activeJob.stepSummary.rolls.find(
        (r) => r.rollId === activeJob.selectedRollId
      ) ?? null
    );
  }, [activeJob]);

  // Top/sekme değişimi → çalışma state'i temizlenir. İş emrinde planlanan
  // katlama (2-KAT / 4-KAT) otomatik seçili gelir; plan yoksa 2-KAT varsayılır.
  // Operatör değiştirebilir ama biri her zaman seçilidir (asla boş kalmaz).
  useEffect(() => {
    const planned = activeJob?.context?.plannedFoldType;
    const defaultFold: TamburFoldType = planned === '4-KAT' ? '4-KAT' : '2-KAT';
    setWork({ ...EMPTY_WORK, foldType: defaultFold });
  }, [activeCardId, activeJob?.selectedRollId, activeJob?.context?.plannedFoldType]);


  // ── Backend re-fetch helper ──
  const refetchActiveJob = async () => {
    if (!activeJob) return;
    const [stepRes, ctxRes] = await Promise.all([
      tamburService.getStep(activeJob.stepSummary.workOrderStepId),
      tamburService
        .getContext(activeJob.cardBarcode)
        .catch(() => null),
    ]);
    const step = stepRes.data as TamburStepSummary | undefined;
    const ctx = (ctxRes?.data ?? null) as TamburContext | null;
    if (!step) return;
    setOpenJobs((prev) =>
      prev.map((j) =>
        j.cardId === activeJob.cardId ? { ...j, stepSummary: step, context: ctx } : j
      )
    );
  };

  // Aktif işin header "Yenile" butonu — manuel yenileme feedback'i (toast + haptic).
  const activeRefresh = useManualRefresh(refetchActiveJob, 'İş güncellendi');

  // ── Kart çözümleme ──
  // K-A5: cift cozumleme guard ref'i.
  const resolveInFlightRef = useRef(false);

  const resolveCard = async (barcode: string, fromInput: boolean) => {
    if (!barcode) return;
    // K-A5 fix: cozumleme ucustayken ikinci tetik (cift okutma/cift Enter) ayni
    // kartin IKI sekme acilmasina yol aciyordu — in-flight guard.
    if (resolveInFlightRef.current) return;
    const existing = openJobs.find((j) => j.cardBarcode === barcode);
    if (existing) {
      setActiveCardId(existing.cardId);
      if (fromInput) setCardBarcode('');
      Toast.show({ type: 'info', text1: 'Kart zaten açık' });
      return;
    }

    resolveInFlightRef.current = true;
    setResolvingCard(true);
    try {
      // Refactor 4 — yanlış istasyonda 400 mesajı catch ile yakalanır
      const res = await tamburService.getByCardBarcode(barcode);
      const step = res.data as TamburStepSummary | undefined;
      if (!step) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Toast.show({ type: 'error', text1: 'Kart bulunamadı', text2: barcode });
        return;
      }
      // Refactor 9 + 11 — yeni context: orders progress + LIFO açık kumaşlar +
      // plannedFoldType/layerCount. Backend uyumsuzluk halinde sessizce null.
      const context = await tamburService
        .getContext(barcode)
        .then((r) => r.data as TamburContext | null)
        .catch(() => null);
      const newJob: OpenJob = {
        cardId: barcode,
        cardBarcode: barcode,
        stepSummary: step,
        context,
        selectedRollId: null,
      };
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOpenJobs((prev) => [...prev, newJob]);
      setActiveCardId(newJob.cardId);
      if (fromInput) setCardBarcode('');
      Toast.show({
        type: 'success',
        text1: 'Kart açıldı',
        text2: `${step.batchNumber} · ${step.rolls.length} top`,
      });
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'Kart çözülemedi',
        text2: (err as Error).message,
      });
    } finally {
      setResolvingCard(false);
      resolveInFlightRef.current = false;
    }
  };

  const handleResolveCard = () => resolveCard(cardBarcode.trim(), true);

  const handleCameraSelect = (card: TamburOpenCard) => {
    setListModalOpen(false);
    resolveCard(card.cardBarcode, false);
  };

  const handleScannerResult = (data: string) => {
    setScannerOpen(false);
    resolveCard(data.trim(), false);
  };

  const closeJob = (cardId: string) => {
    setOpenJobs((prev) => prev.filter((j) => j.cardId !== cardId));
    if (activeCardId === cardId) {
      const remaining = openJobs.filter((j) => j.cardId !== cardId);
      setActiveCardId(remaining[0]?.cardId ?? null);
    }
  };

  const selectRoll = (rollId: string) => {
    if (!activeJob) return;
    setOpenJobs((prev) =>
      prev.map((j) =>
        j.cardId === activeJob.cardId ? { ...j, selectedRollId: rollId } : j
      )
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Compact'ta top seçilince drawer kapanır — operatör sol form'da çalışsın.
    if (compact) setRightDrawerOpen(false);
  };

  // Compact'ta aktif kart değiştiğinde (yeni kart çözüldü / tab değişti) drawer kapanır.
  useEffect(() => {
    if (compact && activeCardId) setRightDrawerOpen(false);
  }, [compact, activeCardId]);

  // Etiket "kime?" kuyruğu drain — sheet ve yazıcı boşsa sıradaki top için aç.
  // Kesim/yönlendir/son-toplar hepsi bu kuyruğa girer; her topta önce hedef sorulur.
  useEffect(() => {
    if (targetSheet === null && activePrintRoll === null && pendingTargetRolls.length > 0) {
      setTargetSheet(pendingTargetRolls[0]);
      setPendingTargetRolls((q) => q.slice(1));
    }
  }, [targetSheet, activePrintRoll, pendingTargetRolls]);

  // Bir topu "Etiket kime?" kuyruğuna at (kesim sonrası / yönlendir / finalize).
  const queueLabel = (roll: Roll, defaultLineId: string | null = null) =>
    setPendingTargetRolls((q) => [...q, { roll, defaultLineId }]);

  // "Etiketi Tekrar Bas" — varolan etiketi AYNEN bas, "kime?" SORMA.
  // labelContext=undefined → backend topun mevcut snapshot/effective etiketini
  // basar (yeni hedef seçilmez). Müşteri değiştirmek = "Etiket Değiştir" akışı.
  const reprintLabel = (roll: Roll) => {
    setLabelContext(undefined);
    setActivePrintRoll(roll);
  };

  // "Müşterisiz (Stok)" — müşteri bilgisi OLMADAN bas. labelContext={stock:true}
  // → backend müşteriyi zorla null bırakır (snapshot/WO atlanır); önizleme/geçmiş
  // reprint'inde tek dokunuşta müşterisiz etiket.
  const reprintLabelStock = (roll: Roll) => {
    setLabelContext({ stock: true });
    setActivePrintRoll(roll);
  };

  // ── Mutations ──
  const finalizeMutation = useMutation({
    mutationFn: (data: TamburFinalizeRequest) => tamburService.finalize(data),
    onSuccess: async (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Tambur tamamlandı',
        text2: 'Top depoya gönderildi',
      });

      // Etiket basımı: sadece child Roll'lar (parent TAMBUR_CONSUMED, qty=0 —
      // artık fiziksel olarak yok, etiketi basılmaz).
      const data = res.data as
        | { originalRoll?: Roll; splitRolls?: Roll[] }
        | undefined;
      const splitRolls = data?.splitRolls ?? [];
      if (splitRolls.length > 0) setPendingPrintRolls(splitRolls);

      // Sıradaki finalize edilmemiş topa atla
      await refetchActiveJob();
      if (activeJob) {
        const remaining = activeJob.stepSummary.rolls.find(
          (r) => r.rollId !== activeJob.selectedRollId
        );
        setOpenJobs((prev) =>
          prev.map((j) =>
            j.cardId === activeJob.cardId
              ? { ...j, selectedRollId: remaining?.rollId ?? null }
              : j
          )
        );
      }
      qc.invalidateQueries({ queryKey: ['rolls'] });
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Finalize başarısız', text2: err.message });
    },
  });

  // Gerçek saha akışı: operatör kesimi yapar, anında sisteme girer + etiket
  // basılır. Bulk submit değil, her "Top Oluştur" anında backend'e gider.
  const cutOpenFabricMutation = useMutation({
    mutationFn: (data: {
      rollId: string;
      lengthMeters: number;
      status: 'WAREHOUSE' | 'SCRAP' | 'A1_STOCK';
      qualityGrade: string;
      targetOrderLineId?: string | null;
      // Müşteri hedefi — backend cut'a gider, child lastLabelSnapshot'a seed edilir.
      targetCustomerId?: string | null;
      markedForKartela?: boolean;
      /** Ağ-retry idempotency: kesim anında üretilir, retry'da aynı kalır. */
      clientToken?: string;
    }) =>
      tamburService.cutOpenFabric(data.rollId, {
        lengthMeters: data.lengthMeters,
        status: data.status,
        qualityGrade: data.qualityGrade,
        targetOrderLineId: data.targetOrderLineId ?? null,
        // Niyet backend'e gider → child lastLabelSnapshot'a seed edilir (kalıcı).
        targetCustomerId: data.targetCustomerId ?? null,
        markedForKartela: data.markedForKartela ?? false,
        clientToken: data.clientToken,
      }),
    onSuccess: async (res, variables) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const data = res.data as
        | { childRoll?: Roll; parentRemainingQty?: number }
        | undefined;
      if (data?.childRoll?.barcode) {
        // Hedef zaten "Kime" bölümünde seçili → "Kes" doğrudan o hedefe basar,
        // TEKRAR "Etiket kime?" SORMAZ. Hiçbir şey seçili değilse = stok (explicit
        // müşterisiz etiket — WO tahmini sızmasın). Sonradan "Etiket Değiştir" ile
        // yönlendirilebilir.
        setLabelContext(
          variables.targetCustomerId
            ? { customerId: variables.targetCustomerId }
            : variables.targetOrderLineId
              ? { orderLineId: variables.targetOrderLineId }
              : { stock: true },
        );
        setActivePrintRoll(data.childRoll);
      }
      // Uzunluk input'unu sıfırla; kalite/sipariş aynen kalsın (seri kesim).
      setWork((w) => ({
        ...w,
        voluntaryEntry: { ...w.voluntaryEntry, length: '' },
      }));
      // OTOMATİK BİTİŞ: açık kumaşın kalanı ihmal edilebilir (<10cm) ise ayrı
      // "Tamamla" beklemeden finalize et — son kesim işi otomatik kapatır,
      // sıradakine geçer. Eşik küçük yuvarlama artıklarını da yutar.
      // Y11 fix: KESİLEN top variables.rollId'den alınır — eski kod yanıt
      // anındaki selectedRoll'u kullanıyordu; kesim isteği uçuştayken operatör
      // listeden başka açık kumaşa tıklarsa İLGİSİZ topu finalize ediyordu.
      const remaining = data?.parentRemainingQty ?? 0;
      if (remaining < 0.1 && variables.rollId) {
        Toast.show({ type: 'success', text1: 'Açık kumaş tamamlandı' });
        finalizeOpenFabricMutation.mutate({
          rollId: variables.rollId,
          remainingAction: 'discard',
          foldType: work.foldType ?? null,
        });
      } else {
        Toast.show({ type: 'success', text1: 'Top oluşturuldu' });
        await refetchActiveJob();
      }
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Top oluşturulamadı', text2: err.message });
    },
  });

  // OFFLINE-AWARE: mutationFn `setMutationDefaults`'ta tanımlı; persist sonrası
  // app restart'ında resolve. onMutate'te optimistic — açık kumaş listeden anında
  // düşer; onError'da rollback. Backend idempotent (status===TAMBUR_CONSUMED
  // check + cached TAMBUR_PROCESSED metadata).
  const finalizeOpenFabricMutation = useMutation<
    Awaited<ReturnType<typeof tamburService.finalizeOpenFabric>>,
    Error,
    TamburFinalizeOpenFabricVars,
    { cardId: string; prevRolls: TamburRollSummary[]; prevSelectedRollId: string | null } | undefined
  >({
    mutationKey: STATION_MUT.TAMBUR_FINALIZE_OPEN_FABRIC,
    onMutate: (vars) => {
      if (!activeJob) return undefined;
      const cardId = activeJob.cardId;
      const prevRolls = activeJob.stepSummary.rolls;
      const prevSelectedRollId = activeJob.selectedRollId;
      const updatedRolls = prevRolls.filter((r) => r.rollId !== vars.rollId);
      const nextSelected = updatedRolls[0]?.rollId ?? null;
      setOpenJobs((prev) =>
        prev.map((j) =>
          j.cardId === cardId
            ? {
                ...j,
                stepSummary: { ...j.stepSummary, rolls: updatedRolls },
                selectedRollId: nextSelected,
              }
            : j,
        ),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Tambur tamamlandı',
        text2: onlineManager.isOnline() ? undefined : 'Çevrimdışı — sync bekliyor',
      });
      return { cardId, prevRolls, prevSelectedRollId };
    },
    onSuccess: async () => {
      setMarkAsKartela(false); // bir sonraki top için sıfırla
      if (!activeJob) {
        qc.invalidateQueries({ queryKey: ['rolls'] });
        return;
      }
      // Backend'den güncel step'i çek; bitirilen roll listeden düşmüş olmalı
      const stepRes = await tamburService.getStep(
        activeJob.stepSummary.workOrderStepId,
      );
      const step = stepRes.data as TamburStepSummary | undefined;
      const remainingRolls = step?.rolls ?? [];
      if (remainingRolls.length === 0) {
        // Kartta başka top yok → kartı kapat (otomatik X)
        setOpenJobs((prev) => {
          const next = prev.filter((j) => j.cardId !== activeJob.cardId);
          setActiveCardId(next[0]?.cardId ?? null);
          return next;
        });
      } else {
        // BUG FIX: onMutate zaten bir sonrakini (updatedRolls[0]) seçti. Burada
        // TEKRAR ilerletme — sadece listeyi backend ile eşitle ve seçiliyi KORU.
        // Eski kod `find(r => r.rollId !== selectedRollId)` ile, seçili artık
        // "sıradaki" olduğundan onu da atlayıp BİR FAZLA ilerliyordu. Seçili hâlâ
        // listede ise koru; değilse (silinmişse) ilk topa düş.
        const sel = activeJob.selectedRollId;
        const keepId = remainingRolls.some((r) => r.rollId === sel)
          ? sel
          : (remainingRolls[0]?.rollId ?? null);
        setOpenJobs((prev) =>
          prev.map((j) =>
            j.cardId === activeJob.cardId
              ? {
                  ...j,
                  stepSummary: step!,
                  selectedRollId: keepId,
                }
              : j,
          ),
        );
      }
      qc.invalidateQueries({ queryKey: ['rolls'] });
    },
    onError: (err, _vars, context) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      if (context) {
        setOpenJobs((prev) =>
          prev.map((j) =>
            j.cardId === context.cardId
              ? {
                  ...j,
                  stepSummary: { ...j.stepSummary, rolls: context.prevRolls },
                  selectedRollId: context.prevSelectedRollId,
                }
              : j,
          ),
        );
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Tamamlanamadı', text2: err.message });
    },
  });

  const reportErrorMutation = useMutation({
    mutationFn: tamburService.reportError,
    onSuccess: async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Hata listeye eklendi' });
      setWork((w) => ({
        ...w,
        errorEntry: { ...EMPTY_ERROR_ENTRY, defectTypeId: w.errorEntry.defectTypeId },
      }));
      await refetchActiveJob();
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Eklenemedi', text2: err.message });
    },
  });

  const deleteErrorMutation = useMutation({
    mutationFn: tamburService.deleteError,
    onSuccess: async () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Karar state'inden de düş
      await refetchActiveJob();
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Toast.show({ type: 'error', text1: 'Silinemedi', text2: err.message });
    },
  });

  // Top Kesme — multi-cut: her kesim child Roll doğurur, parent currentQty
  // düşer, etiket otomatik basılır. Operatör istediği kadar tekrarlar.
  const cutWarehouseRollMutation = useMutation({
    mutationFn: ({
      rollId,
      cutLength,
      qualityGrade,
      targetOrderLineId,
      targetCustomerId,
      markedForKartela,
      rawDestination,
      clientToken,
    }: {
      rollId: string;
      cutLength: number;
      qualityGrade: string;
      targetOrderLineId?: string | null;
      /** Sipariş-dışı müşteri hedefi — backend cut'a gider, child'ın
       *  lastLabelSnapshot'ına seed edilir (yazıcı/ekran bağımsız kalıcı niyet). */
      targetCustomerId?: string | null;
      markedForKartela?: boolean;
      rawDestination?: 'STOCK' | 'WAREHOUSE';
      /** Ağ-retry idempotency: kesim anında üretilir, retry'da aynı kalır. */
      clientToken?: string;
    }) =>
      tamburService.cutWarehouseRoll(rollId, {
        cutLength,
        qualityGrade,
        targetOrderLineId: targetOrderLineId ?? null,
        targetCustomerId: targetCustomerId ?? null,
        markedForKartela: markedForKartela ?? false,
        rawDestination,
        clientToken,
      }),
    onSuccess: (res, variables) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const data = res.data;
      if (data?.childRoll?.barcode) {
        // Hedef "Kime" bölümünde zaten seçili → tekrar "Etiket kime?" SORMA,
        // doğrudan o hedefe bas (open fabric kesimiyle aynı). Hiçbir şey seçili
        // değilse = stok (explicit müşterisiz etiket — WO tahmini sızmasın);
        // sonradan "Etiket Değiştir" ile yönlendirilebilir.
        setLabelContext(
          variables.targetCustomerId
            ? { customerId: variables.targetCustomerId }
            : variables.targetOrderLineId
              ? { orderLineId: variables.targetOrderLineId }
              : { stock: true },
        );
        setActivePrintRoll(data.childRoll);
      }
      // Parent metraj güncelle (sticky header anında yansır)
      if (data && typeof data.parentRemainingQty === 'number' && recutRollMeta) {
        setRecutRollMeta({ ...recutRollMeta, currentQty: data.parentRemainingQty });
      }
      // Güncel parent'ı tut — X kapat sırasında etiket yenilenmek için kuyruğa
      // atılır (backend initialQty'yi de reset etti, etiket fiziksel olarak da
      // yenilenmeli).
      if (data?.parentRoll) {
        setRecutLastParentRoll(data.parentRoll);
      }
      setRecutCutLength('');
      // OTOMATİK BİTİŞ: kalan ~0 ise ayrı "Bitir" beklemeden arşivle.
      const remaining = data?.parentRemainingQty ?? 0;
      if (remaining < 0.1 && recutResolvedRollId) {
        Toast.show({ type: 'success', text1: 'Top Kesme tamamlandı' });
        finalizeWarehouseCutMutation.mutate({
          rollId: recutResolvedRollId,
          remainingAction: 'discard',
        });
      } else {
        Toast.show({
          type: 'success',
          text1: 'Top oluşturuldu',
          text2: `Kalan: ${remaining.toFixed(1)} m`,
        });
      }
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Kesim başarısız', text2: err.message });
    },
  });

  // NOT: Kartela artık Tambur'da kesilmez. Kartela = bitmiş topun kartela fason
  // firmasında işlenmesiyle doğar (Kartela Sevk + Kartela Kabul ekranları).
  // Eski recutSwatchMutation / handleRecutKartela kaldırıldı. Bkz. docs/design/KARTELA-TASARIM.md.

  // Top Kesme'yi bitir — parent retire (TAMBUR_CONSUMED), kalan için karar
  const finalizeWarehouseCutMutation = useMutation({
    mutationFn: ({
      rollId,
      remainingAction,
    }: {
      rollId: string;
      remainingAction: 'keep_1kalite' | 'keep_a1' | 'scrap' | 'discard';
    }) => tamburService.finalizeWarehouseCut(rollId, { remainingAction }),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Top Kesme bitti', text2: 'Top arşivlendi' });
      setMarkAsKartela(false); // bir sonraki top için sıfırla
      const remainingChild = res.data?.remainingChild ?? null;

      if (recutFinalizeOpen) {
        // Modal açıkken bitirildiyse (kalan > 0), kapanma animasyonu bittikten
        // sonra (onModalHide) state sıfırlanıp LabelPrintModal açılmalı.
        // Aksi halde "Top Kesme 2. tur" bug'ı oluşur (RNModal'lar çakışır).
        pendingRecutCleanupRef.current = { remainingChild: remainingChild as Roll | null };
        setRecutFinalizeOpen(false);
      } else {
        // Modal zaten kapalıysa (kalan = 0) hemen temizle.
        if (remainingChild) {
          setPendingPrintRolls((prev) => [...prev, remainingChild as Roll]);
        }
        setRecutResolvedRollId(null);
        setRecutRollMeta(null);
        setRecutCutLength('');
        setRecutQualityGrade('1.KALITE');
        setRecutLastParentRoll(null);
        qc.invalidateQueries({ queryKey: ['rolls'] });
      }
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Bitirilemedi', text2: err.message });
    },
  });


  // ── Decision helpers ──
  const setDecision = (errorId: string, decision: TamburDecision) => {
    setWork((w) => ({
      ...w,
      decisions: {
        ...w.decisions,
        [errorId]: {
          decision,
          qualityGrade: w.decisions[errorId]?.qualityGrade,
        },
      },
    }));
  };

  const setQualityGrade = (errorId: string, qualityGrade: string) => {
    setWork((w) => ({
      ...w,
      decisions: {
        ...w.decisions,
        [errorId]: {
          decision: w.decisions[errorId]?.decision ?? 'CUT',
          qualityGrade,
        },
      },
    }));
  };

  const handleAddError = () => {
    if (!activeJob || !selectedRoll) return;
    const start = parseFloat(work.errorEntry.startMeter);
    if (!Number.isFinite(start) || start < 0) {
      Toast.show({ type: 'error', text1: 'Metraj sayı olmalı' });
      return;
    }
    // Hata tipi seçilmediyse listenin ilkini kullan (admin "default" eklemeli)
    const defectTypeId = work.errorEntry.defectTypeId || defectTypes[0]?.id;
    if (!defectTypeId) {
      Toast.show({
        type: 'error',
        text1: 'Hata tipi yok',
        text2: 'Admin önce hata tipi tanımlamalı',
      });
      return;
    }
    reportErrorMutation.mutate({
      rollId: selectedRoll.rollId,
      stepId: activeJob.stepSummary.workOrderStepId,
      startMeter: start,
      defectTypeId,
    });
  };

  // Per-cut akış: kalan metre = parent'ın güncel currentQty (backend tutar).
  // Top / Kartela aynı uzunluk input'unu paylaşır; her ikisi de parent'ın
  // currentQty'sinden düşer (2 mt → 200 mt 198'e iner).
  const segmentPreview = useMemo(() => {
    if (!selectedRoll) return null;
    return {
      error: null as string | null,
      cuts: [] as Array<{ length: number; qualityGrade: string; qualityName?: string }>,
      remaining: selectedRoll.currentQty,
    };
  }, [selectedRoll]);

  const addVoluntaryCut = (lengthOverride?: number) => {
    if (!selectedRoll) return;
    // Barkod-reddi KALDIRILDI (2026-07-16): WO-kart akışındaki seçili top zaten Tambur
    // adımında (IN_PRODUCTION) — barkodlu olsun ya da olmasın kesilir. Backend (cutOpenFabric)
    // artık barkodlu topu kabul ediyor; "yanlış ekran" yönlendirme hatası kalktı. Gerçek
    // engel (top adımda değil / iptal / metraj) sunucuda kalır ve somut sebep söyler.
    // Otomatik modda uzunluk makineden (override) gelir. Manuelde input'tan;
    // input BOŞSA → kalanın tamamı (Kes = "kalanı kes", ayrı buton gerekmez).
    const manualTrimmed = work.voluntaryEntry.length.trim();
    const length =
      lengthOverride ??
      (manualTrimmed === ''
        ? Math.floor(selectedRoll.currentQty * 10) / 10
        : parseFloat(manualTrimmed));
    if (!Number.isFinite(length) || length <= 0) {
      Toast.show({ type: 'error', text1: 'Uzunluk pozitif sayı olmalı' });
      return;
    }
    // Aşım: girilen uzunluk kalan metrajdan fazla. Flag kapalıyken engelle
    // (bugünkü davranış); açıkken aşağıda onay diyaloğuyla devam et.
    const exceedsRemaining = length > selectedRoll.currentQty + 0.001;
    if (exceedsRemaining && !overQuantityEnabled) {
      Toast.show({
        type: 'error',
        text1: 'Kalan metrajı aşıyor',
        text2: `Kalan ${selectedRoll.currentQty.toFixed(1)} mt`,
      });
      return;
    }
    if (!work.voluntaryEntry.qualityGrade) {
      Toast.show({ type: 'error', text1: 'Kalite seçin' });
      return;
    }
    // Kalite kodu → RollStatus mapping (qualityGrade.targetStatus)
    const qg = qualityGrades.find(
      (q) => q.code === work.voluntaryEntry.qualityGrade,
    );
    const status = (qg?.targetStatus ?? 'WAREHOUSE') as
      | 'WAREHOUSE'
      | 'SCRAP'
      | 'A1_STOCK';
    const runCut = () =>
      cutOpenFabricMutation.mutate({
        rollId: selectedRoll.rollId,
        lengthMeters: length,
        status,
        qualityGrade: qg?.code ?? '1.KALITE',
        targetOrderLineId: work.voluntaryEntry.targetOrderLineId,
        targetCustomerId: work.voluntaryEntry.targetCustomerId,
        markedForKartela: markAsKartela,
        // Ağ-retry idempotency: kesim anında üret, retry'da aynı barkod → çift kesim yok.
        clientToken: generateClientUuid(),
      });
    // Aşımda parmak hatası koruması: onay iste (açık kumaşın tamamı tek topa döner).
    if (exceedsRemaining) {
      setOverCutConfirm({
        recorded: selectedRoll.currentQty,
        entered: length,
        onConfirm: runCut,
      });
      return;
    }
    runCut();
  };

  // Otomatik kesim ölçümü — seçili kata (foldType) ait makineden HC-06/BT ile metre OKU.
  // Simülasyon AÇIKsa (Ayarlar; varsayılan KAPALI) makineye hiç bağlanmaz, sahte değer üretir.
  // KAPALIyken gerçek makineden okunur; donanım yok / cihaz seçilmemiş / okuma hatası →
  // null döner (hata gösterilir, kesim YAPILMAZ; sessiz sahte değer YOK).
  // 2-KAT → 2-kat makinesi, 4-KAT → 4-kat makinesi.
  const measureFromMachine = async (remaining: number): Promise<number | null> => {
    const katLabel = work.foldType === '4-KAT' ? '4 Kat' : '2 Kat';
    const sim = () => {
      const lo = Math.min(5, remaining);
      const hi = Math.min(80, remaining);
      return Math.round((lo + Math.random() * (hi - lo)) * 10) / 10;
    };
    const p = meterPeripheralFor(meterPeripherals, work.foldType);
    if (!p) {
      Toast.show({
        type: 'error',
        text1: `${katLabel} metresi tanımlı değil`,
        text2: 'Admin → Cihaz Kaydı’ndan bu makineye METER cihazı (role) ekleyin.',
        visibilityTime: 6000,
      });
      return null;
    }
    // Cihazın simülasyon bayrağı açıksa (admin) sahte değer (test/donanımsız).
    if (p.simulate) return sim();

    const io = buildIoFromPeripheral(p);
    if (!io.supported || !io.transport || !io.codec) {
      Toast.show({
        type: 'error',
        text1: `${katLabel} metresi okunamıyor`,
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
        text1: `${katLabel} makinesi okunamadı`,
        text2: e instanceof Error ? e.message : 'Makine kapalı/menzil dışı veya komut yanlış olabilir',
        visibilityTime: 6000,
      });
      return null;
    }
  };

  // Footer "Kes" — manuel: input'taki uzunluk; otomatik: makineden ölçülen.
  const handleKes = async () => {
    if (cutMode === 'auto') {
      if (!selectedRoll || measuring) return;
      setMeasuring(true);
      try {
        const measured = await measureFromMachine(selectedRoll.currentQty);
        if (measured == null) return; // okunamadı → hata gösterildi, kesim yapma
        addVoluntaryCut(measured);
      } finally {
        setMeasuring(false);
      }
    } else {
      addVoluntaryCut();
    }
  };

  const removeVoluntaryCut = (id: string) => {
    setWork((w) => ({
      ...w,
      voluntaryCuts: w.voluntaryCuts.filter((c) => c.id !== id),
    }));
  };

  // Normal bitiş OTOMATİK (son kesimde kalan ~0 → finalize). Kalan kumaş artık
  // top yapmadan ayrıca atılmıyor; "Kalanı At" butonu kaldırıldı.
  const allFinalized =
    activeJob &&
    activeJob.stepSummary.rolls.length === 0;

  // Sağ panel içeriği — tablet inline rightCol ve telefon drawer'ı için ortak.
  // NumpadHost ayrı render edilir; compact'ta native klavye kullanıldığı için
  // drawer içinde NumpadHost yoktur.
  // Tek noktadan compact drawer queue. drawerQueue.run(handler) compact +
  // drawerOpen iken drawer'ı kapatıp handler'ı queue'ya yazar; aksi halde
  // direkt çağırır.
  const openScanner = () => drawerQueue.run(() => setScannerOpen(true));
  const openList = () => drawerQueue.run(() => setListModalOpen(true));
  const openRecentOutput = () => drawerQueue.run(() => setRecentOutputOpen(true));
  const openRecut = () => drawerQueue.run(() => setRecutScannerOpen(true));

  // Top Kesme akışı: kamera modal'ından tarama → onScan SADECE modal'ı kapatır
  // ve barkod'u pending state'e atar. Asıl resolve modal tamamen kapandıktan
  // (onModalHide) SONRA çalışır — aksi halde animation sırasında recutMode
  // mount edilirse invisible modal overlay tıklamayı yutuyor (RN nested modal).
  const [pendingRecutScan, setPendingRecutScan] = useState<string | null>(null);
  // O15 fix: Top Kesme'ye "Listeden Seç" alternatifi — kamera/etiket çalışmasa
  // da akış kilitlenmez (proje kuralı: okutulan her ekranda liste seçimi).
  const [recutPickerOpen, setRecutPickerOpen] = useState(false);
  const recutPickFromListPending = useRef(false);

  /** Kesim adayı doğrulaması: bitmiş depo topu VEYA renksiz ham stok. */
  const validateRecutCandidate = (r: { status: string; colorId?: string | null }): boolean => {
    const isRawStock = r.status === 'STOCK' && (r.colorId ?? null) === null;
    if (r.status !== 'WAREHOUSE' && !isRawStock) {
      Toast.show({
        type: 'error',
        text1: 'Top kesime uygun değil',
        text2: `Durum: ${r.status} (depodaki bitmiş toplar veya renksiz ham stok kesilebilir)`,
      });
      return false;
    }
    return true;
  };

  /** Doğrulanmış kesim topunu akışa uygula (kamera + liste ortak yolu). */
  const applyRecutRoll = (r: {
    id: string;
    barcode: string | null;
    currentQty: number | string;
    item?: { name: string } | null;
    itemId: string;
    colorId?: string | null;
    color?: { name: string } | null;
    width?: number | null;
    status: string;
  }) => {
    setRecutResolvedRollId(r.id);
    setRecutRollMeta({
      barcode: r.barcode,
      currentQty: Number(r.currentQty),
      item: r.item?.name ?? '—',
      itemId: r.itemId,
      colorId: r.colorId ?? null,
      colorName: r.color?.name ?? null,
      width: r.width ?? null,
      status: r.status,
    });
    // Ham kesimde varsayılan hedef: üretime devam (STOCK).
    setRecutRawDestination('STOCK');
    setRecutTargetLineId(null);
    setRecutTargetCustomerId(null);
    setRecutTargetCustomerName(undefined);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleRecutScanned = async (barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;
    try {
      const { rollService } = await import('../../../services/roll.service');
      const res = await rollService.getByBarcode(trimmed);
      const r = res.data;
      if (!r) {
        Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: trimmed });
        return;
      }
      if (!validateRecutCandidate(r)) return;
      applyRecutRoll(r);
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: 'Top sorgulanamadı',
        text2: (err as Error).message,
      });
    }
  };

  const handleRecutSubmit = (lengthOverride?: number) => {
    if (!recutResolvedRollId || !recutRollMeta) return;
    // Manuel modda input BOŞSA → kalanın tamamı (Kes = "kalanı kes"; tekrar metraj
    // girmeye gerek yok). Otomatik override / dolu input kendi değerini kullanır.
    const manualTrimmed = recutCutLength.trim();
    const cut =
      lengthOverride ??
      (manualTrimmed === ''
        ? Math.floor(recutRollMeta.currentQty * 10) / 10
        : parseFloat(recutCutLength));
    if (Number.isNaN(cut) || cut <= 0) {
      Toast.show({ type: 'error', text1: 'Kesim metresi pozitif olmalı' });
      return;
    }
    // Aşım: girilen kesim kalan metrajdan fazla. Flag kapalıyken engelle (bugünkü
    // davranış); açıkken aşağıda onay diyaloğuyla devam et.
    const exceedsRemaining = cut > recutRollMeta.currentQty;
    if (exceedsRemaining && !overQuantityEnabled) {
      Toast.show({
        type: 'error',
        text1: 'Geçersiz metraj',
        text2: `Mevcut metrajdan (${recutRollMeta.currentQty}m) küçük olmalı`,
      });
      return;
    }
    if (!recutQualityGrade) {
      Toast.show({ type: 'error', text1: 'Kalite seçilmedi' });
      return;
    }
    // Ham (renksiz STOCK) top → operatörün seçtiği parça hedefini gönder.
    const isRawStock =
      recutRollMeta.status === 'STOCK' && recutRollMeta.colorId == null;
    const runCut = () =>
      cutWarehouseRollMutation.mutate({
        rollId: recutResolvedRollId,
        cutLength: cut,
        qualityGrade: recutQualityGrade,
        targetOrderLineId: recutTargetLineId,
        targetCustomerId: recutTargetCustomerId,
        markedForKartela: markAsKartela,
        rawDestination: isRawStock ? recutRawDestination : undefined,
        // Ağ-retry idempotency: kesim anında üret, retry'da aynı barkod → çift kesim yok.
        clientToken: generateClientUuid(),
      });
    // Aşımda parmak hatası koruması: onay iste (top tamamen tüketilir).
    if (exceedsRemaining) {
      setOverCutConfirm({
        recorded: recutRollMeta.currentQty,
        entered: cut,
        onConfirm: runCut,
      });
      return;
    }
    runCut();
  };

  // Recut "Kes" — manuel: input'taki uzunluk; otomatik: makineden ölçülen (seçili
  // kata göre HC-06/BT, donanım yoksa simülasyon — measureFromMachine ile ortak).
  const handleRecutKes = async () => {
    if (recutMode === 'auto') {
      if (!recutRollMeta || measuring) return;
      setMeasuring(true);
      try {
        const measured = await measureFromMachine(recutRollMeta.currentQty);
        if (measured == null) return; // okunamadı → hata gösterildi, kesim yapma
        handleRecutSubmit(measured);
      } finally {
        setMeasuring(false);
      }
    } else {
      handleRecutSubmit();
    }
  };

  // "Kime" picker seçenekleri — recut akışında topa uyan TÜM açık satırlar
  // (getAvailableOrderLines), açık-kumaşta WO'ya bağlı sipariş satırları.
  // Bu WO'nun siparişlerindeki müşteri id'leri — picker'da öne alınır.
  const orderCustomerIds = useMemo(
    () => new Set((activeJob?.context?.orders ?? []).map((o) => o.customerId)),
    [activeJob],
  );
  // Tüm müşteriler — "Listeden Seç" açıkken çekilir (recut + ana akış). Recut'ta da
  // sipariş-dışı müşteriye kesebilmek için gerekir.
  const customersQuery = useQuery({
    queryKey: ['customers', 'tambur-kime-picker'],
    queryFn: () => customerService.getAll({ page: 1, pageSize: 500 }),
    enabled: kimePickerOpen,
    staleTime: 60_000,
  });

  useTruncationWarning(customersQuery.data?.pagination, 'Müşteri');

  // Picker seçenekleri: recut → WO sipariş satırları; ana akış → TÜM müşteriler
  // (siparişteki müşteriler en üstte, "✓ siparişi var" etiketiyle).
  // Ana liste = sipariş-DIŞI tüm müşteriler. Recut'ta da geçerli: topa siparişi
  // olmayan müşteriye kesmek için. Siparişi olanlar pinned'de (recut → satır,
  // ana akış → müşteri).
  const kimeOptions = useMemo<PickerOption[]>(() => {
    const all = customersQuery.data?.data ?? [];
    if (recutRollMeta) {
      const lineCustomerIds = new Set(recutLineOptions.map((l) => l.customerId));
      return all
        .filter((c) => !lineCustomerIds.has(c.id))
        .map((c) => ({ value: c.id, label: c.name, sublabel: c.code ?? undefined }));
    }
    return all
      .filter((c) => !orderCustomerIds.has(c.id))
      .map((c) => ({ value: c.id, label: c.name, sublabel: c.code ?? undefined }));
  }, [recutRollMeta, recutLineOptions, customersQuery.data, orderCustomerIds]);

  // Çerçeveli (pinned) grup — recut: topa uyan açık sipariş SATIRLARI (value=lineId);
  // ana akış: bu iş emrinde siparişi olan müşteriler (value=customerId).
  const kimePinnedOptions = useMemo<PickerOption[]>(() => {
    if (recutRollMeta) {
      return recutLineOptions.map((l) => ({
        value: l.lineId,
        label: l.customerName,
        sublabel: `${l.orderNumber} · ${l.itemName}${
          l.openQty ? ` · ${Math.round(l.openQty)}m açık` : ''
        }`,
      }));
    }
    const all = customersQuery.data?.data ?? [];
    return all
      .filter((c) => orderCustomerIds.has(c.id))
      .map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: c.code ?? undefined,
      }));
  }, [recutRollMeta, recutLineOptions, customersQuery.data, orderCustomerIds]);

  const handleKimeSelect = (value: string) => {
    if (recutRollMeta) {
      // Pinned = sipariş satırı (value=lineId); ana liste = müşteri (value=customerId).
      // İkisi karşılıklı dışlar; aynı değere 2. kez basınca seçim kalkar.
      const line = recutLineOptions.find((l) => l.lineId === value);
      if (line) {
        setRecutTargetLineId((prev) => (prev === value ? null : value));
        setRecutTargetCustomerId(null);
        setRecutTargetCustomerName(undefined);
      } else {
        const c = (customersQuery.data?.data ?? []).find((x) => x.id === value);
        setRecutTargetCustomerId((prev) => (prev === value ? null : value));
        setRecutTargetCustomerName(c?.name);
        setRecutTargetLineId(null);
      }
      return;
    }
    // Ana akış: value = customerId. 2. kez seçilirse seçim kalkar.
    const cust = (customersQuery.data?.data ?? []).find((c) => c.id === value);
    setWork((w) => {
      const same = w.voluntaryEntry.targetCustomerId === value;
      return {
        ...w,
        voluntaryEntry: {
          ...w.voluntaryEntry,
          targetOrderLineId: null,
          targetCustomerId: same ? null : value,
          targetCustomerName: same ? undefined : cust?.name,
        },
      };
    });
  };

  // "Listeden Seç" — SABİT satır; tüm müşteriler. Müşteri seçiliyse adını gösterir.
  const kimeCustomerActive = recutRollMeta
    ? !!recutTargetCustomerId
    : !!work.voluntaryEntry.targetCustomerId;
  const kimeListChip = (
    <TouchableRipple
      borderless
      onPress={() => setKimePickerOpen(true)}
      style={[
        styles.listOptionPicker,
        kimeCustomerActive && styles.listOptionPickerActive,
      ]}
      accessibilityLabel="Listeden müşteri seç (tüm müşteriler)"
    >
      <View style={styles.listOptionPickerInner}>
        <Icon
          source={kimeCustomerActive ? 'check' : 'account-search'}
          size={16}
          color={kimeCustomerActive ? '#fff' : '#4f46e5'}
        />
        <Text
          style={[
            styles.kimeListChipText,
            kimeCustomerActive && styles.listOptionTextActive,
          ]}
          numberOfLines={1}
        >
          {kimeCustomerActive
            ? recutRollMeta
              ? recutTargetCustomerName
              : work.voluntaryEntry.targetCustomerName
            : 'Listeden Seç'}
        </Text>
      </View>
    </TouchableRipple>
  );

  // "Stok (müşterisiz)" — açık stok seçeneği. Hiç sipariş/müşteri seçili değilken
  // AKTİF (dolu) görünür → operatör stok modunda olduğunu net görür. Bir dokunuş
  // tüm hedefi temizler (müşteri seçimini geri almak için picker'ı yeniden açıp
  // toggle'lamaya gerek kalmaz).
  const stokActive = recutRollMeta
    ? !recutTargetLineId && !recutTargetCustomerId
    : !work.voluntaryEntry.targetOrderLineId && !work.voluntaryEntry.targetCustomerId;
  const clearToStock = () => {
    if (recutRollMeta) {
      setRecutTargetLineId(null);
      setRecutTargetCustomerId(null);
      setRecutTargetCustomerName(undefined);
    } else {
      setWork((w) => ({
        ...w,
        voluntaryEntry: {
          ...w.voluntaryEntry,
          targetOrderLineId: null,
          targetCustomerId: null,
          targetCustomerName: undefined,
        },
      }));
    }
  };
  const stokChip = (
    <TouchableRipple
      borderless
      onPress={clearToStock}
      style={[styles.stokPickerChip, stokActive && styles.stokPickerChipActive]}
      accessibilityLabel="Stok (müşterisiz) — etiket müşteri bilgisi olmadan basılır"
    >
      <View style={styles.listOptionPickerInner}>
        <Icon
          source={stokActive ? 'check' : 'tag-outline'}
          size={16}
          color={stokActive ? '#fff' : '#0f766e'}
        />
        <Text
          style={[styles.stokPickerChipText, stokActive && styles.listOptionTextActive]}
          numberOfLines={1}
        >
          Stok (müşterisiz)
        </Text>
      </View>
    </TouchableRipple>
  );

  const resetRecut = () => {
    // X kapat: kesim yapıldıysa parent etiketini otomatik basım kuyruğuna at —
    // operatör fiziksel etiketi söküp güncel metraj/barkodlu yenisini yapıştırır.
    if (recutLastParentRoll) {
      setPendingPrintRolls((prev) => [...prev, recutLastParentRoll]);
    }
    setRecutResolvedRollId(null);
    setRecutRollMeta(null);
    setRecutTargetLineId(null);
    setRecutTargetCustomerId(null);
    setRecutTargetCustomerName(undefined);
    setRecutCutLength('');
    setRecutQualityGrade('1.KALITE');
    setRecutRawDestination('STOCK');
    setRecutLastParentRoll(null);
  };

  const renderRightContent = () => (
    <>
      {/* HID/manuel modda kart barkodu metin girişi sağ panelde kalır (bir input,
          header'a taşınamaz). Tablet'te aksiyon butonları header'a alındı; bunlar
          yalnızca telefonda (drawer) gösterilir. Kamera modunda tablet'te bu alan
          hiç render edilmez → liste için dikey alan açılır. */}
      {manualBarcodeEntry ? (
        <View style={styles.cardInputWrap}>
          <ScannerEntryBar
            value={cardBarcode}
            onChangeText={setCardBarcode}
            placeholder="Refakat kartı barkodu okut/yaz..."
            onResolve={handleResolveCard}
            resolving={resolvingCard}
            onScan={() => openScanner()}
            onList={() => openList()}
            tone="blue"
          />
          {compact && (
            <View style={styles.actionBtnRow}>
              <Button
                mode="outlined"
                icon="printer-search"
                compact
                onPress={() => openRecentOutput()}
                textColor="#0f172a"
              >
                Çıkan Toplar
              </Button>
              <Button
                mode="outlined"
                icon="content-cut"
                compact
                onPress={() => openRecut()}
                textColor="#b91c1c"
              >
                Top Kesme
              </Button>
            </View>
          )}
        </View>
      ) : compact ? (
        // Telefon kamera-only mod: Çıkanlar/Kesme drawer'da tek satır büyük
        // ikon. Liste ve Tara artık header'ın 2. katında (phoneSecondRow) —
        // burada tekrar etmez.
        <View style={styles.cardInputWrap}>
          <View style={styles.actionsCompactRow}>
            <CompactAction
              icon="printer-search"
              label="Çıkanlar"
              bg="#e0f2fe"
              color="#0369a1"
              onPress={() => openRecentOutput()}
            />
            <CompactAction
              icon="content-cut"
              label="Kesme"
              bg="#fee2e2"
              color="#b91c1c"
              onPress={() => openRecut()}
            />
          </View>
        </View>
      ) : null}

      {openJobs.length > 0 && (
        <View style={styles.tabBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabScroll}
          >
            {openJobs.map((job) => (
              <JobTab
                key={job.cardId}
                job={job}
                active={job.cardId === activeCardId}
                onPress={() => setActiveCardId(job.cardId)}
                onClose={() => closeJob(job.cardId)}
              />
            ))}
          </ScrollView>
          <View style={styles.tabRefreshWrap}>
            <RefreshButton
              onPress={activeRefresh.onRefresh}
              refreshing={activeRefresh.refreshing}
              isError={activeRefresh.isError}
              errorMessage={activeRefresh.errorMessage}
              successMessage={activeRefresh.successMessage}
            />
          </View>
        </View>
      )}

      {!activeJob ? (
        <View style={styles.paneEmpty}>
          <Icon source="package-variant-closed" size={48} color="#cbd5e1" />
          <Text style={styles.paneEmptyText}>Henüz açık iş yok</Text>
        </View>
      ) : activeJob.stepSummary.rolls.length === 0 ? (
        <View style={styles.paneEmpty}>
          <Icon source="check-circle-outline" size={48} color="#10b981" />
          <Text style={styles.paneEmptyText}>Tüm toplar finalize</Text>
          <Text style={styles.paneEmptyHint}>Sekmeyi kapatabilirsin</Text>
        </View>
      ) : (
        <BranchGroupedRollList
          rolls={activeJob.stepSummary.rolls}
          selectedRollId={activeJob.selectedRollId}
          onSelect={selectRoll}
        />
      )}
    </>
  );

  // Telefonda "Açık İşler" (operatörün açtığı kart sekmeleri), "Açık Kartlar"
  // ve "Tara" erişimi Kurşun/Ham Giriş ile aynı desende: header'da sıkışan tek
  // ikon yerine, başlığın ALTINDAKİ 2. katta yan yana üç etiketli chip
  // (secondRow) — hepsi drawer açmadan doğrudan erişilir. Çıkanlar/Kesme
  // telefonda drawer içinde kalır.
  const phoneSecondRow = (
    <>
      <HeaderChip
        icon="clipboard-list-outline"
        label={`Açık İşler · ${openJobs.length}`}
        onPress={() => setRightDrawerOpen(true)}
        fill
      />
      <HeaderChip
        icon="format-list-bulleted"
        label="Açık Kartlar"
        onPress={() => openList()}
        fill
      />
      <HeaderChip icon="camera" label="Tara" onPress={() => openScanner()} fill />
    </>
  );

  // ── Render ──
  return (
    <ScreenChrome
      title="Tambur"
      subtitle={compact ? machineName : undefined}
      hidePlaceChip={compact}
      headerExtras={
        <View style={styles.headerExtrasRow}>
          <SyncStatusChip />
          {/* Tablet: kart aksiyonları header'a etiketli pill olarak alınır →
              sağ kolonda liste için alan açılır. Telefonda erişim 2. kattaki
              chip'lerden (phoneSecondRow) + drawer içinden. */}
          {!compact && (
            <>
              <HeaderChip
                icon="format-list-bulleted"
                label="Liste"
                onPress={() => openList()}
              />
              <HeaderChip icon="camera" label="Tara" onPress={() => openScanner()} />
              <HeaderChip
                icon="printer-search"
                label="Çıkanlar"
                onPress={() => openRecentOutput()}
              />
              <HeaderChip
                icon="content-cut"
                label="Kesme"
                onPress={() => openRecut()}
              />
            </>
          )}
        </View>
      }
      secondRow={compact ? phoneSecondRow : undefined}
      secondRowSpread={compact}
    >
      <View
        style={[
          styles.body,
          // Telefon: yatay kozmetik padding YOK → koyu header/not şeridi tam
          // ekran (full-bleed). İç elemanlar zaten kendi padding'ini taşıyor
          // (header/not 14, scroll 12, footer 10). Sadece çentik/yuvarlak köşe
          // için safe-area inset'i korunur (yatayda landscape'te devreye girer).
          compact && {
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
        // Compact (telefon dik) + native klavye açıkken: input dışına dokununca
        // klavyeyi indir. Capture phase'de false döndüğümüz için child Pressable/
        // Button'lar normal şekilde responder olur — basit "dış-tıkla-kapat" pattern.
        onStartShouldSetResponderCapture={
          compact
            ? () => {
                Keyboard.dismiss();
                return false;
              }
            : undefined
        }
      >
        {/* ════════ SOL: form ════════ */}
        <View style={styles.formCol}>
          {recutResolvedRollId && recutRollMeta ? (
            // Top Kesme akışı — sağdaki "Top Kesme" tetikleyince top okutulur.
            // Normal Tambur akışıyla AYNI kabuk: flush header + kaydırılabilir
            // form + sticky footer (CutActionBar). activeJob/refakat kartından
            // bağımsız, exclusive bir mod. (İçerik farkı: depo topunda Hata
            // Noktaları / 2-4 Kat / Tambur notu yok — o veriler bulunmuyor.)
            <>
              <Surface
                style={[styles.headerBand, compact && styles.headerBandCompact]}
                elevation={2}
              >
                <View
                  style={[styles.headerTitleCol, !compact && styles.headerTitleFlex]}
                >
                  <Text style={styles.headerBarcode} numberOfLines={1}>
                    {recutRollMeta.barcode ?? '—'}
                  </Text>
                  <Text style={styles.headerSub} numberOfLines={2}>
                    {recutRollMeta.item}
                    {recutRollMeta.colorName ? ` · ${recutRollMeta.colorName}` : ''}
                    {recutRollMeta.width != null ? ` · ${recutRollMeta.width} cm` : ''}
                  </Text>
                  {/* Renksiz top = ham kumaş — etiket ham basılır, "bitmiş" değil. */}
                  {recutRollMeta.colorId == null && (
                    <View style={styles.hamBadge}>
                      <Icon source="alpha-h-circle-outline" size={14} color="#fff" />
                      <Text style={styles.hamBadgeText}>HAM KUMAŞ</Text>
                    </View>
                  )}
                </View>
                <View
                  style={[styles.headerBoxes, compact && styles.headerBoxesCompact]}
                >
                  <View
                    style={[
                      styles.headerBox,
                      styles.headerBoxGreen,
                      compact && styles.headerBoxFlex,
                      recutRollMeta.currentQty <= 0.001 && styles.headerBoxDanger,
                    ]}
                  >
                    <Text style={styles.headerBoxValue}>
                      {recutRollMeta.currentQty.toFixed(1)}
                    </Text>
                    <Text style={styles.headerBoxSub}>mt kalan</Text>
                  </View>
                  <IconButton
                    icon="close"
                    size={22}
                    iconColor="#fff"
                    onPress={resetRecut}
                    accessibilityLabel="Top Kesme'yi kapat"
                    style={{ margin: 0 }}
                  />
                </View>
              </Surface>

              {/* WO akışıyla aynı düzen: kaydırılabilir form + sticky footer */}
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
              >
                <Surface style={styles.section} elevation={1}>
                  {/* Uzunluk girişi + Manuel/Otomatik toggle yan yana */}
                  <View style={styles.lengthModeRow}>
                    <View style={styles.lengthCol}>
                      {recutMode === 'manual' ? (
                        <View style={styles.cutInputRow}>
                          <View style={{ flex: 1 }}>
                            <NumpadInput
                              mode="outlined"
                              value={recutCutLength}
                              onChangeText={setRecutCutLength}
                              numpadLabel="Kesim uzunluğu"
                              allowDecimal
                              autoActivate
                              numpadMaxLength={8}
                              placeholder="Boş = kalanı kes (metre)"
                              dense
                              style={styles.input}
                              useNativeKeyboard={compact}
                            />
                          </View>
                          <IconButton
                            icon="backspace-outline"
                            mode="contained-tonal"
                            size={24}
                            iconColor="#475569"
                            containerColor="#e2e8f0"
                            onPress={() => setRecutCutLength('')}
                            disabled={!recutCutLength}
                            accessibilityLabel="Uzunluğu temizle"
                            style={{ margin: 0 }}
                          />
                        </View>
                      ) : (
                        <View style={styles.autoLengthBox}>
                          <Icon source="ruler" size={24} color="#7c3aed" />
                          <Text style={styles.autoLengthLabel}>Uzunluk</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.cutModeToggle}>
                      {(['manual', 'auto'] as const).map((m) => {
                        const active = recutMode === m;
                        return (
                          <TouchableRipple
                            key={m}
                            borderless
                            onPress={() => setRecutMode(m)}
                            style={[styles.cutModeChip, active && styles.cutModeChipActive]}
                          >
                            <Text
                              style={[
                                styles.cutModeChipText,
                                active && styles.cutModeChipTextActive,
                              ]}
                            >
                              {m === 'manual' ? 'Manuel' : 'Otomatik'}
                            </Text>
                          </TouchableRipple>
                        );
                      })}
                    </View>
                  </View>

                  {/* Ham (renksiz STOCK) top → her parçanın hedefi: üretime devam
                      (ham STOCK, yeni iş emrine bağlanır) veya sevke hazır
                      (ham-bitmiş WAREHOUSE). Renkli/bitmiş topta gösterilmez. */}
                  {recutRollMeta.status === 'STOCK' &&
                    recutRollMeta.colorId == null && (
                      <View style={styles.rawDestBlock}>
                        <Text style={styles.entryLabel}>Ham parça hedefi</Text>
                        <View style={styles.rawDestToggle}>
                          {(
                            [
                              { key: 'STOCK', label: 'Üretime devam', icon: 'progress-wrench' },
                              { key: 'WAREHOUSE', label: 'Sevke hazır', icon: 'truck-outline' },
                            ] as const
                          ).map((opt) => {
                            const active = recutRawDestination === opt.key;
                            return (
                              <TouchableRipple
                                key={opt.key}
                                borderless
                                onPress={() => setRecutRawDestination(opt.key)}
                                style={[
                                  styles.rawDestChip,
                                  active && styles.rawDestChipActive,
                                ]}
                              >
                                <View style={styles.rawDestChipInner}>
                                  <Icon
                                    source={opt.icon}
                                    size={18}
                                    color={active ? '#fff' : '#7c3aed'}
                                  />
                                  <Text
                                    style={[
                                      styles.rawDestChipText,
                                      active && styles.rawDestChipTextActive,
                                    ]}
                                  >
                                    {opt.label}
                                  </Text>
                                </View>
                              </TouchableRipple>
                            );
                          })}
                        </View>
                        <Text style={styles.rawDestHint}>
                          {recutRawDestination === 'STOCK'
                            ? 'Parça ham stoğa döner — boyahane/KK2/tambur için yeni iş emrine bağlanabilir.'
                            : 'Parça ham-bitmiş olarak depoya iner — ham etiketle sevk edilebilir.'}
                        </Text>
                      </View>
                    )}

                  {/* "Kalanı kullan" butonu kaldırıldı — boş input zaten kalanı
                      keser; footer "Kes — Kalanı Kes (X mt)" ile bunu söyler
                      (normal akışla aynı). */}

                  {/* Kime + Kalite yan yana iki sütun; her sütun kendi dikey listesi */}
                  <View style={styles.kimeKaliteRow}>
                    <View style={styles.kimeCol}>
                      <Text style={styles.cutSubLabel}>Kime?</Text>
                      {stokChip}
                      {kimeListChip}
                      <ScrollView
                        style={styles.kimeScroll}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                      >
                        <View style={styles.optionList}>
                          {recutLineOptions.map((l) => {
                            const active = recutTargetLineId === l.lineId;
                            return (
                              <TouchableRipple
                                key={l.lineId}
                                borderless
                                onPress={() => {
                                  setRecutTargetLineId(active ? null : l.lineId);
                                  setRecutTargetCustomerId(null);
                                  setRecutTargetCustomerName(undefined);
                                }}
                                style={[
                                  styles.listOption,
                                  active && styles.listOptionActive,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.listOptionText,
                                    active && styles.listOptionTextActive,
                                  ]}
                                  numberOfLines={2}
                                >
                                  {l.customerName} · {Math.round(l.openQty)}m açık
                                </Text>
                              </TouchableRipple>
                            );
                          })}
                        </View>
                      </ScrollView>
                    </View>

                    <View style={styles.kaliteCol}>
                      <Text style={styles.cutSubLabel}>Kalite</Text>
                      <View style={styles.optionList}>
                        {qualityGrades.map((qg) => {
                          const active = recutQualityGrade === qg.code;
                          return (
                            <TouchableRipple
                              key={qg.id}
                              borderless
                              onPress={() => setRecutQualityGrade(qg.code)}
                              style={[
                                styles.listOption,
                                active && styles.listOptionActive,
                                active && qg.color
                                  ? { backgroundColor: qg.color, borderColor: qg.color }
                                  : null,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.listOptionText,
                                  active && styles.listOptionTextActive,
                                ]}
                              >
                                {qg.name}
                              </Text>
                            </TouchableRipple>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                </Surface>
              </ScrollView>

              {/* Sticky footer (Kartela + Kes) — Top Kesme akışı. Son kesimde
                  kalan ~0 olunca depo topu OTOMATİK arşivlenir. */}
              <CutActionBar
                compact={compact}
                kartelaOn={markAsKartela}
                onToggleKartela={() => setMarkAsKartela((v) => !v)}
                onKes={handleRecutKes}
                kesLoading={
                  cutWarehouseRollMutation.isPending ||
                  finalizeWarehouseCutMutation.isPending ||
                  measuring
                }
                kesDisabled={
                  !recutQualityGrade ||
                  recutRollMeta.currentQty <= 0 ||
                  // Manuelde boş input'a İZİN VER (= kalanı kes). Sadece dolu
                  // ama geçersiz (≤0 / kalanı aşan) değer girilince kilitle.
                  // Aşım flag'i açıkken kalanı aşan değer kilitlenmez — onayla geçer.
                  (recutMode === 'manual' &&
                    recutCutLength.trim() !== '' &&
                    (parseFloat(recutCutLength) <= 0 ||
                      (!overQuantityEnabled &&
                        parseFloat(recutCutLength) > recutRollMeta.currentQty)))
                }
                kesLabel={
                  recutMode === 'auto'
                    ? 'Kes — Makineden Ölç'
                    : recutCutLength.trim() === '' && recutRollMeta.currentQty > 0.001
                      ? compact
                        ? 'Kes — Kalanı Kes'
                        : `Kes — Kalanı Kes (${recutRollMeta.currentQty.toFixed(1)} mt)`
                      : 'Kes — Top Oluştur'
                }
              />
            </>
          ) : !activeJob ? (
            <View style={styles.emptyState}>
              <Icon source="card-search-outline" size={64} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>Kart açılmadı</Text>
              <Text style={styles.emptyHint}>
                {compact
                  ? 'Üstten "Açık İşler" butonuyla kart okutarak başlayın'
                  : 'Sağdan refakat kartını okutarak başlayın'}
              </Text>
            </View>
          ) : !selectedRoll ? (
            <View style={styles.emptyState}>
              <Icon source="package-variant" size={64} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>Top seçilmedi</Text>
              <Text style={styles.emptyHint}>
                Sağdaki kuyruktan birini seçin
              </Text>
            </View>
          ) : (
            <>
              {/* Sticky header — kalan metre + siparişler butonu prominent */}
              <Surface
                style={[styles.headerBand, compact && styles.headerBandCompact]}
                elevation={2}
              >
                <View
                  style={[styles.headerTitleCol, !compact && styles.headerTitleFlex]}
                >
                  <Text style={styles.headerBarcode} numberOfLines={1}>
                    {selectedRoll.barcode ?? `Açık Kumaş · ${selectedRoll.rollId.slice(0, 8)}`}
                  </Text>
                  <Text style={styles.headerSub} numberOfLines={2}>
                    {selectedRoll.itemName}
                    {selectedRoll.colorName ? ` · ${selectedRoll.colorName}` : ''}
                    {selectedRoll.width != null ? ` · ${selectedRoll.width} cm` : ''}
                  </Text>
                  {selectedRoll.properties.length > 0 && (
                    <View style={styles.headerPropRow}>
                      {selectedRoll.properties.map((p) => (
                        <View key={p.id} style={styles.headerPropChip}>
                          <Text style={styles.headerPropChipText} numberOfLines={1}>
                            {p.name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* mt kalan / katlama / sipariş kutu grubu. Telefonda başlığın
                    ALTINDA tek satır; her kutu eşit pay alıp genişliği doldurur. */}
                <View
                  style={[styles.headerBoxes, compact && styles.headerBoxesCompact]}
                >
                  {/* Kalan metre — operatörün ana ölçeği */}
                  <View
                    style={[
                      styles.headerBox,
                      styles.headerBoxGreen,
                      compact && styles.headerBoxFlex,
                      (segmentPreview?.remaining ?? 0) <= 0.001 &&
                        styles.headerBoxDanger,
                    ]}
                  >
                    <Text style={styles.headerBoxValue}>
                      {(segmentPreview?.remaining ?? selectedRoll.currentQty).toFixed(1)}
                    </Text>
                    <Text style={styles.headerBoxSub}>mt kalan</Text>
                  </View>

                  {/* İş emrinde belirlenen katlama — metre kutusunun yanında, mor.
                      SABİT referans: iş emrinin planı (plannedFoldType). Aşağıdaki
                      düzenlenebilir kat chip'lerinden BAĞIMSIZ — operatör chip'i
                      değiştirse bile burası iş emrinin değerini gösterir.
                      "2 Kat / sarım" şeklinde okunur. */}
                  <View
                    style={[
                      styles.headerBox,
                      styles.headerBoxFold,
                      compact && styles.headerBoxFlex,
                    ]}
                  >
                    <Text style={styles.headerBoxValue}>
                      {activeJob?.context?.plannedFoldType === '4-KAT'
                        ? '4 Kat'
                        : '2 Kat'}
                    </Text>
                    <Text style={styles.headerBoxSub}>sarım</Text>
                  </View>

                  {/* Siparişler — modal trigger */}
                  {!!activeJob?.context?.orders &&
                    activeJob.context.orders.length > 0 && (
                      <TouchableRipple
                        onPress={() => setOrdersModalOpen(true)}
                        borderless
                        style={[
                          styles.headerBox,
                          styles.headerBoxDark,
                          compact && styles.headerBoxFlex,
                        ]}
                      >
                        <View style={styles.headerBoxInner}>
                          <Text style={styles.headerBoxValue}>
                            {activeJob.context.orders.length}
                          </Text>
                          <Text style={styles.headerBoxSub}>sipariş</Text>
                        </View>
                      </TouchableRipple>
                    )}
                </View>
              </Surface>

              {/* İş emri Tambur adım notu — sticky şerit (header'ın hemen altında,
                  ScrollView dışında → kesim için aşağı kaydırınca kaybolmaz).
                  İlk satır dokunmadan görünür; dokun → tam not modal'i. */}
              {!!activeJob?.context?.stepNote?.trim() && (
                <TouchableRipple
                  onPress={() => setNoteModalOpen(true)}
                  style={styles.noteStrip}
                >
                  <View style={styles.noteStripInner}>
                    <Icon source="note-text-outline" size={16} color="#78350f" />
                    <Text style={styles.noteStripLabel}>Tambur Notu</Text>
                    <Text style={styles.noteStripText} numberOfLines={1}>
                      {activeJob.context.stepNote.trim()}
                    </Text>
                    <Icon source="chevron-right" size={16} color="#b45309" />
                  </View>
                </TouchableRipple>
              )}

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {/* Hata noktaları — metre cetveli. Çok nokta olsa da tek bakışta
                    okunur (yakın noktalar kümelenir). Not artık sticky header'da;
                    burada sadece hata haritası var. Dokun → cetvel + sıralı/
                    filtreli liste modal'i. */}
                {(() => {
                  const errs = selectedRoll.errors;
                  const critCount = errs.reduce(
                    (n, e) =>
                      n +
                      (defectTypes.find((d) => d.name === e.errorType)?.severity ===
                      'CRITICAL'
                        ? 1
                        : 0),
                    0,
                  );
                  return (
                    <TouchableRipple
                      onPress={
                        errs.length ? () => setErrorsModalOpen(true) : undefined
                      }
                      disabled={errs.length === 0}
                      borderless
                      style={styles.defectGuideSection}
                    >
                      <View style={{ gap: 6 }}>
                        <View style={styles.defectGuideTitleRow}>
                          <Text style={styles.defectGuideTitle}>
                            Hata Noktaları ({errs.length})
                          </Text>
                          {critCount > 0 && (
                            <View style={styles.defectCritBadge}>
                              <Text style={styles.defectCritBadgeText}>
                                {critCount} kritik
                              </Text>
                            </View>
                          )}
                          <View style={{ flex: 1 }} />
                          {errs.length > 0 && (
                            <Icon
                              source="chevron-right"
                              size={18}
                              color="#94a3b8"
                            />
                          )}
                        </View>
                        {errs.length === 0 ? (
                          <Text style={styles.defectGuideEmpty}>Kayıtlı hata yok</Text>
                        ) : (
                          <DefectRuler
                            errors={errs}
                            defectTypes={defectTypes}
                            rulerMax={rulerMaxForErrors(
                              selectedRoll.currentQty,
                              errs,
                            )}
                          />
                        )}
                      </View>
                    </TouchableRipple>
                  );
                })()}

                {/* Kesim — operatör fiziksel kesim yapar, anında sisteme girer.
                    Her "Top Oluştur" tıklaması child Roll oluşturur + etiket basar. */}
                <Surface style={styles.section} elevation={1}>
                  {/* Katlama (2/4 kat) — başlıksız, bölümün en üstünde. */}
                  <View style={styles.foldInlineRow}>
                    {(['2-KAT', '4-KAT'] as TamburFoldType[]).map((ft) => {
                      const active = work.foldType === ft;
                      return (
                        <TouchableRipple
                          key={ft}
                          borderless
                          // Biri her zaman seçili kalmalı → aktif chip'e basınca
                          // boşa düşmez; sadece diğerine geçiş yapılır.
                          onPress={() => setWork((w) => ({ ...w, foldType: ft }))}
                          style={[styles.foldChipSm, active && styles.foldChipActive]}
                        >
                          <Text
                            style={[
                              styles.foldChipText,
                              active && styles.foldChipTextActive,
                            ]}
                          >
                            {ft === '2-KAT' ? '2 Kat' : '4 Kat'}
                          </Text>
                        </TouchableRipple>
                      );
                    })}
                  </View>

                  {/* Uzunluk girişi + Manuel/Otomatik yan yana. Otomatik modda
                      sol sütunda büyük "Uzunluk" etiketi durur, toggle sağda. */}
                  <View style={styles.lengthModeRow}>
                    <View style={styles.lengthCol}>
                      {cutMode === 'manual' ? (
                        <View style={styles.cutInputRow}>
                          <View style={{ flex: 1 }}>
                            <NumpadInput
                              mode="outlined"
                              value={work.voluntaryEntry.length}
                              onChangeText={(v) =>
                                setWork((w) => ({
                                  ...w,
                                  voluntaryEntry: { ...w.voluntaryEntry, length: v },
                                }))
                              }
                              numpadLabel="Kesim uzunluğu"
                              allowDecimal
                              autoActivate
                              numpadMaxLength={8}
                              placeholder="Boş = kalanı kes (metre)"
                              dense
                              style={styles.input}
                              useNativeKeyboard={compact}
                            />
                          </View>
                          <IconButton
                            icon="backspace-outline"
                            mode="contained-tonal"
                            size={24}
                            iconColor="#475569"
                            containerColor="#e2e8f0"
                            onPress={() =>
                              setWork((w) => ({
                                ...w,
                                voluntaryEntry: { ...w.voluntaryEntry, length: '' },
                              }))
                            }
                            disabled={!work.voluntaryEntry.length}
                            accessibilityLabel="Uzunluğu temizle"
                            style={{ margin: 0 }}
                          />
                        </View>
                      ) : (
                        // Otomatik: uzunluk makineden gelir. Büyük "Uzunluk"
                        // etiketi, toggle'ın neyi kontrol ettiğini netleştirir.
                        <View style={styles.autoLengthBox}>
                          <Icon source="ruler" size={24} color="#7c3aed" />
                          <Text style={styles.autoLengthLabel}>Uzunluk</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.cutModeToggle}>
                      {(['manual', 'auto'] as const).map((m) => {
                        const active = cutMode === m;
                        return (
                          <TouchableRipple
                            key={m}
                            borderless
                            onPress={() => setCutMode(m)}
                            style={[
                              styles.cutModeChip,
                              active && styles.cutModeChipActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.cutModeChipText,
                                active && styles.cutModeChipTextActive,
                              ]}
                            >
                              {m === 'manual' ? 'Manuel' : 'Otomatik'}
                            </Text>
                          </TouchableRipple>
                        );
                      })}
                    </View>
                  </View>

                  {/* Kime + Kalite YAN YANA; her biri kendi içinde dikey liste.
                      Kime uzarsa kendi sütununda scroll olur, Kalite'yi etkilemez. */}
                  <View style={styles.kimeKaliteRow}>
                    <View style={styles.kimeCol}>
                      <Text style={styles.cutSubLabel}>
                        Kime?
                      </Text>
                      {/* Açık "Stok" seçeneği — hiç seçim yokken aktif görünür. */}
                      {stokChip}
                      {/* SABİT — scroll'la kaymaz; tüm müşteriler (sipariştekiler önce) */}
                      {kimeListChip}
                      {/* Sipariş kısayolları — kendi içinde scroll; 2. tık seçimi
                          kaldırır (seçim yok = stok). */}
                      <ScrollView
                        style={styles.kimeScroll}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                      >
                        <View style={styles.optionList}>
                          {(activeJob?.context?.orders ?? []).flatMap((o) =>
                            o.lines.map((l) => ({
                              lineId: l.lineId,
                              label: `${o.customerName} · ${l.itemName}`,
                            })),
                          ).map((opt) => {
                            const active =
                              work.voluntaryEntry.targetOrderLineId === opt.lineId;
                            return (
                              <TouchableRipple
                                key={opt.lineId}
                                borderless
                                onPress={() =>
                                  setWork((w) => ({
                                    ...w,
                                    voluntaryEntry: {
                                      ...w.voluntaryEntry,
                                      // 2. tık → null (stok); müşteri seçimini de temizle.
                                      targetOrderLineId: active ? null : opt.lineId,
                                      targetCustomerId: null,
                                      targetCustomerName: undefined,
                                    },
                                  }))
                                }
                                style={[
                                  styles.listOption,
                                  active && styles.listOptionActive,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.listOptionText,
                                    active && styles.listOptionTextActive,
                                  ]}
                                  numberOfLines={2}
                                >
                                  {opt.label}
                                </Text>
                              </TouchableRipple>
                            );
                          })}
                        </View>
                      </ScrollView>
                    </View>

                    <View style={styles.kaliteCol}>
                      <Text style={styles.cutSubLabel}>Kalite</Text>
                      <View style={styles.optionList}>
                        {qualityGrades.map((qg) => {
                          const active =
                            work.voluntaryEntry.qualityGrade === qg.code;
                          return (
                            <TouchableRipple
                              key={qg.id}
                              borderless
                              onPress={() =>
                                setWork((w) => ({
                                  ...w,
                                  voluntaryEntry: {
                                    ...w.voluntaryEntry,
                                    qualityGrade: active ? '' : qg.code,
                                    qualityName: active ? undefined : qg.name,
                                  },
                                }))
                              }
                              style={[
                                styles.listOption,
                                active && styles.listOptionActive,
                                active && qg.color
                                  ? { backgroundColor: qg.color, borderColor: qg.color }
                                  : null,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.listOptionText,
                                  active && styles.listOptionTextActive,
                                ]}
                              >
                                {qg.name}
                              </Text>
                            </TouchableRipple>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                </Surface>

              </ScrollView>

              {/* Sticky footer — ASIL aksiyon "Kes". Girilen uzunlukta top oluşur;
                  son kesimde kalan ~0 olunca açık kumaş OTOMATİK biter (ayrı Tamamla
                  yok). cutOpenFabric offline-aware değil → isPending'de kilitlenir. */}
              <CutActionBar
                compact={compact}
                kartelaOn={markAsKartela}
                onToggleKartela={() => setMarkAsKartela((v) => !v)}
                onKes={handleKes}
                // cutOpenFabric offline-aware değil → isPending'de kilitlenir.
                // Otomatik modda makineden okuma uçuşurken de (measuring) kilitli.
                kesLoading={cutOpenFabricMutation.isPending || measuring}
                kesDisabled={!work.voluntaryEntry.qualityGrade}
                kesLabel={
                  cutMode === 'auto'
                    ? 'Kes — Makineden Ölç'
                    : work.voluntaryEntry.length.trim() === '' &&
                        selectedRoll.currentQty > 0.001
                      ? compact
                        ? 'Kes — Kalanı Kes'
                        : `Kes — Kalanı Kes (${selectedRoll.currentQty.toFixed(1)} mt)`
                      : 'Kes — Top Oluştur'
                }
              />
            </>
          )}

        </View>

        {/* ════════ SAĞ: card scan + tab + roll list + numpad ════════ */}
        {!compact && (
          <View style={styles.rightCol}>
            {renderRightContent()}
            {/* Otomatik modda yazılacak bir şey yok → numpad gizlenir. Recut
                akışı aktifse onun modu (recutMode), değilse açık-kumaş (cutMode). */}
            {(recutRollMeta ? recutMode : cutMode) === 'manual' && (
              <NumpadHost style={styles.numpadHost} />
            )}
          </View>
        )}

        {/* Compact (telefon) + native klavye açık → floating dismiss butonu.
            Operatör NumpadInput'tan sonra klavyeyi kapatmak için form'a basmak
            yerine tek tıkla indirir. Tablet'te numpad kullanıldığı için yok. */}
      </View>

      {/* Açık kart listesi — hızlı seçim için */}
      <CameraScanModal
        visible={listModalOpen}
        loading={openCardsQuery.isLoading}
        cards={openCardsQuery.data?.data ?? []}
        onDismiss={() => setListModalOpen(false)}
        onSelect={handleCameraSelect}
        refresh={openCardsRefresh}
      />

      {/* Refakat kartı QR/barkod okuma — gerçek kamera */}
      <BarcodeScannerModal
        visible={scannerOpen}
        title="Refakat Kartı QR Okut"
        onDismiss={() => setScannerOpen(false)}
        onScan={handleScannerResult}
      />

      {/* Top Kesme — kamera ile depo topu barkodu okut. onScan modal'ı kapatır,
          asıl resolve onModalHide'da (modal tam kapandığında) çalışır. */}
      <BarcodeScannerModal
        visible={recutScannerOpen}
        title="Top Kesme — Barkod Okut"
        onDismiss={() => setRecutScannerOpen(false)}
        onScan={(barcode) => {
          setPendingRecutScan(barcode);
          setRecutScannerOpen(false);
        }}
        onModalHide={() => {
          if (pendingRecutScan) {
            const b = pendingRecutScan;
            setPendingRecutScan(null);
            void handleRecutScanned(b);
          } else if (recutPickFromListPending.current) {
            // O15: "Listeden Seç" — scanner tamamen kapandıktan sonra picker aç
            // (RN nested modal: animasyon sırasında mount edilirse overlay yutar).
            recutPickFromListPending.current = false;
            setRecutPickerOpen(true);
          }
        }}
        onPickFromList={() => {
          recutPickFromListPending.current = true;
        }}
      />

      {/* O15: Top Kesme — listeden seçim. Filtre statüleri kesim adaylarını
          kapsar (WAREHOUSE + STOCK); renkli STOCK seçilirse doğrulama net
          mesajla reddeder (backend kuralının aynısı). */}
      <RollPickerModal
        visible={recutPickerOpen}
        onDismiss={() => setRecutPickerOpen(false)}
        title="Top Kesme — Listeden Seç"
        filters={{ status: 'WAREHOUSE,STOCK' }}
        onSelect={(r) => {
          if (!validateRecutCandidate(r)) return;
          setRecutPickerOpen(false);
          applyRecutRoll(r);
        }}
      />

      {/* İş Emri Siparişleri modal'ı — operatör kesim planı için açar */}
      <OrdersDetailModal
        visible={ordersModalOpen}
        orders={activeJob?.context?.orders ?? []}
        onDismiss={() => setOrdersModalOpen(false)}
      />

      {/* Hata noktaları detay modal'ı — büyük cetvel + sıralı/filtreli liste */}
      <TamburErrorsModal
        visible={errorsModalOpen}
        barcode={selectedRoll?.barcode ?? null}
        errors={selectedRoll?.errors ?? []}
        defectTypes={defectTypes}
        rulerMax={rulerMaxForErrors(
          selectedRoll?.currentQty ?? 0,
          selectedRoll?.errors ?? [],
        )}
        onDismiss={() => setErrorsModalOpen(false)}
      />

      {/* Tambur adım notu modal'ı — sticky header "not" kutusundan açılır */}
      <TamburNoteModal
        visible={noteModalOpen}
        note={activeJob?.context?.stepNote ?? null}
        onDismiss={() => setNoteModalOpen(false)}
      />

      {/* Etiket basımı modal'ı — finalize/post-split sonrası */}
      <LabelPrintModal
        rolls={pendingPrintRolls}
        batchNumber={activeJob?.stepSummary.batchNumber ?? null}
        onDismiss={() => setPendingPrintRolls([])}
        onPrint={(roll) => {
          // "Etiket kime?" sheet'i de bir RNModal — bu liste modalı AÇIK kalırsa
          // üstüne açılan sheet arkada kalıp tıklamayı yutuyor ("bir şey olmuyor").
          // Önce listeyi kapat, sonra kuyruğa al (RelabelPickerModal ile aynı desen).
          setPendingPrintRolls([]);
          queueLabel(roll);
        }}
        onPrintStock={(roll) => {
          // "Müşterisiz (Stok)" → doğrudan stok bas. "Kime?" sheet'i açılmaz →
          // çakışma yok → batch listesi AÇIK kalır, operatör sıradaki parçayı da
          // tek dokunuşla müşterisiz basabilir.
          reprintLabelStock(roll);
        }}
        printingRollId={activePrintRoll?.id ?? null}
      />

      {/* Top Kesme bitir — kalan kumaş için karar (1.KALITE/A1/FIRE/discard) */}
      <FinalizeRemainingModal
        visible={recutFinalizeOpen}
        remainingQty={recutRollMeta?.currentQty ?? 0}
        onDismiss={() => setRecutFinalizeOpen(false)}
        loading={finalizeWarehouseCutMutation.isPending}
        onChoose={(action) => {
          if (!recutResolvedRollId) return;
          finalizeWarehouseCutMutation.mutate({
            rollId: recutResolvedRollId,
            remainingAction: action,
          });
        }}
        onModalHide={() => {
          if (pendingRecutCleanupRef.current) {
            const { remainingChild } = pendingRecutCleanupRef.current;
            pendingRecutCleanupRef.current = null;
            if (remainingChild) {
              setPendingPrintRolls((prev) => [...prev, remainingChild]);
            }
            setRecutResolvedRollId(null);
            setRecutRollMeta(null);
            setRecutCutLength('');
            setRecutQualityGrade('1.KALITE');
            setRecutLastParentRoll(null);
            qc.invalidateQueries({ queryKey: ['rolls'] });
          }
        }}
      />

      {/* Aşım onayı — operatör kayıtlı kalandan fazla metraj girdi (flag açık).
          Parmak hatası koruması: somut kayıtlı/girilen değerleri göster, onayla geç.
          Onaylanınca kaynak kumaş tamamen kapanır (backend parent'ı tüketir). */}
      <AppModal
        visible={!!overCutConfirm}
        onDismiss={() => setOverCutConfirm(null)}
        position="center"
        swipeToDismiss={false}
        contentStyle={overCutStyles.sheet}
      >
        {overCutConfirm && (
          <View>
            <View style={overCutStyles.header}>
              <Icon source="alert-outline" size={26} color="#b45309" />
              <Text style={overCutStyles.title}>Kayıtlı metrajı aşıyor</Text>
            </View>
            <Text style={overCutStyles.body}>
              Kayıtlı kalan{' '}
              <Text style={overCutStyles.strong}>
                {overCutConfirm.recorded.toFixed(1)} m
              </Text>
              , girilen{' '}
              <Text style={overCutStyles.strong}>
                {overCutConfirm.entered.toFixed(1)} m
              </Text>{' '}
              (+{(overCutConfirm.entered - overCutConfirm.recorded).toFixed(1)} m).
              Top bu metrajla oluşturulacak ve kaynak kumaş tamamen kapanacak. Emin misin?
            </Text>
            <View style={overCutStyles.actions}>
              <Button
                mode="outlined"
                style={overCutStyles.btn}
                onPress={() => setOverCutConfirm(null)}
              >
                Vazgeç
              </Button>
              <Button
                mode="contained"
                style={overCutStyles.btn}
                buttonColor="#b45309"
                onPress={() => {
                  const fn = overCutConfirm.onConfirm;
                  setOverCutConfirm(null);
                  fn();
                }}
              >
                {`Evet, ${overCutConfirm.entered.toFixed(1)} m`}
              </Button>
            </View>
          </View>
        )}
      </AppModal>

      {/* Tambur'dan çıkmış toplar listesi — geçmişten etiket yeniden basımı */}
      <RecentOutputModal
        visible={recentOutputOpen}
        onDismiss={() => setRecentOutputOpen(false)}
        onPrint={(roll) => {
          // "Bas" → mevcut etiketi AYNEN tekrar bas, "kime?" sorma. Liste
          // KAPANMASIN (sadece önizleme kapanır) — baskı sonrası listede kal.
          reprintLabel(roll);
        }}
        onNewLabel={(roll) => {
          // "Yeni Etiket" → yönlendir: "Etiket kime?" sheet'i Çıkanlar'ın ÜSTÜNDE
          // aç (liste KAPANMASIN — kullanıcı seçim sonrası listede kalsın). Sadece
          // önizleme kapanır (RecentOutputModal içinde), Çıkanlar açık kalır.
          queueLabel(roll);
        }}
        onPrintStock={(roll) => {
          // "Müşterisiz (Stok)" → mevcut topu müşterisiz bas (liste açık kalsın).
          reprintLabelStock(roll);
        }}
      />

      {/* Compact'ta sağdan kayan iş paneli — telefon ekranında sağ kolonun yerine */}
      {compact && (
        <RightPanelDrawer
          visible={rightDrawerOpen}
          onDismiss={() => setRightDrawerOpen(false)}
          insets={insets}
          title="Tambur İşleri"
          onClosed={drawerQueue.drain}
          widthFactor={0.96}
          maxWidth={560}
        >
          {renderRightContent()}
        </RightPanelDrawer>
      )}

      {/* Aktif yazdırma — LabelPrinter expo-print ile PDF/sistem yazdırma açar.
          Renksiz top = ham kumaş → ham etiket (ROLL_RAW); renkli/boyanmış =
          bitmiş (ROLL_FINISHED). Tambur ham kesim parçaları renksiz olduğundan
          ham etiketle basılır. */}
      <LabelPrinter
        roll={activePrintRoll}
        kind={activePrintRoll?.colorId == null ? 'ROLL_RAW' : 'ROLL_FINISHED'}
        labelContext={labelContext}
        onDone={() => {
          setActivePrintRoll(null);
          setLabelContext(undefined);
        }}
      />

      {/* Listeden Seç — recut: WO sipariş satırları; ana akış: TÜM müşteriler
          (sipariştekiler önce). Etiket bambaşka müşteriye de basılabilsin diye. */}
      <PickerModal
        visible={kimePickerOpen}
        title={recutRollMeta ? 'Müşteri / Sipariş Seç' : 'Müşteri Seç (tüm müşteriler)'}
        options={kimeOptions}
        pinnedOptions={kimePinnedOptions}
        pinnedLabel={
          recutRollMeta ? 'Bu topa uyan açık siparişler' : 'Bu iş emrinde siparişi olan müşteriler'
        }
        selectedValue={
          recutRollMeta
            ? recutTargetLineId ?? recutTargetCustomerId
            : work.voluntaryEntry.targetCustomerId
        }
        numColumns={compact ? 1 : 2}
        onSelect={handleKimeSelect}
        onDismiss={() => setKimePickerOpen(false)}
        emptyText={
          customersQuery.isLoading ? 'Müşteriler yükleniyor…' : 'Müşteri bulunamadı'
        }
      />

      {/* Etiket kime? — kesim/yönlendir/son-toplar sonrası baskı hedefi */}
      <LabelTargetSheet
        roll={
          targetSheet
            ? {
                id: targetSheet.roll.id,
                barcode: targetSheet.roll.barcode,
                itemId: targetSheet.roll.itemId,
                colorId: targetSheet.roll.colorId,
                width: targetSheet.roll.width != null ? Number(targetSheet.roll.width) : null,
                itemName: targetSheet.roll.item?.name,
                colorName: targetSheet.roll.color?.name ?? null,
                lastLabelSnapshot: targetSheet.roll.lastLabelSnapshot ?? null,
              }
            : null
        }
        defaultLineId={targetSheet?.defaultLineId ?? null}
        onCancel={() => setTargetSheet(null)}
        onConfirm={(ctx) => {
          const r = targetSheet?.roll ?? null;
          setTargetSheet(null);
          if (!r) return;
          // Stok seçimi de explicit bir bağlam — undefined'a düşürme, yoksa backend
          // topun eski müşteri snapshot'ını/WO tahminini tekrar basar (müşterisiz olmaz).
          setLabelContext(
            ctx.orderLineId || ctx.customerId || ctx.stock ? ctx : undefined,
          );
          setActivePrintRoll(r);
        }}
      />

    </ScreenChrome>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Roll satırı — etiket modallarında ortak görsel (item, renk, metraj, kalite +
// "Bas" butonu).
// ─────────────────────────────────────────────────────────────────────────────
function RollLabelCard({
  roll,
  index,
  isPrinting,
  onPrint,
  onPrintStock,
  onPreview,
}: {
  roll: Roll;
  index: number;
  isPrinting: boolean;
  onPrint: (roll: Roll) => void;
  /** Verilirse "Bas"ın solunda müşterisiz (stok) hızlı baskı butonu çıkar —
   *  "Kime?" sormadan, doğrudan müşterisiz basar. */
  onPrintStock?: (roll: Roll) => void;
  /** Verilirse kart gövdesine dokunmak etiket önizlemesini açar (son basılan
   *  etiketi göster). "Bas" butonu ayrı dokunma hedefi olarak kalır. */
  onPreview?: (roll: Roll) => void;
}) {
  const color = roll.color ?? null;
  const gradeBg =
    roll.qualityGrade === 'FIRE'
      ? '#fee2e2'
      : roll.qualityGrade === 'A1'
        ? '#fef3c7'
        : '#dcfce7';
  const body = (
    <View style={resplitStyles.labelLeft}>
      <View style={resplitStyles.labelTopLine}>
        <Text style={resplitStyles.labelIndex}>#{index + 1}</Text>
        <View style={[resplitStyles.qualityPill, { backgroundColor: gradeBg }]}>
          <Text style={resplitStyles.qualityPillText}>{roll.qualityGrade}</Text>
        </View>
        {color && (
          <View style={resplitStyles.labelColorRow}>
            <View
              style={[
                resplitStyles.colorDot,
                { backgroundColor: color.hex ?? '#e2e8f0' },
              ]}
            />
            <Text style={resplitStyles.labelMetaText} numberOfLines={1}>
              {color.name}
            </Text>
          </View>
        )}
        {onPreview && (
          <Icon source="eye-outline" size={15} color="#64748b" />
        )}
      </View>
      <Text style={resplitStyles.labelBarcode} numberOfLines={1}>
        {roll.barcode ?? '—'}
      </Text>
      <Text style={resplitStyles.labelItemName} numberOfLines={1}>
        {roll.item?.name ?? '—'}
        {roll.color?.name ? ` · ${roll.color.name}` : ''}
      </Text>
      <Text style={resplitStyles.labelMetaText}>
        {roll.currentQty.toFixed(1)} m
        {roll.width != null ? ` · ${roll.width} cm` : ''}
      </Text>
    </View>
  );
  return (
    <Surface style={resplitStyles.labelCard} elevation={1}>
      {onPreview ? (
        <TouchableRipple
          borderless
          onPress={() => onPreview(roll)}
          style={{ flex: 1 }}
          accessibilityLabel="Etiketi önizle"
        >
          {body}
        </TouchableRipple>
      ) : (
        body
      )}
      {onPrintStock && (
        <IconButton
          icon="account-off-outline"
          mode="contained"
          size={22}
          containerColor="#0f766e"
          iconColor="#fff"
          onPress={() => onPrintStock(roll)}
          disabled={isPrinting}
          accessibilityLabel="Müşterisiz (stok) bas"
          style={{ margin: 0 }}
        />
      )}
      <IconButton
        icon={isPrinting ? 'progress-clock' : 'printer'}
        mode="contained"
        size={22}
        containerColor="#1e40af"
        iconColor="#fff"
        onPress={() => onPrint(roll)}
        disabled={isPrinting}
        accessibilityLabel="Etiketi bas (kime? seç)"
        style={{ margin: 0 }}
      />
    </Surface>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Etiket Basımı Modal — finalize / post-split sonrası yeni Roll'lar.
// Her satırın "Bas" butonu LabelPrinter'ı (expo-print) tetikler.
// ─────────────────────────────────────────────────────────────────────────────
function LabelPrintModal({
  rolls,
  batchNumber,
  onDismiss,
  onPrint,
  onPrintStock,
  printingRollId,
}: {
  rolls: Roll[];
  batchNumber?: string | null;
  onDismiss: () => void;
  onPrint: (roll: Roll) => void;
  onPrintStock?: (roll: Roll) => void;
  printingRollId: string | null;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  // Compact (telefon dik) ekranda %45 modal çok dar — operatör barkod + ürün +
  // "Bas" satırlarını okumakta zorlanıyor. Portrait'te 92% ver, tablet/yatayda
  // 45% kalsın (kalan ekranı bloklamasın).
  const isCompactPortrait = winH > winW;
  const sheetWidth = isCompactPortrait ? winW * 0.92 : winW * 0.45;
  // NOT: rolls.length === 0 iken `return null` YAPMA — RNModal kapanış
  // animasyonu yarıda kalıyor, backdrop arkada saklı kalıp sonraki ekranın
  // tıklamalarını yutuyor (Top Kesme 2. tur bug'ı). isVisible=false ile bırak,
  // animasyon tamamlansın.

  return (
    <AppModal visible={rolls.length > 0} onDismiss={onDismiss}>
      <View style={[cameraStyles.sheet, { width: sheetWidth, maxHeight: winH * 0.85 }]}>
        <View style={[cameraStyles.header, { backgroundColor: '#dcfce7', paddingVertical: 8 }]}>
          <Icon source="printer" size={20} color="#059669" />
          <Text variant="titleMedium" style={cameraStyles.title}>
            Etiket Bas {batchNumber ? `· ${batchNumber}` : ''}
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" size={20} onPress={onDismiss} style={{ margin: 0 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 8, gap: 6 }}>
          {rolls.map((roll, idx) => (
            <RollLabelCard
              key={roll.id}
              roll={roll}
              index={idx}
              isPrinting={printingRollId === roll.id}
              onPrint={onPrint}
              onPrintStock={onPrintStock}
            />
          ))}
        </ScrollView>
      </View>
    </AppModal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// İş Emri Siparişleri Detay Modal'ı — operatör kesim planı için referans alır.
// Her sipariş kalemi: müşteri + ürün + renk + sipariş - sevk = kalan (mt).
// ─────────────────────────────────────────────────────────────────────────────
function OrdersDetailModal({
  visible,
  orders,
  onDismiss,
}: {
  visible: boolean;
  orders: TamburContextOrder[];
  onDismiss: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const phone = winW < 600;

  // Başlık özeti için toplam kalem sayısı.
  const lineCount = useMemo(
    () => orders.reduce((n, o) => n + o.lines.length, 0),
    [orders],
  );

  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <View
        style={[
          ordersModalStyles.sheet,
          {
            width: phone ? winW * 0.94 : Math.min(720, winW * 0.62),
            maxHeight: winH * 0.86,
          },
        ]}
      >
        {/* Başlık — lacivert kimlik; özet (sipariş + kalem) gömülü */}
        <View style={ordersModalStyles.header}>
          <View style={ordersModalStyles.headerIcon}>
            <Icon source="clipboard-list-outline" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ordersModalStyles.title}>İş Emri Siparişleri</Text>
            <Text style={ordersModalStyles.subtitle}>
              {orders.length} sipariş · {lineCount} kalem
            </Text>
          </View>
          <IconButton
            icon="close"
            size={22}
            iconColor="#fff"
            onPress={onDismiss}
            style={{ margin: 0 }}
          />
        </View>

        <ScrollView
          contentContainerStyle={ordersModalStyles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {orders.length === 0 ? (
            <View style={ordersModalStyles.emptyWrap}>
              <Icon
                source="package-variant-closed"
                size={44}
                color={colors.borderStrong}
              />
              <Text style={ordersModalStyles.empty}>
                Bu iş emrine bağlı sipariş yok
              </Text>
              <Text style={ordersModalStyles.emptyHint}>Stok için üretim</Text>
            </View>
          ) : (
            orders.map((o, oi) => (
              <AnimatedEntrance
                key={o.orderId}
                index={oi}
                style={ordersModalStyles.orderCard}
              >
                {/* Sipariş başlığı — müşteri baş harfi rozeti + ad + sipariş no */}
                <View style={ordersModalStyles.orderHeaderRow}>
                  <View style={ordersModalStyles.avatar}>
                    <Text style={ordersModalStyles.avatarText}>
                      {(o.customerName || '?').trim().charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={ordersModalStyles.customerName} numberOfLines={1}>
                    {o.customerName}
                  </Text>
                  <View style={ordersModalStyles.orderChip}>
                    <Icon source="pound" size={11} color={ORDERS_ACCENT_DARK} />
                    <Text style={ordersModalStyles.orderChipText}>
                      {o.orderNumber}
                    </Text>
                  </View>
                </View>

                {o.lines.map((line) => {
                  // Loose modelde top→sipariş satırı bağı yok; per-line karşılanma
                  // türetilemez (backend F133). Sipariş metrajını göster.
                  const ordered = Math.max(0, line.orderedQty || 0);
                  const hasMeta =
                    line.width != null ||
                    line.requiredProperties.length > 0 ||
                    line.pieceLengthM != null ||
                    !!line.cutNote?.trim();
                  return (
                    <View key={line.lineId} style={ordersModalStyles.lineRow}>
                      {/* Sol: ürün + tüm nitelikler tek satır akışında (kompakt) */}
                      <View style={ordersModalStyles.lineMain}>
                        <Text style={ordersModalStyles.lineItem} numberOfLines={1}>
                          {line.itemName}
                          {line.colorName ? (
                            <Text style={ordersModalStyles.lineColor}>
                              {' · '}
                              {line.colorName}
                            </Text>
                          ) : null}
                        </Text>

                        {hasMeta && (
                          <View style={ordersModalStyles.metaRow}>
                            {line.width != null && (
                              <View style={ordersModalStyles.metaChip}>
                                <Icon
                                  source="arrow-expand-horizontal"
                                  size={11}
                                  color={colors.textSecondary}
                                />
                                <Text style={ordersModalStyles.metaChipText}>
                                  {line.width} cm
                                </Text>
                              </View>
                            )}
                            {line.requiredProperties.map((p) => (
                              <View key={p.id} style={ordersModalStyles.propChip}>
                                <Text style={ordersModalStyles.propChipText}>
                                  {p.name}
                                </Text>
                              </View>
                            ))}
                            {line.pieceLengthM != null && (
                              <View style={ordersModalStyles.cutChip}>
                                <Icon
                                  source="content-cut"
                                  size={11}
                                  color={colors.warningDark}
                                />
                                <Text style={ordersModalStyles.cutChipText}>
                                  Her {line.pieceLengthM} m
                                </Text>
                              </View>
                            )}
                            {!!line.cutNote?.trim() && (
                              <View style={ordersModalStyles.cutChip}>
                                <Icon
                                  source="note-text-outline"
                                  size={11}
                                  color={colors.warningDark}
                                />
                                <Text
                                  style={ordersModalStyles.cutChipText}
                                  numberOfLines={1}
                                >
                                  {line.cutNote.trim()}
                                </Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>

                      {/* Sağ: sipariş metrajı — kompakt lacivert pill */}
                      <View style={ordersModalStyles.remainingPill}>
                        <Text style={ordersModalStyles.remainingValue}>
                          {ordered.toFixed(1)}
                        </Text>
                        <Text style={ordersModalStyles.remainingUnit}>m</Text>
                      </View>
                    </View>
                  );
                })}
              </AnimatedEntrance>
            ))
          )}
        </ScrollView>
      </View>
    </AppModal>
  );
}

// Lacivert aksan — tema mavi (blue/info) ailesi; modal header + rozet/chip kimliği.
const ORDERS_ACCENT = '#1e40af'; // blue-800
const ORDERS_ACCENT_DARK = '#1e3a8a'; // blue-900 (en koyu — header)
const ORDERS_ACCENT_SOFT = '#eff6ff'; // blue-50
const ORDERS_ACCENT_BORDER = '#bfdbfe'; // blue-200
const ORDERS_ACCENT_ON = '#dbeafe'; // blue-100

const overCutStyles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadow.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: colors.warningDark,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  strong: {
    fontWeight: '800',
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  btn: {
    minWidth: 120,
  },
});

const ordersModalStyles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadow.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: ORDERS_ACCENT_DARK,
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 17, fontWeight: '800', color: '#fff' },
  subtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: ORDERS_ACCENT_ON,
    marginTop: 1,
  },

  scroll: { padding: spacing.md, gap: spacing.sm },

  emptyWrap: { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.sm },
  empty: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  emptyHint: { textAlign: 'center', color: colors.textMuted, fontSize: 12 },

  orderCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadow.sm,
  },
  orderHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: ORDERS_ACCENT_ON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 13, fontWeight: '800', color: ORDERS_ACCENT_DARK },
  customerName: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.text },
  orderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: ORDERS_ACCENT_SOFT,
    borderWidth: 1,
    borderColor: ORDERS_ACCENT_BORDER,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  orderChipText: { fontSize: 11, fontWeight: '700', color: ORDERS_ACCENT_DARK },

  // Tek satır akışında kompakt kalem satırı — ürün solda, kalan sağda.
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lineMain: { flex: 1, gap: spacing.xs },
  lineItem: { fontSize: 13, fontWeight: '700', color: colors.text },
  lineColor: { fontWeight: '600', color: colors.textSecondary },

  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  metaChipText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  propChip: {
    backgroundColor: ORDERS_ACCENT_ON,
    borderColor: ORDERS_ACCENT_BORDER,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  propChipText: { fontSize: 11, fontWeight: '700', color: ORDERS_ACCENT_DARK },
  cutChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: '100%',
    backgroundColor: colors.warningContainer,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  cutChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.warningDark,
    flexShrink: 1,
  },

  remainingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minWidth: 56,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: ORDERS_ACCENT,
  },
  remainingValue: { fontSize: 15, fontWeight: '800', color: '#fff' },
  remainingUnit: { fontSize: 10, fontWeight: '700', color: ORDERS_ACCENT_ON },
});

// Hata noktaları modal — kırmızı aksan (uyarı ailesi).
const ERR_ACCENT = '#b91c1c'; // red-700
const ERR_ACCENT_DARK = '#7f1d1d'; // red-900 (header)

const errorsModalStyles = StyleSheet.create({
  sheet: { backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: ERR_ACCENT_DARK,
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 16, fontWeight: '800', color: '#fff' },
  subtitle: { fontSize: 12, color: '#fecaca', marginTop: 1, fontWeight: '600' },
  rulerBox: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 8,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fca5a5',
    backgroundColor: '#fef2f2',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  filterChipOn: { backgroundColor: ERR_ACCENT, borderColor: ERR_ACCENT },
  filterChipInner: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  filterChipText: { fontSize: 12, fontWeight: '700', color: '#b91c1c' },
  filterChipTextOn: { color: '#fff' },
  scroll: { paddingHorizontal: 12, paddingBottom: 14, gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#94a3b8' },
  dotCritical: { backgroundColor: '#dc2626' },
  rowMeter: { fontSize: 15, fontWeight: '800', color: '#0f172a', minWidth: 64 },
  rowType: { flex: 1, fontSize: 13, color: '#475569', fontWeight: '600' },
  critBadge: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  critBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#b91c1c',
    letterSpacing: 0.3,
  },
  emptyWrap: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  empty: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
});

// Tambur adım notu modal — amber (talimat) kimliği.
const noteModalStyles = StyleSheet.create({
  sheet: { backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fef3c7',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#fde68a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 16, fontWeight: '800', color: '#78350f' },
  body: { padding: 16 },
  text: { fontSize: 16, lineHeight: 24, color: '#0f172a', fontWeight: '500' },
});

// "Çıkanlar" listesinde tek top satırı — TÜM satır tıklanır (dokun → önizleme:
// Bas / Yeni Etiket). (Eski "Etiket Değiştir" RelabelPickerModal'i kaldırıldı;
// yönlendirme artık Çıkanlar önizlemesindeki "Yeni Etiket" butonundan yapılıyor.)
function RelabelRollRow({
  roll,
  onPress,
  stacked,
}: {
  roll: Roll;
  onPress: () => void;
  /** Telefon-dik: tek satır sığmaz → okunur 3 satırlı kart. */
  stacked?: boolean;
}) {
  const color = roll.color ?? null;
  const grade = roll.qualityGrade ?? '—';
  const gradeBg =
    grade === 'FIRE' ? '#fee2e2' : grade === 'A1' ? '#fef3c7' : '#dcfce7';
  const itemText = `${roll.item?.name ?? '—'}${color?.name ? ` · ${color.name}` : ''}`;
  const qtyText =
    (roll.currentQty != null ? `${Number(roll.currentQty).toFixed(1)} m` : '—') +
    (roll.width != null ? ` · ${roll.width} cm` : '');

  if (stacked) {
    return (
      <TouchableRipple
        onPress={onPress}
        rippleColor="rgba(67,56,202,0.12)"
        style={relabelStyles.rowStacked}
      >
        <View style={relabelStyles.rowStackedInner}>
          <View style={relabelStyles.rowStackedTop}>
            <View style={[relabelStyles.gradePill, { backgroundColor: gradeBg }]}>
              <Text style={relabelStyles.gradePillText}>{grade}</Text>
            </View>
            <Text style={relabelStyles.rowStackedBarcode} numberOfLines={1}>
              {roll.barcode ?? '—'}
            </Text>
            <Icon source="chevron-right" size={22} color="#94a3b8" />
          </View>
          <View style={relabelStyles.rowStackedLine}>
            {color && (
              <View
                style={[
                  relabelStyles.colorDot,
                  { backgroundColor: color.hex ?? '#e2e8f0' },
                ]}
              />
            )}
            <Text style={relabelStyles.rowStackedItem} numberOfLines={1}>
              {itemText}
            </Text>
          </View>
          <Text style={relabelStyles.rowStackedMeta} numberOfLines={1}>
            {qtyText}
          </Text>
        </View>
      </TouchableRipple>
    );
  }

  return (
    <TouchableRipple
      onPress={onPress}
      rippleColor="rgba(67,56,202,0.12)"
      style={relabelStyles.row}
    >
      <View style={relabelStyles.rowInner}>
        <View style={[relabelStyles.gradePill, { backgroundColor: gradeBg }]}>
          <Text style={relabelStyles.gradePillText}>{grade}</Text>
        </View>
        <Text style={relabelStyles.rowBarcode} numberOfLines={1}>
          {roll.barcode ?? '—'}
        </Text>
        {color && (
          <View
            style={[
              relabelStyles.colorDot,
              { backgroundColor: color.hex ?? '#e2e8f0' },
            ]}
          />
        )}
        <Text style={relabelStyles.rowMeta} numberOfLines={1}>
          {itemText}
        </Text>
        <Text style={relabelStyles.rowQty} numberOfLines={1}>
          {qtyText}
        </Text>
        <Icon source="chevron-right" size={24} color="#94a3b8" />
      </View>
    </TouchableRipple>
  );
}

const relabelStyles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  searchInput: { flex: 1, backgroundColor: '#fff' },
  scanBtn: { margin: 0, borderRadius: 12, height: 52, width: 52 },
  // Düz liste satırı — kart değil; ince alt çizgiyle ayrılır, tek satır.
  row: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eef2f6' },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 56,
  },
  gradePill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    minWidth: 42,
    alignItems: 'center',
  },
  gradePillText: { fontSize: 12, fontWeight: '800', color: '#0f172a' },
  rowBarcode: {
    flexShrink: 0,
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  colorDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#94a3b8',
  },
  rowMeta: { flex: 1, fontSize: 14, fontWeight: '600', color: '#334155' },
  rowQty: { flexShrink: 0, fontSize: 13, fontWeight: '700', color: '#475569' },
  // Telefon-dik: tek satır sığmıyor → okunur 3 satırlı kart (barkod+kalite /
  // ürün·renk / metraj·en). Her parça kendi satırında, kırpılmadan okunur.
  rowStacked: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eef2f6' },
  rowStackedInner: { paddingHorizontal: 14, paddingVertical: 11, gap: 6 },
  rowStackedTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowStackedBarcode: {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  rowStackedLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowStackedItem: { flex: 1, fontSize: 15, fontWeight: '600', color: '#334155' },
  rowStackedMeta: { fontSize: 14, fontWeight: '700', color: '#475569' },
  loadingMore: { paddingVertical: 16, alignItems: 'center' },
  footer: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  footerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Tambur'dan çıkmış son toplar listesi — etiketleri sonradan tekrar basmak için
// ─────────────────────────────────────────────────────────────────────────────
function RecentOutputModal({
  visible,
  onDismiss,
  onPrint,
  onNewLabel,
  onPrintStock,
}: {
  visible: boolean;
  onDismiss: () => void;
  /** "Bas" — mevcut etiketi aynen tekrar bas. */
  onPrint: (roll: Roll) => void;
  /** "Yeni Etiket" — yönlendir (kime? → yeni etiket). */
  onNewLabel: (roll: Roll) => void;
  /** "Müşterisiz (Stok)" — müşteri bilgisi olmadan bas. */
  onPrintStock: (roll: Roll) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const isCompactPortrait = winH > winW;
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  // Modal kapanınca aramayı sıfırla — sonraki açılış temiz başlasın.
  useEffect(() => {
    if (!visible) setSearch('');
  }, [visible]);

  const q = useInfiniteQuery({
    queryKey: ['tambur', 'recent-output-rolls', debouncedSearch],
    queryFn: ({ pageParam }) =>
      tamburService.recentOutputRolls({
        limit: 30,
        cursor: pageParam,
        search: debouncedSearch || undefined,
        withTotal: !pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.nextCursor : undefined,
    enabled: visible,
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
  });
  // Modal her açılışta ilk sayfayı tazele — yeni üretilen toplar hemen görünsün.
  useRefetchOnOpen(q.refetch, visible);

  const rolls: Roll[] = useMemo(
    () => q.data?.pages.flatMap((p) => p.data) ?? [],
    [q.data],
  );
  const total = q.data?.pages[0]?.pagination.totalEstimate ?? null;

  // Satıra dokununca topun "son basılan etiket"ini önizle (LabelPreviewSheet,
  // snapshot/effective cascade). Liste açık kalır; önizleme üstüne (Portal) açılır.
  const [previewRoll, setPreviewRoll] = useState<Roll | null>(null);

  // Kameradan barkod okut → o topun önizlemesini aç (oradan Bas / Yeni Etiket).
  // onModalHide deseni: tarama modalı tam kapanınca çöz (RNModal çakışması yok).
  const [scanOpen, setScanOpen] = useState(false);
  const [pendingScan, setPendingScan] = useState<string | null>(null);
  const [scanResolving, setScanResolving] = useState(false);

  const resolveScanned = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setScanResolving(true);
    try {
      const res = await rollService.getByBarcode(trimmed);
      const roll = res.data as Roll | null;
      if (!roll) {
        Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: trimmed });
        return;
      }
      setPreviewRoll(roll);
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Okunamadı', text2: (e as Error).message });
    } finally {
      setScanResolving(false);
    }
  };

  return (
    <>
      <RemoteListSheet
        visible={visible}
        onDismiss={onDismiss}
        title="Üretilen Toplar"
        icon="printer-search"
        iconColor="#1e40af"
        headerTint="#dbeafe"
        widthRatio={isCompactPortrait ? 0.96 : 0.5}
        heightRatio={isCompactPortrait ? 0.9 : 0.85}
        loading={q.isLoading}
        fetching={q.isFetching && !q.isFetchingNextPage}
        isError={q.isError}
        errorMessage={(q.error as Error | undefined)?.message}
        onRefresh={() => q.refetch()}
        successMessage="Üretilen toplar güncellendi"
        items={rolls}
        keyExtractor={(r) => r.id}
        onEndReached={() => {
          if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
        }}
        listFooterComponent={
          q.isFetchingNextPage ? (
            <View style={relabelStyles.loadingMore}>
              <ActivityIndicator size="small" color="#1e40af" />
            </View>
          ) : null
        }
        subHeader={
          <View style={relabelStyles.searchRow}>
            <TextInput
              mode="outlined"
              dense
              placeholder="Barkod, ürün, renk veya parti ara…"
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              left={<TextInput.Icon icon="magnify" />}
              right={
                search ? (
                  <TextInput.Icon icon="close" onPress={() => setSearch('')} />
                ) : undefined
              }
              style={relabelStyles.searchInput}
            />
            <IconButton
              icon="barcode-scan"
              mode="contained"
              size={26}
              containerColor="#1e40af"
              iconColor="#fff"
              onPress={() => setScanOpen(true)}
              disabled={scanResolving}
              accessibilityLabel="Kameradan okut"
              style={relabelStyles.scanBtn}
            />
          </View>
        }
        footer={
          total != null ? (
            <View style={relabelStyles.footer}>
              <Text style={relabelStyles.footerText}>
                {total} top · {rolls.length} gösteriliyor
              </Text>
            </View>
          ) : null
        }
        renderItem={(roll) => (
          // Dokun → önizleme modalı (Bas / Yeni Etiket). Telefon-dik'te okunur
          // 3 satırlı kart (stacked); tablet/yatayda ince tek satır.
          <RelabelRollRow
            roll={roll}
            stacked={isCompactPortrait}
            onPress={() => setPreviewRoll(roll)}
          />
        )}
        emptyIcon="package-variant"
        emptyText={
          debouncedSearch ? 'Eşleşen top yok' : "Henüz Tambur'dan çıkmış top yok"
        }
        emptyHint={
          debouncedSearch
            ? 'Farklı bir barkod / ürün / renk / parti dene'
            : undefined
        }
      />

      {/* Etiket önizleme — "Bas" mevcut etiketi aynen basar, "Yeni Etiket"
          yönlendirir (kime? → yeni etiket). İkisi de listeyi kapatıp parent'a verir. */}
      <LabelPreviewSheet
        visible={previewRoll !== null}
        rollId={previewRoll?.id ?? null}
        onDismiss={() => setPreviewRoll(null)}
        onPrint={() => {
          const r = previewRoll;
          setPreviewRoll(null);
          if (r) onPrint(r);
        }}
        onNewLabel={() => {
          const r = previewRoll;
          setPreviewRoll(null);
          if (r) onNewLabel(r);
        }}
        onPrintStock={() => {
          const r = previewRoll;
          setPreviewRoll(null);
          if (r) onPrintStock(r);
        }}
      />

      {/* Kameradan üretilen topu okut → çözülünce o topun önizlemesi açılır. */}
      <BarcodeScannerModal
        visible={scanOpen}
        title="Üretilen Topu Okut"
        onDismiss={() => setScanOpen(false)}
        onScan={(code) => {
          setPendingScan(code);
          setScanOpen(false);
        }}
        onModalHide={() => {
          if (pendingScan) {
            const c = pendingScan;
            setPendingScan(null);
            void resolveScanned(c);
          }
        }}
      />
    </>
  );
}

const resplitStyles = StyleSheet.create({
  labelCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  labelLeft: { flex: 1, gap: 2 },
  labelTopLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  labelIndex: { fontSize: 12, fontWeight: '700', color: '#475569' },
  qualityPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  qualityPillText: { fontSize: 10, fontWeight: '700', color: '#0f172a' },
  labelBarcode: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  labelMetaText: { fontSize: 11, color: '#475569', fontWeight: '600' },
  labelItemName: { fontSize: 12, color: '#0f172a', fontWeight: '600' },
  labelColorRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#94a3b8',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
function CameraScanModal({
  visible,
  loading,
  cards,
  onDismiss,
  onSelect,
  refresh,
}: {
  visible: boolean;
  loading: boolean;
  cards: TamburOpenCard[];
  onDismiss: () => void;
  onSelect: (card: TamburOpenCard) => void;
  refresh: ManualRefresh;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  // Compact portrait (telefon dik) ekranda 70% genişlik dar — operatör kart
  // listesini taramakta zorlanıyor. Portrait'te 92% ver, tablet/yatayda 70%.
  const isCompactPortrait = winH > winW;
  const sheetWidth = isCompactPortrait ? winW * 0.92 : winW * 0.7;
  return (
    <AppModal
      visible={visible}
      onDismiss={onDismiss}
      contentStyle={[cameraStyles.sheet, { width: sheetWidth, height: winH * 0.8 }]}
    >
      <>
        <View style={cameraStyles.header}>
          <Icon source="format-list-bulleted" size={22} color="#0f172a" />
          <Text variant="titleMedium" style={cameraStyles.title} numberOfLines={1}>
            Açık Kartlar
          </Text>
          <View style={{ flex: 1 }} />
          <RefreshButton
            onPress={refresh.onRefresh}
            refreshing={refresh.refreshing}
            isError={refresh.isError}
            errorMessage={refresh.errorMessage}
            successMessage={refresh.successMessage}
          />
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>
        <View style={cameraStyles.listBox}>
          {loading ? (
            <SkeletonList count={6} />
          ) : cards.length === 0 ? (
            <View style={cameraStyles.empty}>
              <Icon source="package-variant" size={48} color="#cbd5e1" />
              <Text style={cameraStyles.emptyText}>
                Tambur'da bekleyen kart yok
              </Text>
            </View>
          ) : (
            <FlashList
              data={cards}
              keyExtractor={(c) => c.cardId}
              contentContainerStyle={{ padding: 10 }}
              renderItem={({ item }) => (
                <Surface style={cameraStyles.row} elevation={1}>
                  <TouchableRipple
                    borderless
                    onPress={() => onSelect(item)}
                    style={cameraStyles.rowTouch}
                  >
                    <View style={cameraStyles.rowInner}>
                      {/* Büyük refakat kartı no · kalan bilgi tek satır inline */}
                      <Text style={cameraStyles.rowCardNo} numberOfLines={1}>
                        {item.cardNumber}
                      </Text>
                      <Text style={cameraStyles.rowMetaInline} numberOfLines={1}>
                        {item.batchNumber} · {item.stationName} · {item.openRollCount} top
                        {item.oldestEnteredAt
                          ? ` · ${formatRelativeWait(item.oldestEnteredAt)} bekliyor`
                          : ''}
                      </Text>
                      <Icon source="chevron-right" size={22} color="#94a3b8" />
                    </View>
                  </TouchableRipple>
                </Surface>
              )}
            />
          )}
        </View>
      </>
    </AppModal>
  );
}

function JobTab({
  job,
  active,
  onPress,
  onClose,
}: {
  job: OpenJob;
  active: boolean;
  onPress: () => void;
  onClose: () => void;
}) {
  const total = job.stepSummary.rolls.length;
  return (
    <Surface
      style={[helperStyles.tab, active && helperStyles.tabActive]}
      elevation={active ? 2 : 1}
    >
      <TouchableRipple onPress={onPress} borderless style={helperStyles.tabPress}>
        <View style={helperStyles.tabInner}>
          <View style={helperStyles.tabTextWrap}>
            <Text
              style={[helperStyles.tabLabel, active && helperStyles.tabLabelActive]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {job.stepSummary.batchNumber}
            </Text>
            <Text style={helperStyles.tabSub} numberOfLines={1}>
              {total} top
            </Text>
          </View>
          <IconButton
            icon="close"
            size={14}
            onPress={onClose}
            iconColor="#94a3b8"
            style={helperStyles.tabCloseBtn}
            accessibilityLabel="Sekmeyi kapat"
          />
        </View>
      </TouchableRipple>
    </Surface>
  );
}

function RollListItem({
  roll,
  index,
  selected,
  onPress,
}: {
  roll: TamburRollSummary;
  index: number;
  selected: boolean;
  onPress: () => void;
}) {
  const press = usePressScale();
  return (
    <Animated.View style={press.style}>
      <Surface
        style={[
          helperStyles.rollItem,
          selected && helperStyles.rollItemSelected,
        ]}
        elevation={selected ? 2 : 1}
      >
        <TouchableRipple
          borderless
          onPress={onPress}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          style={helperStyles.rollTouch}
        >
        <View style={helperStyles.rollInner}>
          <View style={helperStyles.rollIndex}>
            <Text style={helperStyles.rollIndexText}>{index + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={helperStyles.rollBarcode} numberOfLines={1}>
              {roll.barcode ?? `Açık · ${roll.rollId.slice(0, 8)}`}
            </Text>
            <Text style={helperStyles.rollItemName} numberOfLines={1}>
              {roll.itemName}
              {roll.colorName ? ` · ${roll.colorName}` : ''}
              {roll.properties.length > 0
                ? ` · ${roll.properties.map((p) => p.name).join(', ')}`
                : ''}
              {roll.errorCount > 0 ? ` · ⚠ ${roll.errorCount} hata` : ''}
            </Text>
          </View>
          <View style={helperStyles.rollRight}>
            <Text style={helperStyles.rollMeter}>
              {roll.currentQty.toFixed(1)} mt
            </Text>
            {roll.width != null && (
              <Text style={helperStyles.rollWidth}>{roll.width} cm</Text>
            )}
          </View>
          {selected && (
            <Icon source="chevron-left" size={22} color="#1e40af" />
          )}
        </View>
        </TouchableRipple>
      </Surface>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Parti (Batch) renk paleti + gruplu liste — aynı WO'nun birden çok partisi
// Tambur'a "yetişince" toplar tek listede karışıyordu. Her parti renkli
// çerçeveli grup kartında gösterilir (yalnız ≥2 parti varsa; tekte düz liste).
const BRANCH_PALETTE: { border: string; bg: string; text: string; dot: string }[] = [
  { border: '#2563eb', bg: '#eff6ff', text: '#1e40af', dot: '#2563eb' }, // mavi
  { border: '#ea580c', bg: '#fff7ed', text: '#c2410c', dot: '#ea580c' }, // turuncu
  { border: '#16a34a', bg: '#f0fdf4', text: '#15803d', dot: '#16a34a' }, // yeşil
  { border: '#7c3aed', bg: '#f5f3ff', text: '#6d28d9', dot: '#7c3aed' }, // mor
  { border: '#db2777', bg: '#fdf2f8', text: '#be185d', dot: '#db2777' }, // pembe
];
const BRANCH_NEUTRAL = { border: '#94a3b8', bg: '#f8fafc', text: '#475569', dot: '#94a3b8' };

interface BranchGroup {
  key: string;
  ordinal: number | null;
  batchNumber: string | null;
  dispatchNo: string | null;
  rolls: TamburRollSummary[];
  totalQty: number;
  palette: { border: string; bg: string; text: string; dot: string };
}

function buildBranchGroups(rolls: TamburRollSummary[]): BranchGroup[] {
  const byKey = new Map<string, BranchGroup>();
  for (const r of rolls) {
    const key = r.batchId ?? '__none__';
    let g = byKey.get(key);
    if (!g) {
      const ordinal = r.branchOrdinal ?? null;
      const palette =
        ordinal != null
          ? BRANCH_PALETTE[(ordinal - 1) % BRANCH_PALETTE.length]
          : BRANCH_NEUTRAL;
      g = {
        key,
        ordinal,
        batchNumber: r.batchNumber ?? null,
        dispatchNo: r.dispatchNo ?? null,
        rolls: [],
        totalQty: 0,
        palette,
      };
      byKey.set(key, g);
    }
    g.rolls.push(r);
    g.totalQty += r.currentQty;
  }
  // Parti sırasına göre (1,2,3…); partisiz (ordinal null) en sona.
  return [...byKey.values()].sort((a, b) => {
    if (a.ordinal == null) return 1;
    if (b.ordinal == null) return -1;
    return a.ordinal - b.ordinal;
  });
}

function BranchGroupedRollList({
  rolls,
  selectedRollId,
  onSelect,
}: {
  rolls: TamburRollSummary[];
  selectedRollId: string | null;
  onSelect: (rollId: string) => void;
}) {
  const groups = useMemo(() => buildBranchGroups(rolls), [rolls]);

  // Tek parti (ya da partisiz) → çerçeveye gerek yok, düz liste (eski davranış).
  if (groups.length <= 1) {
    return (
      <FlashList
        data={rolls}
        keyExtractor={(r) => r.rollId}
        contentContainerStyle={{ padding: 8 }}
        renderItem={({ item, index }) => (
          <RollListItem
            roll={item}
            index={index}
            selected={selectedRollId === item.rollId}
            onPress={() => onSelect(item.rollId)}
          />
        )}
      />
    );
  }

  // ≥2 parti → her parti renkli çerçeveli grup kartında.
  return (
    <FlashList
      data={groups}
      keyExtractor={(g) => g.key}
      contentContainerStyle={{ padding: 8 }}
      renderItem={({ item: g }) => (
        <View style={[branchStyles.groupCard, { borderColor: g.palette.border }]}>
          <View style={[branchStyles.groupHeader, { backgroundColor: g.palette.bg }]}>
            <View style={[branchStyles.groupDot, { backgroundColor: g.palette.dot }]} />
            <Text
              style={[branchStyles.groupTitle, { color: g.palette.text }]}
              numberOfLines={1}
            >
              {g.ordinal != null ? `${g.ordinal}. PARTİ` : 'PARTİSİZ'}
              {g.batchNumber ? ` · ${g.batchNumber}` : ''}
              {g.dispatchNo ? ` · ${g.dispatchNo}` : ''}
            </Text>
            <Text style={[branchStyles.groupMeta, { color: g.palette.text }]}>
              {g.rolls.length} top · {g.totalQty.toFixed(0)} mt
            </Text>
          </View>
          <View style={branchStyles.groupBody}>
            {g.rolls.map((roll, i) => (
              <RollListItem
                key={roll.rollId}
                roll={roll}
                index={i}
                selected={selectedRollId === roll.rollId}
                onPress={() => onSelect(roll.rollId)}
              />
            ))}
          </View>
        </View>
      )}
    />
  );
}

const branchStyles = StyleSheet.create({
  groupCard: {
    borderWidth: 2,
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 8,
  },
  groupDot: { width: 12, height: 12, borderRadius: 6 },
  groupTitle: { flex: 1, fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  groupMeta: { fontSize: 12, fontWeight: '700' },
  groupBody: { paddingHorizontal: 6, paddingVertical: 2 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Tamamla modal'ı — açık kumaşın kalan metresi için operatör kararı.
// 4 seçenek: 1.Kalite top, A1 top, Fire top, At (kayıp).
function FinalizeRemainingModal({
  visible,
  remainingQty,
  onDismiss,
  onChoose,
  loading,
  onModalHide,
}: {
  visible: boolean;
  remainingQty: number;
  onDismiss: () => void;
  onChoose: (action: TamburFinalizeRemainingAction) => void;
  loading: boolean;
  onModalHide?: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const isCompactPortrait = winH > winW;
  const qtyText = `${remainingQty.toFixed(1)} mt`;

  return (
    <AppModal
      visible={visible}
      onDismiss={onDismiss}
      dismissable={!loading}
      onHidden={onModalHide}
    >
      <View
        style={[
          cameraStyles.sheet,
          {
            width: winW * (isCompactPortrait ? 0.9 : 0.5),
            maxHeight: winH * 0.85,
          },
        ]}
      >
        <View
          style={[
            cameraStyles.header,
            { backgroundColor: '#dbeafe', paddingVertical: 10 },
          ]}
        >
          <Icon source="warehouse" size={20} color="#1e40af" />
          <Text variant="titleMedium" style={cameraStyles.title}>
            Kalan {qtyText} için karar
          </Text>
          <View style={{ flex: 1 }} />
          {!loading && (
            <IconButton
              icon="close"
              size={20}
              onPress={onDismiss}
              style={{ margin: 0 }}
            />
          )}
        </View>

        <View style={{ padding: 16, gap: 10 }}>
          <Text style={{ color: '#475569', fontSize: 13 }}>
            Bu açık kumaştan kalan {qtyText} kumaşı nasıl kaydedeyim?
          </Text>
          <Button
            mode="contained"
            icon="check-circle"
            onPress={() => onChoose('keep_1kalite')}
            disabled={loading}
            loading={loading}
            buttonColor="#059669"
            contentStyle={{ paddingVertical: 6 }}
            labelStyle={{ fontSize: 15, fontWeight: '700' }}
          >
            1. Kalite Top Yap ({qtyText})
          </Button>
          <Button
            mode="contained"
            icon="alpha-a-circle"
            onPress={() => onChoose('keep_a1')}
            disabled={loading}
            buttonColor="#d97706"
            contentStyle={{ paddingVertical: 6 }}
            labelStyle={{ fontSize: 15, fontWeight: '700' }}
          >
            A1 (2. Kalite) Top Yap ({qtyText})
          </Button>
          <Button
            mode="contained"
            icon="fire"
            onPress={() => onChoose('scrap')}
            disabled={loading}
            buttonColor="#dc2626"
            contentStyle={{ paddingVertical: 6 }}
            labelStyle={{ fontSize: 15, fontWeight: '700' }}
          >
            Fire Top Yap ({qtyText})
          </Button>
          <Button
            mode="outlined"
            icon="delete-outline"
            onPress={() => onChoose('discard')}
            disabled={loading}
            textColor="#475569"
            contentStyle={{ paddingVertical: 6 }}
            labelStyle={{ fontSize: 14 }}
          >
            Kayıt Dışı (Operatör Attı)
          </Button>
        </View>
      </View>
    </AppModal>
  );
}

// Cetvel ölçeği — topun mevcut uzunluğu ile en uzak hatadan büyük olanı (sıfıra
// bölme yok). Topta kesim olduysa bile en uzak hata cetvelde görünür kalır.
function rulerMaxForErrors(
  currentQty: number,
  errors: TamburRollDefect[],
): number {
  let m = currentQty > 0 ? currentQty : 0;
  for (const e of errors) if (e.startMeter > m) m = e.startMeter;
  return Math.max(m, 1);
}

// Metre değeri — tamsa ondalıksız, değilse tek ondalık (47, 47.5).
function fmtMeter(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// Metre cetveli — hatalar topun uzunluğu boyunca tik olarak işaretlenir. Üst üste
// binecek kadar yakın olanlar sayaçlı kümeye toplanır (çok nokta olsa da okunur).
// Kritik = kırmızı. Genişlik onLayout ile ölçülür; ölçülene dek tik basılmaz.
function DefectRuler({
  errors,
  defectTypes,
  rulerMax,
}: {
  errors: TamburRollDefect[];
  defectTypes: DefectType[];
  rulerMax: number;
}) {
  const [w, setW] = useState(0);
  const isCritical = (e: TamburRollDefect) =>
    defectTypes.find((d) => d.name === e.errorType)?.severity === 'CRITICAL';

  const markers = useMemo(() => {
    if (w <= 0)
      return [] as {
        x: number;
        n: number;
        critical: boolean;
        label: string;
        showLabel: boolean;
      }[];
    const MIN_GAP = 16; // bu px'ten yakın tik'ler tek kümede toplanır
    const sorted = [...errors].sort((a, b) => a.startMeter - b.startMeter);
    const out: {
      x: number;
      n: number;
      critical: boolean;
      meterMin: number;
      meterMax: number;
      label: string;
      showLabel: boolean;
    }[] = [];
    for (const e of sorted) {
      const x = (Math.min(e.startMeter, rulerMax) / rulerMax) * w;
      const last = out[out.length - 1];
      if (last && x - last.x < MIN_GAP) {
        last.x = (last.x * last.n + x) / (last.n + 1);
        last.n += 1;
        last.critical = last.critical || isCritical(e);
        last.meterMin = Math.min(last.meterMin, e.startMeter);
        last.meterMax = Math.max(last.meterMax, e.startMeter);
      } else {
        out.push({
          x,
          n: 1,
          critical: isCritical(e),
          meterMin: e.startMeter,
          meterMax: e.startMeter,
          label: '',
          showLabel: false,
        });
      }
    }
    // Etiket metni (tek = metre, küme = min–max) + soldan sağa greedy çakışma
    // engelleme: sığmayan etiket atlanır (marker yine görünür; tam liste modalda).
    let lastEnd = -Infinity;
    for (const m of out) {
      m.label =
        m.n > 1 && m.meterMin !== m.meterMax
          ? `${fmtMeter(m.meterMin)}–${fmtMeter(m.meterMax)}`
          : fmtMeter(m.meterMin);
      const halfW = (m.label.length * 5.5) / 2 + 2;
      if (m.x - halfW >= lastEnd) {
        m.showLabel = true;
        lastEnd = m.x + halfW;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors, w, rulerMax, defectTypes]);

  return (
    <View
      style={styles.rulerWrap}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      <View style={styles.rulerTrack} />

      {/* Uç ölçek: sol 0, sağ = seçili topun uzunluğu (metre). */}
      {w > 0 && (
        <>
          <View style={[styles.rulerScaleTick, { left: 0 }]} />
          <View style={[styles.rulerScaleTick, { left: w - 1 }]} />
          <Text style={[styles.rulerEndLabel, styles.rulerEndLabelLeft]}>0</Text>
          <Text style={[styles.rulerEndLabel, styles.rulerEndLabelRight]}>
            {fmtMeter(rulerMax)} m
          </Text>
        </>
      )}

      {/* Hata metre etiketleri — marker'ların ÜSTÜnde (kritik = kırmızı). */}
      {markers.map((m, i) =>
        m.showLabel ? (
          <Text
            key={`l${i}`}
            style={[
              styles.rulerDefectLabel,
              m.critical && styles.rulerDefectLabelCritical,
              { left: Math.max(0, Math.min(m.x - 19, w - 38)) },
            ]}
            numberOfLines={1}
          >
            {m.label}
          </Text>
        ) : null,
      )}

      {/* Marker'lar — tek tik veya sayaçlı küme. */}
      {markers.map((c, i) =>
        c.n > 1 ? (
          <View
            key={i}
            style={[
              styles.rulerCluster,
              c.critical && styles.rulerClusterCritical,
              { left: Math.max(0, Math.min(c.x - 11, w - 22)) },
            ]}
          >
            <Text style={styles.rulerClusterText}>{c.n}</Text>
          </View>
        ) : (
          <View
            key={i}
            style={[
              styles.rulerTick,
              c.critical && styles.rulerTickCritical,
              { left: Math.max(0, Math.min(c.x - 2, w - 4)) },
            ]}
          />
        ),
      )}
    </View>
  );
}

// Hata noktaları detay modal'ı — büyük cetvel + metreye göre sıralı liste +
// "sadece kritik" filtresi. Tambur ekranındaki hata şeridine dokununca açılır.
function TamburErrorsModal({
  visible,
  barcode,
  errors,
  defectTypes,
  rulerMax,
  onDismiss,
}: {
  visible: boolean;
  barcode: string | null;
  errors: TamburRollDefect[];
  defectTypes: DefectType[];
  rulerMax: number;
  onDismiss: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const phone = winW < 600;
  const [criticalOnly, setCriticalOnly] = useState(false);

  const isCritical = (e: TamburRollDefect) =>
    defectTypes.find((d) => d.name === e.errorType)?.severity === 'CRITICAL';

  const critCount = useMemo(
    () => errors.filter(isCritical).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [errors, defectTypes],
  );

  const rows = useMemo(() => {
    const list = criticalOnly ? errors.filter(isCritical) : errors;
    return [...list].sort((a, b) => a.startMeter - b.startMeter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors, defectTypes, criticalOnly]);

  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <View
        style={[
          errorsModalStyles.sheet,
          {
            width: phone ? winW * 0.94 : Math.min(640, winW * 0.6),
            maxHeight: winH * 0.86,
          },
        ]}
      >
        <View style={errorsModalStyles.header}>
          <View style={errorsModalStyles.headerIcon}>
            <Icon source="alert-octagon-outline" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={errorsModalStyles.title}>Hata Noktaları</Text>
            <Text style={errorsModalStyles.subtitle}>
              {barcode ? `${barcode} · ` : ''}
              {errors.length} nokta
              {critCount > 0 ? ` · ${critCount} kritik` : ''}
            </Text>
          </View>
          <IconButton
            icon="close"
            size={22}
            iconColor="#fff"
            onPress={onDismiss}
            style={{ margin: 0 }}
          />
        </View>

        {/* Büyük cetvel — tüm hataların top boyunca dağılımı */}
        <View style={errorsModalStyles.rulerBox}>
          <DefectRuler
            errors={errors}
            defectTypes={defectTypes}
            rulerMax={rulerMax}
          />
        </View>

        {critCount > 0 && (
          <View style={errorsModalStyles.filterRow}>
            <TouchableRipple
              borderless
              onPress={() => setCriticalOnly((v) => !v)}
              style={[
                errorsModalStyles.filterChip,
                criticalOnly && errorsModalStyles.filterChipOn,
              ]}
            >
              <View style={errorsModalStyles.filterChipInner}>
                <Icon
                  source={criticalOnly ? 'check-circle' : 'circle-outline'}
                  size={15}
                  color={criticalOnly ? '#fff' : '#b91c1c'}
                />
                <Text
                  style={[
                    errorsModalStyles.filterChipText,
                    criticalOnly && errorsModalStyles.filterChipTextOn,
                  ]}
                >
                  Sadece kritik
                </Text>
              </View>
            </TouchableRipple>
          </View>
        )}

        <ScrollView
          contentContainerStyle={errorsModalStyles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {rows.length === 0 ? (
            <View style={errorsModalStyles.emptyWrap}>
              <Icon
                source="check-decagram-outline"
                size={44}
                color={colors.borderStrong}
              />
              <Text style={errorsModalStyles.empty}>Gösterilecek hata yok</Text>
            </View>
          ) : (
            rows.map((e, i) => {
              const crit = isCritical(e);
              return (
                <AnimatedEntrance
                  key={e.id}
                  index={i}
                  style={errorsModalStyles.row}
                >
                  <View
                    style={[
                      errorsModalStyles.dot,
                      crit && errorsModalStyles.dotCritical,
                    ]}
                  />
                  <Text style={errorsModalStyles.rowMeter}>
                    {e.startMeter.toFixed(1)} m
                  </Text>
                  <Text style={errorsModalStyles.rowType} numberOfLines={1}>
                    {e.errorType ?? 'Hata'}
                  </Text>
                  {crit && (
                    <View style={errorsModalStyles.critBadge}>
                      <Text style={errorsModalStyles.critBadgeText}>KRİTİK</Text>
                    </View>
                  )}
                </AnimatedEntrance>
              );
            })
          )}
        </ScrollView>
      </View>
    </AppModal>
  );
}

// Tambur adım notu modal'ı — sticky header'daki "not" kutusundan açılır, tam
// metni gösterir (uzun notlar için kaydırmalı).
function TamburNoteModal({
  visible,
  note,
  onDismiss,
}: {
  visible: boolean;
  note: string | null;
  onDismiss: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const phone = winW < 600;
  const text = note?.trim();
  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <View
        style={[
          noteModalStyles.sheet,
          {
            width: phone ? winW * 0.9 : Math.min(520, winW * 0.5),
            maxHeight: winH * 0.7,
          },
        ]}
      >
        <View style={noteModalStyles.header}>
          <View style={noteModalStyles.headerIcon}>
            <Icon source="note-text-outline" size={20} color="#78350f" />
          </View>
          <Text style={noteModalStyles.title}>Tambur Notu</Text>
          <IconButton
            icon="close"
            size={22}
            iconColor="#78350f"
            onPress={onDismiss}
            style={{ margin: 0 }}
          />
        </View>
        <ScrollView contentContainerStyle={noteModalStyles.body}>
          <Text style={noteModalStyles.text}>{text || 'Not yok'}</Text>
        </ScrollView>
      </View>
    </AppModal>
  );
}

// Kamera-only modda sağdaki aksiyon hücresi — ikon + altında etiket. Operatör
// hangi butonun ne olduğunu (liste / tara / çıkan / kesme) karıştırmasın.
function CompactAction({
  icon,
  label,
  bg,
  color,
  onPress,
}: {
  icon: string;
  label: string;
  bg: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple
      onPress={onPress}
      rippleColor="rgba(15,23,42,0.10)"
      style={[styles.compactAction, { backgroundColor: bg }]}
      accessibilityLabel={label}
    >
      <View style={styles.compactActionInner}>
        <Icon source={icon} size={20} color={color} />
        <Text style={[styles.compactActionLabel, { color }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </TouchableRipple>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  body: { flex: 1, flexDirection: 'row', backgroundColor: '#f8fafc', position: 'relative' },
  headerExtrasRow: { flexDirection: 'row', alignItems: 'center' },
  // Koyu header'a uygun translucent etiketli aksiyon butonu (az yuvarlak köşe).
  headerChip: {
    borderRadius: 10,
    marginLeft: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  // Etiket Değiştir = ayrık birincil aksiyon → hafif indigo vurgu.
  headerChipAccent: {
    backgroundColor: 'rgba(99,102,241,0.28)',
    borderColor: 'rgba(165,180,252,0.6)',
  },
  headerChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  // secondRow'da (telefon) 3 chip eşit paylaşır — taşmaz, kaydırma gerekmez.
  headerChipFill: { flex: 1, marginLeft: 0 },
  headerChipInnerFill: { justifyContent: 'center' },
  headerChipText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  reprintBadge: { position: 'absolute', top: 4, right: 2, backgroundColor: '#dc2626' },

  formCol: { flex: 1.4 },
  // Compact (telefon) — form üstü sağa yaslı sağ panel tetiği
  compactTriggerBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#475569' },
  emptyHint: { fontSize: 13, color: '#94a3b8', textAlign: 'center', maxWidth: 320 },

  headerBand: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0f172a',
    gap: 8,
  },
  // Telefon (dik): başlık üstte tam genişlik, kutular altında tek satır.
  // Tablette satır düzeni aynen korunur (orada zaten yer bol).
  headerBandCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
  // Başlık sütunu — tablette esner (flex), telefonda tam genişlik. minWidth:0
  // ile numberOfLines kırpması doğru çalışır (flex child taşmasın).
  headerTitleCol: { minWidth: 0 },
  headerTitleFlex: { flex: 1 },
  // Kutu grubu — tablette doğal genişlik, telefonda her kutu eşit pay alıp
  // satırı baştan sona doldurur (headerBoxFlex).
  headerBoxes: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBoxesCompact: { alignSelf: 'stretch' },
  headerBoxFlex: { flex: 1 },
  headerBarcode: {
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  headerSub: { fontSize: 12, color: '#cbd5e1', marginTop: 2 },
  headerPropRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  headerPropChip: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderColor: 'rgba(255,255,255,0.28)',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  headerPropChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2,
  },
  plannedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#1e293b',
    alignSelf: 'flex-start',
  },
  plannedChipText: { fontSize: 10, color: '#cbd5e1', fontWeight: '600' },

  // Header kutuları — Katlama / mt kalan / sipariş HEPSİ eşit yükseklik.
  headerBox: {
    minWidth: 76,
    minHeight: 52,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerBoxInner: { alignItems: 'center' },
  headerBoxDark: { backgroundColor: '#1e293b' },
  headerBoxGreen: { backgroundColor: '#059669' },
  headerBoxDanger: { backgroundColor: '#dc2626' },
  // İş emrinde belirlenen katlama kutusu — yeşil metre / koyu sipariş'ten ayrışsın.
  headerBoxFold: { backgroundColor: '#7c3aed' },
  headerBoxValue: { fontSize: 20, fontWeight: '800', color: '#fff', lineHeight: 24 },
  headerBoxSub: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.82)',
    fontWeight: '700',
    letterSpacing: 0.3,
    marginTop: 1,
  },
  // Tambur adım notu — sticky şerit (amber = talimat). Header altında sabit.
  noteStrip: {
    backgroundColor: '#fffbeb',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  noteStripInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  noteStripLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#b45309',
    letterSpacing: 0.3,
  },
  noteStripText: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
    fontWeight: '600',
  },

  // Kalan metre rozeti — header'da prominent
  remainingBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#059669',
    alignItems: 'center',
    minWidth: 90,
  },
  remainingBadgeDanger: {
    backgroundColor: '#dc2626',
  },
  remainingBadgeValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 24,
  },
  remainingBadgeLabel: {
    fontSize: 10,
    color: '#d1fae5',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  remainingBadgeMeta: {
    fontSize: 9,
    color: '#a7f3d0',
    marginTop: 1,
  },

  // Siparişler butonu — header'da modal trigger
  ordersHeaderBtn: {
    borderRadius: 10,
    backgroundColor: '#1e293b',
    overflow: 'hidden',
  },
  ordersHeaderBtnInner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 70,
  },
  ordersHeaderBtnLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 22,
  },
  ordersHeaderBtnSub: {
    fontSize: 10,
    color: '#cbd5e1',
    fontWeight: '600',
  },
  openFabricActions: {
    flexDirection: 'column',
    gap: 6,
  },

  // Refactor 4 — yanlış istasyon banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    margin: 10,
  },
  errorBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#991b1b',
    marginBottom: 2,
  },
  errorBannerText: { fontSize: 12, color: '#7f1d1d', lineHeight: 16 },

  scrollContent: { padding: 12, gap: 10 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  muted: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' },

  // Hata noktaları rehber chip'leri — kompakt yan yana
  defectGuideSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 8,
    gap: 6,
  },
  defectGuideTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.3,
  },
  defectGuideEmpty: {
    fontSize: 11,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  defectGuideTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  defectCritBadge: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  defectCritBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#b91c1c',
    letterSpacing: 0.2,
  },
  // Metre cetveli — hatalar tik/küme olarak, absolute konumlanır.
  rulerWrap: { height: 54, justifyContent: 'center', marginTop: 2 },
  rulerTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 26,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#e2e8f0',
  },
  rulerTick: {
    position: 'absolute',
    top: 18,
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: '#94a3b8',
  },
  rulerTickCritical: { backgroundColor: '#dc2626' },
  rulerCluster: {
    position: 'absolute',
    top: 16,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 4,
    backgroundColor: '#94a3b8',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rulerClusterCritical: { backgroundColor: '#dc2626' },
  rulerClusterText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  // Hata metre etiketi — marker'ın ÜSTÜnde (kritik = kırmızı).
  rulerDefectLabel: {
    position: 'absolute',
    top: 0,
    width: 38,
    textAlign: 'center',
    fontSize: 9.5,
    lineHeight: 12,
    color: '#475569',
    fontWeight: '700',
  },
  rulerDefectLabelCritical: { color: '#dc2626' },
  // Uç ölçek tik'i (sol 0 / sağ uzunluk) — çubuğun hemen altında.
  rulerScaleTick: {
    position: 'absolute',
    top: 29,
    width: 1,
    height: 6,
    backgroundColor: '#cbd5e1',
  },
  // Uç etiketleri — 0 (sol) ve seçili topun uzunluğu (sağ), çubuğun altında.
  rulerEndLabel: {
    position: 'absolute',
    bottom: 0,
    fontSize: 10,
    color: '#64748b',
    fontWeight: '700',
  },
  rulerEndLabelLeft: { left: 0 },
  rulerEndLabelRight: { right: 0 },

  // Kesim — uzunluk input + temizleme tuşu
  cutInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Kalite chip'leri + Top Oluştur butonu yan yana, yer tasarrufu
  qualityActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  // Kime + Kalite YAN YANA iki sütun; her sütun kendi içinde dikey liste.
  kimeKaliteRow: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  kimeCol: { flex: 3 },
  kaliteCol: { flex: 2 },
  cutSubLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 4 },
  // Sütun içi dikey seçenek listesi.
  optionList: { gap: 6 },
  // Kime listesi uzayınca kendi sütununda scroll olur (Kalite'yi itmez).
  kimeScroll: { maxHeight: 220 },
  // Tam genişlik dikey liste satırı (chip değil).
  listOption: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  listOptionActive: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  listOptionText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  listOptionTextActive: { color: '#fff' },
  // "Listeden Seç" — tam genişlik kesik çizgili picker satırı.
  listOptionPicker: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#4f46e5',
    borderStyle: 'dashed',
    backgroundColor: '#eef2ff',
    marginBottom: 6,
  },
  // Müşteri seçiliyken dolu indigo (seçili sipariş satırı gibi).
  listOptionPickerActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
    borderStyle: 'solid',
  },
  listOptionPickerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  qualityGridInline: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  createTopBtn: {
    borderRadius: 8,
  },
  createActionRow: { flexDirection: 'column', gap: 6 },
  // Uzunluk girişi + Manuel/Otomatik toggle yan yana (toggle dikeyde ortalı).
  lengthModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  lengthCol: { flex: 1 },
  // Otomatik modda sol sütun — büyük "Uzunluk" etiketi (toggle bağlamı).
  autoLengthBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  autoLengthLabel: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  // Manuel/Otomatik kesim modu toggle'ı (segmented)
  cutModeToggle: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 8,
    padding: 2,
  },
  cutModeChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 },
  cutModeChipActive: { backgroundColor: '#7c3aed' },
  cutModeChipText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  cutModeChipTextActive: { color: '#fff' },
  // Ham kumaş rozeti (header) — renksiz top ham etiketle basılır işareti.
  hamBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 6,
    backgroundColor: '#7c3aed',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  hamBadgeText: { color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },
  // Ham parça hedefi seçimi (üretime devam / sevke hazır).
  rawDestBlock: { marginTop: 14 },
  rawDestToggle: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  rawDestChip: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: '#c4b5fd',
    backgroundColor: '#f5f3ff',
  },
  rawDestChipActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  rawDestChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  rawDestChipText: { fontSize: 14, fontWeight: '700', color: '#6d28d9' },
  rawDestChipTextActive: { color: '#fff' },
  rawDestHint: { marginTop: 6, fontSize: 12, color: '#64748b', lineHeight: 16 },
  // Top Kesme (recut) formu hâlâ klasik başlık + auto-info kullanıyor.
  cutHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  autoInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  autoInfoText: { flex: 1, fontSize: 13, color: '#1e40af', fontWeight: '600', lineHeight: 18 },

  // İş Emri Siparişleri — operatörün kesim planı yapması için
  orderItem: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 8,
    gap: 4,
    marginTop: 4,
  },
  orderHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  orderLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  orderLineItem: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1e293b',
  },
  orderLineMeta: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 1,
  },
  orderLineRemaining: {
    alignItems: 'center',
    minWidth: 60,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#7c3aed',
  },
  orderLineRemainingValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 16,
  },
  orderLineRemainingLabel: {
    fontSize: 9,
    color: '#ede9fe',
    fontWeight: '600',
  },

  // Hata kartı
  errorCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    gap: 8,
    marginTop: 6,
  },
  errorCardCritical: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  errorCardCut: {
    borderColor: '#dc2626',
    borderWidth: 2,
  },
  errorHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#fef3c7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorIndexText: { fontSize: 11, fontWeight: '700', color: '#92400e' },
  errorTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  errorRange: { fontSize: 11, color: '#475569', marginTop: 2 },
  criticalBadge: { color: '#dc2626', fontWeight: '700', fontSize: 11 },

  defectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 8,
    gap: 8,
    marginTop: 4,
  },
  defectName: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  defectRange: { fontSize: 11, color: '#475569', marginTop: 2 },

  decisionRow: { flexDirection: 'row', gap: 8 },
  decisionBtn: { flex: 1, borderRadius: 8, borderWidth: 2 },
  decisionBtnContent: { height: 44 },

  qualityRow: { gap: 6 },
  qualityLabel: { fontSize: 11, fontWeight: '600', color: '#475569' },
  qualityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  qualityChip: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    minWidth: 64,
    alignItems: 'center',
  },
  qualityChipActive: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  qualityChipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  qualityChipTextActive: { color: '#fff' },

  // Yeni kesim girişi
  entrySection: {
    backgroundColor: '#fffbeb',
    borderColor: '#fcd34d',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  entryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400e',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: { backgroundColor: '#fff' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  defectChip: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#cbd5e1',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 999,
    minHeight: 48,
    minWidth: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  defectChipActive: { backgroundColor: '#d97706', borderColor: '#b45309' },
  defectChipText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  defectChipTextActive: { color: '#fff' },
  addBtn: { borderRadius: 10, marginTop: 4 },
  addBtnContent: { height: 56 },
  addBtnLabel: { fontSize: 16, fontWeight: '700' },

  foldRow: { flexDirection: 'row', gap: 10 },
  // Kesim içi kompakt katlama satırı (etiket + 2 küçük chip)
  foldInlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  // "Listeden Seç" chip (kesik kenarlı = kısayollardan ayrışsın)
  kimeListChip: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#4f46e5',
    borderStyle: 'dashed',
    backgroundColor: '#eef2ff',
  },
  kimeListChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  kimeListChipText: { fontSize: 13, fontWeight: '700', color: '#4f46e5' },
  // "Stok (müşterisiz)" — kesim "Kime?" picker'ında açık stok seçeneği (teal;
  // "Müşterisiz" baskı butonlarıyla aynı renk). Seçim yokken AKTİF (dolu) görünür.
  stokPickerChip: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#0f766e',
    borderStyle: 'dashed',
    backgroundColor: '#f0fdfa',
    marginBottom: 6,
  },
  stokPickerChipActive: {
    backgroundColor: '#0f766e',
    borderColor: '#0f766e',
    borderStyle: 'solid',
  },
  stokPickerChipText: { fontSize: 13, fontWeight: '700', color: '#0f766e' },
  foldChipSm: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#cbd5e1',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  foldChip: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#cbd5e1',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  foldChipActive: { backgroundColor: '#1e40af', borderColor: '#1e3a8a' },
  foldChipText: { fontSize: 15, fontWeight: '700', color: '#475569' },
  foldChipTextActive: { color: '#fff' },

  // Kesim footer'ı (Kartela + Kes) artık ./CutActionBar.tsx içinde — buradaki
  // footer* stilleri kaldırıldı.

  // Sağ
  rightCol: {
    flex: 1,
    backgroundColor: '#fff',
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
  },
  cardInputWrap: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  cardInputRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardInput: { backgroundColor: '#fff' },
  cameraBtn: { margin: 0 },
  resplitBtn: { marginTop: 6, alignSelf: 'flex-start', borderColor: '#cbd5e1' },
  actionBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  // Kamera-only mod: 4 aksiyon tek satırda — her biri ikon + altında etiket
  // (operatör hangi butonun ne olduğunu karıştırmasın). Hücreler flex:1.
  actionsCompactRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 4,
  },
  // Yatay pill: renkli zemin + ikon + kısa etiket, tek satır (az yer kaplar).
  compactAction: { flex: 1, borderRadius: 10, overflow: 'hidden' },
  // Dikey: ikon üstte, kısa etiket altta — dar hücrelerde (5 aksiyon) etiket
  // yan yana sığmadığından alt satıra alınır.
  compactActionInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  compactActionLabel: { fontSize: 11, fontWeight: '700' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 4,
  },
  tabScroll: { paddingHorizontal: 6, gap: 6, alignItems: 'center' },
  tabRefreshWrap: {
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
  },

  paneEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 6,
  },
  paneEmptyText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
  paneEmptyHint: { fontSize: 12, color: '#cbd5e1', textAlign: 'center' },

  numpadHost: {
    margin: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 8,
  },
});

const helperStyles = StyleSheet.create({
  tab: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    overflow: 'hidden',
    width: 170,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActive: { backgroundColor: '#dbeafe', borderColor: '#1e40af' },
  tabPress: { borderRadius: 8, width: '100%' },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 2,
    paddingVertical: 4,
    width: '100%',
  },
  tabTextWrap: { flex: 1, minWidth: 0 },
  tabLabel: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  tabLabelActive: { color: '#1e40af' },
  tabSub: { fontSize: 10, color: '#64748b', marginTop: 2 },
  tabCloseBtn: { margin: 0, width: 28, height: 28 },

  rollItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginVertical: 3,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rollItemSelected: {
    borderColor: '#1e40af',
    backgroundColor: '#eff6ff',
    borderWidth: 2,
  },
  rollTouch: { borderRadius: 8 },
  rollInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    gap: 8,
  },
  rollIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#dbeafe',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rollIndexText: { fontSize: 11, fontWeight: '700', color: '#1e40af' },
  rollBarcode: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  rollItemName: { fontSize: 11, color: '#64748b', marginTop: 1 },
  rollRight: { alignItems: 'flex-end', marginLeft: 8 },
  rollMeter: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    fontVariant: ['tabular-nums'],
  },
  rollWidth: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
});

const cameraStyles = StyleSheet.create({
  sheet: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 8,
    backgroundColor: '#eff6ff',
  },
  title: { fontWeight: '700', color: '#0f172a' },
  listBox: { flex: 1 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 6,
  },
  emptyText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
  row: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  rowTouch: { borderRadius: 10 },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 8,
  },
  // Büyük refakat kartı no (sol-ana) + kalan bilgi tek satır muted inline
  rowCardNo: {
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    flexShrink: 0,
  },
  rowMetaInline: { flex: 1, fontSize: 13, color: '#475569', fontWeight: '500' },
});
