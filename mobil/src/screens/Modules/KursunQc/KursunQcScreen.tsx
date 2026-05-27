import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
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
} from 'react-native-paper';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
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
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { useDrawerActionQueue } from '../../../hooks/useDrawerActionQueue';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import RefreshButton from '../../../components/RefreshButton';
import NumpadInput from '../../../components/NumpadInput';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { NumpadHost } from '../../../components/NumpadProvider';
import { RightPanelDrawer } from '../../../components/RightPanelDrawer';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import {
  kursunQcService,
  type CompleteQc2Request,
} from '../../../services/kursunQc.service';
import { defectTypeService } from '../../../services/defectType.service';
import { rollService } from '../../../services/roll.service';
import { STATION_MUT } from '../../../offline/mutations';
import { useIsOnline, usePendingStationOps } from '../../../offline/hooks';
import type {
  KursunStepSummary,
  KursunRollSummary,
  KursunOpenCard,
  DefectType,
} from '../../../types/models';

// =============================================================================
// Multi-job state — operatör birden fazla refakat kartını paralel açabilir.
// Acil iş gelirse mevcut kart kuyruğa alınır, yeni kart başlatılır;
// sonra eski karta sekmeyle dönülür. Job state'i tamamen client-side tutulur;
// her aksiyon sonrası backend re-fetch ile senkronlanır.
// =============================================================================

interface OpenJob {
  cardId: string;
  cardNumber: string;
  cardBarcode: string; // refresh için
  stepSummary: KursunStepSummary;
  selectedRollId: string | null;
}

// Hata giriş alanı sürekli açık — yeni-hata butonu yok.
// rollId tutmuyoruz: top değişimi state'i sıfırlar, "yanlış topa yazılmış"
// senaryosu olamaz.
//
// Yeni model: hata aralık değil NOKTA. Operatör yalnız "kaç. metrede hata
// başladı" girer; bitiş Tambur'da kesim kararıyla belirlenir.
interface ErrorEntryState {
  defectTypeId: string;
  startMeter: string;
}

const EMPTY_ERROR_ENTRY: ErrorEntryState = {
  defectTypeId: '',
  startMeter: '',
};

/** Açık kart listesinin otomatik yenileme aralığı (modal başlığında gösterilir). */
const OPEN_CARDS_REFETCH_MS = 15 * 1000;

export default function KursunQcScreen() {
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
  const [errorEntry, setErrorEntry] = useState<ErrorEntryState>(EMPTY_ERROR_ENTRY);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  /** Refactor 4 — "yanlış istasyon" / kart bulunamadı backend mesajı banner. */
  const [cardError, setCardError] = useState<string | null>(null);

  // Açık kart listesi — modal açılmadan da (acil rozeti için) tazelenir.
  // OPEN_CARDS_REFETCH_MS polling: planlama acil işaretlediğinde tablet en geç
  // o sürede görür. Aynı sabit modal başlığında operatöre gösterilir.
  const openCardsQuery = useQuery({
    queryKey: ['kursun-qc', 'open-cards'],
    queryFn: () => kursunQcService.listOpenCards(),
    staleTime: 10 * 1000,
    refetchInterval: OPEN_CARDS_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
  const urgentCount = useMemo(
    () => (openCardsQuery.data?.data ?? []).filter((c) => c.isUrgent).length,
    [openCardsQuery.data],
  );

  // Yeni acil iş geldiğinde operatörü uyar (toast + haptic).
  // İlk render'da (prev=undefined) sessiz: zaten badge görünür. Sadece artış
  // anında "yeni acil var" bildirimi at — düşüşte (operatör bitirdiği için
  // azaldı) bildirim yok.
  const prevUrgentRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevUrgentRef.current;
    prevUrgentRef.current = urgentCount;
    if (prev === null) return; // ilk yükleme
    if (urgentCount > prev) {
      const diff = urgentCount - prev;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Toast.show({
        type: 'error',
        text1: diff === 1 ? 'Yeni acil iş geldi' : `${diff} yeni acil iş geldi`,
        text2: 'Açık Kartlar listesinden kontrol et.',
        visibilityTime: 5000,
      });
    }
  }, [urgentCount]);

  // Modal her açıldığında listeyi tazele: planlama acil işaretlediyse veya
  // sırayı değiştirdiyse operatör güncel sırayı görsün (badge zaten polling
  // yapıyor, ama liste açıldı = "operatör şu an karar verecek" → fresh data).
  useRefetchOnOpen(openCardsQuery.refetch, listModalOpen);

  // Compact'ta aktif kart değiştiğinde (yeni kart çözüldü / tab değişti) drawer
  // kapanır — operatör sol form alanını görsün.
  useEffect(() => {
    if (compact && activeCardId) setRightDrawerOpen(false);
  }, [compact, activeCardId]);

  // Defect type kataloğu — uygulama hayat boyu cache'lenebilir.
  const defectTypesQuery = useQuery({
    queryKey: ['defect-types', 'active'],
    queryFn: () => defectTypeService.list({ pageSize: 100 }),
    staleTime: 10 * 60 * 1000, // 10 dk: katalog nadir değişir
  });
  const defectTypes = defectTypesQuery.data?.data ?? [];

  // Aktif iş ve seçili top
  const activeJob = useMemo(
    () => openJobs.find((j) => j.cardId === activeCardId) ?? null,
    [openJobs, activeCardId]
  );
  const selectedRoll = useMemo(() => {
    if (!activeJob || !activeJob.selectedRollId) return null;
    return (
      activeJob.stepSummary.rolls.find(
        (r) => r.rollId === activeJob.selectedRollId
      ) ?? null
    );
  }, [activeJob]);

  // ── Backend re-fetch helper ────────────────────────────────────────────────
  const refetchActiveJob = async () => {
    if (!activeJob) return;
    const res = await kursunQcService.getStep(activeJob.stepSummary.workOrderStepId);
    const step = res.data as KursunStepSummary | undefined;
    if (!step) return;
    setOpenJobs((prev) =>
      prev.map((j) => (j.cardId === activeJob.cardId ? { ...j, stepSummary: step } : j))
    );
  };

  // ── Kart çözümleme ─────────────────────────────────────────────────────────
  // Barkod parametreli ortak çözüm — input + kamera modalı bunu paylaşır.
  const resolveCard = async (barcode: string, fromInput: boolean) => {
    if (!barcode) return;

    // Aynı kart zaten açıksa o sekmeye geç
    const existing = openJobs.find((j) => j.cardBarcode === barcode);
    if (existing) {
      setActiveCardId(existing.cardId);
      if (fromInput) setCardBarcode('');
      Toast.show({
        type: 'info',
        text1: 'Kart zaten açık',
        text2: existing.cardNumber,
      });
      return;
    }

    setResolvingCard(true);
    setCardError(null);
    try {
      // Refactor 4 — backend artık yanlış istasyonda 400 atıyor:
      //   "Bu iş emrinin 'Kurşun + KK2' adımında şu an açık top yok.
      //    Mevcut konum: Boyahane (4 rulo)."
      // Mesaj catch block'unda banner'a yansıtılır.
      let res = await kursunQcService.getByCardBarcode(barcode);
      let step = res.data as KursunStepSummary | undefined;
      if (!step) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setCardError(`Kart bulunamadı: ${barcode}`);
        Toast.show({ type: 'error', text1: 'Kart bulunamadı', text2: barcode });
        return;
      }

      // Adım yanlışlıkla kapatılmışsa otomatik yeniden aç (dev aşaması — uyarıyla).
      let reopened = false;
      if (step.status === 'COMPLETED') {
        try {
          await kursunQcService.reopenStep({ stepId: step.workOrderStepId });
          reopened = true;
          res = await kursunQcService.getStep(step.workOrderStepId);
          step = res.data as KursunStepSummary;
        } catch (err) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Toast.show({
            type: 'error',
            text1: 'Adım yeniden açılamadı',
            text2: (err as Error).message,
          });
          return;
        }
      }

      const newJob: OpenJob = {
        cardId: barcode, // unique key — barkod yeterli
        cardNumber: step.batchNumber, // gösterilen etiket; cardNumber ayrı API'de yok
        cardBarcode: barcode,
        stepSummary: step,
        selectedRollId: null,
      };
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOpenJobs((prev) => [...prev, newJob]);
      setActiveCardId(newJob.cardId);
      if (fromInput) setCardBarcode('');
      if (reopened) {
        Toast.show({
          type: 'info',
          text1: 'DİKKAT: Adım yeniden açıldı',
          text2: `Bu adım daha önce kapatılmış. ${step.rolls.length} top geri çekildi.`,
        });
      } else {
        Toast.show({
          type: 'success',
          text1: 'Kart açıldı',
          text2: `${step.batchNumber} · ${step.rolls.length} top`,
        });
      }
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setCardError((err as Error).message);
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

  const handleCameraSelect = (card: KursunOpenCard) => {
    setListModalOpen(false);
    resolveCard(card.cardBarcode, false);
  };

  const handleScannerResult = (data: string) => {
    setScannerOpen(false);
    resolveCard(data.trim(), false);
  };

  const closeJob = (cardId: string) => {
    const job = openJobs.find((j) => j.cardId === cardId);
    if (!job) return;
    const unfinished = job.stepSummary.rolls.filter((r) => !r.qc2Completed).length;
    if (unfinished > 0) {
      Toast.show({
        type: 'info',
        text1: 'Sekme kapatıldı',
        text2: `${unfinished} top yarım kaldı — sonra tekrar kart okutabilirsin.`,
      });
    }
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
    // Top değişince hata giriş alanı temizlenir — yanlış topa yanlışlıkla
    // hata yazılmasın.
    setErrorEntry(EMPTY_ERROR_ENTRY);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Compact'ta top seçilince drawer kapanır — operatör sol form'da çalışsın.
    if (compact) setRightDrawerOpen(false);
  };

  // ── Mutations ──────────────────────────────────────────────────────────────
  // Per-roll "Kurşun geçtim/geçmedim" toggle'ı yok — istasyon yeteneği tek
  // doğruluk kaynağı. İstasyona KURSUN özelliği atanmışsa, QC2 tamamlanan
  // her top otomatik kurşunlanır (backend completeQc2 / kursunFinish).
  //
  // OFFLINE-FIRST: mutationFn `setMutationDefaults`'ta tanımlı; persist sonrası
  // app restart'ında resolve edilir. onMutate'te optimistic update + sonraki
  // top'a geçiş anında yapılır (network bekleme yok). onError'da rollback.
  // Network yoksa mutation 'paused' kalır, online dönünce otomatik resume +
  // backend zaten upsert ile idempotent (schema.prisma RollOperation @@unique).
  const completeQc2Mutation = useMutation<
    Awaited<ReturnType<typeof kursunQcService.completeQc2>>,
    Error,
    CompleteQc2Request,
    { cardId: string; prevRolls: KursunRollSummary[]; prevSelectedRollId: string | null } | undefined
  >({
    mutationKey: STATION_MUT.QC2_COMPLETE,
    onMutate: (vars) => {
      if (!activeJob) return undefined;
      const cardId = activeJob.cardId;
      const prevRolls = activeJob.stepSummary.rolls;
      const prevSelectedRollId = activeJob.selectedRollId;

      const updatedRolls = prevRolls.map((r) =>
        r.rollId === vars.rollId ? { ...r, qc2Completed: true } : r,
      );
      const next = updatedRolls.find(
        (r) => !r.qc2Completed && r.rollId !== vars.rollId,
      );

      setOpenJobs((prev) =>
        prev.map((j) =>
          j.cardId === cardId
            ? {
                ...j,
                stepSummary: { ...j.stepSummary, rolls: updatedRolls },
                selectedRollId: next?.rollId ?? null,
              }
            : j,
        ),
      );

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'QC2 işaretlendi',
        text2: onlineManager.isOnline() ? undefined : 'Çevrimdışı — sync bekliyor',
      });

      return { cardId, prevRolls, prevSelectedRollId };
    },
    onSuccess: async () => {
      // Server confirm geldi — backend'den fresh state çek (open jobs listesi
      // de değişmiş olabilir: step kapanma, başka kart silinmesi vb.).
      await refetchActiveJob();
      qc.invalidateQueries({ queryKey: ['kursun-qc', 'open-cards'] });
    },
    onError: (err, vars, context) => {
      // 4xx (örn. WO iptal) veya net 5xx — optimistic update'i geri al.
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
      Toast.show({ type: 'error', text1: 'QC2 başarısız', text2: err.message });
    },
  });

  const undoQc2Mutation = useMutation({
    mutationFn: kursunQcService.undoQc2,
    onSuccess: async () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Toast.show({ type: 'info', text1: 'QC2 işareti kaldırıldı' });
      await refetchActiveJob();
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Geri alınamadı', text2: err.message });
    },
  });

  const reportErrorMutation = useMutation({
    mutationFn: kursunQcService.reportError,
    onSuccess: async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Hata kaydedildi' });
      // Aynı türden ardışık hata girişi için defectTypeId korunur, sadece
      // metraj alanı temizlenir.
      setErrorEntry((prev) => ({ ...prev, startMeter: '' }));
      await refetchActiveJob();
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Hata kaydedilemedi', text2: err.message });
    },
  });

  const deleteErrorMutation = useMutation({
    mutationFn: kursunQcService.deleteError,
    onSuccess: async () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await refetchActiveJob();
    },
    onError: (err: Error) =>
      Toast.show({ type: 'error', text1: 'Silinemedi', text2: err.message }),
  });

  // Açık kumaşı Tambur'a iletir. Metre fason kabulden gelen değer, hatalar
  // operatörün "Hata Ekle" ile eklediği kayıtlar — bu çağrı sadece roll'u
  // ilerletir + Kurşun/QC2 operation log'larını yazar.
  //
  // OFFLINE-FIRST: mutationFn registry'de (STATION_MUT.KURSUN_FINISH). Backend
  // idempotent: priorFinish check + RollOperation skipDuplicates. onMutate'te
  // optimistic — rulo listeden düşer, bir sonraki otomatik seçilir; onError'da
  // tam rollback. Sync sırasında çakışma çıkarsa rollback toast'la görünür.
  const kursunFinishMutation = useMutation<
    Awaited<ReturnType<typeof rollService.kursunFinish>>,
    Error,
    string,
    { cardId: string; prevRolls: KursunRollSummary[]; prevSelectedRollId: string | null } | undefined
  >({
    mutationKey: STATION_MUT.KURSUN_FINISH,
    onMutate: (rollId) => {
      if (!activeJob) return undefined;
      const cardId = activeJob.cardId;
      const prevRolls = activeJob.stepSummary.rolls;
      const prevSelectedRollId = activeJob.selectedRollId;

      const updatedRolls = prevRolls.filter((r) => r.rollId !== rollId);
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
        text1: 'Kumaş bitirildi',
        text2: onlineManager.isOnline()
          ? "Tambur'a iletildi"
          : 'Çevrimdışı — sync bekliyor',
      });

      return { cardId, prevRolls, prevSelectedRollId };
    },
    onSuccess: async (_res, finishedRollId) => {
      // Server confirm — fresh step state çek (kalan rulolar, kart kapatma).
      if (!activeJob) return;
      const res = await kursunQcService.getStep(
        activeJob.stepSummary.workOrderStepId,
      );
      const step = res.data as KursunStepSummary | undefined;
      const remainingRolls = step?.rolls ?? [];
      if (remainingRolls.length === 0) {
        setOpenJobs((prev) => {
          const next = prev.filter((j) => j.cardId !== activeJob.cardId);
          setActiveCardId(next[0]?.cardId ?? null);
          return next;
        });
        qc.invalidateQueries({ queryKey: ['rolls'] });
        return;
      }
      const next = remainingRolls.find((r) => r.rollId !== finishedRollId);
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
      qc.invalidateQueries({ queryKey: ['rolls'] });
    },
    onError: (err, _rollId, context) => {
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
      Toast.show({ type: 'error', text1: 'Kumaş bitirilemedi', text2: err.message });
    },
  });

  const finishStepMutation = useMutation({
    mutationFn: kursunQcService.finishStep,
    onSuccess: async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Adım kapatıldı',
        text2: 'Toplar Tambur\'a taşındı',
      });
      if (activeCardId) {
        const remaining = openJobs.filter((j) => j.cardId !== activeCardId);
        setOpenJobs(remaining);
        setActiveCardId(remaining[0]?.cardId ?? null);
      }
      qc.invalidateQueries({ queryKey: ['rolls'] });
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Adım kapatılamadı', text2: err.message });
    },
  });

  // ── Handler shortcuts ──────────────────────────────────────────────────────
  const handleCompleteQc2 = () => {
    if (!activeJob || !selectedRoll) return;
    completeQc2Mutation.mutate({
      rollId: selectedRoll.rollId,
      stepId: activeJob.stepSummary.workOrderStepId,
    });
  };

  const handleUndoQc2 = () => {
    if (!activeJob || !selectedRoll) return;
    undoQc2Mutation.mutate({
      rollId: selectedRoll.rollId,
      stepId: activeJob.stepSummary.workOrderStepId,
    });
  };

  const handleAddError = () => {
    if (!activeJob || !selectedRoll) return;
    const start = parseFloat(errorEntry.startMeter);
    if (!Number.isFinite(start) || start < 0) {
      Toast.show({ type: 'error', text1: 'Metraj sayı olmalı' });
      return;
    }
    // Hata tipi seçilmemişse listenin ilkini kullan (admin tarafından "default"
    // olarak eklenmesi beklenen kayıt). Liste boşsa kullanıcıya hata göster.
    const defectTypeId = errorEntry.defectTypeId || defectTypes[0]?.id;
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

  const handleDeleteError = (errorId: string) => {
    deleteErrorMutation.mutate({ errorId });
  };

  const handleFinishStep = () => {
    if (!activeJob) return;
    finishStepMutation.mutate({ stepId: activeJob.stepSummary.workOrderStepId });
  };

  // Card scan input event'lerinde defect-types boş ise ön-yükle (network bekletme)
  useEffect(() => {
    if (!defectTypesQuery.data && !defectTypesQuery.isFetching) {
      defectTypesQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  const allQc2Done =
    activeJob &&
    activeJob.stepSummary.rolls.length > 0 &&
    activeJob.stepSummary.rolls.every((r) => r.qc2Completed);

  // Sağ panel içeriği — hem inline rightCol'da (tablet) hem RightDrawer'da
  // (telefon compact) aynı kullanılır. NumpadHost ayrı render edilir; compact'ta
  // native klavye kullanıldığı için drawer içinde NumpadHost yoktur.
  const renderRightContent = () => (
    <>
      {/* Kart input + kamera */}
      <View style={styles.cardInputWrap}>
        <ScannerEntryBar
          value={cardBarcode}
          onChangeText={setCardBarcode}
          placeholder="Refakat kartı barkodu okut/yaz..."
          onResolve={handleResolveCard}
          resolving={resolvingCard}
          onScan={() => drawerQueue.run(() => setScannerOpen(true))}
          onList={() => drawerQueue.run(() => setListModalOpen(true))}
          tone="green"
          listContainerColor={urgentCount > 0 ? '#fee2e2' : undefined}
          listIconColor={urgentCount > 0 ? '#b91c1c' : undefined}
          listBadge={<UrgentBadge count={urgentCount} />}
        />
      </View>

      {cardError && (
        <Surface style={styles.errorBanner} elevation={1}>
          <Icon source="alert-circle" size={20} color="#b91c1c" />
          <View style={{ flex: 1 }}>
            <Text style={styles.errorBannerTitle}>Yanlış istasyon</Text>
            <Text style={styles.errorBannerText}>{cardError}</Text>
          </View>
          <IconButton
            icon="close"
            size={18}
            onPress={() => setCardError(null)}
            accessibilityLabel="Hata mesajını kapat"
            style={{ margin: 0 }}
          />
        </Surface>
      )}

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
          <Text style={styles.paneEmptyHint}>
            Yukarıdan kart okutarak başlayın
          </Text>
        </View>
      ) : activeJob.stepSummary.rolls.length === 0 ? (
        <View style={styles.paneEmpty}>
          <Text style={styles.paneEmptyText}>Bu adımda bekleyen top yok</Text>
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

      {activeJob && activeJob.stepSummary.rolls.length > 0 && (
        <Surface style={styles.finishWrap} elevation={3}>
          <Button
            mode="contained"
            icon="flag-checkered"
            onPress={handleFinishStep}
            disabled={!allQc2Done || finishStepMutation.isPending}
            loading={finishStepMutation.isPending}
            buttonColor="#1e40af"
            style={styles.finishBtn}
            contentStyle={styles.finishBtnContent}
          >
            {allQc2Done
              ? 'Adımı Kapat — Toplar Tambur\'a'
              : `${activeJob.stepSummary.rolls.filter((r) => !r.qc2Completed).length} top QC2 bekliyor`}
          </Button>
        </Surface>
      )}
    </>
  );

  // Telefonda "Açık İşler" header'a (profil ikonunun soluna) taşınır —
  // ScreenChrome.headerExtras profilden önce render edilir. Acil top varsa
  // ikon turuncuya döner — operatör drawer'ı açmadan da uyarıyı görsün.
  const headerOpenJobsBtn = compact ? (
    <IconButton
      icon="format-list-bulleted"
      iconColor={urgentCount > 0 ? '#f59e0b' : '#fff'}
      size={22}
      onPress={() => setRightDrawerOpen(true)}
      accessibilityLabel={
        activeJob
          ? `${activeJob.cardNumber} · ${activeJob.stepSummary.rolls.length} top${
              urgentCount > 0 ? ` · ${urgentCount} acil` : ''
            }`
          : 'Açık İşler'
      }
      style={styles.headerOpenJobsBtn}
    />
  ) : null;

  const headerExtras = (
    <View style={styles.headerExtrasRow}>
      <SyncStatusChip />
      {headerOpenJobsBtn}
    </View>
  );

  return (
    <ScreenChrome title="Kurşun + QC2" headerExtras={headerExtras}>
      <View
        style={[
          styles.body,
          compact && {
            paddingLeft: Math.max(insets.left, 12) + 12,
            paddingRight: Math.max(insets.right, 12) + 12,
          },
        ]}
      >
        {/* ════════ SOL: aktif top işlem ════════ */}
        <View style={styles.formCol}>
          {!activeJob ? (
            <View style={styles.emptyState}>
              <Icon source="card-search-outline" size={64} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>Kart açılmadı</Text>
              <Text style={styles.emptyHint}>
                {compact
                  ? 'Üstten "Açık İşler" butonuyla kart okutarak başlayın'
                  : 'Sağ üstten refakat kartı barkodunu okutarak başlayın'}
              </Text>
            </View>
          ) : !selectedRoll ? (
            <View style={styles.emptyState}>
              <Icon source="package-variant" size={64} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>Top seçilmedi</Text>
              <Text style={styles.emptyHint}>
                Sağdaki top kuyruğundan birini seçin
              </Text>
            </View>
          ) : (
            <>
              {/* Sticky header */}
              <Surface style={styles.headerBand} elevation={2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.headerBatch} numberOfLines={1}>
                    {selectedRoll.barcode ?? `Açık Kumaş · ${selectedRoll.rollId.slice(0, 8)}`}
                  </Text>
                  <Text style={styles.headerSub} numberOfLines={1}>
                    {activeJob.stepSummary.batchNumber} ·{' '}
                    {activeJob.stepSummary.stationName} ·{' '}
                    {selectedRoll.currentQty.toFixed(1)} mt
                    {selectedRoll.colorName ? ` · ${selectedRoll.colorName}` : ''}
                  </Text>
                </View>
                <View style={styles.statusRow}>
                  <StatusPill
                    label={`${selectedRoll.errorCount} hata`}
                    tone={selectedRoll.errorCount > 0 ? 'amber' : 'neutral'}
                  />
                  <StatusPill
                    label={
                      selectedRoll.qc2Completed ? 'QC2 ✓' : 'QC2 ⏳'
                    }
                    tone={selectedRoll.qc2Completed ? 'green' : 'neutral'}
                  />
                </View>
              </Surface>

              {activeJob.stepSummary.appliesKursun && (
                <Surface style={styles.kursunBanner} elevation={1}>
                  <Icon source="shield-check" size={20} color="#059669" />
                  <Text style={styles.kursunBannerText}>
                    Bu istasyonda her top otomatik kurşunlanır
                  </Text>
                </Surface>
              )}

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {/* Mevcut hatalar — sade liste */}
                {selectedRoll.defects.length > 0 && (
                  <Surface style={styles.section} elevation={1}>
                    <Text style={styles.sectionTitle}>
                      Kayıtlı Hatalar ({selectedRoll.defects.length})
                    </Text>
                    {selectedRoll.defects.map((d, idx) => (
                      <View key={d.id} style={styles.defectRow}>
                        <View style={styles.defectIndex}>
                          <Text style={styles.defectIndexText}>{idx + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.defectName}>{d.errorType ?? '—'}</Text>
                          <Text style={styles.defectRange}>
                            {d.startMeter.toFixed(1)} mt
                          </Text>
                        </View>
                        <IconButton
                          icon="trash-can-outline"
                          size={22}
                          iconColor="#dc2626"
                          onPress={() => handleDeleteError(d.id)}
                          accessibilityLabel="Hatayı sil"
                          style={{ margin: 0 }}
                        />
                      </View>
                    ))}
                  </Surface>
                )}

                {/* Hata giriş alanı — sürekli açık */}
                <Surface style={styles.entrySection} elevation={1}>
                  <Text style={styles.sectionTitle}>Yeni Hata Gir</Text>

                    {/* Hata metresi — tek nokta (aralık değil). Tambur kesim kararı verir.
                        autoActivate: input'a tıklamadan numpad doğrudan buraya yazsın. */}
                    <Text style={styles.entryLabel}>Hata Metresi (mt)</Text>
                    <NumpadInput
                      mode="outlined"
                      value={errorEntry.startMeter}
                      onChangeText={(v) =>
                        setErrorEntry((p) => ({ ...p, startMeter: v }))
                      }
                      numpadLabel="Hata metresi"
                      allowDecimal
                      autoActivate
                      numpadMaxLength={8}
                      placeholder="örn: 60"
                      dense
                      style={styles.meterInput}
                      useNativeKeyboard={compact}
                    />

                    {/* Defect chips — sürekli açık grid */}
                    <Text style={[styles.entryLabel, { marginTop: 4 }]}>
                      Hata Tipi
                    </Text>
                    {defectTypes.length === 0 ? (
                      <Text style={styles.muted}>
                        Hata tipi tanımlı değil — admin'den ekleyin
                      </Text>
                    ) : (
                      <View style={styles.defectGrid}>
                        {defectTypes.map((dt) => {
                          const active = errorEntry.defectTypeId === dt.id;
                          return (
                            <TouchableRipple
                              key={dt.id}
                              borderless
                              onPress={() =>
                                setErrorEntry((p) => ({
                                  ...p,
                                  defectTypeId: active ? '' : dt.id,
                                }))
                              }
                              style={[
                                styles.defectChip,
                                active && styles.defectChipActive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.defectChipText,
                                  active && styles.defectChipTextActive,
                                ]}
                              >
                                {dt.name}
                              </Text>
                            </TouchableRipple>
                          );
                        })}
                      </View>
                    )}

                    {/* Hata Ekle butonu — büyük, sahada hızlı */}
                    <Button
                      mode="contained"
                      icon="plus-circle"
                      onPress={handleAddError}
                      loading={reportErrorMutation.isPending}
                      disabled={
                        reportErrorMutation.isPending ||
                        !errorEntry.startMeter ||
                        defectTypes.length === 0
                      }
                      buttonColor="#d97706"
                      style={styles.addBtn}
                      contentStyle={styles.addBtnContent}
                      labelStyle={styles.addBtnLabel}
                    >
                      Hata Ekle
                    </Button>
                  </Surface>
              </ScrollView>

              {/* Sticky footer — açık kumaş ise "Kumaş Bitir", barkodlu ise QC2 */}
              <Surface style={styles.footer} elevation={4}>
                {!selectedRoll.barcode ? (
                  // Açık kumaş: direkt Tambur'a iletir (KK2'de ölçüm yok).
                  // OFFLINE-AWARE: loading/disabled binding'i YOK — mutation
                  // hook'un global isPending'i paused mutation'larda true kalır,
                  // bu da sıradaki rulaya basmayı engeller. Optimistic update
                  // rulayı zaten listeden düşürdüğü için double-press riski yok.
                  <Button
                    mode="contained"
                    icon="package-check"
                    onPress={() =>
                      kursunFinishMutation.mutate(selectedRoll.rollId)
                    }
                    buttonColor="#7c3aed"
                    style={styles.footerBtn}
                    contentStyle={styles.footerBtnContent}
                    labelStyle={styles.footerBtnLabel}
                  >
                    Kumaşı Bitir (Tambur'a)
                  </Button>
                ) : selectedRoll.qc2Completed ? (
                  <Button
                    mode="outlined"
                    icon="undo"
                    onPress={handleUndoQc2}
                    disabled={undoQc2Mutation.isPending}
                    loading={undoQc2Mutation.isPending}
                    textColor="#dc2626"
                    style={[styles.footerBtn, { borderColor: '#dc2626', borderWidth: 2 }]}
                    contentStyle={styles.footerBtnContent}
                    labelStyle={styles.footerBtnLabel}
                  >
                    QC2'yi Geri Al
                  </Button>
                ) : (
                  // Barkodlu top — aynı offline-aware mantığı: loading/disabled
                  // binding'i yok (paused mutation sıradaki rulayı engellemesin).
                  <Button
                    mode="contained"
                    icon="check-all"
                    onPress={handleCompleteQc2}
                    buttonColor="#059669"
                    style={styles.footerBtn}
                    contentStyle={styles.footerBtnContent}
                    labelStyle={styles.footerBtnLabel}
                  >
                    {`QC2 Tamamla (${selectedRoll.errorCount} hata)`}
                  </Button>
                )}
              </Surface>
            </>
          )}
        </View>

        {/* ════════ SAĞ: kart input + tab bar + roll list ════════ */}
        {!compact && (
          <View style={styles.rightCol}>
            {renderRightContent()}
            <NumpadHost style={styles.numpadHost} />
          </View>
        )}
      </View>

      {/* Açık kart listesi — hızlı seçim için */}
      <CameraScanModal
        visible={listModalOpen}
        loading={openCardsQuery.isLoading}
        cards={openCardsQuery.data?.data ?? []}
        onDismiss={() => setListModalOpen(false)}
        onSelect={handleCameraSelect}
        refreshIntervalMs={OPEN_CARDS_REFETCH_MS}
        dataUpdatedAt={openCardsQuery.dataUpdatedAt}
        isFetching={openCardsQuery.isFetching}
        onRefresh={() => {
          Haptics.selectionAsync();
          void openCardsQuery.refetch();
        }}
      />

      {/* Refakat kartı QR/barkod okuma — gerçek kamera */}
      <BarcodeScannerModal
        visible={scannerOpen}
        title="Refakat Kartı QR Okut"
        onDismiss={() => setScannerOpen(false)}
        onScan={handleScannerResult}
      />

      {/* Compact'ta sağdan kayan iş paneli — telefon ekranında sağ kolonun yerine */}
      {compact && (
        <RightPanelDrawer
          visible={rightDrawerOpen}
          onDismiss={() => setRightDrawerOpen(false)}
          insets={insets}
          title="Kurşun · QC2 İşleri"
          onClosed={drawerQueue.drain}
        >
          {renderRightContent()}
        </RightPanelDrawer>
      )}

    </ScreenChrome>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Yardımcı bileşenler
// ─────────────────────────────────────────────────────────────────────────────

// Çevrimdışı / sync bekleyen QC2 sayısı rozeti.
// Online + 0 bekleyen → görünmez (operatöre gürültü yapma).
// Online + N bekleyen → mavi "🕐 N sync".
// Offline + 0 → sarı "Çevrimdışı".
// Offline + N → kırmızı "Çevrimdışı · N bekliyor" (en kritik durum).
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
      accessibilityLabel={
        online
          ? `${pendingCount} işlem senkronize bekliyor`
          : pendingCount > 0
          ? `Çevrimdışı, ${pendingCount} işlem bekliyor`
          : 'Çevrimdışı'
      }
    >
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Açık kart listesi modal'ı.
// PROCESS_QC istasyonlarında açık top bekleyen aktif kartları listeler.
// Operatör kart fiziksel olarak yokken bu listeden seçim yapar.
// ─────────────────────────────────────────────────────────────────────────────
function CameraScanModal({
  visible,
  loading,
  cards,
  onDismiss,
  onSelect,
  refreshIntervalMs,
  dataUpdatedAt,
  isFetching,
  onRefresh,
}: {
  visible: boolean;
  loading: boolean;
  cards: KursunOpenCard[];
  onDismiss: () => void;
  onSelect: (card: KursunOpenCard) => void;
  /** Otomatik yenileme periyodu (ms) — başlıkta saniye olarak gösterilir. */
  refreshIntervalMs: number;
  /** TanStack Query `dataUpdatedAt` — son başarılı fetch epoch ms. */
  dataUpdatedAt: number;
  /** Manuel "Yenile" ile tetiklenen veya polling fetch sürüyor mu. */
  isFetching: boolean;
  /** Manuel yenile butonu — `query.refetch()` çağırır. */
  onRefresh: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();

  // FlashList sıralama değiştiğinde "en üstteki kart yukarı kaçar" davranışını
  // engellemek için: kartların order'ını imzalayan key'i her refetch'te
  // güncelle ve modal her açıldığında başa scroll et.
  const listRef = useRef<FlashListRef<KursunOpenCard>>(null);
  const orderSignature = cards.map((c) => c.cardId).join("|");
  useEffect(() => {
    if (!visible) return;
    // Bir sonraki frame'de scroll et — FlashList yeni datayla render ettikten sonra.
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
  }, [visible, orderSignature]);

  const refreshIntervalSec = Math.round(refreshIntervalMs / 1000);
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
      <View style={[cameraStyles.sheet, { width: winW * 0.9, height: winH * 0.8 }]}>
        <View style={cameraStyles.header}>
          <Icon source="format-list-bulleted" size={22} color="#0f172a" />
          <Text variant="titleMedium" style={cameraStyles.title}>
            Açık Kartlar
          </Text>
          <View style={{ flex: 1 }} />
          <RefreshMeta
            visible={visible}
            refreshIntervalSec={refreshIntervalSec}
            dataUpdatedAt={dataUpdatedAt}
            isFetching={isFetching}
          />
          <IconButton
            icon="refresh"
            size={20}
            onPress={onRefresh}
            disabled={isFetching}
            loading={isFetching}
            style={{ margin: 0 }}
          />
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>

        <View style={cameraStyles.hint}>
          <Icon source="information-outline" size={14} color="#475569" />
          <Text style={cameraStyles.hintText}>
            Refakat kartı yoksa PROCESS_QC istasyonunda açık top bekleyen
            kartlardan birini seçerek devam edin.
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
                Kurşun + QC2'de bekleyen kart yok
              </Text>
            </View>
          ) : (
            <FlashList
              ref={listRef}
              data={cards}
              keyExtractor={(c) => c.cardId}
              contentContainerStyle={{ padding: 10 }}
              renderItem={({ item }) => (
                <Surface
                  style={[
                    cameraStyles.row,
                    item.isUrgent && cameraStyles.rowUrgent,
                  ]}
                  elevation={1}
                >
                  <TouchableRipple
                    borderless
                    onPress={() => onSelect(item)}
                    style={cameraStyles.rowTouch}
                  >
                    <View style={cameraStyles.rowInner}>
                      <View style={{ flex: 1 }}>
                        <View style={cameraStyles.rowTitle}>
                          <Text style={cameraStyles.rowBatch}>
                            {item.batchNumber}
                          </Text>
                          {item.isUrgent && (
                            <View style={cameraStyles.urgentBadge}>
                              <Icon
                                source="alert-octagon"
                                size={12}
                                color="#ffffff"
                              />
                              <Text style={cameraStyles.urgentBadgeText}>
                                ACİL
                              </Text>
                            </View>
                          )}
                        </View>
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

// Modal header'da "X sn önce" sayacı — kendi nowTick state'i olduğu için modal
// veya FlashList'i her saniye re-render etmez. Sadece bu küçük Text yenilenir.
function RefreshMeta({
  visible,
  refreshIntervalSec,
  dataUpdatedAt,
  isFetching,
}: {
  visible: boolean;
  refreshIntervalSec: number;
  dataUpdatedAt: number;
  isFetching: boolean;
}) {
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!visible) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible]);
  const secondsSinceUpdate =
    dataUpdatedAt > 0
      ? Math.max(0, Math.floor((nowTick - dataUpdatedAt) / 1000))
      : null;
  return (
    <Text style={cameraStyles.refreshMeta}>
      {refreshIntervalSec}sn ·{' '}
      {isFetching
        ? 'şimdi'
        : secondsSinceUpdate === null
          ? '—'
          : secondsSinceUpdate < 5
            ? 'az önce'
            : `${secondsSinceUpdate}sn`}
    </Text>
  );
}

// Açık Kartlar butonunun üstünde duran kırmızı badge — planlama bir kartı
// "Acil" işaretlediğinde tablet operatörü modal'ı açmadan görsün diye.
// Opacity loop ile yanıp söner; sayı 0 ise hiç render edilmez.
function UrgentBadge({ count }: { count: number }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (count === 0) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [count, opacity]);

  if (count === 0) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[urgentBadgeStyles.dot, { opacity }]}
    >
      <Text style={urgentBadgeStyles.text}>{count}</Text>
    </Animated.View>
  );
}

const urgentBadgeStyles = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  text: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
});

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'green' | 'amber' | 'neutral';
}) {
  const palette =
    tone === 'green'
      ? { bg: '#dcfce7', fg: '#059669' }
      : tone === 'amber'
        ? { bg: '#fef3c7', fg: '#92400e' }
        : { bg: '#e2e8f0', fg: '#475569' };
  return (
    <View style={[helperStyles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[helperStyles.pillText, { color: palette.fg }]}>{label}</Text>
    </View>
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
  const done = job.stepSummary.rolls.filter((r) => r.qc2Completed).length;
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
              {done}/{total} top
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
  roll: KursunRollSummary;
  index: number;
  selected: boolean;
  onPress: () => void;
}) {
  const done = roll.qc2Completed;
  return (
    <Surface
      style={[
        helperStyles.rollItem,
        selected && helperStyles.rollItemSelected,
        done && helperStyles.rollItemDone,
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
            <Text style={helperStyles.rollMeta}>
              {roll.currentQty.toFixed(1)} mt
              {roll.colorName ? ` · ${roll.colorName}` : ''}
            </Text>
            <View style={helperStyles.rollChips}>
              {roll.errorCount > 0 && (
                <View style={helperStyles.chipAmber}>
                  <Text style={helperStyles.chipText}>{roll.errorCount} hata</Text>
                </View>
              )}
              {done ? (
                <View style={helperStyles.chipBlue}>
                  <Text style={helperStyles.chipText}>QC2 ✓</Text>
                </View>
              ) : (
                <View style={helperStyles.chipNeutral}>
                  <Text style={helperStyles.chipText}>QC2 bekliyor</Text>
                </View>
              )}
            </View>
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
const styles = StyleSheet.create({
  body: { flex: 1, flexDirection: 'row', backgroundColor: '#f8fafc' },

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


  // Sol — form
  formCol: { flex: 1.4 },
  // Compact (telefon) — header'da profil ikonu solunda "Açık İşler" ikonu
  headerOpenJobsBtn: { margin: 0 },
  // Header'da sync chip + open jobs button yan yana sığsın.
  headerExtrasRow: { flexDirection: 'row', alignItems: 'center' },

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
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0f172a',
    gap: 6,
  },
  headerBatch: {
    fontFamily: 'monospace',
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  headerSub: { fontSize: 12, color: '#cbd5e1', marginTop: 2 },
  statusRow: { flexDirection: 'row', gap: 6, marginTop: 4 },

  scrollContent: { padding: 14, gap: 12 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  muted: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' },

  kursunBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  kursunBannerText: { fontSize: 13, fontWeight: '600', color: '#047857', flex: 1 },

  defectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 8,
    gap: 8,
    marginTop: 4,
  },
  defectIndex: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fef3c7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  defectIndexText: { fontSize: 11, fontWeight: '700', color: '#92400e' },
  defectName: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  defectRange: { fontSize: 11, color: '#475569', marginTop: 2 },

  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    padding: 10,
  },
  footerBtn: { borderRadius: 12 },
  footerBtnContent: { height: 56 },
  footerBtnLabel: { fontSize: 16, fontWeight: '700' },

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

  finishWrap: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    padding: 8,
  },
  finishBtn: { borderRadius: 10 },
  finishBtnContent: { height: 48 },
  numpadHost: {
    margin: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 8,
  },

  // Hata giriş alanı (sürekli açık)
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
  meterRow: { flexDirection: 'row', gap: 10 },
  meterInput: { backgroundColor: '#fff' },
  defectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  defectChip: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#cbd5e1',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 999,
    minHeight: 48, // büyük dokunma hedefi (sahada kolay)
    minWidth: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  defectChipActive: {
    backgroundColor: '#d97706',
    borderColor: '#b45309',
  },
  defectChipText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  defectChipTextActive: { color: '#fff' },
  addBtn: { borderRadius: 10, marginTop: 4 },
  addBtnContent: { height: 56 },
  addBtnLabel: { fontSize: 16, fontWeight: '700' },
});

const helperStyles = StyleSheet.create({
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillText: { fontSize: 11, fontWeight: '700' },

  // Tab
  // Tab — sabit genişlik + her zaman 1px border (active'de renk değişir).
  // Aktif/inactive geçişinde layout shift olmaz, text clipping yaşanmaz.
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
  tabTextWrap: { flex: 1, minWidth: 0 }, // minWidth: 0 — flex child'ın overflow olmasına izin ver
  tabLabel: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  tabLabelActive: { color: '#1e40af' },
  tabSub: { fontSize: 10, color: '#64748b', marginTop: 2 },
  tabCloseBtn: { margin: 0, width: 28, height: 28 },

  // Roll list
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
  rollItemDone: { opacity: 0.6 },
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
  rollMeta: { fontSize: 11, color: '#64748b', marginTop: 1 },
  rollChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  chipAmber: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  chipBlue: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  chipNeutral: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  chipText: { fontSize: 10, fontWeight: '700', color: '#0f172a' },
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
  refreshMeta: { fontSize: 11, color: '#475569', fontVariant: ['tabular-nums'] },

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
  rowUrgent: {
    borderColor: '#dc2626',
    backgroundColor: '#fef2f2',
  },
  rowTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  rowBatch: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#dc2626',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  urgentBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  rowMetaText: { fontSize: 12, color: '#475569', fontWeight: '500', flex: 1 },
  rowFooter: { marginTop: 6 },
  rowQty: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
});
