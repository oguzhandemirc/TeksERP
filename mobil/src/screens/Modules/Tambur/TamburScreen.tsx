import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  Keyboard,
} from 'react-native';
import RNModal from 'react-native-modal';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Surface,
  ActivityIndicator,
  TouchableRipple,
  Icon,
  Appbar,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import {
  useQuery,
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
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { LabelPrinter } from '../../../components/LabelPrinter';
import { tamburService } from '../../../services/tambur.service';
import {
  STATION_MUT,
  type TamburFinalizeOpenFabricVars,
} from '../../../offline/mutations';
import { useIsOnline, usePendingStationOps } from '../../../offline/hooks';
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
};
const EMPTY_WORK: RollWorkState = {
  decisions: {},
  foldType: null,
  voluntaryCuts: [],
  voluntaryEntry: EMPTY_VOLUNTARY_ENTRY,
  errorEntry: EMPTY_ERROR_ENTRY,
};

export default function TamburScreen() {
  // Telefon ekranında landscape kilidi kaldırılır + sağ panel drawer'a alınır.
  // Tabletlerde önceki davranış aynen korunur.
  const device = useDeviceType();
  const compact = device === 'phone';
  const manualBarcodeEntry = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  useLandscapeLock(!compact);
  const insets = useSafeAreaInsets();
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
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

  // Top Kesme — sağdaki "Top Kesme" butonu → top-level kamera modal → barkod
  // tara → sol panelde "WAREHOUSE topu modu" açılır. Normal Tambur cutOpenFabric
  // akışıyla yapısal olarak aynı: multi-cut + finalize. Her kesim child doğurur,
  // parent.currentQty düşer; Bitir → parent TAMBUR_CONSUMED (arşive).
  const [recutResolvedRollId, setRecutResolvedRollId] = useState<string | null>(null);
  const [recutRollMeta, setRecutRollMeta] = useState<{
    barcode: string | null;
    currentQty: number;
    item: string;
  } | null>(null);
  const [recutCutLength, setRecutCutLength] = useState('');
  const [recutQualityGrade, setRecutQualityGrade] = useState<string>('1.KALITE');
  const [recutScannerOpen, setRecutScannerOpen] = useState(false);
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
    }) =>
      tamburService.cutOpenFabric(data.rollId, {
        lengthMeters: data.lengthMeters,
        status: data.status,
        qualityGrade: data.qualityGrade,
      }),
    onSuccess: async (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Top oluşturuldu' });
      const data = res.data as { childRoll?: Roll } | undefined;
      if (data?.childRoll?.barcode) {
        // Hemen etiket basma modal'ını aç — operatör sayaç başında basar
        setPendingPrintRolls((prev) => [...prev, data.childRoll!]);
      }
      // Uzunluk input'unu sıfırla; kalite aynen kalsın (operatör çoğu zaman
      // aynı kaliteyi devam ettirir).
      setWork((w) => ({
        ...w,
        voluntaryEntry: { ...w.voluntaryEntry, length: '' },
      }));
      await refetchActiveJob();
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
        // Hâlâ top varsa sıradakini otomatik seç
        const next = remainingRolls.find(
          (r) => r.rollId !== activeJob.selectedRollId,
        );
        setOpenJobs((prev) =>
          prev.map((j) =>
            j.cardId === activeJob.cardId
              ? {
                  ...j,
                  stepSummary: step!,
                  selectedRollId: next?.rollId ?? null,
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
    }: {
      rollId: string;
      cutLength: number;
      qualityGrade: string;
    }) => tamburService.cutWarehouseRoll(rollId, { cutLength, qualityGrade }),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const data = res.data;
      if (data?.childRoll) {
        // Otomatik etiket basımı — LabelPrintModal pendingPrintRolls'ı dinler
        setPendingPrintRolls((prev) => [...prev, data.childRoll]);
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
      // Form reset — operatör hemen yeni kesim yapabilsin
      setRecutCutLength('');
      Toast.show({
        type: 'success',
        text1: 'Top oluşturuldu',
        text2: `Kalan: ${data?.parentRemainingQty.toFixed(1)} m`,
      });
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Kesim başarısız', text2: err.message });
    },
  });

  // Top Kesme — kartela üretimi (depo topundan, multi-cut akışı sırasında).
  // Backend createSwatch metraj düşürür; frontend recutRollMeta'yı local günceller.
  const recutSwatchMutation = useMutation({
    mutationFn: ({
      sourceRollId,
      length,
    }: {
      sourceRollId: string;
      length: number;
    }) =>
      tamburService.createSwatch({
        sourceRollId,
        length,
        count: 1,
        purpose: null,
        workOrderId: null,
      }),
    onSuccess: (_res, vars) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Kartela oluşturuldu' });
      if (recutRollMeta) {
        setRecutRollMeta({
          ...recutRollMeta,
          currentQty: Math.max(0, recutRollMeta.currentQty - vars.length),
        });
      }
      setRecutCutLength('');
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Kartela başarısız', text2: err.message });
    },
  });

  const handleRecutKartela = () => {
    if (!recutResolvedRollId || !recutRollMeta) return;
    const cut = parseFloat(recutCutLength);
    if (Number.isNaN(cut) || cut <= 0) {
      Toast.show({ type: 'error', text1: 'Uzunluk pozitif olmalı' });
      return;
    }
    if (cut > recutRollMeta.currentQty + 0.001) {
      Toast.show({
        type: 'error',
        text1: 'Kalan metrajı aşıyor',
        text2: `Kalan ${recutRollMeta.currentQty.toFixed(1)} mt`,
      });
      return;
    }
    recutSwatchMutation.mutate({
      sourceRollId: recutResolvedRollId,
      length: cut,
    });
  };

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

  const swatchMutation = useMutation({
    mutationFn: tamburService.createSwatch,
    onSuccess: async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Kartela oluşturuldu' });
      setWork((w) => ({
        ...w,
        voluntaryEntry: { ...w.voluntaryEntry, length: '' },
      }));
      await refetchActiveJob();
    },
    onError: (err: Error) =>
      Toast.show({ type: 'error', text1: 'Kartela oluşturulamadı', text2: err.message }),
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

  const addVoluntaryCut = () => {
    if (!selectedRoll) return;
    if (selectedRoll.barcode) {
      Toast.show({
        type: 'error',
        text1: 'Bu ekran açık kumaş için',
        text2: 'Barkodlu top için Yeniden Kes kullanın',
      });
      return;
    }
    const length = parseFloat(work.voluntaryEntry.length);
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
    });
  };

  // "Makineden Çek" — sayaç entegrasyonu yok; simülasyon olarak makul rastgele
  // bir değer üret. Kalan metraja göre clamp et.
  const fetchFromMachine = () => {
    if (!selectedRoll) return;
    const usedSoFar = work.voluntaryCuts.reduce((s, c) => s + c.length, 0);
    const remaining = Math.max(0, selectedRoll.currentQty - usedSoFar);
    if (remaining <= 0) {
      Toast.show({ type: 'info', text1: 'Kesim için kalan metraj yok' });
      return;
    }
    // 5–80 mt arası rastgele; kalan azsa kalana clamp
    const min = Math.min(5, remaining);
    const max = Math.min(80, remaining);
    const raw = min + Math.random() * (max - min);
    const simulated = Math.round(raw * 10) / 10; // 1 ondalık
    setWork((w) => ({
      ...w,
      voluntaryEntry: { ...w.voluntaryEntry, length: simulated.toString() },
    }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const removeVoluntaryCut = (id: string) => {
    setWork((w) => ({
      ...w,
      voluntaryCuts: w.voluntaryCuts.filter((c) => c.id !== id),
    }));
  };

  // Kartela: top kesimiyle aynı uzunluk input'u; tek kayıt, amaç/adet sorulmaz.
  const addKartela = () => {
    if (!activeJob || !selectedRoll) return;
    if (selectedRoll.barcode) {
      Toast.show({
        type: 'error',
        text1: 'Bu ekran açık kumaş için',
      });
      return;
    }
    const length = parseFloat(work.voluntaryEntry.length);
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
    swatchMutation.mutate({
      sourceRollId: selectedRoll.rollId,
      length,
      count: 1,
      purpose: null,
      workOrderId: activeJob.stepSummary.workOrderId,
    });
  };

  // Tamamla'ya basınca, kalan metre varsa operatöre 4 seçenekli modal sun.
  // Kalan = 0 ise modal yok, doğrudan kapat (action önemsiz — backend no-op).
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false);

  const handleFinalize = () => {
    if (!activeJob || !selectedRoll) return;
    if (selectedRoll.barcode) {
      Toast.show({
        type: 'error',
        text1: 'Bu ekran açık kumaş için',
      });
      return;
    }
    const remaining = selectedRoll.currentQty;
    if (remaining <= 0.001) {
      // Kalan yok → modal'a gerek yok, direkt kapat
      finalizeOpenFabricMutation.mutate({
        rollId: selectedRoll.rollId,
        remainingAction: 'discard',
        foldType: work.foldType ?? null,
      });
      return;
    }
    setFinalizeModalOpen(true);
  };

  const submitFinalize = (action: TamburFinalizeRemainingAction) => {
    if (!activeJob || !selectedRoll) return;
    setFinalizeModalOpen(false);
    finalizeOpenFabricMutation.mutate({
      rollId: selectedRoll.rollId,
      remainingAction: action,
      foldType: work.foldType ?? null,
    });
  };

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
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: 'Top sorgulanamadı',
        text2: (err as Error).message,
      });
    }
  };

  const handleRecutSubmit = () => {
    if (!recutResolvedRollId || !recutRollMeta) return;
    const cut = parseFloat(recutCutLength);
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
    });
  };

  const resetRecut = () => {
    // X kapat: kesim yapıldıysa parent etiketini otomatik basım kuyruğuna at —
    // operatör fiziksel etiketi söküp güncel metraj/barkodlu yenisini yapıştırır.
    if (recutLastParentRoll) {
      setPendingPrintRolls((prev) => [...prev, recutLastParentRoll]);
    }
    setRecutResolvedRollId(null);
    setRecutRollMeta(null);
    setRecutCutLength('');
    setRecutQualityGrade('1.KALITE');
    setRecutLastParentRoll(null);
  };

  const renderRightContent = () => (
    <>
      <View style={styles.cardInputWrap}>
        {manualBarcodeEntry ? (
          <>
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
          </>
        ) : (
          // Kamera-only mod: 4 aksiyon tek satırda büyük ikon olarak.
          // Input gizli olduğu için açılan alanı dokunma hedeflerini büyüterek değerlendiriyoruz.
          <View style={styles.actionsCompactRow}>
            <IconButton
              icon="format-list-bulleted"
              mode="contained-tonal"
              containerColor="#e2e8f0"
              iconColor="#0f172a"
              size={32}
              onPress={() => openList()}
              accessibilityLabel="Açık kartları listele"
              style={styles.compactActionBtn}
            />
            <IconButton
              icon="camera"
              mode="contained-tonal"
              containerColor="#dbeafe"
              iconColor="#1e40af"
              size={32}
              onPress={() => openScanner()}
              accessibilityLabel="Kamera ile refakat kartı tara"
              style={styles.compactActionBtn}
            />
            <IconButton
              icon="printer-search"
              mode="contained-tonal"
              containerColor="#e0f2fe"
              iconColor="#0369a1"
              size={32}
              onPress={() => openRecentOutput()}
              accessibilityLabel="Çıkan toplar"
              style={styles.compactActionBtn}
            />
            <IconButton
              icon="content-cut"
              mode="contained-tonal"
              containerColor="#fee2e2"
              iconColor="#b91c1c"
              size={32}
              onPress={() => openRecut()}
              accessibilityLabel="Top kesme"
              style={styles.compactActionBtn}
            />
          </View>
        )}
      </View>

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
      subtitle={compact ? undefined : 'Kesim kararı + final + depoya gönderim'}
      headerExtras={
        <View style={styles.headerExtrasRow}>
          <SyncStatusChip />
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
                  <Text style={styles.headerSub}>{recutRollMeta.item}</Text>
                </View>
                <View style={styles.remainingBadge}>
                  <Text style={styles.remainingBadgeValue}>
                    {recutRollMeta.currentQty.toFixed(1)}
                  </Text>
                  <Text style={styles.remainingBadgeLabel}>mt kalan</Text>
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

              {/* ScrollView'siz: form kısa, scroll gerekmez. Header, section ve
                  footer peş peşe yerleşir — gap ile birbirine yakın, bütünleşik. */}
              <Surface style={styles.section} elevation={1}>
                  <Text style={styles.sectionTitle}>Kesim</Text>
                  <Text style={styles.entryLabel}>Uzunluk (mt)</Text>
                  <NumpadInput
                    mode="outlined"
                    value={recutCutLength}
                    onChangeText={setRecutCutLength}
                    numpadLabel="Kesim uzunluğu"
                    allowDecimal
                    autoActivate
                    numpadMaxLength={8}
                    placeholder="örn: 60"
                    dense
                    style={styles.input}
                    useNativeKeyboard={compact}
                  />

                  <View style={styles.qualityActionRow}>
                    <View style={styles.qualityGridInline}>
                      {qualityGrades.map((qg) => {
                        const active = recutQualityGrade === qg.code;
                        return (
                          <TouchableRipple
                            key={qg.id}
                            borderless
                            onPress={() => setRecutQualityGrade(qg.code)}
                            style={[
                              styles.qualityChip,
                              active && styles.qualityChipActive,
                              active && qg.color
                                ? { backgroundColor: qg.color, borderColor: qg.color }
                                : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.qualityChipText,
                                active && styles.qualityChipTextActive,
                              ]}
                            >
                              {qg.name}
                            </Text>
                          </TouchableRipple>
                        );
                      })}
                    </View>
                    <View style={styles.createActionRow}>
                      <Button
                        mode="contained"
                        icon="plus-circle"
                        onPress={handleRecutSubmit}
                        buttonColor="#7c3aed"
                        compact
                        loading={cutWarehouseRollMutation.isPending}
                        disabled={
                          cutWarehouseRollMutation.isPending ||
                          recutSwatchMutation.isPending ||
                          !recutCutLength.trim() ||
                          parseFloat(recutCutLength) <= 0 ||
                          parseFloat(recutCutLength) > recutRollMeta.currentQty ||
                          !recutQualityGrade
                        }
                        style={styles.createTopBtn}
                      >
                        Top Oluştur
                      </Button>
                      <Button
                        mode="contained-tonal"
                        icon="content-copy"
                        onPress={handleRecutKartela}
                        compact
                        loading={recutSwatchMutation.isPending}
                        disabled={
                          cutWarehouseRollMutation.isPending ||
                          recutSwatchMutation.isPending ||
                          !recutCutLength.trim() ||
                          parseFloat(recutCutLength) <= 0 ||
                          parseFloat(recutCutLength) > recutRollMeta.currentQty
                        }
                        style={styles.createTopBtn}
                      >
                        Kartela Oluştur
                      </Button>
                    </View>
                  </View>
                </Surface>

              {/* Footer — Top Kesme bitir; kalan varsa karar modal, yoksa
                  direkt arşivle (discard, kayıp 0). Beyaz card kaldırıldı —
                  sadece buton görünür. */}
              <Surface style={styles.recutFooter} elevation={0}>
                <Button
                  mode="contained"
                  icon="archive"
                  onPress={() => {
                    if (recutRollMeta.currentQty <= 0.001) {
                      // Kalan yok — modal'a gerek yok, direkt parent'ı arşivle
                      finalizeWarehouseCutMutation.mutate({
                        rollId: recutResolvedRollId,
                        remainingAction: 'discard',
                      });
                    } else {
                      setRecutFinalizeOpen(true);
                    }
                  }}
                  buttonColor="#1e40af"
                  style={styles.footerBtn}
                  contentStyle={styles.footerBtnContent}
                  labelStyle={styles.footerBtnLabel}
                  loading={finalizeWarehouseCutMutation.isPending}
                  disabled={
                    cutWarehouseRollMutation.isPending ||
                    finalizeWarehouseCutMutation.isPending
                  }
                >
                  {recutRollMeta.currentQty > 0.001
                    ? `Bitir (Kalan ${recutRollMeta.currentQty.toFixed(1)}m için seç)`
                    : 'Bitir ve Arşivle'}
                </Button>
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
                  {/* Planlanan foldType / layerCount info chip */}
                  {activeJob?.context &&
                    (activeJob.context.plannedFoldType ||
                      activeJob.context.plannedLayerCount != null) && (
                      <View style={styles.plannedChip}>
                        <Icon source="information-outline" size={11} color="#cbd5e1" />
                        <Text style={styles.plannedChipText}>
                          Planlanan:{' '}
                          {activeJob.context.plannedFoldType ?? '—'}
                          {activeJob.context.plannedLayerCount != null
                            ? ` · ${activeJob.context.plannedLayerCount} katman`
                            : ''}
                        </Text>
                      </View>
                    )}
                </View>

                {/* Kalan metre rozeti — sürekli görünür, operatörün ana ölçeği */}
                <View
                  style={[
                    styles.remainingBadge,
                    (segmentPreview?.remaining ?? 0) <= 0.001 &&
                      styles.remainingBadgeDanger,
                  ]}
                >
                  <Text style={styles.remainingBadgeValue}>
                    {(segmentPreview?.remaining ?? selectedRoll.currentQty).toFixed(1)}
                  </Text>
                  <Text style={styles.remainingBadgeLabel}>
                    mt kalan
                  </Text>
                  <Text style={styles.remainingBadgeMeta}>
                    / {selectedRoll.currentQty.toFixed(1)} giriş
                  </Text>
                </View>

                {/* Siparişler butonu — operatör tıklayınca modal'da görür */}
                {activeJob?.context?.orders &&
                  activeJob.context.orders.length > 0 && (
                    <TouchableRipple
                      onPress={() => setOrdersModalOpen(true)}
                      borderless
                      style={styles.ordersHeaderBtn}
                    >
                      <View style={styles.ordersHeaderBtnInner}>
                        <Icon source="clipboard-list-outline" size={20} color="#fff" />
                        <Text style={styles.ordersHeaderBtnLabel}>
                          {activeJob.context.orders.length}
                        </Text>
                        <Text style={styles.ordersHeaderBtnSub}>sipariş</Text>
                      </View>
                    </TouchableRipple>
                  )}
              </Surface>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {/* Hata noktaları — sadece referans, kompakt yan yana chip'ler */}
                <Surface style={styles.defectGuideSection} elevation={1}>
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

                {/* Kesim — operatör fiziksel kesim yapar, anında sisteme girer.
                    Her "Top Oluştur" tıklaması child Roll oluşturur + etiket basar. */}
                <Surface style={styles.section} elevation={1}>
                  <Text style={styles.sectionTitle}>Kesim</Text>

                  <Text style={styles.entryLabel}>Uzunluk (mt)</Text>
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
                        placeholder="örn: 60"
                        dense
                        style={styles.input}
                        useNativeKeyboard={compact}
                      />
                    </View>
                    <IconButton
                      icon="counter"
                      mode="contained-tonal"
                      size={24}
                      iconColor="#7c3aed"
                      containerColor="#ede9fe"
                      onPress={fetchFromMachine}
                      accessibilityLabel="Makineden çek (simülasyon)"
                      style={{ margin: 0 }}
                    />
                  </View>

                  <View style={styles.qualityActionRow}>
                    <View style={styles.qualityGridInline}>
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
                              styles.qualityChip,
                              active && styles.qualityChipActive,
                              active && qg.color
                                ? { backgroundColor: qg.color, borderColor: qg.color }
                                : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.qualityChipText,
                                active && styles.qualityChipTextActive,
                              ]}
                            >
                              {qg.name}
                            </Text>
                          </TouchableRipple>
                        );
                      })}
                    </View>
                    <View style={styles.createActionRow}>
                      <Button
                        mode="contained"
                        icon="plus-circle"
                        onPress={addVoluntaryCut}
                        buttonColor="#7c3aed"
                        compact
                        loading={cutOpenFabricMutation.isPending}
                        disabled={
                          cutOpenFabricMutation.isPending ||
                          !work.voluntaryEntry.length ||
                          !work.voluntaryEntry.qualityGrade
                        }
                        style={styles.createTopBtn}
                      >
                        Top Oluştur
                      </Button>
                      <Button
                        mode="contained-tonal"
                        icon="content-copy"
                        onPress={addKartela}
                        compact
                        loading={swatchMutation.isPending}
                        disabled={
                          swatchMutation.isPending ||
                          !work.voluntaryEntry.length
                        }
                        style={styles.createTopBtn}
                      >
                        Kartela Oluştur
                      </Button>
                    </View>
                  </View>
                </Surface>

                {/* Katlama */}
                <Surface style={styles.section} elevation={1}>
                  <Text style={styles.sectionTitle}>Katlama</Text>
                  <View style={styles.foldRow}>
                    {(['2-KAT', '4-KAT'] as TamburFoldType[]).map((ft) => {
                      const active = work.foldType === ft;
                      return (
                        <TouchableRipple
                          key={ft}
                          borderless
                          onPress={() =>
                            setWork((w) => ({ ...w, foldType: active ? null : ft }))
                          }
                          style={[
                            styles.foldChip,
                            active && styles.foldChipActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.foldChipText,
                              active && styles.foldChipTextActive,
                            ]}
                          >
                            {ft === '2-KAT' ? 'Çift Kat' : '4 Kat'}
                          </Text>
                        </TouchableRipple>
                      );
                    })}
                  </View>
                </Surface>

              </ScrollView>

              {/* Sticky footer — açık kumaş bitirme. Kalan varsa fire işaretlenir.
                  OFFLINE-AWARE: loading/disabled binding'i YOK — mutation hook'un
                  global isPending'i paused mutation'larda true kalır ve sıradaki
                  rulayı engelleyebilir. Optimistic update rulayı listeden zaten
                  düşürdüğü için double-press riski yok. */}
              <Surface style={styles.footer} elevation={4}>
                <Button
                  mode="contained"
                  icon="warehouse"
                  onPress={handleFinalize}
                  buttonColor="#1e40af"
                  style={styles.footerBtn}
                  contentStyle={styles.footerBtnContent}
                  labelStyle={styles.footerBtnLabel}
                >
                  {selectedRoll.currentQty > 0.001
                    ? `Tamamla (Kalan ${selectedRoll.currentQty.toFixed(1)}m için seç)`
                    : 'Tamamla'}
                </Button>
              </Surface>
            </>
          )}

        </View>

        {/* ════════ SAĞ: card scan + tab + roll list + numpad ════════ */}
        {!compact && (
          <View style={styles.rightCol}>
            {renderRightContent()}
            <NumpadHost style={styles.numpadHost} />
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
        onPrint={(roll) => setActivePrintRoll(roll)}
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
        onPrint={(roll) => setActivePrintRoll(roll)}
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
        onDone={() => setActivePrintRoll(null)}
      />

      <FinalizeRemainingModal
        visible={finalizeModalOpen}
        remainingQty={selectedRoll?.currentQty ?? 0}
        onDismiss={() => setFinalizeModalOpen(false)}
        onChoose={submitFinalize}
        loading={false}
      />

    </ScreenChrome>
  );
}

// Çevrimdışı / sync bekleyen istasyon işlemi rozeti (KursunQc'deki ile aynı).
function SyncStatusChip() {
  const online = useIsOnline();
  const pending = usePendingStationOps();
  const pendingCount = pending.length;
  if (online && pendingCount === 0) return null;
  let bg = '#1e40af';
  let label = `${pendingCount} sync`;
  if (!online && pendingCount === 0) {
    bg = '#b45309';
    label = 'Çevrimdışı';
  } else if (!online && pendingCount > 0) {
    bg = '#b91c1c';
    label = `Çevrimdışı · ${pendingCount}`;
  }
  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        marginRight: 8,
      }}
    >
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
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
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
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
  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.55}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
      style={ordersModalStyles.modal}
    >
      <View
        style={[
          ordersModalStyles.sheet,
          { width: winW * 0.7, maxHeight: winH * 0.85 },
        ]}
      >
        <View style={ordersModalStyles.header}>
          <Icon source="clipboard-list-outline" size={22} color="#7c3aed" />
          <Text variant="titleMedium" style={ordersModalStyles.title}>
            İş Emri Siparişleri ({orders.length})
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          {orders.length === 0 ? (
            <Text style={ordersModalStyles.empty}>
              Bu iş emrine bağlı sipariş yok (stok üretimi).
            </Text>
          ) : (
            orders.map((o) => (
              <Surface
                key={o.orderId}
                style={ordersModalStyles.orderCard}
                elevation={1}
              >
                <Text style={ordersModalStyles.orderHeader}>
                  {o.customerName} · {o.orderNumber}
                </Text>
                {o.lines.map((line) => {
                  const remaining = Math.max(0, line.orderedQty - line.shippedQty);
                  return (
                    <View key={line.lineId} style={ordersModalStyles.lineRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={ordersModalStyles.lineItem}>
                          {line.itemName}
                          {line.colorName ? ` · ${line.colorName}` : ''}
                        </Text>
                        <Text style={ordersModalStyles.lineMeta}>
                          Sipariş: {line.orderedQty.toFixed(1)} mt
                          {line.width != null && ` · En: ${line.width} cm`}
                        </Text>
                        {line.requiredProperties.length > 0 && (
                          <View style={ordersModalStyles.linePropRow}>
                            {line.requiredProperties.map((p) => (
                              <View
                                key={p.id}
                                style={ordersModalStyles.linePropChip}
                              >
                                <Text style={ordersModalStyles.linePropChipText}>
                                  {p.name}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                      <View style={ordersModalStyles.lineRemaining}>
                        <Text style={ordersModalStyles.lineRemainingValue}>
                          {remaining.toFixed(1)}
                        </Text>
                        <Text style={ordersModalStyles.lineRemainingLabel}>
                          mt kalan
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </Surface>
            ))
          )}
        </ScrollView>
      </View>
    </RNModal>
  );
}

const ordersModalStyles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0 },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: { fontWeight: '700', color: '#0f172a' },
  empty: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 13,
    fontStyle: 'italic',
    padding: 24,
  },
  orderCard: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  orderHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  lineItem: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
  },
  lineMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  linePropRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  linePropChip: {
    backgroundColor: '#ede9fe',
    borderColor: '#c4b5fd',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  linePropChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#5b21b6',
  },
  lineRemaining: {
    alignItems: 'center',
    minWidth: 70,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#7c3aed',
  },
  lineRemainingValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 18,
  },
  lineRemainingLabel: {
    fontSize: 10,
    color: '#ede9fe',
    fontWeight: '600',
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
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
    >
      <View style={[cameraStyles.sheet, { width: sheetWidth, height: winH * 0.8 }]}>
        <View style={cameraStyles.header}>
          <Icon source="format-list-bulleted" size={22} color="#0f172a" />
          <Text variant="titleMedium" style={cameraStyles.title}>
            Açık Kartlar
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>
        <View style={cameraStyles.hint}>
          <Icon source="information-outline" size={14} color="#475569" />
          <Text style={cameraStyles.hintText}>
            Refakat kartı yoksa Tambur'da açık top bekleyen kartlardan birini seçin.
          </Text>
        </View>
        <View style={cameraStyles.listBox}>
          {loading ? (
            <View style={cameraStyles.empty}>
              <ActivityIndicator size="large" color="#1e40af" />
            </View>
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
                      <View style={{ flex: 1 }}>
                        <Text style={cameraStyles.rowBatch}>{item.batchNumber}</Text>
                        <View style={cameraStyles.rowMeta}>
                          <Icon source="card-account-details" size={12} color="#475569" />
                          <Text style={cameraStyles.rowMetaText} numberOfLines={1}>
                            {item.cardNumber}
                          </Text>
                        </View>
                        <View style={cameraStyles.rowMeta}>
                          <Icon source="map-marker-path" size={12} color="#475569" />
                          <Text style={cameraStyles.rowMetaText} numberOfLines={1}>
                            {item.stationName}
                          </Text>
                        </View>
                        <View style={cameraStyles.rowFooter}>
                          <Text style={cameraStyles.rowQty}>
                            {item.openRollCount} top bekliyor
                          </Text>
                        </View>
                      </View>
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
  return (
    <Surface
      style={[
        helperStyles.rollItem,
        selected && helperStyles.rollItemSelected,
      ]}
      elevation={selected ? 2 : 1}
    >
      <TouchableRipple borderless onPress={onPress} style={helperStyles.rollTouch}>
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
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
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

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  body: { flex: 1, flexDirection: 'row', backgroundColor: '#f8fafc', position: 'relative' },
  headerExtrasRow: { flexDirection: 'row', alignItems: 'center' },
  // recutMode wrap — header / form / footer doğal akışta yan yana, gap ile
  // birbirine yakın. paddingTop ekran üstünden nefes alır.
  recutWrap: { flex: 1, paddingTop: 24, gap: 12 },

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

  // Kesim — uzunluk input + Makineden Çek ikonu
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
  // Kamera-only mod: 4 aksiyon tek satırda. justifyContent space-around
  // → ikonlar eşit aralıklı, dokunma hedefi 48dp+ contained-tonal sayesinde.
  actionsCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 4,
  },
  compactActionBtn: { margin: 0 },

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
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  hintText: { fontSize: 12, color: '#475569', flex: 1 },
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
  rowBatch: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  rowMetaText: { fontSize: 12, color: '#475569', fontWeight: '500', flex: 1 },
  rowFooter: { marginTop: 6 },
  rowQty: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
});
