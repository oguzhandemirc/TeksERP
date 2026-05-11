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
import { LabelPrinter } from '../../../components/LabelPrinter';
import { tamburService } from '../../../services/tambur.service';
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
  selectedRollId: string | null;
}

interface ErrorEntryState {
  startMeter: string;
  endMeter: string;
  defectTypeId: string;
}

interface SwatchEntryState {
  open: boolean;
  startMeter: string;
  endMeter: string;
  count: string; // adet
  purpose: string;
}

interface VoluntaryCutDraft {
  id: string;        // local — uuid / counter
  start: number;
  end: number;       // > start
  qualityGrade: string;
  qualityName?: string; // display only
}

interface VoluntaryEntryState {
  start: string;
  end: string;
  qualityGrade: string;
  qualityName?: string;
}

interface RollWorkState {
  decisions: Record<string, { decision: TamburDecision; qualityGrade?: string }>;
  foldType: TamburFoldType | null;
  voluntaryCuts: VoluntaryCutDraft[];
  voluntaryEntry: VoluntaryEntryState;
  errorEntry: ErrorEntryState;
  swatchEntry: SwatchEntryState;
}

const EMPTY_ERROR_ENTRY: ErrorEntryState = {
  startMeter: '',
  endMeter: '',
  defectTypeId: '',
};
const EMPTY_SWATCH_ENTRY: SwatchEntryState = {
  open: false,
  startMeter: '',
  endMeter: '',
  count: '1',
  purpose: '',
};
const EMPTY_VOLUNTARY_ENTRY: VoluntaryEntryState = {
  start: '',
  end: '',
  qualityGrade: '',
  qualityName: undefined,
};
const EMPTY_WORK: RollWorkState = {
  decisions: {},
  foldType: null,
  voluntaryCuts: [],
  voluntaryEntry: EMPTY_VOLUNTARY_ENTRY,
  errorEntry: EMPTY_ERROR_ENTRY,
  swatchEntry: EMPTY_SWATCH_ENTRY,
};

export default function TamburScreen() {
  const qc = useQueryClient();

  const [cardBarcode, setCardBarcode] = useState('');
  const [resolvingCard, setResolvingCard] = useState(false);
  const [openJobs, setOpenJobs] = useState<OpenJob[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Aktif top'un çalışma state'i — top/sekme değişince sıfırlanır.
  const [work, setWork] = useState<RollWorkState>(EMPTY_WORK);

  // Etiket basımı modal state — finalize veya post-split sonrası yeni Roll'lar.
  // Roller tam obje olarak tutulur (item.color, variant dahil) → LabelPrinter
  // doğrudan basabilsin.
  const [pendingPrintRolls, setPendingPrintRolls] = useState<Roll[]>([]);

  // Geçmiş çıktı listesi modal state
  const [recentOutputOpen, setRecentOutputOpen] = useState(false);

  // Yazdırılacak aktif rol — LabelPrinter bu state'i izler ve sıfırlanınca
  // hazır olur. Per-row "Bas" butonu bu state'i set eder.
  const [activePrintRoll, setActivePrintRoll] = useState<Roll | null>(null);

  // Yeniden Kesim (post-production split) modal state
  const [resplitOpen, setResplitOpen] = useState(false);

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

  // Top/sekme değişimi → çalışma state'i temizlenir
  useEffect(() => {
    setWork(EMPTY_WORK);
  }, [activeCardId, activeJob?.selectedRollId]);

  // ── Backend re-fetch helper ──
  const refetchActiveJob = async () => {
    if (!activeJob) return;
    const res = await tamburService.getStep(activeJob.stepSummary.workOrderStepId);
    const step = res.data as TamburStepSummary | undefined;
    if (!step) return;
    setOpenJobs((prev) =>
      prev.map((j) => (j.cardId === activeJob.cardId ? { ...j, stepSummary: step } : j))
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
      const res = await tamburService.getByCardBarcode(barcode);
      const step = res.data as TamburStepSummary | undefined;
      if (!step) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Toast.show({ type: 'error', text1: 'Kart bulunamadı', text2: barcode });
        return;
      }
      const newJob: OpenJob = {
        cardId: barcode,
        cardBarcode: barcode,
        stepSummary: step,
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

      // Yeni Roll'lar varsa etiket basımı modal'ını aç (orijinal + split'ler)
      const data = res.data as
        | { originalRoll?: Roll; splitRolls?: Roll[] }
        | undefined;
      if (data) {
        const rolls: Roll[] = [];
        if (data.originalRoll) rolls.push(data.originalRoll);
        for (const r of data.splitRolls ?? []) rolls.push(r);
        if (rolls.length > 0) setPendingPrintRolls(rolls);
      }

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

  // Post-production split — depodaki topu istenen metrede ikiye böl
  const resplitMutation = useMutation({
    mutationFn: tamburService.postProductionSplit,
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Kesim yapıldı',
        text2: 'İki top depoya hazır',
      });
      const data = res.data as
        | { original?: Roll; newRoll?: Roll }
        | undefined;
      if (data) {
        const rolls: Roll[] = [];
        if (data.original) rolls.push(data.original);
        if (data.newRoll) rolls.push(data.newRoll);
        if (rolls.length > 0) setPendingPrintRolls(rolls);
      }
      setResplitOpen(false);
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Kesim başarısız', text2: err.message });
    },
  });

  const swatchMutation = useMutation({
    mutationFn: tamburService.createSwatch,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Kartela basıldı' });
      setWork((w) => ({ ...w, swatchEntry: EMPTY_SWATCH_ENTRY }));
    },
    onError: (err: Error) =>
      Toast.show({ type: 'error', text1: 'Kartela basılamadı', text2: err.message }),
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
    const end = parseFloat(work.errorEntry.endMeter);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      Toast.show({ type: 'error', text1: 'Metraj sayı olmalı' });
      return;
    }
    if (start < 0 || end <= start) {
      Toast.show({
        type: 'error',
        text1: 'Geçersiz aralık',
        text2: 'Bitiş başlangıçtan büyük olmalı',
      });
      return;
    }
    if (!work.errorEntry.defectTypeId) {
      Toast.show({ type: 'error', text1: 'Hata tipi seçin' });
      return;
    }
    reportErrorMutation.mutate({
      rollId: selectedRoll.rollId,
      stepId: activeJob.stepSummary.workOrderStepId,
      startMeter: start,
      endMeter: end,
      defectTypeId: work.errorEntry.defectTypeId,
    });
  };

  // Tüm kesimleri (defect CUT + gönüllü + açık kartela formu) tek listede topla,
  // sırala, çakışma kontrolü yap; dokunulmamış segmentleri hesapla. Operatör
  // için canlı önizleme. Kartela "Bas" ile commit olur; commit sonrası form
  // sıfırlanır, kartela rolün currentQty'sinden düşer.
  const segmentPreview = useMemo(() => {
    if (!selectedRoll) return null;
    const total = selectedRoll.currentQty;
    type C = {
      start: number;
      end: number;
      qualityGrade: string;
      source: 'DEFECT' | 'VOLUNTARY' | 'SWATCH';
    };
    const cuts: C[] = [];
    for (const e of selectedRoll.errors) {
      const dec = work.decisions[e.id];
      if (dec?.decision === 'CUT') {
        cuts.push({
          start: e.startMeter,
          end: e.endMeter,
          qualityGrade: dec.qualityGrade ?? 'FIRE',
          source: 'DEFECT',
        });
      }
    }
    for (const v of work.voluntaryCuts) {
      cuts.push({
        start: v.start,
        end: v.end,
        qualityGrade: v.qualityGrade,
        source: 'VOLUNTARY',
      });
    }
    // Açık kartela entry formu — start/end/count geçerliyse preview'a dahil et.
    // Adet>1 ise bitişik kabul: range = [start, start + (end-start)*count].
    if (work.swatchEntry.open) {
      const s = parseFloat(work.swatchEntry.startMeter);
      const e = parseFloat(work.swatchEntry.endMeter);
      const n = parseInt(work.swatchEntry.count, 10);
      if (
        !Number.isNaN(s) &&
        !Number.isNaN(e) &&
        e > s &&
        !Number.isNaN(n) &&
        n >= 1
      ) {
        const len = e - s;
        cuts.push({
          start: s,
          end: s + len * n,
          qualityGrade: `Kartela ${n}×${len.toFixed(1)}m`,
          source: 'SWATCH',
        });
      }
    }
    const sorted = [...cuts].sort((a, b) => a.start - b.start);
    for (const c of sorted) {
      if (c.start < 0 || c.end > total) {
        return { error: `Kesim aralığı top sınırları dışında (${c.start}-${c.end})`, cuts: sorted };
      }
    }
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start < sorted[i - 1].end) {
        return {
          error: `Çakışan aralıklar: ${sorted[i - 1].start}-${sorted[i - 1].end} ile ${sorted[i].start}-${sorted[i].end}`,
          cuts: sorted,
        };
      }
    }
    const untouched: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (const c of sorted) {
      if (c.start > cursor) untouched.push({ start: cursor, end: c.start });
      cursor = c.end;
    }
    if (cursor < total) untouched.push({ start: cursor, end: total });

    return {
      error: null as string | null,
      cuts: sorted,
      untouched,
    };
  }, [selectedRoll, work.decisions, work.voluntaryCuts, work.swatchEntry]);

  const addVoluntaryCut = () => {
    if (!selectedRoll) return;
    const start = parseFloat(work.voluntaryEntry.start);
    const end = parseFloat(work.voluntaryEntry.end);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      Toast.show({ type: 'error', text1: 'Başlangıç ve bitiş sayı olmalı' });
      return;
    }
    if (end <= start) {
      Toast.show({ type: 'error', text1: 'Bitiş başlangıçtan büyük olmalı' });
      return;
    }
    if (start < 0 || end > selectedRoll.currentQty) {
      Toast.show({
        type: 'error',
        text1: 'Aralık top sınırları içinde olmalı',
        text2: `0 - ${selectedRoll.currentQty.toFixed(1)} mt`,
      });
      return;
    }
    if (!work.voluntaryEntry.qualityGrade) {
      Toast.show({ type: 'error', text1: 'Kalite seçin' });
      return;
    }
    const id = `vc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setWork((w) => ({
      ...w,
      voluntaryCuts: [
        ...w.voluntaryCuts,
        {
          id,
          start,
          end,
          qualityGrade: w.voluntaryEntry.qualityGrade,
          qualityName: w.voluntaryEntry.qualityName,
        },
      ],
      voluntaryEntry: EMPTY_VOLUNTARY_ENTRY,
    }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const removeVoluntaryCut = (id: string) => {
    setWork((w) => ({
      ...w,
      voluntaryCuts: w.voluntaryCuts.filter((c) => c.id !== id),
    }));
  };

  // Kartela: end - start, capture buttons just open numpad target — UI'ya gerek yok
  const swatchLength = useMemo(() => {
    const start = parseFloat(work.swatchEntry.startMeter);
    const end = parseFloat(work.swatchEntry.endMeter);
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return end - start;
  }, [work.swatchEntry]);

  const handleCreateSwatch = () => {
    if (!activeJob || !selectedRoll) return;
    if (swatchLength == null || swatchLength <= 0) {
      Toast.show({ type: 'error', text1: 'Kartela uzunluğu pozitif olmalı' });
      return;
    }
    const count = parseInt(work.swatchEntry.count, 10);
    if (Number.isNaN(count) || count < 1) {
      Toast.show({ type: 'error', text1: 'Adet 1 veya daha büyük olmalı' });
      return;
    }
    swatchMutation.mutate({
      sourceRollId: selectedRoll.rollId,
      length: swatchLength,
      count,
      purpose: work.swatchEntry.purpose.trim() || null,
      workOrderId: activeJob.stepSummary.workOrderId,
    });
  };

  // ── Finalize ──
  const handleFinalize = () => {
    if (!activeJob || !selectedRoll) return;
    // Validate decisions
    const decisions: TamburErrorDecision[] = [];
    for (const e of selectedRoll.errors) {
      const dec = work.decisions[e.id];
      if (!dec || !dec.decision) {
        Toast.show({
          type: 'error',
          text1: 'Karar eksik',
          text2: `Tüm hatalar için KES/KESME işaretlenmeli`,
        });
        return;
      }
      if (dec.decision === 'CUT' && !dec.qualityGrade) {
        Toast.show({
          type: 'error',
          text1: 'Kalite seçilmedi',
          text2: 'Kesilen parçaların kalitesi belirtilmeli',
        });
        return;
      }
      decisions.push({
        errorId: e.id,
        decision: dec.decision,
        qualityGrade: dec.decision === 'CUT' ? dec.qualityGrade : undefined,
      });
    }

    if (segmentPreview?.error) {
      Toast.show({ type: 'error', text1: 'Kesim hatası', text2: segmentPreview.error });
      return;
    }

    finalizeMutation.mutate({
      rollId: selectedRoll.rollId,
      decisions,
      voluntaryCuts: work.voluntaryCuts.map((v) => ({
        start: v.start,
        end: v.end,
        qualityGrade: v.qualityGrade,
      })),
      foldType: work.foldType ?? undefined,
      cutMode: 'BY_DEFECT', // sade akış — fixed-length sahada kullanılmıyor
    });
  };

  const allFinalized =
    activeJob &&
    activeJob.stepSummary.rolls.length === 0;

  // ── Render ──
  return (
    <ScreenChrome
      title="Tambur"
      subtitle="Kesim kararı + final + depoya gönderim"
    >
      <View style={styles.body}>
        {/* ════════ SOL: form ════════ */}
        <View style={styles.formCol}>
          {!activeJob ? (
            <View style={styles.emptyState}>
              <Icon source="card-search-outline" size={64} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>Kart açılmadı</Text>
              <Text style={styles.emptyHint}>
                Sağdan refakat kartını okutarak başlayın
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
              {/* Sticky header */}
              <Surface style={styles.headerBand} elevation={2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.headerBarcode}>{selectedRoll.barcode}</Text>
                  <Text style={styles.headerSub}>
                    {selectedRoll.itemName}
                    {selectedRoll.variantName ? ` · ${selectedRoll.variantName}` : ''}
                    {' · '}
                    Giriş: {selectedRoll.currentQty.toFixed(1)} mt
                    {selectedRoll.width != null ? ` · ${selectedRoll.width} cm` : ''}
                  </Text>
                </View>
              </Surface>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {/* Kesim listesi */}
                <Surface style={styles.section} elevation={1}>
                  <Text style={styles.sectionTitle}>
                    Kesim Listesi ({selectedRoll.errors.length})
                  </Text>
                  {selectedRoll.errors.length === 0 && (
                    <Text style={styles.muted}>
                      Hata kaydı yok. Aşağıdan ekleyebilir veya doğrudan finalize edebilirsiniz.
                    </Text>
                  )}
                  {selectedRoll.errors.map((e, idx) => {
                    const dec = work.decisions[e.id];
                    const isCut = dec?.decision === 'CUT';
                    const isNoCut = dec?.decision === 'NO_CUT';
                    const defectType = defectTypes.find(
                      (d) => d.name === e.errorType
                    );
                    const isCritical = defectType?.severity === 'CRITICAL';
                    return (
                      <View
                        key={e.id}
                        style={[
                          styles.errorCard,
                          isCritical && styles.errorCardCritical,
                          isCut && styles.errorCardCut,
                        ]}
                      >
                        <View style={styles.errorHeader}>
                          <View style={styles.errorIndex}>
                            <Text style={styles.errorIndexText}>{idx + 1}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.errorTitle}>
                              {e.errorType ?? '—'}
                              {isCritical && (
                                <Text style={styles.criticalBadge}> ⚠ KES öner</Text>
                              )}
                            </Text>
                            <Text style={styles.errorRange}>
                              {e.startMeter.toFixed(1)} – {e.endMeter.toFixed(1)} mt
                              {' · '}
                              {(e.endMeter - e.startMeter).toFixed(1)} mt
                            </Text>
                          </View>
                          <IconButton
                            icon="trash-can-outline"
                            size={20}
                            iconColor="#dc2626"
                            onPress={() =>
                              deleteErrorMutation.mutate({ errorId: e.id })
                            }
                            style={{ margin: 0 }}
                            accessibilityLabel="Hatayı sil"
                          />
                        </View>

                        {/* KES/KESME toggle */}
                        <View style={styles.decisionRow}>
                          <Button
                            mode={isCut ? 'contained' : 'outlined'}
                            icon="content-cut"
                            buttonColor={isCut ? '#dc2626' : undefined}
                            textColor={isCut ? '#fff' : '#dc2626'}
                            onPress={() => setDecision(e.id, 'CUT')}
                            style={[styles.decisionBtn, { borderColor: '#dc2626' }]}
                            contentStyle={styles.decisionBtnContent}
                          >
                            KES
                          </Button>
                          <Button
                            mode={isNoCut ? 'contained' : 'outlined'}
                            icon="check"
                            buttonColor={isNoCut ? '#059669' : undefined}
                            textColor={isNoCut ? '#fff' : '#059669'}
                            onPress={() => setDecision(e.id, 'NO_CUT')}
                            style={[styles.decisionBtn, { borderColor: '#059669' }]}
                            contentStyle={styles.decisionBtnContent}
                          >
                            KESME
                          </Button>
                        </View>

                        {/* KES ise kalite seçimi */}
                        {isCut && (
                          <View style={styles.qualityRow}>
                            <Text style={styles.qualityLabel}>Kesilen parça kalitesi:</Text>
                            <View style={styles.qualityGrid}>
                              {qualityGrades.map((qg) => {
                                const active = dec?.qualityGrade === qg.code;
                                return (
                                  <TouchableRipple
                                    key={qg.id}
                                    borderless
                                    onPress={() => setQualityGrade(e.id, qg.code)}
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
                          </View>
                        )}
                      </View>
                    );
                  })}
                </Surface>

                {/* Yeni kesim gir — sürekli açık */}
                <Surface style={styles.entrySection} elevation={1}>
                  <Text style={styles.sectionTitle}>Yeni Kesim Gir</Text>
                  <View style={styles.meterRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entryLabel}>Başlangıç (mt)</Text>
                      <NumpadInput
                        mode="outlined"
                        value={work.errorEntry.startMeter}
                        onChangeText={(v) =>
                          setWork((w) => ({
                            ...w,
                            errorEntry: { ...w.errorEntry, startMeter: v },
                          }))
                        }
                        numpadLabel="Kesim başlangıç"
                        allowDecimal
                        numpadMaxLength={8}
                        placeholder="0"
                        dense
                        style={styles.input}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entryLabel}>Bitiş (mt)</Text>
                      <NumpadInput
                        mode="outlined"
                        value={work.errorEntry.endMeter}
                        onChangeText={(v) =>
                          setWork((w) => ({
                            ...w,
                            errorEntry: { ...w.errorEntry, endMeter: v },
                          }))
                        }
                        numpadLabel="Kesim bitiş"
                        allowDecimal
                        numpadMaxLength={8}
                        placeholder="0"
                        dense
                        style={styles.input}
                      />
                    </View>
                  </View>

                  <Text style={[styles.entryLabel, { marginTop: 4 }]}>Hata Tipi</Text>
                  {defectTypes.length === 0 ? (
                    <Text style={styles.muted}>
                      Hata tipi tanımlı değil — admin'den ekleyin
                    </Text>
                  ) : (
                    <View style={styles.chipGrid}>
                      {defectTypes.map((dt) => {
                        const active = work.errorEntry.defectTypeId === dt.id;
                        return (
                          <TouchableRipple
                            key={dt.id}
                            borderless
                            onPress={() =>
                              setWork((w) => ({
                                ...w,
                                errorEntry: {
                                  ...w.errorEntry,
                                  defectTypeId: active ? '' : dt.id,
                                },
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

                  <Button
                    mode="contained"
                    icon="plus-circle"
                    onPress={handleAddError}
                    loading={reportErrorMutation.isPending}
                    disabled={
                      reportErrorMutation.isPending ||
                      !work.errorEntry.defectTypeId ||
                      !work.errorEntry.startMeter ||
                      !work.errorEntry.endMeter
                    }
                    buttonColor="#d97706"
                    style={styles.addBtn}
                    contentStyle={styles.addBtnContent}
                    labelStyle={styles.addBtnLabel}
                  >
                    Listeye Ekle
                  </Button>
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

                {/* Gönüllü Kesim — defect dışı, operatörün belirlediği aralıklar */}
                <Surface style={styles.section} elevation={1}>
                  <Text style={styles.sectionTitle}>Gönüllü Kesim</Text>
                  <Text style={styles.muted}>
                    Defect'ten bağımsız olarak topu istediğin aralıkta böl. Aralık
                    aynı topta kesimle ayrılmış yeni bir parça olur.
                  </Text>

                  {work.voluntaryCuts.length > 0 && (
                    <View style={{ gap: 4, marginTop: 4 }}>
                      {work.voluntaryCuts.map((vc) => (
                        <View key={vc.id} style={styles.defectRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.defectName}>
                              {vc.start.toFixed(1)} – {vc.end.toFixed(1)} mt ·{' '}
                              {(vc.end - vc.start).toFixed(1)} mt
                            </Text>
                            <Text style={styles.defectRange}>
                              {vc.qualityName ?? vc.qualityGrade}
                            </Text>
                          </View>
                          <IconButton
                            icon="trash-can-outline"
                            size={20}
                            iconColor="#dc2626"
                            onPress={() => removeVoluntaryCut(vc.id)}
                            accessibilityLabel="Kesimi sil"
                            style={{ margin: 0 }}
                          />
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={styles.meterRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entryLabel}>Başlangıç (mt)</Text>
                      <NumpadInput
                        mode="outlined"
                        value={work.voluntaryEntry.start}
                        onChangeText={(v) =>
                          setWork((w) => ({
                            ...w,
                            voluntaryEntry: { ...w.voluntaryEntry, start: v },
                          }))
                        }
                        numpadLabel="Gönüllü kesim başlangıç"
                        allowDecimal
                        numpadMaxLength={8}
                        placeholder="0"
                        dense
                        style={styles.input}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entryLabel}>Bitiş (mt)</Text>
                      <NumpadInput
                        mode="outlined"
                        value={work.voluntaryEntry.end}
                        onChangeText={(v) =>
                          setWork((w) => ({
                            ...w,
                            voluntaryEntry: { ...w.voluntaryEntry, end: v },
                          }))
                        }
                        numpadLabel="Gönüllü kesim bitiş"
                        allowDecimal
                        numpadMaxLength={8}
                        placeholder="0"
                        dense
                        style={styles.input}
                      />
                    </View>
                  </View>

                  <Text style={[styles.qualityLabel, { marginTop: 4 }]}>
                    Kalite
                  </Text>
                  <View style={styles.qualityGrid}>
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

                  <Button
                    mode="contained"
                    icon="plus-circle"
                    onPress={addVoluntaryCut}
                    buttonColor="#7c3aed"
                    style={styles.addBtn}
                    contentStyle={styles.addBtnContent}
                    disabled={
                      !work.voluntaryEntry.start ||
                      !work.voluntaryEntry.end ||
                      !work.voluntaryEntry.qualityGrade
                    }
                  >
                    Listeye Ekle
                  </Button>
                </Surface>

                {/* Çıkış Önizleme — kesimler sonrası parçalar */}
                {segmentPreview && (
                  <Surface style={styles.section} elevation={1}>
                    <Text style={styles.sectionTitle}>Çıkış Önizleme</Text>
                    {segmentPreview.error ? (
                      <Text style={[styles.muted, { color: '#dc2626' }]}>
                        {segmentPreview.error}
                      </Text>
                    ) : (
                      <View style={{ gap: 4 }}>
                        <Text style={styles.muted}>
                          Top giriş: {selectedRoll.currentQty.toFixed(1)} mt · Parent bölünecek (Bölündü)
                        </Text>
                        {segmentPreview.untouched!.map((s, i) => (
                          <View key={`u-${i}`} style={styles.defectRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.defectName}>
                                Yeni iyi parça {i + 1}: {(s.end - s.start).toFixed(1)} mt
                              </Text>
                              <Text style={styles.defectRange}>
                                [{s.start.toFixed(1)} – {s.end.toFixed(1)}] · WAREHOUSE
                              </Text>
                            </View>
                          </View>
                        ))}
                        {segmentPreview.cuts.map((c, i) => (
                          <View key={`cut-${i}`} style={styles.defectRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.defectName}>
                                {c.source === 'DEFECT'
                                  ? 'Defect kesim'
                                  : c.source === 'VOLUNTARY'
                                    ? 'Gönüllü kesim'
                                    : 'Kartela (taslak)'}: {(c.end - c.start).toFixed(1)} mt
                              </Text>
                              <Text style={styles.defectRange}>
                                [{c.start.toFixed(1)} – {c.end.toFixed(1)}] · {c.qualityGrade}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                  </Surface>
                )}

                {/* Kartela */}
                <Surface style={styles.section} elevation={1}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.sectionTitle}>Kartela (opsiyonel)</Text>
                    {!work.swatchEntry.open ? (
                      <Button
                        mode="contained-tonal"
                        icon="content-copy"
                        compact
                        onPress={() =>
                          setWork((w) => ({
                            ...w,
                            swatchEntry: { ...EMPTY_SWATCH_ENTRY, open: true },
                          }))
                        }
                      >
                        Kartela Bas
                      </Button>
                    ) : (
                      <IconButton
                        icon="close"
                        size={20}
                        onPress={() =>
                          setWork((w) => ({ ...w, swatchEntry: EMPTY_SWATCH_ENTRY }))
                        }
                        style={{ margin: 0 }}
                      />
                    )}
                  </View>

                  {work.swatchEntry.open && (
                    <>
                      <Text style={styles.muted}>
                        Sarımdayken metreyi çek: başlangıçta tek tıkla, kartela
                        bittiğinde tekrar tıkla.
                      </Text>
                      <View style={styles.meterRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.entryLabel}>Başlangıç (mt)</Text>
                          <NumpadInput
                            mode="outlined"
                            value={work.swatchEntry.startMeter}
                            onChangeText={(v) =>
                              setWork((w) => ({
                                ...w,
                                swatchEntry: { ...w.swatchEntry, startMeter: v },
                              }))
                            }
                            numpadLabel="Kartela başlangıç"
                            allowDecimal
                            numpadMaxLength={8}
                            placeholder="0"
                            dense
                            style={styles.input}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.entryLabel}>Bitiş (mt)</Text>
                          <NumpadInput
                            mode="outlined"
                            value={work.swatchEntry.endMeter}
                            onChangeText={(v) =>
                              setWork((w) => ({
                                ...w,
                                swatchEntry: { ...w.swatchEntry, endMeter: v },
                              }))
                            }
                            numpadLabel="Kartela bitiş"
                            allowDecimal
                            numpadMaxLength={8}
                            placeholder="0"
                            dense
                            style={styles.input}
                          />
                        </View>
                      </View>
                      {swatchLength != null && swatchLength > 0 && (
                        <Text style={styles.swatchInfo}>
                          Uzunluk: {swatchLength.toFixed(2)} mt
                        </Text>
                      )}
                      <View style={styles.meterRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.entryLabel}>Adet</Text>
                          <NumpadInput
                            mode="outlined"
                            value={work.swatchEntry.count}
                            onChangeText={(v) =>
                              setWork((w) => ({
                                ...w,
                                swatchEntry: { ...w.swatchEntry, count: v },
                              }))
                            }
                            numpadLabel="Kartela adet"
                            allowDecimal={false}
                            numpadMaxLength={4}
                            placeholder="1"
                            dense
                            style={styles.input}
                          />
                        </View>
                        <View style={{ flex: 2 }}>
                          <Text style={styles.entryLabel}>Amaç (ops)</Text>
                          <TextInput
                            mode="outlined"
                            value={work.swatchEntry.purpose}
                            onChangeText={(v) =>
                              setWork((w) => ({
                                ...w,
                                swatchEntry: { ...w.swatchEntry, purpose: v },
                              }))
                            }
                            placeholder="Müşteri numune..."
                            dense
                            style={styles.input}
                          />
                        </View>
                      </View>
                      <Button
                        mode="contained"
                        icon="content-copy"
                        onPress={handleCreateSwatch}
                        loading={swatchMutation.isPending}
                        disabled={
                          swatchMutation.isPending ||
                          swatchLength == null ||
                          swatchLength <= 0
                        }
                        buttonColor="#7c3aed"
                        style={styles.addBtn}
                        contentStyle={styles.addBtnContent}
                      >
                        Kartelayı Bas
                      </Button>
                    </>
                  )}
                </Surface>
              </ScrollView>

              {/* Sticky footer */}
              <Surface style={styles.footer} elevation={4}>
                <Button
                  mode="contained"
                  icon="warehouse"
                  onPress={handleFinalize}
                  loading={finalizeMutation.isPending}
                  disabled={
                    finalizeMutation.isPending || !!segmentPreview?.error
                  }
                  buttonColor="#1e40af"
                  style={styles.footerBtn}
                  contentStyle={styles.footerBtnContent}
                  labelStyle={styles.footerBtnLabel}
                >
                  Tamburu Bitir → Depoya Gönder
                </Button>
              </Surface>
            </>
          )}
        </View>

        {/* ════════ SAĞ: card scan + tab + roll list + numpad ════════ */}
        <View style={styles.rightCol}>
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
                      icon={() => <ActivityIndicator size={18} color="#1e40af" />}
                    />
                  ) : cardBarcode.trim() ? (
                    <TextInput.Icon
                      icon="check"
                      onPress={handleResolveCard}
                      color="#1e40af"
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
            {/* Eylem butonları: sol → Yeniden Kes · sağ → Çıkan Toplar */}
            <View style={styles.actionBtnRow}>
              <Button
                mode="outlined"
                icon="content-cut"
                compact
                onPress={() => setResplitOpen(true)}
                textColor="#0f172a"
              >
                Yeniden Kes
              </Button>
              <Button
                mode="outlined"
                icon="printer-search"
                compact
                onPress={() => setRecentOutputOpen(true)}
                textColor="#0f172a"
              >
                Çıkan Toplar
              </Button>
            </View>
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
                <RefreshButton
                  onPress={refetchActiveJob}
                  refreshing={false}
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
              <Text style={styles.paneEmptyHint}>
                Sekmeyi kapatabilirsin
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

          {/* Sabit numpad */}
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

      {/* Yeniden kesim modal'ı */}
      <ResplitModal
        visible={resplitOpen}
        loading={resplitMutation.isPending}
        onDismiss={() => setResplitOpen(false)}
        onSubmit={(payload) => resplitMutation.mutate(payload)}
      />

      {/* Etiket basımı modal'ı — finalize/post-split sonrası */}
      <LabelPrintModal
        rolls={pendingPrintRolls}
        batchNumber={activeJob?.stepSummary.batchNumber ?? null}
        onDismiss={() => setPendingPrintRolls([])}
        onPrint={(roll) => setActivePrintRoll(roll)}
        printingRollId={activePrintRoll?.id ?? null}
      />

      {/* Tambur'dan çıkmış toplar listesi — geçmişten etiket yeniden basımı */}
      <RecentOutputModal
        visible={recentOutputOpen}
        onDismiss={() => setRecentOutputOpen(false)}
        onPrint={(roll) => setActivePrintRoll(roll)}
        printingRollId={activePrintRoll?.id ?? null}
      />

      {/* Aktif yazdırma — LabelPrinter expo-print ile PDF/sistem yazdırma açar */}
      <LabelPrinter
        roll={activePrintRoll}
        batchNumber={
          activePrintRoll
            ? (activeJob?.stepSummary.batchNumber ?? null)
            : null
        }
        onDone={() => setActivePrintRoll(null)}
      />
    </ScreenChrome>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Yeniden Kesim Modal — depodaki topu istenen metrede ikiye böl
// ─────────────────────────────────────────────────────────────────────────────
function ResplitModal({
  visible,
  loading,
  onDismiss,
  onSubmit,
}: {
  visible: boolean;
  loading: boolean;
  onDismiss: () => void;
  onSubmit: (payload: {
    rollId: string;
    cutLength: number;
    originalKeepsLarger: boolean;
  }) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [rollBarcode, setRollBarcode] = useState('');
  const [resolvedRollId, setResolvedRollId] = useState<string | null>(null);
  const [rollMeta, setRollMeta] = useState<{
    barcode: string;
    currentQty: number;
    item: string;
  } | null>(null);
  const [cutLength, setCutLength] = useState('');
  const [originalKeepsLarger, setOriginalKeepsLarger] = useState(true);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setRollBarcode('');
      setResolvedRollId(null);
      setRollMeta(null);
      setCutLength('');
      setOriginalKeepsLarger(true);
    }
  }, [visible]);

  const handleResolve = async () => {
    const barcode = rollBarcode.trim();
    if (!barcode) return;
    setResolving(true);
    try {
      const { rollService } = await import('../../../services/roll.service');
      const res = await rollService.getByBarcode(barcode);
      const r = res.data;
      if (!r) {
        Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: barcode });
        return;
      }
      if (r.status !== 'WAREHOUSE' && r.status !== 'A1_STOCK') {
        Toast.show({
          type: 'error',
          text1: 'Top kesime uygun değil',
          text2: `Durum: ${r.status} (depodaki toplar kesilebilir)`,
        });
        return;
      }
      setResolvedRollId(r.id);
      setRollMeta({
        barcode: r.barcode,
        currentQty: r.currentQty,
        item: r.item?.name ?? '—',
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: 'Top sorgulanamadı',
        text2: (err as Error).message,
      });
    } finally {
      setResolving(false);
    }
  };

  const handleSubmit = () => {
    if (!resolvedRollId || !rollMeta) return;
    const cut = parseFloat(cutLength);
    if (Number.isNaN(cut) || cut <= 0) {
      Toast.show({ type: 'error', text1: 'Kesim metresi pozitif olmalı' });
      return;
    }
    if (cut >= rollMeta.currentQty) {
      Toast.show({
        type: 'error',
        text1: 'Geçersiz metraj',
        text2: `Topun toplam metrajından (${rollMeta.currentQty}m) küçük olmalı`,
      });
      return;
    }
    onSubmit({
      rollId: resolvedRollId,
      cutLength: cut,
      originalKeepsLarger,
    });
  };

  const remainingPart = rollMeta
    ? originalKeepsLarger
      ? rollMeta.currentQty - (parseFloat(cutLength) || 0)
      : parseFloat(cutLength) || 0
    : 0;
  const cutPart = rollMeta
    ? originalKeepsLarger
      ? parseFloat(cutLength) || 0
      : rollMeta.currentQty - (parseFloat(cutLength) || 0)
    : 0;

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
      avoidKeyboard
    >
      <View style={[cameraStyles.sheet, { width: winW * 0.65, maxHeight: winH * 0.85 }]}>
        <View style={[cameraStyles.header, { backgroundColor: '#fef2f2' }]}>
          <Icon source="content-cut" size={22} color="#b91c1c" />
          <Text variant="titleMedium" style={cameraStyles.title}>
            Depo Topu Yeniden Kes
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <Text style={resplitStyles.muted}>
            Depodaki bir topu istenen metrede ikiye böler. Aynı kalitede iki top
            oluşur, ikisi de WAREHOUSE'da kalır. Çuvallanmış toplar kesilemez.
          </Text>

          {!resolvedRollId ? (
            <>
              <Text style={resplitStyles.label}>Top Barkodu</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  mode="outlined"
                  value={rollBarcode}
                  onChangeText={setRollBarcode}
                  placeholder="Top barkodu okut/yaz..."
                  autoCapitalize="characters"
                  autoCorrect={false}
                  onSubmitEditing={handleResolve}
                  returnKeyType="search"
                  style={[resplitStyles.input, { flex: 1 }]}
                />
                <Button
                  mode="contained"
                  onPress={handleResolve}
                  loading={resolving}
                  disabled={resolving || !rollBarcode.trim()}
                  buttonColor="#1e40af"
                >
                  Bul
                </Button>
              </View>
            </>
          ) : (
            <>
              <Surface style={resplitStyles.rollCard} elevation={1}>
                <Text style={resplitStyles.rollBarcode}>{rollMeta?.barcode}</Text>
                <Text style={resplitStyles.rollItem}>{rollMeta?.item}</Text>
                <Text style={resplitStyles.rollQty}>
                  Mevcut metraj: {rollMeta?.currentQty.toFixed(1)} m
                </Text>
              </Surface>

              <Text style={resplitStyles.label}>Kesim Metresi</Text>
              <NumpadInput
                mode="outlined"
                value={cutLength}
                onChangeText={setCutLength}
                numpadLabel="Kesim metresi"
                allowDecimal
                placeholder="0"
                style={resplitStyles.input}
              />

              <Text style={resplitStyles.label}>Hangi parça orijinal top kalsın?</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableRipple
                  borderless
                  onPress={() => setOriginalKeepsLarger(true)}
                  style={[
                    resplitStyles.choiceChip,
                    originalKeepsLarger && resplitStyles.choiceChipActive,
                  ]}
                >
                  <Text
                    style={[
                      resplitStyles.choiceChipText,
                      originalKeepsLarger && resplitStyles.choiceChipTextActive,
                    ]}
                  >
                    Büyük parça orijinal
                  </Text>
                </TouchableRipple>
                <TouchableRipple
                  borderless
                  onPress={() => setOriginalKeepsLarger(false)}
                  style={[
                    resplitStyles.choiceChip,
                    !originalKeepsLarger && resplitStyles.choiceChipActive,
                  ]}
                >
                  <Text
                    style={[
                      resplitStyles.choiceChipText,
                      !originalKeepsLarger && resplitStyles.choiceChipTextActive,
                    ]}
                  >
                    Küçük parça orijinal
                  </Text>
                </TouchableRipple>
              </View>

              {cutLength && rollMeta && (
                <Surface style={resplitStyles.preview} elevation={0}>
                  <Text style={resplitStyles.previewTitle}>Sonuç:</Text>
                  <Text style={resplitStyles.previewText}>
                    Orijinal top: {remainingPart.toFixed(1)} m
                  </Text>
                  <Text style={resplitStyles.previewText}>
                    Yeni top: {cutPart.toFixed(1)} m
                  </Text>
                </Surface>
              )}

              <Button
                mode="contained"
                icon="content-cut"
                onPress={handleSubmit}
                loading={loading}
                disabled={loading || !cutLength}
                buttonColor="#b91c1c"
                style={{ marginTop: 4 }}
                contentStyle={{ height: 52 }}
                labelStyle={{ fontSize: 15, fontWeight: '700' }}
              >
                Kesimi Onayla
              </Button>
            </>
          )}
        </ScrollView>
      </View>
    </RNModal>
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
  const color = roll.item?.color ?? null;
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
          {roll.barcode}
        </Text>
        <Text style={resplitStyles.labelItemName} numberOfLines={1}>
          {roll.item?.name ?? '—'}
          {roll.variant?.name ? ` · ${roll.variant.name}` : ''}
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
  if (rolls.length === 0) return null;

  return (
    <RNModal
      isVisible={rolls.length > 0}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.55}
      style={cameraStyles.modal}
      useNativeDriver
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
    >
      <View style={[cameraStyles.sheet, { width: winW * 0.45, maxHeight: winH * 0.85 }]}>
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
  const q = useQuery({
    queryKey: ['tambur', 'recent-output-rolls'],
    queryFn: () => tamburService.recentOutputRolls({ limit: 50 }),
    enabled: visible,
    staleTime: 30 * 1000,
  });
  const rolls: Roll[] = q.data?.data ?? [];

  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.55}
      style={cameraStyles.modal}
      useNativeDriver
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
    >
      <View style={[cameraStyles.sheet, { width: winW * 0.5, height: winH * 0.85 }]}>
        <View style={[cameraStyles.header, { backgroundColor: '#dbeafe', paddingVertical: 8 }]}>
          <Icon source="printer-search" size={20} color="#1e40af" />
          <Text variant="titleMedium" style={cameraStyles.title}>
            Tambur Çıktı Toplar
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton
            icon="refresh"
            size={20}
            onPress={() => q.refetch()}
            disabled={q.isFetching}
            style={{ margin: 0 }}
          />
          <IconButton icon="close" size={20} onPress={onDismiss} style={{ margin: 0 }} />
        </View>

        <View style={{ flex: 1 }}>
          {q.isLoading ? (
            <View style={cameraStyles.empty}>
              <ActivityIndicator size="large" color="#1e40af" />
            </View>
          ) : q.isError ? (
            <View style={cameraStyles.empty}>
              <Text style={cameraStyles.emptyText}>
                Liste yüklenemedi: {(q.error as Error).message}
              </Text>
            </View>
          ) : rolls.length === 0 ? (
            <View style={cameraStyles.empty}>
              <Icon source="package-variant" size={48} color="#cbd5e1" />
              <Text style={cameraStyles.emptyText}>
                Henüz Tambur'dan çıkmış top yok
              </Text>
            </View>
          ) : (
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
          )}
        </View>
      </View>
    </RNModal>
  );
}

const resplitStyles = StyleSheet.create({
  muted: { fontSize: 12, color: '#475569', lineHeight: 18 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0f172a',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: { backgroundColor: '#fff' },
  rollCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  rollBarcode: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  rollItem: { fontSize: 13, color: '#475569' },
  rollQty: { fontSize: 13, color: '#0f172a', fontWeight: '600', marginTop: 4 },
  choiceChip: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#cbd5e1',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  choiceChipActive: { backgroundColor: '#1e40af', borderColor: '#1e3a8a' },
  choiceChipText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  choiceChipTextActive: { color: '#fff' },
  preview: {
    backgroundColor: '#dbeafe',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  previewTitle: { fontSize: 11, fontWeight: '700', color: '#1e40af' },
  previewText: { fontSize: 13, color: '#0f172a', fontWeight: '600' },

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
              {roll.barcode}
            </Text>
            <Text style={helperStyles.rollItemName} numberOfLines={1}>
              {roll.itemName}
              {roll.variantName ? ` · ${roll.variantName}` : ''}
            </Text>
            <View style={helperStyles.rollChips}>
              <View style={helperStyles.chipNeutral}>
                <Text style={helperStyles.chipText}>
                  {roll.currentQty.toFixed(1)} mt
                </Text>
              </View>
              {roll.errorCount > 0 && (
                <View style={helperStyles.chipAmber}>
                  <Text style={helperStyles.chipText}>{roll.errorCount} hata</Text>
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
  },
  headerBarcode: {
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  headerSub: { fontSize: 12, color: '#cbd5e1', marginTop: 2 },

  scrollContent: { padding: 12, gap: 10 },
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
  meterRow: { flexDirection: 'row', gap: 10 },
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

  swatchInfo: { fontSize: 13, fontWeight: '700', color: '#7c3aed' },

  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    padding: 10,
  },
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
  rollChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  chipAmber: {
    backgroundColor: '#fef3c7',
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
