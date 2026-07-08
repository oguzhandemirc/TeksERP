import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import AppModal from '../../../components/AppModal';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Surface,
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
import StationActionButton from '../../../components/StationActionButton';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { useDrawerActionQueue } from '../../../hooks/useDrawerActionQueue';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh, type ManualRefresh } from '../../../hooks/useManualRefresh';
import NumpadInput from '../../../components/NumpadInput';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { NumpadHost } from '../../../components/NumpadProvider';
import { RightPanelDrawer } from '../../../components/RightPanelDrawer';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import {
  kursunQcService,
  type CompleteQc2Request,
  type ReportErrorRequest,
  type DeleteErrorRequest,
  type FinishStepRequest,
  type ReopenPreview,
} from '../../../services/kursunQc.service';
import { isWorkSessionLost } from '../../../services/api';
import { defectTypeService } from '../../../services/defectType.service';
import { rollService } from '../../../services/roll.service';
import { STATION_MUT } from '../../../offline/mutations';
import { generateClientUuid } from '../../../offline/barcode';
import SyncStatusChip from '../../../components/SyncStatusChip';
import { SkeletonList, usePressScale } from '../../../components/motion';
import Reanimated from 'react-native-reanimated';
import { formatRelativeWait } from '../../../utils/relativeTime';
import type {
  KursunStepSummary,
  KursunRollSummary,
  KursunRollDefectSummary,
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

// Hata giriş alanı sürekli açık. rollId tutmuyoruz: top değişimi metrajı
// sıfırlar, "yanlış topa yazılmış" senaryosu olamaz.
//
// Yeni model: hata aralık değil NOKTA. Operatör yalnız "kaç. metrede hata
// başladı" girer; bitiş Tambur'da kesim kararıyla belirlenir. Hata tipi
// tuşları ANA AKSİYON: metraj girip tipe basınca hata DİREKT kaydedilir
// (ayrı "Ekle" tuşu yok, ön-seçim yok).

/** Açık kart listesinin otomatik yenileme aralığı (modal başlığında gösterilir). */
const OPEN_CARDS_REFETCH_MS = 15 * 1000;

// Koyu header'da etiketli aksiyon pill'i (ikon + ne olduğu yazısı) — Tambur
// ekranıyla aynı stil. `badge` = sağ üst köşede küçük rozet (acil sayısı).
function HeaderChip({
  icon,
  label,
  onPress,
  badge,
  iconAnimatedStyle,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  badge?: React.ReactNode;
  iconAnimatedStyle?: object;
}) {
  return (
    <View style={styles.headerChipWrap}>
      <TouchableRipple
        onPress={onPress}
        style={styles.headerChip}
        borderless
        rippleColor="rgba(255,255,255,0.2)"
        accessibilityLabel={label}
      >
        <View style={styles.headerChipInner}>
          <Reanimated.View style={iconAnimatedStyle}>
            <Icon source={icon} size={18} color="#fff" />
          </Reanimated.View>
          <Text style={styles.headerChipText}>{label}</Text>
        </View>
      </TouchableRipple>
      {badge}
    </View>
  );
}

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
  /** Kapalı kart okutulunca: reopen onayı için bekleyen istem (preview + bağlam).
   *  Otomatik reopen YOK — operatör onaylamadan toplar Tambur'dan çekilmez. */
  const [reopenPrompt, setReopenPrompt] = useState<{
    barcode: string;
    fromInput: boolean;
    stepId: string;
    batchNumber: string;
    preview: ReopenPreview;
  } | null>(null);
  const [reopening, setReopening] = useState(false);
  const [startMeter, setStartMeter] = useState('');
  const [listModalOpen, setListModalOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  /** İş emri adım notu (WorkOrderStep.notes) tam metin modal'ı. */
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  /** Refactor 4 — "yanlış istasyon" / kart bulunamadı backend mesajı banner. */
  const [cardError, setCardError] = useState<string | null>(null);
  /** Cetveldeki hata noktasına dokununca: o noktadaki hata id'leri (silme modalı). */
  const [deletePointIds, setDeletePointIds] = useState<string[] | null>(null);

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

  // Açık Kartlar modalındaki manuel "Yenile" — standart RefreshButton davranışı
  // (dönen ikon + haptic + toast). Auto-poll (openCardsQuery.isFetching) butonu
  // döndürmez; spinner/toast yalnızca operatör bizzat bastığında çıkar.
  const openCardsRefresh = useManualRefresh(
    () => openCardsQuery.refetch(),
    'Açık kartlar güncellendi',
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
  // Saha #18: "GENEL" hata tipi her zaman İLK tuş — operatör tip belirtmek
  // istemediğinde varsayılan olarak ona basar (katalog sırası ne olursa olsun).
  const defectTypes = useMemo(() => {
    const list = defectTypesQuery.data?.data ?? [];
    const idx = list.findIndex((d) => d.code === 'GENEL');
    if (idx <= 0) return list;
    return [list[idx]!, ...list.slice(0, idx), ...list.slice(idx + 1)];
  }, [defectTypesQuery.data]);

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

  // Cetveldeki hata noktası modalı — dokunulan marker'ın hata id'leri CANLI defect
  // listesinden çözülür; hata silindikçe liste küçülür, boşalınca modal kapanır
  // (o noktadaki tüm hatalar silindi → nokta kalmadı).
  const deletePointDefects = useMemo(() => {
    if (!deletePointIds || !selectedRoll) return [];
    const set = new Set(deletePointIds);
    return selectedRoll.defects.filter((d) => set.has(d.id));
  }, [deletePointIds, selectedRoll]);
  useEffect(() => {
    if (deletePointIds !== null && deletePointDefects.length === 0) {
      setDeletePointIds(null);
    }
  }, [deletePointIds, deletePointDefects.length]);

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

  // Manuel "Yenile" — aktif kartı + açık kart listesini birlikte tazeler.
  // Standart useManualRefresh: offline guard + zaman aşımı + tek tip animasyon/
  // haptic/toast. refetchActiveJob axios fn'i (offline'da throw eder),
  // openCards react-query refetch'i — hook ikisinin de hatasını doğru ele alır,
  // böylece artık "ağ kopukken yanlış 'Yenilendi'" olmaz.
  const activeRefresh = useManualRefresh(
    [
      () => (activeJob ? refetchActiveJob() : Promise.resolve()),
      () => openCardsQuery.refetch(),
    ],
    'Yenilendi',
  );

  // ── Kart çözümleme ─────────────────────────────────────────────────────────
  // Barkod parametreli ortak çözüm — input + kamera modalı bunu paylaşır.
  // K-A5: cift cozumleme guard ref'i.
  const resolveInFlightRef = useRef(false);

  const resolveCard = async (barcode: string, fromInput: boolean) => {
    if (!barcode) return;
    // K-A5 fix: cozumleme ucustayken ikinci tetik (cift okutma/cift Enter) ayni
    // kartin IKI sekme acilmasina yol aciyordu — in-flight guard.
    if (resolveInFlightRef.current) return;

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

    resolveInFlightRef.current = true;
    setResolvingCard(true);
    setCardError(null);
    try {
      // Refactor 4 — backend artık yanlış istasyonda 400 atıyor:
      //   "Bu iş emrinin 'Kurşun + KK2' adımında şu an açık top yok.
      //    Mevcut konum: Boyahane (4 rulo)."
      // Mesaj catch block'unda banner'a yansıtılır.
      const res = await kursunQcService.getByCardBarcode(barcode);
      const step = res.data as KursunStepSummary | undefined;
      if (!step) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setCardError(`Kart bulunamadı: ${barcode}`);
        Toast.show({ type: 'error', text1: 'Kart bulunamadı', text2: barcode });
        return;
      }

      // Adım kapatılmışsa OTOMATİK reopen YOK — yıkıcı (toplar Tambur'dan geri
      // çekilir). Önce önizleme çek, onay modalını aç; reopen kullanıcı onayıyla.
      if (step.status === 'COMPLETED') {
        const prev = await kursunQcService.reopenPreview(step.workOrderStepId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setReopenPrompt({
          barcode,
          fromInput,
          stepId: step.workOrderStepId,
          batchNumber: step.batchNumber,
          preview: prev.data,
        });
        return; // iş, onay sonrası confirmReopen ile açılır
      }

      openResolvedStep(barcode, step, fromInput, false);
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
      resolveInFlightRef.current = false;
    }
  };

  // Çözülen adımı sekme olarak açar (normal + reopen sonrası ortak).
  const openResolvedStep = (
    barcode: string,
    step: KursunStepSummary,
    fromInput: boolean,
    reopened: boolean,
  ) => {
    const newJob: OpenJob = {
      cardId: barcode, // unique key — barkod yeterli
      cardNumber: step.batchNumber,
      cardBarcode: barcode,
      stepSummary: step,
      selectedRollId: null,
    };
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setOpenJobs((prev) => [...prev, newJob]);
    setActiveCardId(newJob.cardId);
    if (fromInput) setCardBarcode('');
    Toast.show(
      reopened
        ? {
            type: 'info',
            text1: 'Adım yeniden açıldı',
            text2: `${step.rolls.length} top Tambur'dan geri çekildi`,
          }
        : {
            type: 'success',
            text1: 'Kart açıldı',
            text2: `${step.batchNumber} · ${step.rolls.length} top`,
          },
    );
  };

  // Reopen onayı: toplar Tambur'dan geri çekilir, adım açılır.
  const confirmReopen = async () => {
    if (!reopenPrompt || reopening) return;
    setReopening(true);
    try {
      await kursunQcService.reopenStep({ stepId: reopenPrompt.stepId });
      const res = await kursunQcService.getStep(reopenPrompt.stepId);
      const step = res.data as KursunStepSummary | undefined;
      if (!step) throw new Error('Adım okunamadı');
      openResolvedStep(reopenPrompt.barcode, step, reopenPrompt.fromInput, true);
      setReopenPrompt(null);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'Adım yeniden açılamadı',
        text2: (err as Error).message,
      });
    } finally {
      setReopening(false);
    }
  };

  const cancelReopen = () => {
    if (reopening) return;
    setReopenPrompt(null);
    Toast.show({ type: 'info', text1: 'Kart açılmadı', text2: 'Adım kapalı bırakıldı' });
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
    // Top değişince metraj temizlenir — yanlış topa yanlışlıkla hata yazılmasın.
    setStartMeter('');
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
        text1: 'KK2 işaretlendi',
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
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
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
      Toast.show({ type: 'error', text1: 'KK2 başarısız', text2: err.message });
    },
  });

  // Seçili topun defect listesinden bir lekeyi optimistik kaldırır (errorCount
  // da düşer). Hem delete onMutate hem "offline ekle→sil iptali" yolu kullanır.
  const removeDefectOptimistic = (
    cardId: string,
    rollId: string,
    errorId: string,
  ) => {
    setOpenJobs((prev) =>
      prev.map((j) =>
        j.cardId === cardId
          ? {
              ...j,
              stepSummary: {
                ...j.stepSummary,
                rolls: j.stepSummary.rolls.map((r) =>
                  r.rollId === rollId
                    ? {
                        ...r,
                        defects: r.defects.filter((d) => d.id !== errorId),
                        errorCount: Math.max(0, r.errorCount - 1),
                      }
                    : r,
                ),
              },
            }
          : j,
      ),
    );
  };

  // OFFLINE-FIRST: leke ekleme. clientErrorId vars'ta (handler üretir) → backend
  // idempotent. onMutate'te optimistic defect listeye eklenir + metraj temizlenir
  // (network bekleme yok); onError'da yalnız o leke geri alınır (eşzamanlı diğer
  // optimistic lekelere dokunmaz). Online resume mutationFn'i registry'den çalışır.
  const reportErrorMutation = useMutation<
    Awaited<ReturnType<typeof kursunQcService.reportError>>,
    Error,
    ReportErrorRequest,
    { cardId: string; rollId: string } | undefined
  >({
    mutationKey: STATION_MUT.QC2_REPORT_ERROR,
    onMutate: (vars) => {
      if (!activeJob) return undefined;
      const cardId = activeJob.cardId;
      const defectName =
        defectTypes.find((d) => d.id === vars.defectTypeId)?.name ?? null;
      const optimisticDefect: KursunRollDefectSummary = {
        id: vars.clientErrorId ?? '',
        startMeter: vars.startMeter,
        defectTypeId: vars.defectTypeId,
        errorType: defectName,
      };
      setOpenJobs((prev) =>
        prev.map((j) =>
          j.cardId === cardId
            ? {
                ...j,
                stepSummary: {
                  ...j.stepSummary,
                  rolls: j.stepSummary.rolls.map((r) =>
                    r.rollId === vars.rollId
                      ? {
                          ...r,
                          defects: [...r.defects, optimisticDefect],
                          errorCount: r.errorCount + 1,
                        }
                      : r,
                  ),
                },
              }
            : j,
        ),
      );
      // Sonraki leke için metraj temizlenir (online/offline fark etmez).
      setStartMeter('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Hata kaydedildi',
        text2: onlineManager.isOnline() ? undefined : 'Çevrimdışı — sync bekliyor',
      });
      return { cardId, rollId: vars.rollId };
    },
    onSuccess: async () => {
      await refetchActiveJob();
    },
    onError: (err, vars, context) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      // Sadece bu lekeyi geri al — diğer bekleyen optimistic lekeler korunur.
      if (context && vars.clientErrorId) {
        removeDefectOptimistic(context.cardId, context.rollId, vars.clientErrorId);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Hata kaydedilemedi', text2: err.message });
    },
  });

  // OFFLINE-FIRST: leke silme. onMutate'te optimistic kaldırma; onError'da silinen
  // leke geri eklenir. Henüz sync olmamış (paused) eklemenin silinmesi handler'da
  // ele alınır (mutate ÇAĞRILMAZ) — buraya yalnız sunucuda var olan leke düşer.
  const deleteErrorMutation = useMutation<
    Awaited<ReturnType<typeof kursunQcService.deleteError>>,
    Error,
    DeleteErrorRequest,
    { cardId: string; rollId: string; defect: KursunRollDefectSummary } | undefined
  >({
    mutationKey: STATION_MUT.QC2_DELETE_ERROR,
    onMutate: (vars) => {
      if (!activeJob || !selectedRoll) return undefined;
      const cardId = activeJob.cardId;
      const rollId = selectedRoll.rollId;
      const defect = selectedRoll.defects.find((d) => d.id === vars.errorId);
      removeDefectOptimistic(cardId, rollId, vars.errorId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (!onlineManager.isOnline()) {
        Toast.show({
          type: 'info',
          text1: 'Hata silindi',
          text2: 'Çevrimdışı — sync bekliyor',
        });
      }
      return defect ? { cardId, rollId, defect } : undefined;
    },
    onSuccess: async () => {
      await refetchActiveJob();
    },
    onError: (err, _vars, context) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      // Rollback: silinen lekeyi geri ekle.
      if (context) {
        setOpenJobs((prev) =>
          prev.map((j) =>
            j.cardId === context.cardId
              ? {
                  ...j,
                  stepSummary: {
                    ...j.stepSummary,
                    rolls: j.stepSummary.rolls.map((r) =>
                      r.rollId === context.rollId
                        ? {
                            ...r,
                            defects: [...r.defects, context.defect],
                            errorCount: r.errorCount + 1,
                          }
                        : r,
                    ),
                  },
                }
              : j,
          ),
        );
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Silinemedi', text2: err.message });
    },
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
      Toast.show({ type: 'error', text1: 'Kumaş bitirilemedi', text2: err.message });
    },
  });

  // OFFLINE-FIRST: adımı kapat (barkodlu topları topluca Tambur'a). onMutate'te
  // kart optimistic kapanır (listeden düşer, sonraki karta geçilir); onError'da
  // kart eski yerine geri konur. Resume FIFO: kuyruğa önce KK2/leke, sonra bu
  // girer → backend tüm QC2'leri işaretli görür. Backend idempotent (kapalı adım
  // başarı döner). Toast offline'da "sync bekliyor" der.
  const finishStepMutation = useMutation<
    Awaited<ReturnType<typeof kursunQcService.finishStep>>,
    Error,
    FinishStepRequest,
    { job: OpenJob; index: number; prevActiveCardId: string | null } | undefined
  >({
    mutationKey: STATION_MUT.QC2_FINISH_STEP,
    onMutate: (vars) => {
      const index = openJobs.findIndex(
        (j) => j.stepSummary.workOrderStepId === vars.stepId,
      );
      if (index < 0) return undefined;
      const job = openJobs[index];
      const prevActiveCardId = activeCardId;
      const remaining = openJobs.filter((_, i) => i !== index);
      setOpenJobs(remaining);
      if (activeCardId === job.cardId) {
        setActiveCardId(remaining[0]?.cardId ?? null);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Adım kapatıldı',
        text2: onlineManager.isOnline()
          ? "Toplar Tambur'a taşındı"
          : 'Çevrimdışı — sync bekliyor',
      });
      return { job, index, prevActiveCardId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rolls'] });
      qc.invalidateQueries({ queryKey: ['kursun-qc', 'open-cards'] });
    },
    onError: (err, _vars, context) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      // Rollback: kapatılan kartı eski sırasına geri koy.
      if (context) {
        setOpenJobs((prev) => {
          const next = [...prev];
          next.splice(context.index, 0, context.job);
          return next;
        });
        setActiveCardId(context.prevActiveCardId);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Adım kapatılamadı', text2: err.message });
    },
  });

  // ── Handler shortcuts ──────────────────────────────────────────────────────
  // Y10 fix: footer aksiyonlarına ref-tabanlı kısa cooldown. onMutate seçimi
  // anında SONRAKİ topa ilerlettiği için kazara çift basışın ikinci vuruşu aynı
  // ekran konumundaki butona düşüp HİÇ İNCELENMEMİŞ topu işaretliyor, hatta son
  // topta footer "Adımı Kapat"a dönüşüp adımı kapatıyordu. isPending'e bağlamak
  // offline'da kilitlenme yarattığından (paused mutation isPending=true kalır)
  // bilinçli olarak zaman-tabanlı throttle kullanılır — optimistic akış korunur.
  const footerPressRef = useRef(0);
  const footerThrottled = (fn: () => void) => {
    const now = Date.now();
    if (now - footerPressRef.current < 700) return;
    footerPressRef.current = now;
    fn();
  };

  const handleCompleteQc2 = () => {
    if (!activeJob || !selectedRoll) return;
    completeQc2Mutation.mutate({
      rollId: selectedRoll.rollId,
      stepId: activeJob.stepSummary.workOrderStepId,
    });
  };

  // Hata tipi tuşu = ana aksiyon. Metraj girilmişse, basılan tipi DİREKT
  // kaydeder (ön-seçim + ayrı Ekle yok). Metraj boş/geçersizse uyarır.
  const handleReportDefect = (defectTypeId: string) => {
    if (!activeJob || !selectedRoll) return;
    const start = parseFloat(startMeter);
    if (!Number.isFinite(start) || start < 0) {
      Toast.show({
        type: 'error',
        text1: 'Önce hata metresini gir',
        text2: 'Metre alanına sayı yaz, sonra hata tipine bas',
      });
      return;
    }
    // Metraj kumaş boyunu aşamaz — backend (reportError) ile birebir aynı kural.
    // Client'ta da kontrol şart: offline'da optimistic ekleme backend'i görmez,
    // bu kontrol olmadan kumaştan uzun metrede leke sıraya girer, sync'te 400 yer.
    if (start > selectedRoll.currentQty) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Toast.show({
        type: 'error',
        text1: 'Metraj kumaş boyunu aşıyor',
        text2: `Hata metresi (${start}) topun metrajını (${selectedRoll.currentQty.toFixed(1)} mt) aşamaz`,
      });
      return;
    }
    // Mükerrer engeli: aynı metre + aynı hata tipi zaten kayıtlıysa engelle.
    // Aynı metrede FARKLI tip serbest. Backend de 409 ile bunu garanti eder;
    // bu kontrol anında geri bildirim için. (Decimal(12,3) → 0.0005 tolerans.)
    const duplicate = selectedRoll.defects.some(
      (d) =>
        d.defectTypeId === defectTypeId &&
        Math.abs(d.startMeter - start) < 0.0005,
    );
    if (duplicate) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Toast.show({
        type: 'error',
        text1: 'Bu hata zaten eklenmiş',
        text2: `${start}. metrede bu hata tipi zaten kayıtlı`,
      });
      return;
    }
    // clientErrorId burada üretilip vars'a gömülür → mutate variables persist
    // edilir, online resume'da backend aynı id ile idempotent çalışır.
    reportErrorMutation.mutate({
      rollId: selectedRoll.rollId,
      stepId: activeJob.stepSummary.workOrderStepId,
      startMeter: start,
      defectTypeId,
      clientErrorId: generateClientUuid(),
    });
  };

  const handleDeleteError = (errorId: string) => {
    if (!activeJob || !selectedRoll) return;

    // Henüz sync olmamış (paused) bir leke EKLEMESİ mi siliniyor? Öyleyse
    // kuyruktaki reportError'ı iptal et — sunucuya hiç gitmesin (offline
    // ekle→sil net sıfır). Aksi halde ekleme online dönünce yine kaydolur,
    // sonra silinmesi için ayrı bir delete gerekir; FIFO sıraya da bel bağlamayız.
    const cache = qc.getMutationCache();
    const pendingAdd = cache.getAll().find(
      (m) =>
        Array.isArray(m.options.mutationKey) &&
        m.options.mutationKey[0] === STATION_MUT.QC2_REPORT_ERROR[0] &&
        m.options.mutationKey[1] === STATION_MUT.QC2_REPORT_ERROR[1] &&
        m.state.isPaused &&
        (m.state.variables as ReportErrorRequest | undefined)?.clientErrorId ===
          errorId,
    );
    if (pendingAdd) {
      removeDefectOptimistic(activeJob.cardId, selectedRoll.rollId, errorId);
      cache.remove(pendingAdd);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Toast.show({ type: 'info', text1: 'Hata kaldırıldı (gönderilmeden)' });
      return;
    }

    // Sunucuda var olan (sync olmuş) leke → offline-aware silme kuyruğu.
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
      {/* Kart girişi.
          • Kamera modu: Okut + Liste + sekmeler TEK satırda → dikey alan kazanır,
            bir liste elemanı daha görünür.
          • Manuel mod (Ayarlar → kamera arızalı): tam metin input bandı ayrı
            satırda — HID tarayıcı / elle giriş için şart. */}
      {manualBarcodeEntry && (
        <View style={styles.cardInputWrap}>
          <ScannerEntryBar
            value={cardBarcode}
            onChangeText={setCardBarcode}
            placeholder="Refakat kartı barkodu okut/yaz..."
            onResolve={handleResolveCard}
            resolving={resolvingCard}
            // Tablette kamera-okut header'daki "Kart Okut" pill'i ile yapılıyor →
            // giriş bandındaki ikinci (pasif duran) kamera butonu kaldırıldı.
            // Telefonda header pill'i yok, kamera butonu burada kalır.
            onScan={compact ? () => drawerQueue.run(() => setScannerOpen(true)) : undefined}
            onList={() => drawerQueue.run(() => setListModalOpen(true))}
            tone="green"
            listContainerColor={urgentCount > 0 ? '#fee2e2' : undefined}
            listIconColor={urgentCount > 0 ? '#b91c1c' : undefined}
            listBadge={<UrgentBadge count={urgentCount} />}
          />
        </View>
      )}

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

      {/* Üst kontrol/sekme şeridi — kamera modunda Okut+Liste solda sabit,
          sekmeler kalan alanda yatay kaydırılır; manuel modda yalnız sekmeler. */}
      {((compact && !manualBarcodeEntry) || openJobs.length > 0) && (
        <View style={styles.topArea}>
          {/* Kamera modu aksiyonları (telefon): kendi satırında. */}
          {compact && !manualBarcodeEntry && (
            <View style={styles.scanRow}>
              <Button
                mode="contained"
                icon="camera"
                compact
                onPress={() => drawerQueue.run(() => setScannerOpen(true))}
                buttonColor="#059669"
                style={styles.scanCompactBtn}
                contentStyle={styles.scanCompactContent}
                labelStyle={styles.scanCompactLabel}
              >
                Okut
              </Button>
              <View>
                <IconButton
                  icon="format-list-bulleted"
                  mode="contained-tonal"
                  containerColor={urgentCount > 0 ? '#fee2e2' : '#f1f5f9'}
                  iconColor={urgentCount > 0 ? '#b91c1c' : '#475569'}
                  size={22}
                  onPress={() => drawerQueue.run(() => setListModalOpen(true))}
                  accessibilityLabel="Açık kartlar listesi"
                  style={styles.listCompactBtn}
                />
                <UrgentBadge count={urgentCount} />
              </View>
              {/* Yenile burada DEĞİL — açık iş sekmeleri şeridinde (tabRow) tek
                  bir RefreshButton var. İkisi birden gösterilince drawer'da iki
                  yenile tuşu çıkıyordu. */}
            </View>
          )}

          {/* Açık iş emri sekmeleri — telefonda KENDİ tam-genişlik satırı (tek
              satır çip). Tablette de tek satır; orada zaten ayrı şerit. */}
          {openJobs.length > 0 && (
            <View style={styles.tabRow}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.tabScroll, compact && styles.tabScrollCompact]}
                style={styles.tabScrollArea}
              >
                {openJobs.map((job) => (
                  <JobTab
                    key={job.cardId}
                    job={job}
                    compact={compact}
                    active={job.cardId === activeCardId}
                    onPress={() => setActiveCardId(job.cardId)}
                    onClose={() => closeJob(job.cardId)}
                  />
                ))}
              </ScrollView>
              {/* Yenile: telefonda tek yer BURASI (header'da "Yenile" pill'i yok).
                  Tablette header'daki pill aynı activeRefresh'i atıyor → tablette
                  buradaki KALDIRILDI, çift buton olmasın. */}
              {compact && (
                <View style={styles.tabRefreshWrap}>
                  <RefreshButton
                    onPress={activeRefresh.onRefresh}
                    refreshing={activeRefresh.refreshing}
                    isError={activeRefresh.isError}
                    errorMessage={activeRefresh.errorMessage}
                    successMessage={activeRefresh.successMessage}
                  />
                </View>
              )}
            </View>
          )}
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
          // flex:1 — liste kalan alanı kaplar + KENDİ İÇİNDE kaydırır. Yoksa
          // (boş-durum panelleri flex:1 ama liste değildi) toplar çoğalınca liste
          // içeriği sağ paneli aşıp taşıyordu (satırların büyümesiyle görünür oldu).
          style={{ flex: 1 }}
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
      {/* Tablet: Kart Okut + Liste aksiyonları header'a etiketli pill olarak
          alınır (Tambur ekranıyla aynı stil). Telefonda header dar; aksiyonlar
          drawer'da kalır, headerOpenJobsBtn ile açılır. */}
      {!compact && (
        <>
          <HeaderChip
            icon="camera"
            label="Kart Okut"
            onPress={() => drawerQueue.run(() => setScannerOpen(true))}
          />
          <HeaderChip
            icon="format-list-bulleted"
            label="Liste"
            onPress={() => drawerQueue.run(() => setListModalOpen(true))}
            badge={<UrgentBadge count={urgentCount} />}
          />
          <RefreshButton
            headerStyle
            label="Yenile"
            onPress={activeRefresh.onRefresh}
            refreshing={activeRefresh.refreshing}
            isError={activeRefresh.isError}
            errorMessage={activeRefresh.errorMessage}
            successMessage={activeRefresh.successMessage}
          />
        </>
      )}
      {headerOpenJobsBtn}
    </View>
  );

  return (
    <ScreenChrome title="Kurşun" headerExtras={headerExtras}>
      <View
        style={[
          styles.body,
          // KK1 ile aynı: compact'ta yalnız güvenli-alan (notch) kadar dış
          // boşluk — içerik kenara yaslanır, "ortada emanet" durmaz. İç nefes
          // payı blokların kendi 8px padding'inde.
          compact && {
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        {/* ════════ SOL: aktif top işlem ════════ */}
        <View style={styles.formCol}>
          {/* İş emri adım notu (rotada KK2 istasyonuna yazılan talimat) —
              kart açıkken HEP üstte, top seçilmeden de görünür. İlk satır
              dokunmadan okunur; dokun → tam not modal'i. (Tambur ile aynı desen) */}
          {!!activeJob?.stepSummary.stepNote?.trim() && (
            <TouchableRipple
              onPress={() => setNoteModalOpen(true)}
              style={styles.noteStrip}
            >
              <View style={styles.noteStripInner}>
                <Icon source="note-text-outline" size={22} color="#78350f" />
                <Text style={styles.noteStripLabel}>NOT</Text>
                <Text style={styles.noteStripText} numberOfLines={2}>
                  {activeJob.stepSummary.stepNote.trim()}
                </Text>
                <Icon source="chevron-right" size={22} color="#b45309" />
              </View>
            </TouchableRipple>
          )}
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
            // Tüm öğeler tek gap'li kolonda — cetvel · giriş · buton · numpad
            // arası boşluk EŞİT (styles.rollPane gap). Flex-spacer yok.
            <View style={styles.rollPane}>
              {/* Kayıtlı hatalar — metre cetveli. Tek bakışta "nerede hata var"
                  haritası; tek satır, sabit (scroll gerekmez). Tik'e dokun → o
                  noktadaki hata(lar)ı sil.
                  NOT: eski koyu "seçili top" bandı (barkod/metraj) KALDIRILDI —
                  navbarla BİREBİR aynı renkteydi, sağ kolonda karşılığı yoktu →
                  navbar uzuyormuş gibi görünüp simetriyi bozuyordu. Seçili topun
                  kimliği sağ listede vurgulu; metraj cetvelin sağ ucunda. */}
              <View style={styles.rulerBlock}>
                {selectedRoll.defects.length === 0 ? (
                  <View style={styles.emptyDefects}>
                    <Icon
                      source="check-circle-outline"
                      size={28}
                      color="#cbd5e1"
                    />
                    <Text style={styles.muted}>Henüz hata yok</Text>
                  </View>
                ) : (
                  <Surface style={styles.section} elevation={1}>
                    {(() => {
                      const critCount = selectedRoll.defects.reduce(
                        (n, d) =>
                          n +
                          (defectTypes.find((t) => t.name === d.errorType)
                            ?.severity === 'CRITICAL'
                            ? 1
                            : 0),
                        0,
                      );
                      return (
                        <>
                          <View style={styles.defectGuideTitleRow}>
                            <Text style={styles.sectionTitle}>
                              Hata Noktaları ({selectedRoll.defects.length})
                            </Text>
                            {critCount > 0 && (
                              <View style={styles.defectCritBadge}>
                                <Text style={styles.defectCritBadgeText}>
                                  {critCount} kritik
                                </Text>
                              </View>
                            )}
                            <View style={{ flex: 1 }} />
                            <Text style={styles.defectGuideHint}>
                              tik'e dokun → sil
                            </Text>
                          </View>
                          {/* Metre cetveli — hatalar top boyunca tik/küme; her
                              marker dokunulabilir → o noktadaki hata(lar) silme
                              modalında çıkar. Chip listesine göre çok daha az yer. */}
                          <KursunDefectRuler
                            defects={selectedRoll.defects}
                            defectTypes={defectTypes}
                            rulerMax={rulerMaxForDefects(
                              selectedRoll.currentQty,
                              selectedRoll.defects,
                            )}
                            onMarkerPress={(ids) => setDeletePointIds(ids)}
                          />
                        </>
                      );
                    })()}
                  </Surface>
                )}
              </View>

              {/* Hata giriş alanı — cetvelin altında, eşit gap ile. Metraj gir →
                  hata tipine bas → hata DİREKT kaydedilir (ayrı Ekle yok). */}
              <View style={styles.entryFixed}>
                <Surface style={styles.entrySection} elevation={1}>
                  {/* Önce metraj — tek nokta (aralık değil); bitiş Tambur kesimiyle.
                      autoActivate: input'a tıklamadan numpad doğrudan buraya yazar. */}
                  <NumpadInput
                    mode="outlined"
                    value={startMeter}
                    onChangeText={setStartMeter}
                    numpadLabel="Hata metresi"
                    allowDecimal
                    autoActivate
                    numpadMaxLength={8}
                    label="Hata metresi (mt)"
                    dense
                    style={styles.meterInput}
                    useNativeKeyboard={compact}
                  />

                  {/* Hata tipi = ANA TUŞLAR (input'un altında, büyük). Metraj
                      girip tipe basınca hata DİREKT kaydedilir — ayrı Ekle yok. */}
                  {defectTypes.length === 0 ? (
                    <Text style={styles.muted}>
                      Hata tipi tanımlı değil — admin'den ekleyin
                    </Text>
                  ) : (
                    <View style={styles.defectGrid}>
                      {defectTypes.map((dt) => (
                        // OFFLINE-AWARE: isPending'e disabled/opacity binding'i YOK.
                        // Paused mutation (offline) isPending'i sonsuza true tutar;
                        // bağlanırsa ilk lekeden sonra tüm tuşlar kilitlenir. Çift
                        // basış zaten onMutate metraj temizliği + mükerrer kontrolü
                        // + backend 409 ile engellenir.
                        <TouchableRipple
                          key={dt.id}
                          onPress={() => handleReportDefect(dt.id)}
                          rippleColor="rgba(255,255,255,0.25)"
                          style={styles.defectBtn}
                        >
                          <Text style={styles.defectBtnText} numberOfLines={1}>
                            {dt.name}
                          </Text>
                        </TouchableRipple>
                      ))}
                    </View>
                  )}
                </Surface>
              </View>

              {/* Sticky footer — durum sırası:
                  1) Tüm toplar KK2 tamam → Adımı Kapat (toplu Tambur'a)
                  2) Açık kumaş      → Kumaşı Bitir (tek tek Tambur'a)
                  3) Barkodlu + tamam → pasif "KK2 Tamamlandı" göstergesi
                  4) Barkodlu + bekliyor → KK2 Tamamla
                  Not: per-roll "Geri Al" kaldırıldı (yarım geri alıyordu + offline
                  ölüydü). Yanlış işaret düzeltmesi = kartı tekrar okut → adım reopen. */}
              <Surface
                style={[styles.footer, !compact && styles.footerBare]}
                elevation={compact ? 4 : 0}
              >
                {allQc2Done ? (
                  // Kart hazır: tüm barkodlu toplar KK2 görmüş → topluca Tambur'a
                  // gönder. Bu, barkodlu top akışını ilerleten tek aksiyon
                  // (completeQc2 sadece işaretler, taşımaz).
                  // OFFLINE-AWARE: isPending'e disabled/loading binding'i YOK —
                  // paused mutation isPending'i sonsuz true tutar, bağlanırsa
                  // sonraki kartın "Adımı Kapat"ı da kilitlenir. Optimistic
                  // kapanma kartı listeden düşürür → çift basış riski yok.
                  <Button
                    mode="contained"
                    icon="flag-checkered"
                    onPress={() => footerThrottled(handleFinishStep)}
                    buttonColor="#1e40af"
                    style={styles.footerBtn}
                    contentStyle={styles.footerBtnContent}
                    labelStyle={styles.footerBtnLabel}
                  >
                    Adımı Kapat — Toplar Tambur'a
                  </Button>
                ) : !selectedRoll.barcode ? (
                  // Açık kumaş: direkt Tambur'a iletir (KK2'de ölçüm yok).
                  // Tambur "Kes" butonuyla aynı görsel dil (tam genişlik +
                  // basış animasyonu + haptic) — StationActionButton.
                  // OFFLINE-AWARE: loading/disabled binding'i YOK — mutation
                  // hook'un global isPending'i paused mutation'larda true kalır,
                  // bu da sıradaki rulaya basmayı engeller. Optimistic update
                  // rulayı zaten listeden düşürdüğü için double-press riski yok.
                  <StationActionButton
                    icon="package-check"
                    label={compact ? "Kumaşı Bitir (Tambur'a)" : "Kumaşı Bitir (Tambur'a Gönder)"}
                    compact={compact}
                    large={!compact}
                    onPress={() =>
                      footerThrottled(() => kursunFinishMutation.mutate(selectedRoll.rollId))
                    }
                  />
                ) : selectedRoll.qc2Completed ? (
                  // Bu barkodlu top KK2'yi görmüş ama kartın hepsi bitmemiş
                  // (operatör elle yeniden seçti). Pasif durum göstergesi — aksiyon
                  // yok; operatör kalan topları işler veya hepsi bitince adımı kapatır.
                  <Button
                    mode="contained-tonal"
                    icon="check-circle"
                    disabled
                    style={styles.footerBtn}
                    contentStyle={styles.footerBtnContent}
                    labelStyle={styles.footerBtnLabel}
                  >
                    KK2 Tamamlandı
                  </Button>
                ) : (
                  // Barkodlu top — aynı offline-aware mantığı: loading/disabled
                  // binding'i yok (paused mutation sıradaki rulayı engellemesin).
                  <Button
                    mode="contained"
                    icon="check-all"
                    onPress={() => footerThrottled(handleCompleteQc2)}
                    buttonColor="#059669"
                    style={styles.footerBtn}
                    contentStyle={styles.footerBtnContent}
                    labelStyle={styles.footerBtnLabel}
                  >
                    {`KK2 Tamamla (${selectedRoll.errorCount} hata)`}
                  </Button>
                )}
              </Surface>

              {/* Tablet: sayısal tuş takımı sol kolonun altında — metre girişi
                  ile aynı sütunda, aksiyon butonunun hemen altında. Tam boy tuşlar
                  (koyu band kalktığı için yer var). Telefonda numpad yok. */}
              {!compact && <NumpadHost style={styles.numpadHost} />}
            </View>
          )}
        </View>

        {/* ════════ SAĞ: kart input + tab bar + roll list ════════ */}
        {!compact && (
          <View style={styles.rightCol}>
            {renderRightContent()}
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
        refresh={openCardsRefresh}
      />

      {/* Refakat kartı QR/barkod okuma — gerçek kamera */}
      <BarcodeScannerModal
        visible={scannerOpen}
        title="Refakat Kartı QR Okut"
        onDismiss={() => setScannerOpen(false)}
        onScan={handleScannerResult}
      />

      {/* İş emri adım notu tam metin modal'ı — üstteki not şeridinden açılır */}
      <StepNoteModal
        visible={noteModalOpen}
        note={activeJob?.stepSummary.stepNote ?? null}
        onDismiss={() => setNoteModalOpen(false)}
      />

      {/* Cetveldeki hata noktasına dokununca — o noktadaki hata(lar)ı sil */}
      <DeletePointModal
        visible={deletePointIds !== null}
        defects={deletePointDefects}
        defectTypes={defectTypes}
        onDelete={handleDeleteError}
        onDismiss={() => setDeletePointIds(null)}
      />

      {/* Kapalı kart okutulunca: reopen onay modalı (toplar Tambur'dan geri çekilir) */}
      <ReopenConfirmModal
        prompt={reopenPrompt}
        reopening={reopening}
        onConfirm={confirmReopen}
        onCancel={cancelReopen}
      />

      {/* Compact'ta sağdan kayan iş paneli — telefon ekranında sağ kolonun yerine */}
      {compact && (
        <RightPanelDrawer
          visible={rightDrawerOpen}
          onDismiss={() => setRightDrawerOpen(false)}
          insets={insets}
          title="Kurşun · KK2 İşleri"
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
  refresh,
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
  /** Manuel "Yenile" ile tetiklenen veya polling fetch sürüyor mu — RefreshMeta sayacı için. */
  isFetching: boolean;
  /** Standart manuel yenileme kontrolü (RefreshButton'a bağlanır). */
  refresh: ManualRefresh;
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
    <AppModal visible={visible} onDismiss={onDismiss}>
      <View style={[cameraStyles.sheet, { width: winW * 0.9, height: winH * 0.8 }]}>
        <View style={cameraStyles.header}>
          <Icon source="format-list-bulleted" size={22} color="#0f172a" />
          <Text variant="titleMedium" style={cameraStyles.title} numberOfLines={1}>
            Açık Kartlar
          </Text>
          <View style={{ flex: 1 }} />
          <RefreshMeta
            visible={visible}
            refreshIntervalSec={refreshIntervalSec}
            dataUpdatedAt={dataUpdatedAt}
            isFetching={isFetching}
          />
          <RefreshButton
            size={20}
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
                Kurşun + KK2'de bekleyen kart yok
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
                      {/* ACİL solda · büyük refakat kartı no · kalan bilgi inline */}
                      {item.isUrgent && (
                        <View style={cameraStyles.urgentBadge}>
                          <Icon source="alert-octagon" size={12} color="#ffffff" />
                          <Text style={cameraStyles.urgentBadgeText}>ACİL</Text>
                        </View>
                      )}
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
    </AppModal>
  );
}

// İş emri adım notu (WorkOrderStep.notes) tam metin modal'ı — üstteki sticky
// not şeridine dokununca açılır. Tambur'daki TamburNoteModal ile aynı stil.
function StepNoteModal({
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
          <Text style={noteModalStyles.title}>Kurşun + KK2 Notu</Text>
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

// Kapalı bir kart okutulduğunda çıkan reopen ONAY modalı. Otomatik reopen
// kaldırıldı (yıkıcı: toplar Tambur'dan geri çekilir) — burada operatöre hangi
// topların geri çekileceği SOMUT listelenir, onaylanınca confirmReopen çalışır.
// Güvenlik engeli varsa (top ileri taşınmış) canReopen=false → sebep gösterilir.
function ReopenConfirmModal({
  prompt,
  reopening,
  onConfirm,
  onCancel,
}: {
  prompt: {
    barcode: string;
    fromInput: boolean;
    stepId: string;
    batchNumber: string;
    preview: ReopenPreview;
  } | null;
  reopening: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const phone = winW < 600;
  const preview = prompt?.preview;
  const canReopen = !!preview?.canReopen;
  return (
    <AppModal visible={!!prompt} onDismiss={onCancel}>
      <View
        style={[
          reopenStyles.sheet,
          {
            width: phone ? winW * 0.92 : Math.min(560, winW * 0.6),
            maxHeight: winH * 0.8,
          },
        ]}
      >
        <View style={reopenStyles.header}>
          <View style={reopenStyles.headerIcon}>
            <Icon source="alert" size={22} color="#b45309" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={reopenStyles.title}>Adım kapatılmış</Text>
            {!!prompt && (
              <Text style={reopenStyles.subtitle} numberOfLines={1}>
                {prompt.batchNumber}
              </Text>
            )}
          </View>
          <IconButton
            icon="close"
            size={22}
            onPress={onCancel}
            disabled={reopening}
            style={{ margin: 0 }}
          />
        </View>

        {canReopen ? (
          <>
            <Text style={reopenStyles.warnText}>
              Bu kartın KK2 adımı kapatılmış; aşağıdaki {preview!.rollCount} top
              zaten Tambur'a geçmiş. Yeniden açarsan bu toplar Tambur'dan geri
              çekilip tekrar KK2'ye alınır.
            </Text>
            <Text style={reopenStyles.listLabel}>
              Geri çekilecek toplar ({preview!.rollCount})
            </Text>
            <ScrollView
              style={reopenStyles.list}
              contentContainerStyle={{ paddingBottom: 4 }}
            >
              {preview!.rolls.map((r, i) => (
                <View key={r.rollId} style={reopenStyles.row}>
                  <Text style={reopenStyles.rowIndex}>{i + 1}</Text>
                  <Text style={reopenStyles.rowName} numberOfLines={1}>
                    {r.barcode ?? `Açık Kumaş · ${r.rollId.slice(0, 8)}`}
                  </Text>
                  <Text style={reopenStyles.rowQty}>
                    {r.currentQty.toFixed(1)} mt
                  </Text>
                </View>
              ))}
            </ScrollView>
            <View style={reopenStyles.actions}>
              <Button
                mode="outlined"
                onPress={onCancel}
                disabled={reopening}
                style={reopenStyles.actionBtn}
                textColor="#475569"
              >
                Vazgeç
              </Button>
              <Button
                mode="contained"
                icon="lock-open-variant"
                onPress={onConfirm}
                loading={reopening}
                disabled={reopening}
                buttonColor="#b45309"
                style={[reopenStyles.actionBtn, { flex: 1.6 }]}
              >
                {`Yeniden Aç (${preview!.rollCount} top geri çek)`}
              </Button>
            </View>
          </>
        ) : (
          <>
            <View style={reopenStyles.blockBox}>
              <Icon source="cancel" size={20} color="#b91c1c" />
              <Text style={reopenStyles.blockText}>
                {preview?.blockReason ?? 'Bu adım yeniden açılamıyor.'}
              </Text>
            </View>
            <View style={reopenStyles.actions}>
              <Button
                mode="contained"
                onPress={onCancel}
                style={reopenStyles.actionBtn}
                buttonColor="#475569"
              >
                Kapat
              </Button>
            </View>
          </>
        )}
      </View>
    </AppModal>
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

function JobTab({
  job,
  active,
  onPress,
  onClose,
  compact = false,
}: {
  job: OpenJob;
  active: boolean;
  onPress: () => void;
  onClose: () => void;
  /** Telefon: tek satır çip (parti no · adet yan yana), daha dar. */
  compact?: boolean;
}) {
  const total = job.stepSummary.rolls.length;
  const done = job.stepSummary.rolls.filter((r) => r.qc2Completed).length;
  return (
    <Surface
      style={[helperStyles.tab, compact && helperStyles.tabCompact, active && helperStyles.tabActive]}
      elevation={active ? 2 : 1}
    >
      <TouchableRipple onPress={onPress} borderless style={helperStyles.tabPress}>
        <View style={helperStyles.tabInner}>
          <View style={helperStyles.tabTextWrap}>
            {compact ? (
              // Tek satır: parti no + adet inline → şerit tek satır kalır.
              <Text
                style={[helperStyles.tabLabel, active && helperStyles.tabLabelActive]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {job.stepSummary.batchNumber}
                <Text style={helperStyles.tabCountInline}>{`  ·  ${done}/${total}`}</Text>
              </Text>
            ) : (
              <>
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
              </>
            )}
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
  const press = usePressScale();
  return (
    <Reanimated.View style={press.style}>
      <Surface
        style={[
          helperStyles.rollItem,
          selected && helperStyles.rollItemSelected,
          done && helperStyles.rollItemDone,
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
            {/* Barkodlu top → barkod (monospace). Açık kumaş (barkodsuz) → kumaş
                adı + renk; ikisi de yoksa "Açık Kumaş". */}
            <Text
              style={roll.barcode ? helperStyles.rollBarcode : helperStyles.rollName}
              numberOfLines={1}
            >
              {roll.barcode
                ? roll.barcode
                : [roll.itemName, roll.colorName].filter(Boolean).join(' · ') ||
                  'Açık Kumaş'}
            </Text>
            <Text style={helperStyles.rollMeta}>
              {roll.currentQty.toFixed(1)} mt
              {/* Renk: barkodlu topta burada; açık kumaşta üst satırda (ad ile)
                  gösterildi → tekrar etme. */}
              {roll.barcode && roll.colorName ? ` · ${roll.colorName}` : ''}
            </Text>
          </View>
          {/* Durum chip'leri sağa yaslı — satır 2 satıra iner, liste kompaktlaşır */}
          <View style={helperStyles.rollRight}>
            {roll.errorCount > 0 && (
              <View style={helperStyles.chipAmber}>
                <Text style={helperStyles.chipText}>{roll.errorCount} hata</Text>
              </View>
            )}
            {done ? (
              <View style={helperStyles.chipBlue}>
                <Text style={helperStyles.chipText}>KK2 ✓</Text>
              </View>
            ) : (
              <View style={helperStyles.chipNeutral}>
                <Text style={helperStyles.chipText}>KK2 bekliyor</Text>
              </View>
            )}
          </View>
          {selected && (
            <Icon source="chevron-left" size={22} color="#1e40af" />
          )}
        </View>
        </TouchableRipple>
      </Surface>
    </Reanimated.View>
  );
}

// Metre değeri — tamsa ondalıksız, değilse tek ondalık (47, 47.5).
function fmtMeter(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// Cetvel sağ ucu = topun boyu; ölçüm dışı bir hata metresi topu aşarsa cetvel
// o metreye kadar uzar (marker kadraja sığsın).
function rulerMaxForDefects(
  currentQty: number,
  defects: KursunRollDefectSummary[],
): number {
  let m = currentQty > 0 ? currentQty : 0;
  for (const d of defects) if (d.startMeter > m) m = d.startMeter;
  return Math.max(m, 1);
}

// Etkileşimli metre cetveli — Tambur'un DefectRuler'ıyla aynı görsel dil (0→top
// boyu ölçek, tik/küme, kritik=kırmızı) AMA marker'lar dokunulabilir: dokununca
// o noktadaki hata id'leri onMarkerPress ile döner (silme modalı açılır). Yakın
// noktalar tek dokunulabilir kümede toplanır (sayaç); kümeye dokun → hepsi.
function KursunDefectRuler({
  defects,
  defectTypes,
  rulerMax,
  onMarkerPress,
}: {
  defects: KursunRollDefectSummary[];
  defectTypes: DefectType[];
  rulerMax: number;
  onMarkerPress: (defectIds: string[]) => void;
}) {
  const [w, setW] = useState(0);
  const isCritical = (e: KursunRollDefectSummary) =>
    defectTypes.find((d) => d.name === e.errorType)?.severity === 'CRITICAL';

  const markers = useMemo(() => {
    if (w <= 0)
      return [] as {
        x: number;
        defects: KursunRollDefectSummary[];
        critical: boolean;
        meterMin: number;
        meterMax: number;
        label: string;
        showLabel: boolean;
      }[];
    // Dokunulabilir marker'lar — Tambur'daki 16px'ten geniş: hit alanları (28px)
    // çakışmasın diye 30px'ten yakın tik'ler tek kümede toplanır.
    const MIN_GAP = 30;
    const sorted = [...defects].sort((a, b) => a.startMeter - b.startMeter);
    const out: {
      x: number;
      defects: KursunRollDefectSummary[];
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
        last.x = (last.x * last.defects.length + x) / (last.defects.length + 1);
        last.defects.push(e);
        last.critical = last.critical || isCritical(e);
        last.meterMin = Math.min(last.meterMin, e.startMeter);
        last.meterMax = Math.max(last.meterMax, e.startMeter);
      } else {
        out.push({
          x,
          defects: [e],
          critical: isCritical(e),
          meterMin: e.startMeter,
          meterMax: e.startMeter,
          label: '',
          showLabel: false,
        });
      }
    }
    // Etiket (tek = metre, küme = min–max) + soldan sağa çakışma engelleme.
    let lastEnd = -Infinity;
    for (const m of out) {
      m.label =
        m.defects.length > 1 && m.meterMin !== m.meterMax
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
  }, [defects, w, rulerMax, defectTypes]);

  return (
    <View
      style={styles.rulerWrap}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      <View style={styles.rulerTrack} />

      {/* Uç ölçek: sol 0, sağ = topun boyu (metre). */}
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

      {/* Dokunulabilir marker'lar — tek tik veya sayaçlı küme. Geniş şeffaf hit
          alanı (28px) parmakla kolay bassın; içteki tik/küme ortalanır. */}
      {markers.map((m, i) => (
        <TouchableRipple
          key={i}
          borderless
          onPress={() => onMarkerPress(m.defects.map((d) => d.id))}
          style={[
            styles.rulerHit,
            { left: Math.max(0, Math.min(m.x - 14, w - 28)) },
          ]}
          accessibilityLabel={`${m.label} metre hata — sil`}
        >
          {m.defects.length > 1 ? (
            <View
              style={[
                styles.rulerCluster,
                m.critical && styles.rulerClusterCritical,
              ]}
            >
              <Text style={styles.rulerClusterText}>{m.defects.length}</Text>
            </View>
          ) : (
            <View
              style={[styles.rulerTick, m.critical && styles.rulerTickCritical]}
            />
          )}
        </TouchableRipple>
      ))}
    </View>
  );
}

// Cetveldeki bir hata noktasına (tik/küme) dokununca açılır — o noktadaki
// hata(lar)ı listeler, her biri "Sil" ile kaldırılır (offline-aware
// handleDeleteError). Tek hata → tek satır onay; küme → o noktadaki hepsi.
function DeletePointModal({
  visible,
  defects,
  defectTypes,
  onDelete,
  onDismiss,
}: {
  visible: boolean;
  defects: KursunRollDefectSummary[];
  defectTypes: DefectType[];
  onDelete: (id: string) => void;
  onDismiss: () => void;
}) {
  const { width: winW } = useWindowDimensions();
  const phone = winW < 600;
  const sorted = [...defects].sort((a, b) => a.startMeter - b.startMeter);
  const isCritical = (e: KursunRollDefectSummary) =>
    defectTypes.find((d) => d.name === e.errorType)?.severity === 'CRITICAL';
  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <View
        style={[
          deletePointStyles.sheet,
          { width: phone ? winW * 0.9 : Math.min(460, winW * 0.5) },
        ]}
      >
        <View style={deletePointStyles.header}>
          <Icon source="alert-circle-outline" size={22} color="#b45309" />
          <Text style={deletePointStyles.title}>
            {sorted.length > 1 ? `Hata Noktası (${sorted.length})` : 'Hatayı Sil'}
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton
            icon="close"
            size={22}
            onPress={onDismiss}
            style={{ margin: 0 }}
          />
        </View>
        {sorted.map((d) => {
          const crit = isCritical(d);
          return (
            <View key={d.id} style={deletePointStyles.row}>
              <View
                style={[
                  deletePointStyles.dot,
                  crit && deletePointStyles.dotCritical,
                ]}
              />
              <Text style={deletePointStyles.rowMeter}>
                {d.startMeter.toFixed(1)} m
              </Text>
              <Text style={deletePointStyles.rowType} numberOfLines={1}>
                {d.errorType ?? 'Hata'}
              </Text>
              {crit && (
                <View style={deletePointStyles.critBadge}>
                  <Text style={deletePointStyles.critBadgeText}>KRİTİK</Text>
                </View>
              )}
              <Button
                mode="contained"
                icon="delete"
                compact
                buttonColor="#dc2626"
                onPress={() => onDelete(d.id)}
                style={deletePointStyles.delBtn}
                labelStyle={deletePointStyles.delBtnLabel}
              >
                Sil
              </Button>
            </View>
          );
        })}
      </View>
    </AppModal>
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

  // İş emri adım notu sticky şeridi (formCol en üstü) — Tambur ile aynı amber dil.
  noteStrip: {
    backgroundColor: '#fffbeb',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  noteStripInner: {
    flexDirection: 'row',
    // İlk satıra hizalı: not 2 satıra düşse de etiket/ok ilk satırla aynı
    // bantta kalır (center olsaydı bloğun ortasına "asılı" görünürdü).
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  noteStripLabel: {
    fontSize: 13,
    // İçerikle aynı satır yüksekliği + includeFontPadding kapalı → Android'in
    // font boyutuna orantılı üst boşluğu kalkar, etiket notun ilk satırıyla
    // dikeyde tam örtüşür (yoksa küçük yazı yukarı kayıyordu).
    lineHeight: 22,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontWeight: '800',
    color: '#b45309',
    letterSpacing: 0.3,
  },
  noteStripText: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    includeFontPadding: false,
    textAlignVertical: 'center',
    color: '#0f172a',
    fontWeight: '600',
  },

  // Sol — form
  formCol: { flex: 1.4 },
  // Compact (telefon) — header'da profil ikonu solunda "Açık İşler" ikonu
  headerOpenJobsBtn: { margin: 0 },
  // Header'da sync chip + open jobs button yan yana sığsın.
  headerExtrasRow: { flexDirection: 'row', alignItems: 'center' },
  // Koyu header'a uygun translucent etiketli aksiyon pill'i (Tambur ile aynı).
  headerChipWrap: { marginLeft: 4 },
  headerChip: {
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  headerChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  headerChipText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#475569' },
  emptyHint: { fontSize: 13, color: '#94a3b8', textAlign: 'center', maxWidth: 320 },

  // Sabit (sticky) hata giriş zonu — header ile scroll arasında, kaymaz.
  // Dış yatay boşluk minimal (8) → amber kutu kolon genişliğini neredeyse
  // tam kullanır; kart kenarı ekrana yapışmasın diye küçük pay bırakıldı.
  // Seçili top içeriği — tüm öğeler arası boşluk EŞİT (tek gap). Flex-spacer yok;
  // öğeler yukarıdan diziler, artan yer en altta kalır. paddingTop: koyu band
  // kalkınca cetvel navbara yapışmasın (sağ kolon şeridiyle simetrik pay).
  rollPane: { flex: 1, gap: 10, paddingTop: 8 },
  // Hata giriş alanı — dış boşluk rollPane gap'inden gelir; burada yalnız yatay
  // iç boşluk (amber kartı kenardan içeri al). Border/zemin YOK (hr çizgisi kalktı).
  entryFixed: { paddingHorizontal: 8 },
  // Metre cetveli bloğu — SABİT yükseklik: "henüz hata yok" ↔ cetvel geçişinde
  // yükseklik değişmez (alttaki giriş zıplamaz). İçteki kart/boş durum flex ile
  // bloğu tam doldurur → komşu gap'ler eşit kalır.
  rulerBlock: { height: 112, paddingHorizontal: 8 },
  section: {
    flex: 1,
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

  // Kayıtlı hatalar — boş durum (cetvelle aynı yüksekliği doldurur → zıplama yok).
  emptyDefects: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  defectGuideTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  defectGuideHint: { fontSize: 10, color: '#94a3b8', fontStyle: 'italic' },
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
  // Metre cetveli — hatalar tik/küme olarak absolute konumlanır; her marker
  // geniş şeffaf hit alanına (rulerHit) sarılı, dokununca o nokta silinir.
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
  rulerHit: {
    position: 'absolute',
    top: 12,
    height: 34,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  rulerTick: { width: 4, height: 18, borderRadius: 2, backgroundColor: '#94a3b8' },
  rulerTickCritical: { backgroundColor: '#dc2626' },
  rulerCluster: {
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
  rulerScaleTick: {
    position: 'absolute',
    top: 29,
    width: 1,
    height: 6,
    backgroundColor: '#cbd5e1',
  },
  rulerEndLabel: {
    position: 'absolute',
    bottom: 0,
    fontSize: 10,
    color: '#64748b',
    fontWeight: '700',
  },
  rulerEndLabelLeft: { left: 0 },
  rulerEndLabelRight: { right: 0 },

  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  // Tablet: footer'ın beyaz zemini + üst çizgisi kaldırılır — aksiyon butonu
  // doğrudan sol kolon zemininde durur. Dikey iç boşluk 0: buton→giriş ve
  // buton→numpad mesafesi rollPane gap'inden gelsin (eşit boşluk).
  footerBare: {
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  footerBtn: { borderRadius: 12 },
  // Büyük footer aksiyonu — Kumaşı Bitir (StationActionButton large=72) ile aynı
  // görsel ağırlıkta dursun.
  footerBtnContent: { height: 72 },
  footerBtnLabel: { fontSize: 18, fontWeight: '700' },

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

  // Üst kontrol/sekme şeridi — Okut + Liste + yatay kaydırılan sekmeler tek satır.
  // Üst alan: kamera-aksiyon satırı + açık iş sekmeleri satırı (telefonda 2 satır).
  topArea: {
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 6,
    gap: 6,
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  scanCompactBtn: { borderRadius: 8 },
  scanCompactContent: { height: 44, paddingHorizontal: 2 },
  scanCompactLabel: { fontSize: 14, fontWeight: '700' },
  listCompactBtn: { margin: 0, height: 44, width: 44, borderRadius: 8 },
  // Sekme ScrollView'i kalan alanı kaplar — taşan sekmeler yatay kayar.
  tabScrollArea: { flex: 1 },
  // flexGrow + flex-end: az sekme varken sağa dayanır (refresh'in soluna),
  // yeni sekme sağ uca eklenir; taştığında normal yatay kaydırma.
  tabScroll: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 6,
    gap: 6,
    alignItems: 'center',
  },
  // Telefon: kendi satırında sekmeler soldan başlar (refresh sağda).
  tabScrollCompact: { justifyContent: 'flex-start' },
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

  // Tablet: sol kolonda aksiyon butonunun altında. Üst boşluk rollPane gap'inden
  // gelir (marginTop 0).
  numpadHost: {
    marginHorizontal: 8,
    marginTop: 0,
    marginBottom: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 8,
  },

  // Hata giriş alanı (sürekli açık, kompakt) — yatay iç boşluk küçültüldü
  // ki tuşlar genişliği tam kullansın.
  entrySection: {
    backgroundColor: '#fffbeb',
    borderColor: '#fcd34d',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 10,
  },
  meterInput: { backgroundColor: '#fff' },
  defectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Hata tipi = ANA TUŞ: büyük, dolgulu amber, az yuvarlak köşe (ana aksiyon
  // hissi). Metraj girip basınca hata direkt kaydedilir.
  // flexGrow+flexBasis: tuşlar satırı tam doldurur, sağda boş alan kalmaz;
  // dolu satırda eşit, yarım satırda esneyip genişler.
  defectBtn: {
    backgroundColor: '#d97706',
    borderRadius: 10,
    minHeight: 64,
    flexGrow: 1,
    flexBasis: 124,
    minWidth: 124,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  defectBtnText: { fontSize: 17, fontWeight: '800', color: '#fff' },
});

const helperStyles = StyleSheet.create({

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
  // Telefon: tek satır çip → daha dar, içerik tek satır.
  tabCompact: { width: 132 },
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
  tabCountInline: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: '#64748b' },
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
  // Açık kumaş üst satırı — kumaş adı + renk (barkod yok). Proportional font
  // (monospace değil): ad okunur dursun.
  rollName: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  // Metre — belirgin: barkod/ad satırından biraz küçük ama net (11px gri değil).
  rollMeta: { fontSize: 13, fontWeight: '700', color: '#334155', marginTop: 2 },
  rollRight: { alignItems: 'flex-end', gap: 4, marginLeft: 8 },
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
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: '#78350f' },
  body: { padding: 18 },
  text: { fontSize: 18, lineHeight: 27, color: '#0f172a', fontWeight: '500' },
});

// Reopen onay modalı (kapalı kart re-scan) — somut top listesi + onay.
const reopenStyles = StyleSheet.create({
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
  title: { fontSize: 17, fontWeight: '800', color: '#78350f' },
  subtitle: { fontSize: 13, color: '#92400e', marginTop: 1 },
  warnText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#0f172a',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  listLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  list: { maxHeight: 240, paddingHorizontal: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  rowIndex: {
    width: 22,
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    textAlign: 'center',
  },
  rowName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#0f172a' },
  rowQty: { fontSize: 14, fontWeight: '700', color: '#475569' },
  blockBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    margin: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  blockText: { flex: 1, fontSize: 15, lineHeight: 21, color: '#7f1d1d', fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  actionBtn: { flex: 1, borderRadius: 12 },
});

// Cetveldeki hata noktası → o noktadaki hata(lar)ı silme modalı stilleri.
const deletePointStyles = StyleSheet.create({
  sheet: { backgroundColor: '#fff', borderRadius: 16, padding: 12, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  title: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#94a3b8' },
  dotCritical: { backgroundColor: '#dc2626' },
  rowMeter: { fontSize: 16, fontWeight: '800', color: '#0f172a', minWidth: 64 },
  rowType: { flex: 1, fontSize: 14, color: '#475569', fontWeight: '600' },
  critBadge: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  critBadgeText: { fontSize: 9, fontWeight: '800', color: '#b91c1c' },
  delBtn: { borderRadius: 8 },
  delBtnLabel: { fontSize: 13, fontWeight: '800', marginVertical: 4, marginHorizontal: 10 },
});
