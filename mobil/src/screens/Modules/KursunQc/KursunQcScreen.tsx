import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import AppModal from '../../../components/AppModal';
import {
  Text,
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
import { useSessionStore } from '../../../store/sessionStore';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { useDrawerActionQueue } from '../../../hooks/useDrawerActionQueue';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh, type ManualRefresh } from '../../../hooks/useManualRefresh';
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
import { signalScan } from '../../../services/scanFeedback';
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
} from '../../../types/models';
import { showScreenError } from '../../../lib/screenToast';
import InspectionPanel, {
  toInspectionPriorDefects,
  inspectionSaveErrorText,
  type InspectionDefectInput,
} from '../../../components/inspection/InspectionPanel';
import PriorDefectList from '../../../components/inspection/PriorDefectList';
import PriorErrorBadge from '../../../components/inspection/PriorErrorBadge';
import {
  composeStationPanels,
  dativeTr,
  emptyRollHint,
  finishStepLabel,
  nextStationLabel,
} from './stationPanels';
import GramajTapPanel from './GramajTapPanel';
import { useGramajTap } from './useGramajTap';
import { MachineStopBand, MachineStopChip, useMachineStopControl } from '../../../components/machine-stop/MachineStopChip';
import MeterStrip from './MeterStrip';
import MeterModals from './MeterModals';
import { useMeterAcks } from './useMeterAcks';
import { useMeterCapture } from './useMeterCapture';
import MeasuredWidthField from './MeasuredWidthField';
import { useMeasuredWidth } from './useMeasuredWidth';
import { measuredWidthErrorText, widthCaptureEnabled } from './measuredWidth';
import { kursunFinishRollId, type KursunFinishVars } from '../../../offline/kursunFinishVars';
import { meterSettingsOf, pendingAcksFromError } from './meterCapture';
import { primaryMeterFor, useMachinePeripherals } from '../../../hooks/useMachinePeripherals';
import { findTarget } from './gramajTap';
import { useAuthStore } from '../../../store/authStore';
import { palette } from '../../../theme/tokens';

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
  fill,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  badge?: React.ReactNode;
  iconAnimatedStyle?: object;
  /** true: 2. kat satırını (secondRow) eşit paylaşır — taşmaz, kaydırma gerekmez. */
  fill?: boolean;
}) {
  return (
    <View style={[styles.headerChipWrap, fill && styles.headerChipWrapFill]}>
      {/* flex:1 BURADA VERİLMEZ: headerChipWrap (row-child) zaten flex:1 alır,
          bu TouchableRipple onun column-child'ı — kendine de flex:1 verilirse
          parent'ın (auto-height) main-eksenine göre 0 yüksekliğe çöker (Yoga
          flex-basis:0 tuzağı). Wrap'in default stretch'i genişliği zaten verir. */}
      <TouchableRipple
        onPress={onPress}
        style={styles.headerChip}
        borderless
        rippleColor="rgba(255,255,255,0.2)"
        accessibilityLabel={label}
      >
        <View style={[styles.headerChipInner, fill && styles.headerChipInnerFill]}>
          <Reanimated.View style={iconAnimatedStyle}>
            <Icon source={icon} size={18} color="#fff" />
          </Reanimated.View>
          <Text style={styles.headerChipText} numberOfLines={1}>{label}</Text>
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

  // Bulunulan makine adı — telefonda başlık subtitle'ı olarak gösterilir (Ham
  // Giriş/KK1 ile aynı desen); tablette PlaceChip başlığın yanında kalır.
  const activeSession = useSessionStore((s) => s.active);
  const machineName =
    activeSession?.machine?.name ||
    activeSession?.machine?.code ||
    activeSession?.station?.name ||
    undefined;
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
  // Saha #18: kataloğun VARSAYILAN hata tipi (isDefault) her zaman İLK tuş — operatör
  // tip belirtmek istemediğinde ona basar. Literal ('GENEL') YOK: admin başka tipi
  // varsayılan yapınca sıra onu izler (karar A, 2026-09-14). Eski backend'de alan yoksa
  // (undefined) sıra katalog sırasıdır.
  const defectTypes = useMemo(() => {
    const list = defectTypesQuery.data?.data ?? [];
    const idx = list.findIndex((d) => d.isDefault === true);
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

  // H3 sayaç: kip/politika adım özetinden; OFF iken akış ve gövde bugünküyle aynı.
  // Sayaç cihazı yalnız kip açıkken sorulur (OFF'ta ek istek yok).
  const meterPeripherals = useMachinePeripherals('METER', meterSettingsOf(activeJob?.stepSummary).capture !== 'OFF');
  const meterAcks = useMeterAcks();
  const meter = useMeterCapture({
    summary: activeJob?.stepSummary ?? null,
    peripheral: primaryMeterFor(meterPeripherals),
    acks: meterAcks,
  });

  // ── İSTASYON ÖZELLİKLERİ (mod sözleşmesi, 2026-08-10) ─────────────────────
  // AUTO → salt bilgi (backend her topa yazar) · OPSİYONEL/ZORUNLU → tuş.
  // Eski backend `properties` göndermez → hepsi boş → ekran bugünküyle aynı.
  const stationProps = activeJob?.stepSummary.properties ?? [];
  const autoProps = useMemo(() => stationProps.filter((p) => p.mode === 'AUTO'), [stationProps]);
  const pickableProps = useMemo(
    () => stationProps.filter((p) => p.mode !== 'AUTO'),
    [stationProps],
  );
  // Operatörün CEVAPLARI: propertyId → seçim. BAYRAK'ta değer `true`, SEÇİM'de
  // seçilen değer KODU ("50GR"). Tek harita, çünkü ikisi de "bu özelliğe cevap
  // verildi mi" sorusunu yanıtlıyor — ayrı iki state, zorunluluk kontrolünün
  // birini unutmasına açık olurdu.
  //
  // ⚠️ TOP BAŞINA sıfırlanır: bir topta işaretlenen özellik sıradaki topa
  // taşınırsa operatör hiç dokunmadan ikinci topa da yazılır.
  const [propAnswers, setPropAnswers] = useState<Record<string, true | string>>({});
  useEffect(() => {
    setPropAnswers({});
  }, [activeJob?.selectedRollId, activeCardId]);

  /** BAYRAK çipi: aç/kapa. */
  const toggleFlagProp = (id: string) =>
    setPropAnswers((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });

  /** SEÇİM çipi: aynı değere tekrar basmak seçimi KALDIRIR (opsiyonelde
   *  vazgeçebilmeli); farklı değere basmak DEĞİŞTİRİR (tek seçim). */
  const pickValueProp = (id: string, code: string) =>
    setPropAnswers((prev) => {
      const next = { ...prev };
      if (next[id] === code) delete next[id];
      else next[id] = code;
      return next;
    });

  const missingRequiredProps = useMemo(
    () => pickableProps.filter((p) => p.mode === 'REQUIRED' && !propAnswers[p.propertyId]),
    [pickableProps, propAnswers],
  );

  /** Backend sözleşmesi: [{propertyId, valueCode?}] — AUTO'lar GÖNDERİLMEZ. */
  const propertySelections = useMemo(
    () =>
      Object.entries(propAnswers).map(([propertyId, v]) => ({
        propertyId,
        ...(typeof v === 'string' ? { valueCode: v } : {}),
      })),
    [propAnswers],
  );

  // ── PANEL BİLEŞİMİ (KQ-D3) — ekran türden, İÇİ yetenekten ────────────────
  // Kalite paneli `inspectionEnabled`'dan (eski backend → açık), işlem paneli
  // istasyon özelliklerinden. Sonraki istasyon metni `nextStepName`'den.
  const panels = composeStationPanels({
    inspectionEnabled: activeJob?.stepSummary.inspectionEnabled,
    properties: stationProps,
  });
  // D4-E2b: en ölçen istasyonda isteğe bağlı "Ölçülen en"; eski backend alanı göndermez → gizli.
  const measuredWidth = useMeasuredWidth(
    widthCaptureEnabled(activeJob?.stepSummary),
    selectedRoll?.rollId ?? null,
    selectedRoll?.widthLimit,
  );
  const nextStation = nextStationLabel(activeJob?.stepSummary.nextStepName);
  const nextStationDative = nextStation ? dativeTr(nextStation) : null;

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
      // Mükerrer okutma: kart zaten sekmede. Sessiz kalırsa operatör "okumadı"
      // sanıp tekrar okutur, `accept` verilirse kartı yeniden açtığını sanır.
      signalScan('duplicate');
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
        signalScan('reject');
        setCardError(`Kart bulunamadı: ${barcode}`);
        Toast.show({ type: 'error', text1: 'Kart bulunamadı', text2: barcode });
        return;
      }

      // Adım kapatılmışsa OTOMATİK reopen YOK — yıkıcı (toplar Tambur'dan geri
      // çekilir). Önce önizleme çek, onay modalını aç; reopen kullanıcı onayıyla.
      if (step.status === 'COMPLETED') {
        const prev = await kursunQcService.reopenPreview(step.workOrderStepId);
        // Okutma sonucu HENÜZ yok: bu bir SORU (onay modalı). Sonuç sinyalini
        // onay sonrası `openResolvedStep` (accept) ya da catch (reject) verir —
        // önce ret sonra kabul basmak birbirini yalanlardı.
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
      signalScan('reject');
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
    signalScan('accept');
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
      signalScan('reject');
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
        text1: panels.qualityPanel ? 'KK2 işaretlendi' : 'Top tamamlandı',
        text2: onlineManager.isOnline() ? undefined : 'Çevrimdışı — sync bekliyor',
      });

      return { cardId, prevRolls, prevSelectedRollId };
    },
    onSuccess: (data, vars) => {
      meter.onCompleteSuccess(data, vars);
      // Server confirm geldi — backend'den fresh state çek (open jobs listesi
      // de değişmiş olabilir: step kapanma, başka kart silinmesi vb.).
      // BEKLENMEZ (KQ-D5): mutasyon HTTP yanıtında settle olur; tek dokunuş
      // kilidi tazelemeyi beklerse emülatörde ~10 sn sonraki dokunuşu yutuyordu.
      void refetchActiveJob().catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['kursun-qc', 'open-cards'] });
    },
    onError: (err, vars, context) => {
      // true: sunucu sayaç değerini reddetti, aynı dokunuş elle/sebep modalıyla sürüyor.
      const meterRecovering = meter.onCompleteError(vars, err);
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
      if (!meterRecovering) showScreenError(err, 'KK2 başarısız', measuredWidthErrorText(err) ?? undefined);
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
      // Mükerrer 409 → "zaten kayıtlı" (InspectionPanel tek metin kaynağı).
      showScreenError(err, 'Hata kaydedilemedi', inspectionSaveErrorText(err) ?? undefined);
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
      showScreenError(err, 'Silinemedi');
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
    KursunFinishVars,
    { cardId: string; prevRolls: KursunRollSummary[]; prevSelectedRollId: string | null } | undefined
  >({
    mutationKey: STATION_MUT.KURSUN_FINISH,
    onMutate: (vars) => {
      if (!activeJob) return undefined;
      const rollId = kursunFinishRollId(vars);
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
          ? nextStationDative ? `${nextStationDative} iletildi` : 'İletildi'

          : 'Çevrimdışı — sync bekliyor',
      });

      return { cardId, prevRolls, prevSelectedRollId };
    },
    onSuccess: async (_res, finishedVars) => {
      const finishedRollId = kursunFinishRollId(finishedVars);
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
      showScreenError(err, 'Kumaş bitirilemedi', measuredWidthErrorText(err) ?? undefined);
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
          ? nextStationDative ? `Toplar ${nextStationDative} taşındı` : 'Toplar çıkarıldı'

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
      // H3: onay bekleyen metre sapmaları Türkçe liste olarak gösterilir.
      const unacked = pendingAcksFromError(err);
      if (unacked) {
        meterAcks.onUnacked(unacked);
        return;
      }
      showScreenError(err, 'Adım kapatılamadı');
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
    // Zorunlu özellik eksikse İSTEK HİÇ GİTMEZ — backend de reddeder ama
    // operatörün 400'ü beklemesi gereksiz; sebep zaten ekranda yazılı.
    if (missingRequiredProps.length > 0) {
      Toast.show({
        type: 'error',
        text1: 'Zorunlu özellik işaretlenmedi',
        text2: missingRequiredProps.map((p) => p.name).join(', '),
      });
      return;
    }
    const vars = measuredWidth.attach({
      rollId: selectedRoll.rollId,
      stepId: activeJob.stepSummary.workOrderStepId,
      // AUTO satırlar GÖNDERİLMEZ — backend onları kendisi ekler; buradan da
      // yollamak, iki kaynağın ayrışması demekti.
      properties: propertySelections,
    });
    if (vars) completeQc2Mutation.mutate(vars);
  };

  // KQ-D5: yalnız kurşunda tek dokunuş (gramaj = top bitti). Konak mutasyonu
  // iyimser sıradaki topa geçer; düzeltme/kilit/şerit hook'ta.
  const operatorLabel = useAuthStore((st) => st.user?.fullName || st.user?.username || '—');
  // D4-A2: makine duruş çipi + bandı. D4-A2b: açık duruşta gramaj dokunuşu uyarısı ayara bağlı, gönderim sürer (K2).
  const machineStop = useMachineStopControl();
  const gramajTap = useGramajTap({
    cfg: panels.tap,
    summary: activeJob?.stepSummary ?? null,
    roll: selectedRoll?.barcode && !selectedRoll.qc2Completed ? selectedRoll : null,
    operator: operatorLabel,
    complete: (vars, opts) => {
      const withWidth = measuredWidth.attach(vars);
      if (withWidth) completeQc2Mutation.mutate(withWidth, opts);
      else opts.onSettled?.();
    },
    refresh: () => void refetchActiveJob().catch(() => undefined),
    meter,
    stopOpen: machineStop.entryWarning,
    // D4-KUC3b: sınır dışı en sayaç okumadan / istek gitmeden uyarılır.
    precheck: (rollId) => measuredWidth.attach({ rollId }) !== null,
  });
  const tapLayout = panels.completion === 'TAP_VALUE';

  // Hata girişi: InspectionPanel metre/boy/mükerrer doğrulamasını yapıp geçerli
  // girdiyi verir; KONAK yazar. clientErrorId burada üretilip vars'a gömülür →
  // mutate variables persist edilir, online resume'da backend aynı id ile idempotent.
  const handleReportDefect = (input: InspectionDefectInput) => {
    if (!activeJob || !selectedRoll || input.meter === null) return;
    reportErrorMutation.mutate({
      rollId: selectedRoll.rollId,
      stepId: activeJob.stepSummary.workOrderStepId,
      startMeter: input.meter,
      defectTypeId: input.defectTypeId,
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

  /**
   * KURŞUN BYPASS — bu kartta tablet SALT-OKUNUR mu? (2026-08-05)
   *
   * Kararı backend verir (`StepSummary.tabletReadOnly`); ekran yalnız uygular.
   * İki sebep de aynı sonuca çıkar: iş ya bir kurşun makinesine dağıtılmıştır,
   * ya da kurşun dağıtımı açıktır ve bu iş dağıtılacaktır. Her iki hâlde de
   * kurşun adımı Tambur'da kart okutulunca kapanır.
   *
   * ⚠️ Aksiyonları GİZLEMEK yetmez, ama gizlemek de ŞARTTIR: gerçek kapı
   * sunucudadır (offline kuyruk ekranı hiç görmeden istek gönderebilir), buradaki
   * gizleme operatörü çıkmaza sokan bir 409'dan korur. Eskiden alan hiç okunmuyordu
   * ve operatör dağıtılmış bir kartı okutup her butonda ham 409 yiyordu.
   */
  const tabletReadOnly = activeJob?.stepSummary.tabletReadOnly ?? null;

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

      {/* Açık iş emri sekmeleri — Okut + Liste (Açık Kartlar) artık header'ın
          2. katında (phoneSecondRow), burada tekrar etmez. Telefonda KENDİ
          tam-genişlik satırı (tek satır çip); tablette de tek satır. */}
      {openJobs.length > 0 && (
        <View style={styles.topArea}>
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
          {!!activeJob.stepSummary.emptyStep && (
            <Text style={styles.paneEmptyHint}>{activeJob.stepSummary.emptyStep.message}</Text>
          )}
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
              qualityStep={panels.qualityPanel}
            />
          )}
        />
      )}

    </>
  );

  // Telefonda "Açık İşler" (operatörün açtığı kart sekmeleri) ve "Açık Kartlar"
  // (sistemdeki tüm bekleyen kartlar) erişimi Ham Giriş (KK1) ile aynı desende:
  // header'da sıkışan tek ikon yerine, başlığın ALTINDAKİ 2. katta yan yana üç
  // etiketli chip (secondRow) — hepsi drawer açmadan doğrudan erişilir.
  // Açık Kartlar'da acil varsa rozet döner.
  const openCardsCount = openCardsQuery.data?.data?.length ?? 0;
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
        label={`Açık Kartlar · ${openCardsCount}`}
        onPress={() => drawerQueue.run(() => setListModalOpen(true))}
        badge={<UrgentBadge count={urgentCount} />}
        fill
      />
      <HeaderChip
        icon="camera"
        label="Tara"
        onPress={() => drawerQueue.run(() => setScannerOpen(true))}
        fill
      />
    </>
  );

  const headerExtras = (
    <View style={styles.headerExtrasRow}>
      <SyncStatusChip />
      {/* Tablet: Kart Okut + Liste aksiyonları header'a etiketli pill olarak
          alınır (Tambur ekranıyla aynı stil). Telefonda aksiyonlar drawer'da
          kalır, erişim 2. kattaki chip'ten (phoneSecondRow). */}
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
    </View>
  );

  return (
    <ScreenChrome
      title={activeJob?.stepSummary.stationName ?? 'Kurşun'}
      subtitle={compact ? machineName : undefined}
      hidePlaceChip={compact}
      headerExtras={headerExtras}
      secondRow={compact ? phoneSecondRow : undefined}
      secondRowSpread={compact}
      titleRowExtras={<MachineStopChip control={machineStop} />}
      topStrip={<MachineStopBand control={machineStop} />}
    >
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
          ) : tabletReadOnly ? (
            // SALT-OKUNUR: iş kâğıtla yürüyor. Kart yine AÇILIR ve toplar sağ
            // listede görünür (operatörün "bu kart bende ne kadar mal" sorusu
            // meşru); yalnız yazma yüzeyi hiç çizilmez. Kartı hiç açmamak,
            // operatöre "kart bozuk" dedirtirdi.
            <View style={styles.readOnlyState}>
              <Icon source="clipboard-text-clock-outline" size={64} color="#0369a1" />
              <Text style={styles.readOnlyTitle}>Bu iş kurşun dağıtımında</Text>
              <Text style={styles.readOnlyText}>{tabletReadOnly.reason}</Text>
              {!!activeJob.stepSummary.bypassAssignment && (
                <Text style={styles.readOnlyMachine}>
                  Makine: {activeJob.stepSummary.bypassAssignment.machineName}
                </Text>
              )}
              <Text style={styles.readOnlyCount}>
                {activeJob.stepSummary.rolls.length} top bekliyor
              </Text>
            </View>
          ) : activeJob.stepSummary.emptyStep && activeJob.stepSummary.rolls.length === 0 ? (
            // Boş adım (KQ-D2 kararı): HATA DEĞİL bilgi — topun şu an nerede
            // olduğunu söyler ("Bu top henüz bu istasyona gelmedi — şu an: X").
            <View style={styles.readOnlyState} testID="kursun-empty-step">
              <Icon source="information-outline" size={64} color="#0369a1" />
              <Text style={styles.readOnlyTitle}>Bu istasyonda top yok</Text>
              <Text style={styles.readOnlyText}>{activeJob.stepSummary.emptyStep.message}</Text>
            </View>
          ) : !selectedRoll ? (
            <View style={styles.emptyState}>
              <Icon source="package-variant" size={64} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>Top seçilmedi</Text>
              <Text style={styles.emptyHint} testID="kursun-empty-roll-hint">
                {emptyRollHint(compact)}
              </Text>
              {tapLayout && meter.outOn && (
                <MeterStrip meter={meter} acks={meterAcks} roll={null} stepId={null} />
              )}
              {tapLayout && <GramajTapPanel state={gramajTap} hasRoll={false} />}
            </View>
          ) : (
            // Tüm öğeler tek gap'li kolonda — cetvel · giriş · buton · numpad
            // arası boşluk EŞİT (styles.rollPane gap). Flex-spacer yok.
            <View style={styles.rollPane}>
              {/* KQ-D3: hata girişi TEK bileşen (InspectionPanel; K4P ile ortak) —
                  cetvel + metre + tip ızgarası. Kalite paneli kapalı istasyonda
                  (yalnız kurşun) çizilmez; işlem paneli aynı sütunda kalır. */}
              {(() => {
                const processCard = tapLayout && selectedRoll.barcode ? (
                  <>
                    {meter.outOn && (
                      <MeterStrip meter={meter} acks={meterAcks} roll={selectedRoll} stepId={activeJob.stepSummary.workOrderStepId} />
                    )}
                    <GramajTapPanel state={gramajTap} hasRoll={!selectedRoll.qc2Completed} />
                  </>
                ) : (
                  <>
                {/* ── İSTASYON ÖZELLİKLERİ (mod güdümlü, 2026-08-10) ──
                    OTOMATİK satırlar salt bilgi (operatöre sorulmaz, adım
                    kapanınca yazılır); OPSİYONEL/ZORUNLU satırlar tuş olur.
                    ZORUNLU işaretlenmeden "KK2 Tamamla" basılırsa backend ADIYLA
                    400 döner — buradaki disable o hatanın istemci ikizidir.
                    Kart yalnız gerçekten çizilecek satır varsa görünür. */}
                {!selectedRoll.qc2Completed && (autoProps.length > 0 || pickableProps.length > 0) && (
                  <Surface style={styles.section} elevation={1}>
                    <Text style={styles.sectionTitle}>Bu istasyonun kazandırdıkları</Text>
                    {autoProps.length > 0 && (
                      <Text style={styles.propAutoLine}>
                        Otomatik: {autoProps.map((p) => p.name).join(', ')}
                      </Text>
                    )}
                    {pickableProps.map((p) => {
                      // SEÇİM tipli özellik (GRAMAJ → 25GR/50GR/75GR): kendi
                      // başlığı + değer çipleri. Değerler KATALOGDAN gelir,
                      // kodda sabit liste YOK.
                      if (p.valueType === 'CHOICE') {
                        const picked = propAnswers[p.propertyId];
                        // KQ-D5: hedef vurgusu birleşik düzende de (seçim, tamamlamaz).
                        const target = p.variantOfPropertyId
                          ? findTarget(
                              activeJob.stepSummary.targetValues,
                              p.propertyId,
                              (p.values ?? []).map((v) => ({ code: v.code, label: v.name })),
                            )
                          : null;
                        return (
                          <View key={p.propertyId} style={styles.propChoiceBlock}>
                            <Text style={styles.propChoiceLabel}>
                              {p.mode === 'REQUIRED' ? `${p.name} *` : p.name}
                              {target ? `  ·  HEDEF ${target.label}` : ''}
                            </Text>
                            {(p.values ?? []).length === 0 ? (
                              // Değersiz SEÇİM özelliği: backend bunu doğduğu anda
                              // reddediyor ama sahada eski bir kayıt olabilir —
                              // sessiz boşluk bırakma, sebebini yaz.
                              <Text style={styles.propWarnLine}>
                                Bu özelliğin tanımlı değeri yok — panelden değer ekleyin.
                              </Text>
                            ) : (
                              <View style={styles.propChipsRow}>
                                {(p.values ?? []).map((v) => {
                                  const on = picked === v.code;
                                  // Çeşit (gramaj) değerleri eldivenle basılan BÜYÜK
                                  // düğme satırı (≥64 dp, seçili = dolu); diğerleri çip.
                                  const big = !!p.variantOfPropertyId;
                                  const isTarget = big && target?.code === v.code;
                                  return (
                                    <TouchableRipple
                                      key={v.code}
                                      borderless
                                      testID={big ? `kursun-variant-${v.code}` : undefined}
                                      onPress={() => pickValueProp(p.propertyId, v.code)}
                                      style={
                                        big
                                          ? [styles.variantBtn, isTarget && styles.variantBtnTarget, on && styles.variantBtnOn]
                                          : [styles.propChip, on && styles.propChipOn]
                                      }
                                    >
                                      <Text
                                        style={
                                          big
                                            ? [styles.variantBtnText, on && styles.variantBtnTextOn]
                                            : [styles.propChipText, on && styles.propChipTextOn]
                                        }
                                      >
                                        {isTarget ? `★ ${v.name}` : v.name}
                                      </Text>
                                    </TouchableRipple>
                                  );
                                })}
                              </View>
                            )}
                          </View>
                        );
                      }
                      // BAYRAK tipli özellik: tek aç/kapa çipi (bugünkü davranış).
                      const on = !!propAnswers[p.propertyId];
                      return (
                        <View key={p.propertyId} style={styles.propChipsRow}>
                          <TouchableRipple
                            borderless
                            onPress={() => toggleFlagProp(p.propertyId)}
                            style={[styles.propChip, on && styles.propChipOn]}
                          >
                            <Text style={[styles.propChipText, on && styles.propChipTextOn]}>
                              {p.mode === 'REQUIRED' ? `${p.name} *` : p.name}
                            </Text>
                          </TouchableRipple>
                        </View>
                      );
                    })}
                    {missingRequiredProps.length > 0 && (
                      <Text style={styles.propWarnLine}>
                        Zorunlu: {missingRequiredProps.map((p) => p.name).join(', ')} — işaretlemeden{' '}
                        {panels.qualityPanel ? 'KK2 tamamlanamaz.' : 'tamamlanamaz.'}
                      </Text>
                    )}
                  </Surface>
                )}
                  </>
                );
                return panels.qualityPanel ? (
                  <InspectionPanel
                    defectTypes={defectTypes}
                    ownDefects={selectedRoll.defects}
                    priorDefects={toInspectionPriorDefects(selectedRoll.priorDefects)}
                    meterInput={startMeter}
                    onMeterChange={setStartMeter}
                    onDefect={handleReportDefect}
                    onDelete={handleDeleteError}
                    maxMeter={selectedRoll.currentQty}
                    compact={compact}
                  >
                    <MeasuredWidthField state={measuredWidth} hidden={selectedRoll.qc2Completed} />
                    {processCard}
                  </InspectionPanel>
                ) : (
                  <View style={styles.entryFixed}>
                    {/* Yalnız kurşun: önceki hatalar bilgi amaçlı (KQ-D7). */}
                    <PriorDefectList defects={toInspectionPriorDefects(selectedRoll.priorDefects)} />
                    <MeasuredWidthField state={measuredWidth} hidden={selectedRoll.qc2Completed} />
                    {processCard}
                  </View>
                );
              })()}

              {/* Sticky footer — durum sırası:
                  1) Tüm toplar KK2 tamam → Adımı Kapat (toplu Tambur'a)
                  2) Açık kumaş      → Kumaşı Bitir (tek tek Tambur'a)
                  3) Barkodlu + tamam → pasif "KK2 Tamamlandı" göstergesi
                  4) Barkodlu + bekliyor → KK2 Tamamla
                  Not: per-roll "Geri Al" kaldırıldı (yarım geri alıyordu + offline
                  ölüydü). Yanlış işaret düzeltmesi = kartı tekrar okut → adım reopen. */}
              {/* Tek dokunuş düzeninde bekleyen barkodlu topun "Tamamla"sı yok —
                  değer düğmesi tamamlar (KQ-D5). */}
              {!(tapLayout && !allQc2Done && selectedRoll.barcode && !selectedRoll.qc2Completed) && (
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
                    {finishStepLabel(activeJob.stepSummary.nextStepName)}
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
                    label={
                      !nextStationDative
                        ? 'Kumaşı Bitir'
                        : compact
                          ? `Kumaşı Bitir (${nextStationDative})`
                          : `Kumaşı Bitir (${nextStationDative} Gönder)`
                    }
                    compact={compact}
                    large={!compact}
                    onPress={() =>
                      footerThrottled(() => {
                        // Ensiz gövde eski kuyruk biçimiyle (düz rollId) aynı kalır.
                        const v: { rollId: string; measuredWidthCm?: number } | null = measuredWidth.attach({ rollId: selectedRoll.rollId });
                        if (v) kursunFinishMutation.mutate(v.measuredWidthCm != null ? v : v.rollId);
                      })
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
                    {panels.qualityPanel ? 'KK2 Tamamlandı' : 'Tamamlandı'}
                  </Button>
                ) : (
                  // Barkodlu top — aynı offline-aware mantığı: loading/disabled
                  // binding'i yok (paused mutation sıradaki rulayı engellemesin).
                  <Button
                    mode="contained"
                    icon="check-all"
                    onPress={() => footerThrottled(handleCompleteQc2)}
                    // Zorunlu değer seçilmeden kilitli; sebep işlem panelinde yazılı.
                    // (isPending bağı DEĞİL — duraklamış mutasyon kilitlemez.)
                    disabled={missingRequiredProps.length > 0}
                    buttonColor="#059669"
                    style={styles.footerBtn}
                    contentStyle={styles.footerBtnContent}
                    labelStyle={styles.footerBtnLabel}
                  >
                    {panels.qualityPanel
                      ? `${panels.completeLabel} (${selectedRoll.errorCount} hata)`
                      : panels.completeLabel}
                  </Button>
                )}
              </Surface>
              )}

              {/* Tablet: sayısal tuş takımı sol kolonun altında — metre girişi
                  ile aynı sütunda, aksiyon butonunun hemen altında. fill: numpad
                  kalan alana esner (dar tablette taşmaz, geniş tablette iri tuş).
                  Telefonda numpad yok; kalite paneli kapalıysa metre girişi yok → numpad da yok. */}
              {!compact && panels.qualityPanel && <NumpadHost style={styles.numpadHost} fill />}
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

      <MeterModals meter={meter} acks={meterAcks} rolls={activeJob?.stepSummary.rolls ?? []} />

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
                      <PriorErrorBadge count={item.openErrorCount} testID="card-error-badge" />
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

// Top satırının durum çipleri (hata sayısı + adım durumu) — kalite adımı değilse "KK2" demez.
function RollStatusChips({ errorCount, priorCount, done, qualityStep }: { errorCount: number; priorCount?: number; done: boolean; qualityStep: boolean }) {
  return (
    <View style={helperStyles.rollRight}>
      <PriorErrorBadge count={priorCount} testID="roll-prior-badge" />
      {errorCount > 0 && (
        <View style={helperStyles.chipAmber}>
          <Text style={helperStyles.chipText}>{errorCount} hata</Text>
        </View>
      )}
      {done ? (
        <View style={helperStyles.chipBlue}>
          <Text style={helperStyles.chipText}>{qualityStep ? 'KK2 ✓' : 'Tamam ✓'}</Text>
        </View>
      ) : (
        <View style={helperStyles.chipNeutral}>
          <Text style={helperStyles.chipText}>{qualityStep ? 'KK2 bekliyor' : 'Bekliyor'}</Text>
        </View>
      )}
    </View>
  );
}

function RollListItem({
  roll,
  index,
  selected,
  onPress,
  qualityStep,
}: {
  roll: KursunRollSummary;
  index: number;
  selected: boolean;
  onPress: () => void;
  /** Kalite paneli kapalı istasyonda (yalnız kurşun) çip "KK2" demez. */
  qualityStep: boolean;
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
          <RollStatusChips errorCount={roll.errorCount} priorCount={roll.priorOpenErrorCount} done={done} qualityStep={qualityStep} />
          {selected && (
            <Icon source="chevron-left" size={22} color="#1e40af" />
          )}
        </View>
        </TouchableRipple>
      </Surface>
    </Reanimated.View>
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
  // Header'da sync chip + tablet aksiyon chip'leri yan yana sığsın.
  headerExtrasRow: { flexDirection: 'row', alignItems: 'center' },
  // Koyu header'a uygun translucent etiketli aksiyon pill'i (Tambur ile aynı).
  headerChipWrap: { marginLeft: 4 },
  // secondRow'da (telefon) chip'ler eşit paylaşır — taşmaz, kaydırma gerekmez.
  headerChipWrapFill: { flex: 1, marginLeft: 0 },
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
  headerChipInnerFill: { justifyContent: 'center' },
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

  // Kurşun bypass salt-okunur durumu. Boş-durum grisinden AYRI bir renk (mavi):
  // "burada yapacak bir şey yok" ile "bu iş başka yerde yürüyor" farklı şeyler;
  // aynı gri operatöre "kart yüklenmedi" dedirtirdi.
  readOnlyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 10,
    backgroundColor: '#f0f9ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  readOnlyTitle: { fontSize: 20, fontWeight: '800', color: '#075985' },
  readOnlyText: {
    fontSize: 15,
    color: '#0c4a6e',
    textAlign: 'center',
    maxWidth: 420,
    lineHeight: 21,
  },
  readOnlyMachine: { fontSize: 16, fontWeight: '700', color: '#0369a1' },
  readOnlyCount: { fontSize: 13, color: '#0284c7' },

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
  // İşlem paneli kartı ("Bu istasyonun kazandırdıkları") — flex YOK: InspectionPanel
  // girişinin altında içerik kadar uzar (flex:1 onu 56 dp'ye ezip içini gizliyordu).
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  // İstasyon özellikleri (mod güdümlü) — AUTO satırı salt bilgi, gerisi tuş.
  propAutoLine: { fontSize: 13, color: '#475569', marginTop: 6 },
  propWarnLine: { fontSize: 12, color: '#b45309', marginTop: 6, fontWeight: '700' },
  propChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  // SEÇİM tipli özellik bloğu: kendi başlığı + değer çipleri.
  propChoiceBlock: { marginTop: 10 },
  propChoiceLabel: { fontSize: 13, fontWeight: '700', color: '#334155' },
  propChip: {
    paddingHorizontal: 16,
    // ≥56dp dokunma hedefi (fabrika eldiveni) — UI kuralı.
    paddingVertical: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  propChipOn: { borderColor: '#059669', borderWidth: 2, backgroundColor: '#ecfdf5' },
  propChipText: { fontSize: 15, fontWeight: '700', color: '#475569' },
  propChipTextOn: { color: '#047857' },
  // Gramaj (çeşit) düğmesi: büyük dokunma hedefi, seçili = dolu yeşil.
  variantBtn: {
    minHeight: 72,
    flexGrow: 1,
    flexBasis: 120,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#059669',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  variantBtnOn: { backgroundColor: '#059669' },
  variantBtnTarget: { borderWidth: 5, borderColor: palette.emerald[800] },
  variantBtnText: { fontSize: 20, fontWeight: '800', color: '#047857' },
  variantBtnTextOn: { color: '#ffffff' },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  muted: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' },

  // Kayıtlı hatalar — boş durum (cetvelle aynı yüksekliği doldurur → zıplama yok).
  // Metre cetveli — hatalar tik/küme olarak absolute konumlanır; her marker
  // geniş şeffaf hit alanına (rulerHit) sarılı, dokununca o nokta silinir.

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
  // Üst alan: açık iş sekmeleri satırı.
  topArea: {
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 6,
    gap: 6,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
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
  // Hata tipi = ANA TUŞ: büyük, dolgulu amber, az yuvarlak köşe (ana aksiyon
  // hissi). Metraj girip basınca hata direkt kaydedilir.
  // flexGrow+flexBasis: tuşlar satırı tam doldurur, sağda boş alan kalmaz;
  // dolu satırda eşit, yarım satırda esneyip genişler.
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
