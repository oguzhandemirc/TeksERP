import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
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
import { FlashList } from '@shopify/flash-list';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import NumpadInput from '../../../components/NumpadInput';
import { NumpadHost } from '../../../components/NumpadProvider';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { kursunQcService } from '../../../services/kursunQc.service';
import { defectTypeService } from '../../../services/defectType.service';
import { rollService } from '../../../services/roll.service';
import { subcontractorService } from '../../../services/subcontractor.service';
import type {
  KursunStepSummary,
  KursunRollSummary,
  KursunOpenCard,
  DefectType,
  SubcontractorReceiptListItem,
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
interface ErrorEntryState {
  defectTypeId: string;
  startMeter: string;
  endMeter: string;
}

const EMPTY_ERROR_ENTRY: ErrorEntryState = {
  defectTypeId: '',
  startMeter: '',
  endMeter: '',
};

export default function KursunQcScreen() {
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
  /** Refactor 9 — açık kumaş aç modalı (receiptId seçimi). */
  const [openFabricModalVisible, setOpenFabricModalVisible] = useState(false);
  /** Refactor 9 — kursun-finish modalı (totalMeters + errors). */
  const [finishFabricRollId, setFinishFabricRollId] = useState<string | null>(null);

  // Açık kart listesi (sadece liste modalı açıkken çekilir)
  const openCardsQuery = useQuery({
    queryKey: ['kursun-qc', 'open-cards'],
    queryFn: () => kursunQcService.listOpenCards(),
    enabled: listModalOpen,
    staleTime: 30 * 1000,
  });

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
  };

  // ── Mutations ──────────────────────────────────────────────────────────────
  const applyKursunMutation = useMutation({
    mutationFn: kursunQcService.applyKursun,
    onSuccess: async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refetchActiveJob();
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Kurşun işareti başarısız', text2: err.message });
    },
  });

  const undoKursunMutation = useMutation({
    mutationFn: kursunQcService.undoKursun,
    onSuccess: async () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await refetchActiveJob();
    },
    onError: (err: Error) =>
      Toast.show({ type: 'error', text1: 'Geri alınamadı', text2: err.message }),
  });

  const completeQc2Mutation = useMutation({
    mutationFn: kursunQcService.completeQc2,
    onSuccess: async (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'QC2 tamamlandı',
        text2: 'Top sonraki istasyona taşındı',
      });
      await refetchActiveJob();
      // Bir sonraki QC2 olmamış top'a otomatik geç
      if (activeJob) {
        const next = activeJob.stepSummary.rolls.find(
          (r) => !r.qc2Completed && r.rollId !== activeJob.selectedRollId
        );
        setOpenJobs((prev) =>
          prev.map((j) =>
            j.cardId === activeJob.cardId
              ? { ...j, selectedRollId: next?.rollId ?? null }
              : j
          )
        );
      }
    },
    onError: (err: Error) => {
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
      // metraj alanları temizlenir.
      setErrorEntry((prev) => ({ ...prev, startMeter: '', endMeter: '' }));
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

  // Refactor 9 — Açık kumaş aç (open-fabric)
  const openFabricMutation = useMutation({
    mutationFn: (receiptId: string) =>
      rollService.createOpenFabric({
        receiptId,
        stepId: activeJob!.stepSummary.workOrderStepId,
      }),
    onSuccess: async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Açık kumaş oluşturuldu' });
      setOpenFabricModalVisible(false);
      await refetchActiveJob();
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'Açık kumaş oluşturulamadı',
        text2: err.message,
      });
    },
  });

  // Refactor 9 — Kursun finish (totalMeters + errors → Tambur'a ilerlet)
  const kursunFinishMutation = useMutation({
    mutationFn: ({
      rollId,
      totalMeters,
      errors,
      notes,
    }: {
      rollId: string;
      totalMeters: number;
      errors: Array<{ startMeter: number; endMeter?: number | null; defectTypeId?: string | null }>;
      notes?: string | null;
    }) =>
      rollService.kursunFinish(rollId, { totalMeters, errors, notes }),
    onSuccess: async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Kumaş bitirildi',
        text2: 'Roll Tambur adımına geçti',
      });
      setFinishFabricRollId(null);
      await refetchActiveJob();
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Kumaş bitirilemedi', text2: err.message });
    },
  });

  // Açık kumaş aç modalı için WO'nun receipt listesi
  const woReceiptsQuery = useQuery({
    queryKey: [
      'kursun-qc',
      'receipts',
      activeJob?.stepSummary.workOrderId,
    ],
    queryFn: () =>
      subcontractorService.listReceipts({
        workOrderId: activeJob!.stepSummary.workOrderId,
        pageSize: 20,
      }),
    enabled: openFabricModalVisible && !!activeJob,
    staleTime: 30 * 1000,
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
  const handleApplyKursun = () => {
    if (!activeJob || !selectedRoll) return;
    applyKursunMutation.mutate({
      rollId: selectedRoll.rollId,
      stepId: activeJob.stepSummary.workOrderStepId,
    });
  };

  const handleSkipKursun = () => {
    // Backend'de ayrı bir "kurşun gerekmedi" işareti yok — o yüzden bu sadece
    // local state'te "operatör karar verdi" anlamına gelir. QC2 tamamlama
    // sırasında bu durum loglanır (notes alanı). Yine de operatör kasıtlı
    // bir karar verdiği için undoKursun çağrısı yaparız (idempotent — eğer
    // önceden basıldıysa siler; basılmadıysa backend 200 döner).
    if (!activeJob || !selectedRoll) return;
    if (selectedRoll.kursunApplied) {
      undoKursunMutation.mutate({
        rollId: selectedRoll.rollId,
        stepId: activeJob.stepSummary.workOrderStepId,
      });
    }
    // "kurşun gerekmedi" bilinçli kararını işaretlemek için local UI flag
    // gerekirse rollId bazlı bir set tutabiliriz; şimdilik QC2 butonu üzerinden
    // bilgi netleşir.
    Toast.show({
      type: 'info',
      text1: 'Kurşun atlanacak',
      text2: 'QC2 tamamla butonu ile devam et',
    });
  };

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
    if (!errorEntry.defectTypeId) {
      Toast.show({ type: 'error', text1: 'Hata tipi seçin' });
      return;
    }
    const start = parseFloat(errorEntry.startMeter);
    const end = parseFloat(errorEntry.endMeter);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      Toast.show({ type: 'error', text1: 'Metraj sayı olmalı' });
      return;
    }
    if (start < 0 || end <= start) {
      Toast.show({
        type: 'error',
        text1: 'Geçersiz aralık',
        text2: 'Bitiş metrajı başlangıçtan büyük olmalı',
      });
      return;
    }
    reportErrorMutation.mutate({
      rollId: selectedRoll.rollId,
      stepId: activeJob.stepSummary.workOrderStepId,
      startMeter: start,
      endMeter: end,
      defectTypeId: errorEntry.defectTypeId,
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

  return (
    <ScreenChrome
      title="Kurşun + QC2"
      subtitle="Refakat kartı okut, top seç, kurşun + hata gir"
    >
      <View style={styles.body}>
        {/* ════════ SOL: aktif top işlem ════════ */}
        <View style={styles.formCol}>
          {!activeJob ? (
            <View style={styles.emptyState}>
              <Icon source="card-search-outline" size={64} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>Kart açılmadı</Text>
              <Text style={styles.emptyHint}>
                Sağ üstten refakat kartı barkodunu okutarak başlayın
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
                    label={
                      selectedRoll.kursunApplied ? 'Kurşun ✓' : 'Kurşun —'
                    }
                    tone={selectedRoll.kursunApplied ? 'green' : 'neutral'}
                  />
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

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {/* Kurşun kararı */}
                <Surface style={styles.section} elevation={1}>
                  <Text style={styles.sectionTitle}>Kurşun Kararı</Text>
                  <View style={styles.kursunRow}>
                    <Button
                      mode={selectedRoll.kursunApplied ? 'contained' : 'outlined'}
                      icon="check-bold"
                      buttonColor={selectedRoll.kursunApplied ? '#059669' : undefined}
                      textColor={selectedRoll.kursunApplied ? '#fff' : '#059669'}
                      onPress={handleApplyKursun}
                      loading={applyKursunMutation.isPending}
                      disabled={applyKursunMutation.isPending}
                      style={[styles.kursunBtn, { borderColor: '#059669' }]}
                      contentStyle={styles.kursunBtnContent}
                      labelStyle={styles.kursunBtnLabel}
                    >
                      Kurşun Uygulandı
                    </Button>
                    <Button
                      mode={!selectedRoll.kursunApplied ? 'contained' : 'outlined'}
                      icon="close-circle-outline"
                      buttonColor={!selectedRoll.kursunApplied ? '#64748b' : undefined}
                      textColor={!selectedRoll.kursunApplied ? '#fff' : '#64748b'}
                      onPress={handleSkipKursun}
                      loading={undoKursunMutation.isPending}
                      disabled={undoKursunMutation.isPending}
                      style={[styles.kursunBtn, { borderColor: '#64748b' }]}
                      contentStyle={styles.kursunBtnContent}
                      labelStyle={styles.kursunBtnLabel}
                    >
                      Kurşun Gerekmedi
                    </Button>
                  </View>
                </Surface>

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
                            {d.startMeter.toFixed(1)}
                            {d.endMeter != null
                              ? ` – ${d.endMeter.toFixed(1)} mt · ${(d.endMeter - d.startMeter).toFixed(1)} mt`
                              : ' mt (nokta)'}
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

                    {/* Metraj aralığı — NumpadInput ile sağ alttaki numpada bağlı */}
                    <View style={styles.meterRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.entryLabel}>Başlangıç (mt)</Text>
                        <NumpadInput
                          mode="outlined"
                          value={errorEntry.startMeter}
                          onChangeText={(v) =>
                            setErrorEntry((p) => ({ ...p, startMeter: v }))
                          }
                          numpadLabel="Başlangıç metraj"
                          allowDecimal
                          numpadMaxLength={8}
                          placeholder="0"
                          dense
                          style={styles.meterInput}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.entryLabel}>Bitiş (mt)</Text>
                        <NumpadInput
                          mode="outlined"
                          value={errorEntry.endMeter}
                          onChangeText={(v) =>
                            setErrorEntry((p) => ({ ...p, endMeter: v }))
                          }
                          numpadLabel="Bitiş metraj"
                          allowDecimal
                          numpadMaxLength={8}
                          placeholder="0"
                          dense
                          style={styles.meterInput}
                        />
                      </View>
                    </View>

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
                        !errorEntry.defectTypeId ||
                        !errorEntry.startMeter ||
                        !errorEntry.endMeter
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
                  // Refactor 9 — açık kumaş: totalMeters + errors → kursun-finish
                  <Button
                    mode="contained"
                    icon="package-check"
                    onPress={() => setFinishFabricRollId(selectedRoll.rollId)}
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
                  <Button
                    mode="contained"
                    icon="check-all"
                    onPress={handleCompleteQc2}
                    disabled={completeQc2Mutation.isPending}
                    loading={completeQc2Mutation.isPending}
                    buttonColor="#059669"
                    style={styles.footerBtn}
                    contentStyle={styles.footerBtnContent}
                    labelStyle={styles.footerBtnLabel}
                  >
                    {`QC2 Tamamla (${selectedRoll.errorCount} hata${selectedRoll.kursunApplied ? ' · kurşunlu' : ''})`}
                  </Button>
                )}
              </Surface>
            </>
          )}
        </View>

        {/* ════════ SAĞ: kart input + tab bar + roll list ════════ */}
        <View style={styles.rightCol}>
          {/* Kart input + kamera */}
          <View style={styles.cardInputWrap}>
            <View style={styles.cardInputRow}>
              <TextInput
                mode="outlined"
                value={cardBarcode}
                onChangeText={setCardBarcode}
                placeholder="Refakat kartı barkodu okut/yaz..."
                dense
                autoCapitalize="characters"
                autoCorrect={false}
                left={<TextInput.Icon icon="card-search-outline" />}
                right={
                  resolvingCard ? (
                    <TextInput.Icon
                      icon={() => <ActivityIndicator size={18} color="#059669" />}
                    />
                  ) : cardBarcode.trim() ? (
                    <TextInput.Icon
                      icon="check"
                      onPress={handleResolveCard}
                      color="#059669"
                    />
                  ) : undefined
                }
                onSubmitEditing={handleResolveCard}
                returnKeyType="search"
                style={[styles.cardInput, { flex: 1 }]}
              />
              <IconButton
                icon="format-list-bulleted"
                mode="contained-tonal"
                containerColor="#e2e8f0"
                iconColor="#0f172a"
                size={26}
                onPress={() => setListModalOpen(true)}
                accessibilityLabel="Açık kartları listele"
                style={styles.cameraBtn}
              />
              <IconButton
                icon="camera"
                mode="contained-tonal"
                containerColor="#dbeafe"
                iconColor="#1e40af"
                size={26}
                onPress={() => setScannerOpen(true)}
                accessibilityLabel="Kamera ile refakat kartı tara"
                style={styles.cameraBtn}
              />
            </View>
          </View>

          {/* Banner — Refactor 4 yanlış istasyon mesajı */}
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

          {/* Refactor 9 — açık kumaş aç butonu (aktif job varsa) */}
          {activeJob && (
            <View style={styles.openFabricRow}>
              <Button
                mode="contained"
                icon="plus-box-multiple"
                onPress={() => setOpenFabricModalVisible(true)}
                buttonColor="#7c3aed"
                compact
                style={{ flex: 1 }}
              >
                Yeni Açık Kumaş Aç
              </Button>
            </View>
          )}

          {/* Tab bar — açık işler */}
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
                  onPress={refetchActiveJob}
                  refreshing={false}
                />
              </View>
            </View>
          )}

          {/* Top kuyruğu */}
          {!activeJob ? (
            <View style={styles.paneEmpty}>
              <Icon source="package-variant-closed" size={48} color="#cbd5e1" />
              <Text style={styles.paneEmptyText}>
                Henüz açık iş yok
              </Text>
              <Text style={styles.paneEmptyHint}>
                Yukarıdan kart okutarak başlayın
              </Text>
            </View>
          ) : activeJob.stepSummary.rolls.length === 0 ? (
            <View style={styles.paneEmpty}>
              <Text style={styles.paneEmptyText}>
                Bu adımda bekleyen top yok
              </Text>
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

          {/* Adımı kapat butonu */}
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

          {/* Sabit numpad — sol kolondaki NumpadInput'lar tetikler */}
          <NumpadHost style={styles.numpadHost} />
        </View>
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

      {/* Refactor 9 — Açık kumaş aç modal (receipt picker) */}
      <OpenFabricModal
        visible={openFabricModalVisible}
        loading={woReceiptsQuery.isLoading}
        receipts={woReceiptsQuery.data?.data ?? []}
        submitting={openFabricMutation.isPending}
        onDismiss={() => setOpenFabricModalVisible(false)}
        onSelect={(receiptId) => openFabricMutation.mutate(receiptId)}
      />

      {/* Refactor 9 — Kumaş bitir modal (totalMeters + errors → kursun-finish) */}
      <KursunFinishModal
        visible={!!finishFabricRollId}
        defectTypes={defectTypes}
        submitting={kursunFinishMutation.isPending}
        onDismiss={() => setFinishFabricRollId(null)}
        onSubmit={(payload) => {
          if (!finishFabricRollId) return;
          kursunFinishMutation.mutate({
            rollId: finishFabricRollId,
            ...payload,
          });
        }}
      />
    </ScreenChrome>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Refactor 9 — Açık kumaş aç modal
// ─────────────────────────────────────────────────────────────────────────────
function OpenFabricModal({
  visible,
  loading,
  receipts,
  submitting,
  onDismiss,
  onSelect,
}: {
  visible: boolean;
  loading: boolean;
  receipts: SubcontractorReceiptListItem[];
  submitting: boolean;
  onDismiss: () => void;
  onSelect: (receiptId: string) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  // Yalnız iptal edilmemiş kabuller
  const activeReceipts = receipts.filter((r) => !r.cancelledAt);
  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={submitting ? undefined : onDismiss}
      onBackButtonPress={submitting ? undefined : onDismiss}
      backdropOpacity={0.55}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
      style={openFabricStyles.modal}
    >
      <View
        style={[openFabricStyles.sheet, { width: winW * 0.65, maxHeight: winH * 0.8 }]}
      >
        <View style={openFabricStyles.header}>
          <Icon source="plus-box-multiple" size={22} color="#7c3aed" />
          <Text variant="titleMedium" style={openFabricStyles.title}>
            Açık Kumaş Aç
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>
        <Text style={openFabricStyles.body}>
          Hangi fason kabulden yeni açık kumaş oluşturacağınızı seçin. Renk +
          özellikler bu kabulden inherit edilir, barkod basılmaz (sistem ID).
        </Text>
        {loading ? (
          <View style={openFabricStyles.empty}>
            <ActivityIndicator size="large" color="#7c3aed" />
          </View>
        ) : activeReceipts.length === 0 ? (
          <View style={openFabricStyles.empty}>
            <Icon source="package-down" size={48} color="#cbd5e1" />
            <Text style={openFabricStyles.emptyText}>
              Bu WO için aktif fason kabul yok
            </Text>
          </View>
        ) : (
          <FlashList
            data={activeReceipts}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ paddingVertical: 6 }}
            renderItem={({ item }) => (
              <Surface style={openFabricStyles.row} elevation={1}>
                <TouchableRipple
                  borderless
                  onPress={() => onSelect(item.id)}
                  style={openFabricStyles.rowTouch}
                  disabled={submitting}
                >
                  <View style={openFabricStyles.rowInner}>
                    <View style={{ flex: 1 }}>
                      <Text style={openFabricStyles.rowTitle}>
                        {item.receiptNo}
                        {item.appliedColor
                          ? ` · ${item.appliedColor.name}`
                          : ''}
                      </Text>
                      <Text style={openFabricStyles.rowMeta} numberOfLines={1}>
                        {item.subcontractor?.name ?? '—'}
                        {' · '}
                        {item._count?.items ?? 0} top
                      </Text>
                    </View>
                    <Icon source="chevron-right" size={22} color="#94a3b8" />
                  </View>
                </TouchableRipple>
              </Surface>
            )}
          />
        )}
      </View>
    </RNModal>
  );
}

const openFabricStyles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0 },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontWeight: '700', color: '#0f172a' },
  body: { fontSize: 13, color: '#475569', lineHeight: 18 },
  empty: {
    paddingVertical: 36,
    alignItems: 'center',
    gap: 6,
  },
  emptyText: { fontSize: 13, color: '#94a3b8' },
  row: {
    backgroundColor: '#faf5ff',
    borderRadius: 10,
    marginVertical: 3,
    overflow: 'hidden',
  },
  rowTouch: { borderRadius: 10 },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#5b21b6' },
  rowMeta: { fontSize: 12, color: '#6b21a8', marginTop: 2 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Refactor 9 — Kumaş bitir modal (kursun-finish)
// ─────────────────────────────────────────────────────────────────────────────
interface FinishErrorEntry {
  startMeter: string;
  endMeter: string;
  defectTypeId: string;
}

function KursunFinishModal({
  visible,
  defectTypes,
  submitting,
  onDismiss,
  onSubmit,
}: {
  visible: boolean;
  defectTypes: DefectType[];
  submitting: boolean;
  onDismiss: () => void;
  onSubmit: (data: {
    totalMeters: number;
    errors: Array<{ startMeter: number; endMeter?: number | null; defectTypeId?: string | null }>;
    notes?: string | null;
  }) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [totalMeters, setTotalMeters] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FinishErrorEntry[]>([]);

  useEffect(() => {
    if (!visible) {
      setTotalMeters('');
      setNotes('');
      setErrors([]);
    }
  }, [visible]);

  const addError = () =>
    setErrors((prev) => [...prev, { startMeter: '', endMeter: '', defectTypeId: '' }]);

  const updateError = (idx: number, patch: Partial<FinishErrorEntry>) =>
    setErrors((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  const removeError = (idx: number) =>
    setErrors((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = () => {
    const total = parseFloat(totalMeters);
    if (Number.isNaN(total) || total <= 0) {
      Toast.show({ type: 'error', text1: 'Toplam metre zorunlu', text2: 'Pozitif sayı girin' });
      return;
    }
    const parsedErrors: Array<{
      startMeter: number;
      endMeter?: number | null;
      defectTypeId?: string | null;
    }> = [];
    for (let i = 0; i < errors.length; i++) {
      const e = errors[i];
      const start = parseFloat(e.startMeter);
      if (Number.isNaN(start) || start < 0) {
        Toast.show({
          type: 'error',
          text1: `Hata #${i + 1} geçersiz`,
          text2: 'Başlangıç metre sayı olmalı',
        });
        return;
      }
      const end = e.endMeter.trim() ? parseFloat(e.endMeter) : null;
      if (end !== null && (Number.isNaN(end) || end <= start)) {
        Toast.show({
          type: 'error',
          text1: `Hata #${i + 1} geçersiz`,
          text2: 'Bitiş başlangıçtan büyük olmalı',
        });
        return;
      }
      parsedErrors.push({
        startMeter: start,
        endMeter: end,
        defectTypeId: e.defectTypeId || null,
      });
    }
    onSubmit({
      totalMeters: total,
      errors: parsedErrors,
      notes: notes.trim() || null,
    });
  };

  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={submitting ? undefined : onDismiss}
      onBackButtonPress={submitting ? undefined : onDismiss}
      backdropOpacity={0.55}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
      style={finishStyles.modal}
    >
      <View
        style={[finishStyles.sheet, { width: winW * 0.7, maxHeight: winH * 0.9 }]}
      >
        <View style={finishStyles.header}>
          <Icon source="package-check" size={22} color="#7c3aed" />
          <Text variant="titleMedium" style={finishStyles.title}>
            Kumaşı Bitir
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>

        <ScrollView contentContainerStyle={finishStyles.body}>
          <Text style={finishStyles.bodyText}>
            Cihazda gözüken toplam metreyi girin. Hata noktaları opsiyonel —
            bitiş metresi boş bırakılabilir (operatör çoğu zaman sadece
            başlangıç metresini girer).
          </Text>

          <Text style={finishStyles.label}>Toplam Metre *</Text>
          <TextInput
            mode="outlined"
            value={totalMeters}
            onChangeText={setTotalMeters}
            placeholder="örn. 500"
            keyboardType="numeric"
            dense
            style={finishStyles.input}
          />

          <View style={finishStyles.errorsHeader}>
            <Text style={finishStyles.label}>Hatalar (opsiyonel)</Text>
            <Button mode="text" icon="plus-circle" onPress={addError} compact>
              Hata Ekle
            </Button>
          </View>

          {errors.map((e, idx) => (
            <Surface key={idx} style={finishStyles.errorRow} elevation={1}>
              <View style={finishStyles.errorTop}>
                <Text style={finishStyles.errorIndex}>#{idx + 1}</Text>
                <IconButton
                  icon="trash-can-outline"
                  size={18}
                  iconColor="#dc2626"
                  onPress={() => removeError(idx)}
                  style={{ margin: 0 }}
                />
              </View>
              <View style={finishStyles.errorMeterRow}>
                <View style={{ flex: 1 }}>
                  <Text style={finishStyles.subLabel}>Başlangıç (mt)</Text>
                  <TextInput
                    mode="outlined"
                    value={e.startMeter}
                    onChangeText={(v) => updateError(idx, { startMeter: v })}
                    placeholder="60"
                    keyboardType="numeric"
                    dense
                    style={finishStyles.input}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={finishStyles.subLabel}>Bitiş (mt) — boş ok</Text>
                  <TextInput
                    mode="outlined"
                    value={e.endMeter}
                    onChangeText={(v) => updateError(idx, { endMeter: v })}
                    placeholder="opsiyonel"
                    keyboardType="numeric"
                    dense
                    style={finishStyles.input}
                  />
                </View>
              </View>
              <Text style={finishStyles.subLabel}>Hata Tipi (opsiyonel)</Text>
              <View style={finishStyles.defectChipRow}>
                {defectTypes.map((dt) => {
                  const active = e.defectTypeId === dt.id;
                  return (
                    <TouchableRipple
                      key={dt.id}
                      borderless
                      onPress={() =>
                        updateError(idx, {
                          defectTypeId: active ? '' : dt.id,
                        })
                      }
                      style={[
                        finishStyles.defectChip,
                        active && finishStyles.defectChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          finishStyles.defectChipText,
                          active && finishStyles.defectChipTextActive,
                        ]}
                      >
                        {dt.name}
                      </Text>
                    </TouchableRipple>
                  );
                })}
              </View>
            </Surface>
          ))}

          <Text style={finishStyles.label}>Not (opsiyonel)</Text>
          <TextInput
            mode="outlined"
            value={notes}
            onChangeText={setNotes}
            placeholder="Kumaşın geneline dair not"
            multiline
            numberOfLines={2}
            style={finishStyles.input}
          />
        </ScrollView>

        <View style={finishStyles.actions}>
          <Button mode="outlined" onPress={onDismiss} disabled={submitting}>
            Vazgeç
          </Button>
          <Button
            mode="contained"
            buttonColor="#7c3aed"
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting}
            icon="check"
          >
            Bitir & Tambur'a Yolla
          </Button>
        </View>
      </View>
    </RNModal>
  );
}

const finishStyles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0 },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingTop: 16,
    paddingHorizontal: 18,
    paddingBottom: 12,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontWeight: '700', color: '#0f172a' },
  body: { gap: 8, paddingBottom: 8 },
  bodyText: { fontSize: 12, color: '#475569', lineHeight: 16, marginBottom: 6 },
  label: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginTop: 4 },
  subLabel: { fontSize: 11, fontWeight: '600', color: '#475569', marginBottom: 4 },
  input: { backgroundColor: '#fff' },
  errorsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  errorRow: {
    backgroundColor: '#fef3c7',
    padding: 10,
    borderRadius: 10,
    marginVertical: 4,
    gap: 6,
  },
  errorTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorIndex: { fontSize: 12, fontWeight: '700', color: '#92400e' },
  errorMeterRow: { flexDirection: 'row', gap: 8 },
  defectChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  defectChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fbbf24',
    backgroundColor: '#fff',
  },
  defectChipActive: { backgroundColor: '#d97706', borderColor: '#d97706' },
  defectChipText: { fontSize: 11, fontWeight: '600', color: '#92400e' },
  defectChipTextActive: { color: '#fff' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcı bileşenler
// ─────────────────────────────────────────────────────────────────────────────

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
}: {
  visible: boolean;
  loading: boolean;
  cards: KursunOpenCard[];
  onDismiss: () => void;
  onSelect: (card: KursunOpenCard) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
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
      <View style={[cameraStyles.sheet, { width: winW * 0.7, height: winH * 0.8 }]}>
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
              {roll.kursunApplied && (
                <View style={helperStyles.chipGreen}>
                  <Text style={helperStyles.chipText}>Kurşun</Text>
                </View>
              )}
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

  openFabricRow: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 8,
  },

  // Sol — form
  formCol: { flex: 1.4 },

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

  kursunRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  kursunBtn: { flex: 1, borderRadius: 10, borderWidth: 2 },
  kursunBtnContent: { height: 56 },
  kursunBtnLabel: { fontSize: 14, fontWeight: '700' },

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
  chipGreen: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
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
