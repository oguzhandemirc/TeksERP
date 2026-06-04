import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  Keyboard,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import RNModal from 'react-native-modal';
import { useFullscreenModalProps } from '../../../hooks/useFullscreenModalProps';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Surface,
  TouchableRipple,
  Checkbox,
  Icon,
  Appbar,
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
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import RefreshButton from '../../../components/RefreshButton';
import RemoteListSheet from '../../../components/RemoteListSheet';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { useDrawerActionQueue } from '../../../hooks/useDrawerActionQueue';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import NumpadInput from '../../../components/NumpadInput';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { NumpadHost } from '../../../components/NumpadProvider';
import { RightPanelDrawer } from '../../../components/RightPanelDrawer';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import LabelTargetSheet, { type LabelTargetContext } from '../../../components/LabelTargetSheet';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { LabelPrinter } from '../../../components/LabelPrinter';
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
  foldType: null,
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
}: {
  icon: string;
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <TouchableRipple
      onPress={onPress}
      style={[styles.headerChip, accent && styles.headerChipAccent]}
      borderless
      rippleColor="rgba(255,255,255,0.2)"
      accessibilityLabel={label}
    >
      <View style={styles.headerChipInner}>
        <Icon source={icon} size={18} color="#fff" />
        <Text style={styles.headerChipText}>{label}</Text>
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
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  // Etiket "kime?" — baskı anında müşteri seçimi (gevşek model: top→sipariş bağı yok).
  const [labelContext, setLabelContext] = useState<LabelTargetContext | undefined>(undefined);
  const [targetSheet, setTargetSheet] = useState<{ roll: Roll; defaultLineId: string | null } | null>(null);
  const [pendingTargetRolls, setPendingTargetRolls] = useState<{ roll: Roll; defaultLineId: string | null }[]>([]);
  // Yönlendir (yeniden etiketle) — aramalı top seçici (kamera/HID de okutur) → kime? → bas.
  const [relabelFindOpen, setRelabelFindOpen] = useState(false);
  const [relabelScanOpen, setRelabelScanOpen] = useState(false);
  const [relabelResolving, setRelabelResolving] = useState(false);
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
  } | null>(null);
  const [recutCutLength, setRecutCutLength] = useState('');
  // Recut (Top Kesme) — açık kumaş akışıyla aynı: manuel/otomatik mod.
  const [recutMode, setRecutMode] = useState<'manual' | 'auto'>('manual');
  // "Kime" — sipariş kısayollarına ek olarak listeden (müşteriye göre aranabilir)
  // açık sipariş satırı seçme picker'ı. Her iki kesim akışı paylaşır.
  const [kimePickerOpen, setKimePickerOpen] = useState(false);
  const [recutQualityGrade, setRecutQualityGrade] = useState<string>('1.KALITE');
  const [recutScannerOpen, setRecutScannerOpen] = useState(false);
  // "Kime?" — depo topundan kesilen parça hangi siparişe (null = stok). Etiket buradan basılır.
  const [recutTargetLineId, setRecutTargetLineId] = useState<string | null>(null);
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

  // Top/sekme değişimi → çalışma state'i temizlenir. Planlamada belirtilen
  // katlama (2-KAT / 4-KAT) varsa otomatik seçili gelir; operatör değiştirebilir.
  useEffect(() => {
    const planned = activeJob?.context?.plannedFoldType;
    const defaultFold: TamburFoldType | null =
      planned === '2-KAT' || planned === '4-KAT' ? planned : null;
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

  // ── Kart çözümleme ──
  const resolveCard = async (barcode: string, fromInput: boolean) => {
    if (!barcode) return;
    const existing = openJobs.find((j) => j.cardBarcode === barcode);
    if (existing) {
      setActiveCardId(existing.cardId);
      if (fromInput) setCardBarcode('');
      Toast.show({ type: 'info', text1: 'Kart zaten açık' });
      return;
    }

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

  // Bir topu "Etiket kime?" kuyruğuna at (kesim sonrası / yönlendir / son toplar / finalize).
  const queueLabel = (roll: Roll, defaultLineId: string | null = null) =>
    setPendingTargetRolls((q) => [...q, { roll, defaultLineId }]);

  // Yönlendir — barkod/koddan topu çöz → "Etiket kime?" kuyruğuna at.
  const resolveRelabelBarcode = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setRelabelResolving(true);
    try {
      const { rollService } = await import('../../../services/roll.service');
      const res = await rollService.getByBarcode(trimmed);
      const roll = res.data as Roll | null;
      if (!roll) {
        Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: trimmed });
        return;
      }
      setRelabelFindOpen(false);
      queueLabel(roll, null);
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Okunamadı', text2: (e as Error).message });
    } finally {
      setRelabelResolving(false);
    }
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
      // Sadece etiket hedefi (kesim stok olarak girer); backend'e gitmez.
      targetCustomerId?: string | null;
      markedForKartela?: boolean;
    }) =>
      tamburService.cutOpenFabric(data.rollId, {
        lengthMeters: data.lengthMeters,
        status: data.status,
        qualityGrade: data.qualityGrade,
        targetOrderLineId: data.targetOrderLineId ?? null,
        markedForKartela: data.markedForKartela ?? false,
      }),
    onSuccess: async (res, variables) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const data = res.data as
        | { childRoll?: Roll; parentRemainingQty?: number }
        | undefined;
      if (data?.childRoll?.barcode) {
        // Hedef zaten "Kime" bölümünde seçili → "Kes" doğrudan o hedefe basar,
        // TEKRAR "Etiket kime?" SORMAZ. Hiçbir şey seçili değilse = stok
        // (müşterisiz etiket). Sonradan "Etiket Değiştir" ile yönlendirilebilir.
        setLabelContext(
          variables.targetCustomerId
            ? { customerId: variables.targetCustomerId }
            : variables.targetOrderLineId
              ? { orderLineId: variables.targetOrderLineId }
              : undefined,
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
      const remaining = data?.parentRemainingQty ?? 0;
      if (remaining < 0.1 && selectedRoll) {
        Toast.show({ type: 'success', text1: 'Açık kumaş tamamlandı' });
        finalizeOpenFabricMutation.mutate({
          rollId: selectedRoll.rollId,
          remainingAction: 'discard',
          foldType: work.foldType ?? null,
        });
      } else {
        Toast.show({ type: 'success', text1: 'Top oluşturuldu' });
        await refetchActiveJob();
      }
    },
    onError: (err: Error) => {
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
    onError: (err: Error) =>
      Toast.show({ type: 'error', text1: 'Silinemedi', text2: err.message }),
  });

  // Top Kesme — multi-cut: her kesim child Roll doğurur, parent currentQty
  // düşer, etiket otomatik basılır. Operatör istediği kadar tekrarlar.
  const cutWarehouseRollMutation = useMutation({
    mutationFn: ({
      rollId,
      cutLength,
      qualityGrade,
      targetOrderLineId,
      markedForKartela,
    }: {
      rollId: string;
      cutLength: number;
      qualityGrade: string;
      targetOrderLineId?: string | null;
      markedForKartela?: boolean;
    }) =>
      tamburService.cutWarehouseRoll(rollId, {
        cutLength,
        qualityGrade,
        targetOrderLineId: targetOrderLineId ?? null,
        markedForKartela: markedForKartela ?? false,
      }),
    onSuccess: (res, variables) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const data = res.data;
      if (data?.childRoll?.barcode) {
        // Hedef "Kime" bölümünde zaten seçili → tekrar "Etiket kime?" SORMA,
        // doğrudan o hedefe bas (open fabric kesimiyle aynı). Hiçbir şey seçili
        // değilse = stok (müşterisiz etiket); sonradan "Etiket Değiştir" ile
        // yönlendirilebilir.
        setLabelContext(
          variables.targetOrderLineId ? { orderLineId: variables.targetOrderLineId } : undefined,
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Kesim başarısız', text2: err.message });
    },
  });

  // NOT: Kartela artık Tambur'da kesilmez. Kartela = bitmiş topun kartela fason
  // firmasında işlenmesiyle doğar (Kartela Sevk + Kartela Kabul ekranları).
  // Eski recutSwatchMutation / handleRecutKartela kaldırıldı. Bkz. KARTELA-TASARIM.md.

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
    if (selectedRoll.barcode) {
      Toast.show({
        type: 'error',
        text1: 'Bu ekran açık kumaş için',
        text2: 'Barkodlu top için Yeniden Kes kullanın',
      });
      return;
    }
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
    if (length > selectedRoll.currentQty + 0.001) {
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
    cutOpenFabricMutation.mutate({
      rollId: selectedRoll.rollId,
      lengthMeters: length,
      status,
      qualityGrade: qg?.code ?? '1.KALITE',
      targetOrderLineId: work.voluntaryEntry.targetOrderLineId,
      targetCustomerId: work.voluntaryEntry.targetCustomerId,
      markedForKartela: markAsKartela,
    });
  };

  // Footer "Kes" — manuel: input'taki uzunluk; otomatik: makineden ölçülen.
  const handleKes = () => {
    if (cutMode === 'auto') {
      if (!selectedRoll) return;
      // FAZ 1 SİMÜLASYONU — gerçek sayaç yok; kalana clamp'li makul bir uzunluk
      // üret. Faz 2'de bu satır gerçek makine okumasıyla değişecek.
      const remaining = selectedRoll.currentQty;
      const lo = Math.min(5, remaining);
      const hi = Math.min(80, remaining);
      const measured = Math.round((lo + Math.random() * (hi - lo)) * 10) / 10;
      addVoluntaryCut(measured);
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
      if (r.status !== 'WAREHOUSE') {
        Toast.show({
          type: 'error',
          text1: 'Top kesime uygun değil',
          text2: `Durum: ${r.status} (depodaki toplar kesilebilir)`,
        });
        return;
      }
      setRecutResolvedRollId(r.id);
      setRecutRollMeta({
        barcode: r.barcode,
        currentQty: r.currentQty,
        item: r.item?.name ?? '—',
        itemId: r.itemId,
        colorId: r.colorId ?? null,
        colorName: r.color?.name ?? null,
        width: r.width ?? null,
      });
      setRecutTargetLineId(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
    if (cut > recutRollMeta.currentQty) {
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
    cutWarehouseRollMutation.mutate({
      rollId: recutResolvedRollId,
      cutLength: cut,
      qualityGrade: recutQualityGrade,
      targetOrderLineId: recutTargetLineId,
      markedForKartela: markAsKartela,
    });
  };

  // Recut "Kes" — manuel: input'taki uzunluk; otomatik: makineden ölçülen (sim).
  const handleRecutKes = () => {
    if (recutMode === 'auto') {
      if (!recutRollMeta) return;
      const remaining = recutRollMeta.currentQty;
      const lo = Math.min(5, remaining);
      const hi = Math.min(80, remaining);
      const measured = Math.round((lo + Math.random() * (hi - lo)) * 10) / 10;
      handleRecutSubmit(measured);
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
  // Tüm müşteriler — yalnızca "Listeden Seç" açıkken çekilir (ana akış).
  const customersQuery = useQuery({
    queryKey: ['customers', 'tambur-kime-picker'],
    queryFn: () => customerService.getAll({ page: 1, pageSize: 500 }),
    enabled: kimePickerOpen && !recutRollMeta,
    staleTime: 60_000,
  });

  // Picker seçenekleri: recut → WO sipariş satırları; ana akış → TÜM müşteriler
  // (siparişteki müşteriler en üstte, "✓ siparişi var" etiketiyle).
  const kimeOptions = useMemo<PickerOption[]>(() => {
    if (recutRollMeta) {
      return recutLineOptions.map((l) => ({
        value: l.lineId,
        label: l.customerName,
        sublabel: `${l.orderNumber} · ${l.itemName}${
          l.openQty ? ` · ${Math.round(l.openQty)}m açık` : ''
        }`,
      }));
    }
    // Ana liste = sipariş DIŞI müşteriler (çerçevenin dışında). Sipariştekiler
    // ayrı `kimePinnedOptions` ile çerçeve içinde verilir.
    const all = customersQuery.data?.data ?? [];
    return all
      .filter((c) => !orderCustomerIds.has(c.id))
      .map((c) => ({ value: c.id, label: c.name, sublabel: c.code ?? undefined }));
  }, [recutRollMeta, recutLineOptions, customersQuery.data, orderCustomerIds]);

  // Çerçeveli grup — bu iş emrinde siparişi olan müşteriler (ana akış).
  const kimePinnedOptions = useMemo<PickerOption[]>(() => {
    if (recutRollMeta) return [];
    const all = customersQuery.data?.data ?? [];
    return all
      .filter((c) => orderCustomerIds.has(c.id))
      .map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: c.code ?? undefined,
      }));
  }, [recutRollMeta, customersQuery.data, orderCustomerIds]);

  const handleKimeSelect = (value: string) => {
    if (recutRollMeta) {
      setRecutTargetLineId(value);
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
  const kimeCustomerActive =
    !recutRollMeta && !!work.voluntaryEntry.targetCustomerId;
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
            ? work.voluntaryEntry.targetCustomerName
            : 'Listeden Seç'}
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
    setRecutCutLength('');
    setRecutQualityGrade('1.KALITE');
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
        // Telefon kamera-only mod: 4 aksiyon drawer'da tek satır büyük ikon.
        <View style={styles.cardInputWrap}>
          <View style={styles.actionsCompactRow}>
            <CompactAction
              icon="format-list-bulleted"
              label="Liste"
              bg="#e2e8f0"
              color="#0f172a"
              onPress={() => openList()}
            />
            <CompactAction
              icon="camera"
              label="Tara"
              bg="#dbeafe"
              color="#1e40af"
              onPress={() => openScanner()}
            />
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
            <RefreshButton onPress={refetchActiveJob} refreshing={false} />
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
        <FlashList
          data={activeJob.stepSummary.rolls}
          keyExtractor={(r) => r.rollId}
          contentContainerStyle={{ padding: 8 }}
          renderItem={({ item, index }) => (
            <RollListItem
              roll={item}
              index={index}
              selected={activeJob.selectedRollId === item.rollId}
              onPress={() => selectRoll(item.rollId)}
            />
          )}
        />
      )}
    </>
  );

  // ── Render ──
  return (
    <ScreenChrome
      title="Tambur"
      headerExtras={
        <View style={styles.headerExtrasRow}>
          <SyncStatusChip />
          {/* Tablet: kart aksiyonları header'a etiketli pill olarak alınır →
              sağ kolonda liste için alan açılır. Telefonda header dar; bunlar
              drawer'da kalır. */}
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
          <HeaderChip
            icon="swap-horizontal"
            label="Etiket Değiştir"
            onPress={() => setRelabelFindOpen(true)}
            accent
          />
          {compact ? (
            <Appbar.Action
              icon="format-list-bulleted"
              color="#fff"
              onPress={() => setRightDrawerOpen(true)}
              accessibilityLabel={
                activeJob
                  ? `Açık iş: ${activeJob.stepSummary.batchNumber}`
                  : 'Açık İşler / Kart Okut'
              }
            />
          ) : null}
        </View>
      }
    >
      <View
        style={[
          styles.body,
          compact && {
            paddingLeft: Math.max(insets.left, 12) + 12,
            paddingRight: Math.max(insets.right, 12) + 12,
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
            // Top Kesme akışı — sağdaki "Top Kesme" tetikleyince top okutulur,
            // burada normal Tambur akışının basit bir varyantı: sticky header
            // (top bilgisi + kalan metre) + tek alan (kesim metresi) + "Kes" buton.
            // activeJob/refakat kartından bağımsız, exclusive bir mod.
            // Wrap padding: header/footer ekran kenarlarından nefes alır, form
            // ortada → "bir bütün" görünür, dağınık değil.
            <View style={styles.recutWrap}>
              <Surface style={styles.headerBand} elevation={2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.headerBarcode}>
                    {recutRollMeta.barcode ?? '—'}
                  </Text>
                  <Text style={styles.headerSub}>
                    {recutRollMeta.item}
                    {recutRollMeta.colorName ? ` · ${recutRollMeta.colorName}` : ''}
                    {recutRollMeta.width != null ? ` · ${recutRollMeta.width} cm` : ''}
                  </Text>
                </View>
                <View
                  style={[
                    styles.headerBox,
                    styles.headerBoxGreen,
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
              </Surface>

              {/* WO akışıyla aynı düzen: kaydırılabilir form + sticky footer */}
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
              >
                <Surface style={styles.section} elevation={1}>
                  {/* Uzunluk girişi + Manuel/Otomatik toggle yan yana */}
                  {recutMode === 'manual' && (
                    <Text style={styles.entryLabel}>Uzunluk (mt)</Text>
                  )}
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
                              placeholder="Boş = kalanı kes"
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

                  {recutMode === 'manual' && recutRollMeta.currentQty > 0.001 && (
                    <Button
                      mode="text"
                      compact
                      icon="arrow-down-bold-box-outline"
                      onPress={() =>
                        setRecutCutLength(
                          (Math.floor(recutRollMeta.currentQty * 10) / 10).toString(),
                        )
                      }
                      style={styles.useRemainingBtn}
                    >
                      Kalanı kullan ({recutRollMeta.currentQty.toFixed(1)} mt)
                    </Button>
                  )}

                  {/* Kime + Kalite yan yana iki sütun; her sütun kendi dikey listesi */}
                  <View style={styles.kimeKaliteRow}>
                    <View style={styles.kimeCol}>
                      <Text style={styles.cutSubLabel}>Kime? (boş = stok)</Text>
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
                                onPress={() =>
                                  setRecutTargetLineId(active ? null : l.lineId)
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

              {/* Sticky footer — Kes (asıl). Son kesimde kalan ~0 olunca depo
                  topu OTOMATİK arşivlenir. Kartela düğmesi kaldırıldı (kartela
                  artık fason dönüşünden doğuyor). */}
              <Surface style={styles.footer} elevation={4}>
                <TouchableRipple
                  onPress={() => setMarkAsKartela((v) => !v)}
                  style={styles.kartelaCheckRow}
                  borderless
                >
                  <View style={styles.kartelaCheckInner}>
                    <Checkbox status={markAsKartela ? 'checked' : 'unchecked'} />
                    <Text style={styles.kartelaCheckLabel}>
                      Kartelalık (depoda kolay bulunur)
                    </Text>
                  </View>
                </TouchableRipple>
                <View style={styles.footerRow}>
                  <Button
                    mode="contained"
                    icon="content-cut"
                    onPress={handleRecutKes}
                    buttonColor="#7c3aed"
                    loading={cutWarehouseRollMutation.isPending}
                    disabled={
                      cutWarehouseRollMutation.isPending ||
                      finalizeWarehouseCutMutation.isPending ||
                      !recutQualityGrade ||
                      recutRollMeta.currentQty <= 0 ||
                      // Manuelde boş input'a İZİN VER (= kalanı kes). Sadece dolu
                      // ama geçersiz (≤0 / kalanı aşan) değer girilince kilitle.
                      (recutMode === 'manual' &&
                        recutCutLength.trim() !== '' &&
                        (parseFloat(recutCutLength) <= 0 ||
                          parseFloat(recutCutLength) > recutRollMeta.currentQty))
                    }
                    style={styles.footerBtnMain}
                    contentStyle={styles.footerBtnContent}
                    labelStyle={styles.footerBtnLabel}
                  >
                    {recutMode === 'auto' ? 'Kes — Makineden Ölç' : 'Kes — Top Oluştur'}
                  </Button>
                </View>
              </Surface>
            </View>
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
              <Surface style={styles.headerBand} elevation={2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.headerBarcode}>
                    {selectedRoll.barcode ?? `Açık Kumaş · ${selectedRoll.rollId.slice(0, 8)}`}
                  </Text>
                  <Text style={styles.headerSub}>
                    {selectedRoll.itemName}
                    {selectedRoll.colorName ? ` · ${selectedRoll.colorName}` : ''}
                    {selectedRoll.width != null ? ` · ${selectedRoll.width} cm` : ''}
                  </Text>
                  {selectedRoll.properties.length > 0 && (
                    <View style={styles.headerPropRow}>
                      {selectedRoll.properties.map((p) => (
                        <View key={p.id} style={styles.headerPropChip}>
                          <Text style={styles.headerPropChipText}>{p.name}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Planlanan katlama — kutu (mt kalan / sipariş ile aynı yükseklik) */}
                {!!activeJob?.context?.plannedFoldType && (
                  <View style={[styles.headerBox, styles.headerBoxDark]}>
                    <Text style={styles.headerBoxValue}>
                      {activeJob.context.plannedFoldType === '4-KAT'
                        ? '4-Kat'
                        : '2-Kat'}
                    </Text>
                    <Text style={styles.headerBoxSub}>katlama</Text>
                  </View>
                )}

                {/* Kalan metre — operatörün ana ölçeği */}
                <View
                  style={[
                    styles.headerBox,
                    styles.headerBoxGreen,
                    (segmentPreview?.remaining ?? 0) <= 0.001 &&
                      styles.headerBoxDanger,
                  ]}
                >
                  <Text style={styles.headerBoxValue}>
                    {(segmentPreview?.remaining ?? selectedRoll.currentQty).toFixed(1)}
                  </Text>
                  <Text style={styles.headerBoxSub}>mt kalan</Text>
                </View>

                {/* Siparişler — modal trigger */}
                {!!activeJob?.context?.orders &&
                  activeJob.context.orders.length > 0 && (
                    <TouchableRipple
                      onPress={() => setOrdersModalOpen(true)}
                      borderless
                      style={[styles.headerBox, styles.headerBoxDark]}
                    >
                      <View style={styles.headerBoxInner}>
                        <Text style={styles.headerBoxValue}>
                          {activeJob.context.orders.length}
                        </Text>
                        <Text style={styles.headerBoxSub}>sipariş</Text>
                      </View>
                    </TouchableRipple>
                  )}
              </Surface>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {/* Tambur (adım) notu + hata noktaları — tablette yan yana,
                    telefonda alt alta. Kesim notu burada YOK; sipariş-sipariş
                    kırılımıyla "Sipariş" detayında. Adım notu yoksa Hata
                    Noktaları tüm satırı kaplar (topInfoCell flex:1). */}
                <View style={compact ? styles.topInfoStack : styles.topInfoRow}>
                  {/* İş emrinde Tambur adımına özel verilen not (WorkOrderStep.notes) */}
                  <NotesBanner
                    stepNote={activeJob?.context?.stepNote}
                    style={compact ? styles.topInfoStackItem : styles.topInfoCell}
                  />
                  {/* Hata noktaları — sadece referans, kompakt yan yana chip'ler */}
                  <Surface
                    style={[
                      styles.defectGuideSection,
                      compact ? styles.topInfoStackItem : styles.topInfoCell,
                    ]}
                    elevation={1}
                  >
                    <Text style={styles.defectGuideTitle}>
                      Hata Noktaları ({selectedRoll.errors.length})
                    </Text>
                    {selectedRoll.errors.length === 0 ? (
                      <Text style={styles.defectGuideEmpty}>Kayıtlı hata yok</Text>
                    ) : (
                      <View style={styles.defectGuideRow}>
                        {selectedRoll.errors.map((e) => {
                          const defectType = defectTypes.find(
                            (d) => d.name === e.errorType
                          );
                          const isCritical = defectType?.severity === 'CRITICAL';
                          return (
                            <View
                              key={e.id}
                              style={[
                                styles.defectGuideChip,
                                isCritical && styles.defectGuideChipCritical,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.defectGuideChipMeter,
                                  isCritical && styles.defectGuideChipTextCritical,
                                ]}
                              >
                                {e.startMeter.toFixed(1)}m
                              </Text>
                              {e.errorType && (
                                <Text
                                  style={[
                                    styles.defectGuideChipLabel,
                                    isCritical && styles.defectGuideChipTextCritical,
                                  ]}
                                  numberOfLines={1}
                                >
                                  {e.errorType}
                                </Text>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </Surface>
                </View>

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
                          onPress={() =>
                            setWork((w) => ({ ...w, foldType: active ? null : ft }))
                          }
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

                  {/* Label satırın DIŞINDA — böylece aşağıdaki toggle, label'la
                      değil doğrudan input ile dikeyde ortalanır. */}
                  {cutMode === 'manual' && (
                    <Text style={styles.entryLabel}>Uzunluk (mt)</Text>
                  )}
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
                              placeholder="Boş = kalanı kes"
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
                        Kime? (boş = stok)
                      </Text>
                      {/* SABİT — scroll'la kaymaz; tüm müşteriler (sipariştekiler önce) */}
                      {kimeListChip}
                      {/* Sipariş kısayolları — kendi içinde scroll; 2. tık seçimi
                          kaldırır (seçim yok = stok). "Stok" satırı yok. */}
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
              <Surface style={styles.footer} elevation={4}>
                <TouchableRipple
                  onPress={() => setMarkAsKartela((v) => !v)}
                  style={styles.kartelaCheckRow}
                  borderless
                >
                  <View style={styles.kartelaCheckInner}>
                    <Checkbox status={markAsKartela ? 'checked' : 'unchecked'} />
                    <Text style={styles.kartelaCheckLabel}>
                      Kartelalık (depoda kolay bulunur)
                    </Text>
                  </View>
                </TouchableRipple>
                <View style={styles.footerRow}>
                  {/* Kartela düğmesi kaldırıldı — kartela artık fason dönüşünden doğuyor. */}
                  <Button
                    mode="contained"
                    icon="content-cut"
                    onPress={handleKes}
                    buttonColor="#7c3aed"
                    loading={cutOpenFabricMutation.isPending}
                    disabled={
                      cutOpenFabricMutation.isPending ||
                      !work.voluntaryEntry.qualityGrade
                    }
                    style={styles.footerBtnMain}
                    contentStyle={styles.footerBtnContent}
                    labelStyle={styles.footerBtnLabel}
                  >
                    {cutMode === 'auto'
                      ? 'Kes — Makineden Ölç'
                      : work.voluntaryEntry.length.trim() === '' &&
                          selectedRoll.currentQty > 0.001
                        ? `Kes — Kalanı Kes (${selectedRoll.currentQty.toFixed(1)} mt)`
                        : 'Kes — Top Oluştur'}
                  </Button>
                </View>
              </Surface>
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
          }
        }}
      />

      {/* İş Emri Siparişleri modal'ı — operatör kesim planı için açar */}
      <OrdersDetailModal
        visible={ordersModalOpen}
        orders={activeJob?.context?.orders ?? []}
        onDismiss={() => setOrdersModalOpen(false)}
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

      {/* Tambur'dan çıkmış toplar listesi — geçmişten etiket yeniden basımı */}
      <RecentOutputModal
        visible={recentOutputOpen}
        onDismiss={() => setRecentOutputOpen(false)}
        onPrint={(roll) => {
          // Liste modalı açıkken "Etiket kime?" sheet'i (ayrı RNModal) arkada
          // kalıyordu → "Bas"a basınca hiçbir şey olmuyordu. Önce listeyi kapat.
          setRecentOutputOpen(false);
          queueLabel(roll);
        }}
        printingRollId={activePrintRoll?.id ?? null}
      />

      {/* Compact'ta sağdan kayan iş paneli — telefon ekranında sağ kolonun yerine */}
      {compact && (
        <RightPanelDrawer
          visible={rightDrawerOpen}
          onDismiss={() => setRightDrawerOpen(false)}
          insets={insets}
          title="Tambur İşleri"
          onClosed={drawerQueue.drain}
        >
          {renderRightContent()}
        </RightPanelDrawer>
      )}

      {/* Aktif yazdırma — LabelPrinter expo-print ile PDF/sistem yazdırma açar */}
      <LabelPrinter
        roll={activePrintRoll}
        kind="ROLL_FINISHED"
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
        pinnedLabel="Bu iş emrinde siparişi olan müşteriler"
        selectedValue={
          recutRollMeta
            ? recutTargetLineId
            : work.voluntaryEntry.targetCustomerId
        }
        numColumns={compact ? 1 : 2}
        onSelect={handleKimeSelect}
        onDismiss={() => setKimePickerOpen(false)}
        emptyText={
          recutRollMeta
            ? 'Açık sipariş satırı yok'
            : customersQuery.isLoading
              ? 'Müşteriler yükleniyor…'
              : 'Müşteri bulunamadı'
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
          setLabelContext(ctx.orderLineId || ctx.customerId ? ctx : undefined);
          setActivePrintRoll(r);
        }}
      />

      {/* Yönlendir — aramalı + sayfalı top seçici (kamera/HID de okutur) → kime? → bas */}
      <RelabelPickerModal
        visible={relabelFindOpen}
        onDismiss={() => setRelabelFindOpen(false)}
        onSelect={(roll) => {
          setRelabelFindOpen(false);
          queueLabel(roll);
        }}
        onScanPress={() => setRelabelScanOpen(true)}
        onSubmitBarcode={(code) => void resolveRelabelBarcode(code)}
        resolving={relabelResolving}
      />

      <BarcodeScannerModal
        visible={relabelScanOpen}
        onDismiss={() => setRelabelScanOpen(false)}
        onScan={(code) => {
          setRelabelScanOpen(false);
          void resolveRelabelBarcode(code);
        }}
        title="Yönlendirilecek topu okut"
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
}: {
  roll: Roll;
  index: number;
  isPrinting: boolean;
  onPrint: (roll: Roll) => void;
}) {
  const color = roll.color ?? null;
  const gradeBg =
    roll.qualityGrade === 'FIRE'
      ? '#fee2e2'
      : roll.qualityGrade === 'A1'
        ? '#fef3c7'
        : '#dcfce7';
  return (
    <Surface style={resplitStyles.labelCard} elevation={1}>
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
      <IconButton
        icon={isPrinting ? 'progress-clock' : 'printer'}
        mode="contained"
        size={22}
        containerColor="#1e40af"
        iconColor="#fff"
        onPress={() => onPrint(roll)}
        disabled={isPrinting}
        accessibilityLabel="Etiketi bas"
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
  printingRollId,
}: {
  rolls: Roll[];
  batchNumber?: string | null;
  onDismiss: () => void;
  onPrint: (roll: Roll) => void;
  printingRollId: string | null;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const modalProps = useFullscreenModalProps();
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
    <RNModal
      isVisible={rolls.length > 0}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.55}
      style={cameraStyles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      {...modalProps}
    >
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
            />
          ))}
        </ScrollView>
      </View>
    </RNModal>
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
  const modalProps = useFullscreenModalProps();
  const phone = winW < 600;

  // Başlık özeti için toplam kalem sayısı.
  const lineCount = useMemo(
    () => orders.reduce((n, o) => n + o.lines.length, 0),
    [orders],
  );

  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.55}
      useNativeDriver
      hideModalContentWhileAnimating
      {...modalProps}
      style={ordersModalStyles.modal}
    >
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
                  const remaining = Math.max(0, line.orderedQty - line.shippedQty);
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

                      {/* Sağ: kalan metraj — kompakt lacivert pill */}
                      <View style={ordersModalStyles.remainingPill}>
                        <Text style={ordersModalStyles.remainingValue}>
                          {remaining.toFixed(1)}
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
    </RNModal>
  );
}

// Lacivert aksan — tema mavi (blue/info) ailesi; modal header + rozet/chip kimliği.
const ORDERS_ACCENT = '#1e40af'; // blue-800
const ORDERS_ACCENT_DARK = '#1e3a8a'; // blue-900 (en koyu — header)
const ORDERS_ACCENT_SOFT = '#eff6ff'; // blue-50
const ORDERS_ACCENT_BORDER = '#bfdbfe'; // blue-200
const ORDERS_ACCENT_ON = '#dbeafe'; // blue-100

const ordersModalStyles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0 },
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

// ─────────────────────────────────────────────────────────────────────────────
// Yönlendir — top seçici. Depodaki (bitmiş stok) toplar arasından arama + sayfalı
// liste; satıra basınca "Etiket kime?" akışına girer. Kamera/HID ile de okutulur.
//
// Performans: server-side arama (barkod + ürün adı/kodu) + cursor pagination
// (`rollService.getAllCursor`) — tablo 30k+ satıra çıksa bile sabit hız.
// ─────────────────────────────────────────────────────────────────────────────
function RelabelPickerModal({
  visible,
  onDismiss,
  onSelect,
  onScanPress,
  onSubmitBarcode,
  resolving,
}: {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (roll: Roll) => void;
  onScanPress: () => void;
  onSubmitBarcode: (code: string) => void;
  resolving: boolean;
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
    queryKey: ['rolls', 'relabel-picker', debouncedSearch],
    queryFn: ({ pageParam }) =>
      rollService.getAllCursor({
        limit: 24,
        cursor: pageParam,
        search: debouncedSearch || undefined,
        // Bitmiş stok (depo + A1 + üretildi), barkodlu (etiketlenebilir) toplar.
        filters: { rollScope: 'FINISHED_STOCK', rollKind: 'WOUND_ROLL' },
        withTotal: !pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.nextCursor : undefined,
    enabled: visible,
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
  });

  const rolls: Roll[] = useMemo(
    () => q.data?.pages.flatMap((p) => p.data) ?? [],
    [q.data]
  );
  const total = q.data?.pages[0]?.pagination.totalEstimate ?? null;

  return (
    <RemoteListSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Yönlendir — Top Seç"
      icon="swap-horizontal"
      iconColor="#4338ca"
      headerTint="#e0e7ff"
      widthRatio={isCompactPortrait ? 0.96 : 0.64}
      heightRatio={0.78}
      loading={q.isLoading}
      fetching={q.isFetching && !q.isFetchingNextPage}
      isError={q.isError}
      errorMessage={(q.error as Error | undefined)?.message}
      onRefresh={() => q.refetch()}
      items={rolls}
      keyExtractor={(r) => r.id}
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
      }}
      listFooterComponent={
        q.isFetchingNextPage ? (
          <View style={relabelStyles.loadingMore}>
            <ActivityIndicator size="small" color="#4338ca" />
          </View>
        ) : null
      }
      subHeader={
        <View style={relabelStyles.searchRow}>
          <TextInput
            mode="outlined"
            dense
            placeholder="Barkod, ürün veya renk ara…"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => {
              const t = search.trim();
              if (t) onSubmitBarcode(t);
            }}
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
            containerColor="#4338ca"
            iconColor="#fff"
            onPress={onScanPress}
            disabled={resolving}
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
        <RelabelRollRow roll={roll} onPress={() => onSelect(roll)} />
      )}
      emptyIcon="package-variant"
      emptyText={debouncedSearch ? 'Eşleşen top yok' : 'Depoda yönlendirilebilir top yok'}
      emptyHint={
        debouncedSearch ? 'Farklı bir barkod / ürün / renk dene' : undefined
      }
    />
  );
}

// Yönlendir listesinde tek top satırı — TÜM satır tıklanır (seçim = yönlendir).
function RelabelRollRow({
  roll,
  onPress,
}: {
  roll: Roll;
  onPress: () => void;
}) {
  const color = roll.color ?? null;
  const grade = roll.qualityGrade ?? '—';
  const gradeBg =
    grade === 'FIRE' ? '#fee2e2' : grade === 'A1' ? '#fef3c7' : '#dcfce7';
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
          {roll.item?.name ?? '—'}
          {color?.name ? ` · ${color.name}` : ''}
        </Text>
        <Text style={relabelStyles.rowQty} numberOfLines={1}>
          {roll.currentQty != null
            ? `${Number(roll.currentQty).toFixed(1)} m`
            : '—'}
          {roll.width != null ? ` · ${roll.width} cm` : ''}
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
  printingRollId,
}: {
  visible: boolean;
  onDismiss: () => void;
  onPrint: (roll: Roll) => void;
  printingRollId: string | null;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const isCompactPortrait = winH > winW;
  const q = useQuery({
    queryKey: ['tambur', 'recent-output-rolls'],
    queryFn: () => tamburService.recentOutputRolls({ limit: 50 }),
    enabled: visible,
    staleTime: 30 * 1000,
  });
  // Modal her açılışta force refetch — 30s cache stale dönmesin.
  useRefetchOnOpen(q.refetch, visible);
  const rolls: Roll[] = q.data?.data ?? [];

  return (
    <RemoteListSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Üretilen Toplar"
      icon="printer-search"
      iconColor="#1e40af"
      headerTint="#dbeafe"
      widthRatio={isCompactPortrait ? 0.92 : 0.5}
      heightRatio={0.85}
      loading={q.isLoading}
      fetching={q.isFetching}
      isError={q.isError}
      errorMessage={(q.error as Error | undefined)?.message}
      onRefresh={() => q.refetch()}
      items={rolls}
      keyExtractor={(r) => r.id}
      useScrollView
      renderItem={(roll) => (
        <RollLabelCard
          roll={roll}
          index={rolls.indexOf(roll)}
          isPrinting={printingRollId === roll.id}
          onPrint={onPrint}
        />
      )}
      emptyIcon="package-variant"
      emptyText="Henüz Tambur'dan çıkmış top yok"
    />
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
}: {
  visible: boolean;
  loading: boolean;
  cards: TamburOpenCard[];
  onDismiss: () => void;
  onSelect: (card: TamburOpenCard) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const modalProps = useFullscreenModalProps();
  // Compact portrait (telefon dik) ekranda 70% genişlik dar — operatör kart
  // listesini taramakta zorlanıyor. Portrait'te 92% ver, tablet/yatayda 70%.
  const isCompactPortrait = winH > winW;
  const sheetWidth = isCompactPortrait ? winW * 0.92 : winW * 0.7;
  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.55}
      style={cameraStyles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      {...modalProps}
    >
      <View style={[cameraStyles.sheet, { width: sheetWidth, height: winH * 0.8 }]}>
        <View style={cameraStyles.header}>
          <Icon source="format-list-bulleted" size={22} color="#0f172a" />
          <Text variant="titleMedium" style={cameraStyles.title} numberOfLines={1}>
            Açık Kartlar
          </Text>
          <View style={{ flex: 1 }} />
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
      </View>
    </RNModal>
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
  const modalProps = useFullscreenModalProps();
  const isCompactPortrait = winH > winW;
  const qtyText = `${remainingQty.toFixed(1)} mt`;

  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={loading ? undefined : onDismiss}
      onBackButtonPress={loading ? undefined : onDismiss}
      onModalHide={onModalHide}
      backdropOpacity={0.55}
      style={cameraStyles.modal}
      useNativeDriver
      {...modalProps}
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
    </RNModal>
  );
}

// Sipariş kesim notu + tambur adım notu bandı — aktif iş üstünde, operatör
// kesimden önce talimatı görsün (eskiden hiç gösterilmiyordu).
function NotesBanner({
  stepNote,
  style,
}: {
  stepNote?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  // Sadece Tambur (adım) notu. Sipariş kesim notu burada gösterilmez — zaten
  // "Sipariş" detayında sipariş-sipariş kırılımıyla mevcut.
  const note = stepNote?.trim();
  if (!note) return null;
  return (
    <Surface style={[styles.notesBanner, style]} elevation={1}>
      <View style={styles.noteCell}>
        <View style={styles.noteHead}>
          <Icon source="clipboard-text-outline" size={15} color="#b45309" />
          <Text style={styles.noteLabel}>Tambur Notu</Text>
        </View>
        <Text style={styles.noteText}>{note}</Text>
      </View>
    </Surface>
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
  headerChipText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  reprintBadge: { position: 'absolute', top: 4, right: 2, backgroundColor: '#dc2626' },
  // recutMode wrap — header / form / footer doğal akışta yan yana, gap ile
  // birbirine yakın. paddingTop ekran üstünden nefes alır.
  recutWrap: { flex: 1, paddingTop: 6, gap: 10 },

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
  headerBoxValue: { fontSize: 20, fontWeight: '800', color: '#fff', lineHeight: 24 },
  headerBoxSub: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.82)',
    fontWeight: '700',
    letterSpacing: 0.3,
    marginTop: 1,
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
  defectGuideRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  defectGuideChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f1f5f9',
  },
  defectGuideChipCritical: {
    borderColor: '#fca5a5',
    backgroundColor: '#fef2f2',
  },
  defectGuideChipMeter: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  defectGuideChipLabel: {
    fontSize: 11,
    color: '#475569',
    maxWidth: 100,
  },
  defectGuideChipTextCritical: {
    color: '#b91c1c',
  },

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
  useRemainingBtn: { alignSelf: 'flex-start', marginTop: 2, marginBottom: 4 },
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

  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    padding: 10,
  },
  // Top Kesme footer'ı — beyaz card yok, sadece buton kendisi görünür
  recutFooter: { backgroundColor: 'transparent', padding: 10 },
  footerBtn: { borderRadius: 12 },
  // Kartela (küçük, ikincil) + Kes (büyük, asıl) yan yana.
  footerRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  kartelaCheckRow: { borderRadius: 10, marginBottom: 8 },
  kartelaCheckInner: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  kartelaCheckLabel: { fontSize: 14, fontWeight: '600', color: '#7c3aed' },
  footerBtnMain: { flex: 1, borderRadius: 12 },
  footerKartelaBtn: { borderRadius: 12, justifyContent: 'center' },
  footerKartelaContent: { height: 60 },
  footerKartelaLabel: { fontSize: 13, fontWeight: '700' },
  footerBtnContent: { height: 60 },
  footerBtnLabel: { fontSize: 17, fontWeight: '700' },

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
  compactActionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 6,
  },
  compactActionLabel: { fontSize: 12, fontWeight: '700' },

  // Sipariş kesim / tambur adım notu bandı (amber = talimat/dikkat).
  // Kesim notu + hata noktaları üst bilgi bandı — tablette yan yana, telefonda
  // alt alta. Hücreler eşit yükseklikte (stretch) ki amber/beyaz kutular hizalı.
  topInfoRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    marginBottom: 8,
  },
  topInfoStack: { gap: 8, marginBottom: 8 },
  topInfoCell: { flex: 1, marginBottom: 0 },
  topInfoStackItem: { marginBottom: 0 },

  notesBanner: {
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fde68a',
    padding: 8,
    marginBottom: 8,
  },
  noteCell: { flex: 1, gap: 1 },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  noteLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#b45309',
    letterSpacing: 0.3,
  },
  noteText: {
    fontSize: 13,
    color: '#0f172a',
    fontWeight: '600',
    lineHeight: 18,
  },

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
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0, padding: 0 },
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
