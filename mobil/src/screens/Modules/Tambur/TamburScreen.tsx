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
import WorkOrderOutputPanel from './WorkOrderOutputPanel';
import { LabelNamePreview } from './LabelNamePreview';
import TamburFieldFix from './TamburFieldFix';
import { usePermissions } from '../../../hooks/usePermission';
import { useOnlineStatus } from '../../../hooks/useOnlineStatus';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { useSessionStore } from '../../../store/sessionStore';
import { useMachinePeripherals, meterPeripheralFor } from '../../../hooks/useMachinePeripherals';
import { buildIoFromPeripheral } from '../../../hooks/usePeripheralIO';
import RefreshButton from '../../../components/RefreshButton';
import RemoteListSheet from '../../../components/RemoteListSheet';
import { labelService } from '../../../services/label.service';
import { VARIANCE_MIN_REASON_TEXT } from '../../../constants/varianceReasons';
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
import RollFilterBar from '../../../components/filters/RollFilterBar';
import {
  EMPTY_ROLL_FILTER,
  buildRollQueryParams,
  filterQueryKey,
  type RollHistoryFilterState,
} from '../../../components/filters/rollHistoryFilter';
import AppModal from '../../../components/AppModal';
import TamburOrderLinkSheet from './TamburOrderLinkSheet';
import { shortCutOverride, shortCutRevert, SHORT_CUT_QUALITY_CODE } from './shortCutQuality';
import LabelTargetSheet, { type LabelTargetContext } from '../../../components/LabelTargetSheet';
import { LabelPreviewSheet } from '../../../components/labels/LabelPreviewSheet';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import RollPickerModal from '../../../components/RollPickerModal';
import { LabelPrinter } from '../../../components/LabelPrinter';
import StandaloneLabelSheet from '../../../components/labels/StandaloneLabelSheet';
import { StandaloneLabelPrinter } from '../../../components/labels/StandaloneLabelPrinter';
import { isWorkSessionLost } from '../../../services/api';
import {
  tamburService,
  type TamburManualProduceRequest,
  type TamburUndoPreview,
  type TamburUndoMode,
} from '../../../services/tambur.service';
import { rollService } from '../../../services/roll.service';
import { customerService } from '../../../services/customer.service';
import { itemService } from '../../../services/item.service';
import { colorService } from '../../../services/color.service';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { formatRelativeWait } from '../../../utils/relativeTime';
import {
  STATION_MUT,
  type TamburFinalizeOpenFabricVars,
} from '../../../offline/mutations';
import SyncStatusChip from '../../../components/SyncStatusChip';
import { SkeletonList, usePressScale, AnimatedEntrance } from '../../../components/motion';
import { colors, spacing, radius, shadow } from '../../../theme';
import { MANUAL_MIN_REASON } from '../../../constants/manualReasons';
import { useReasonPresets, isBuiltinPreset } from '../../../hooks/useReasonPresets';
import ReasonPresetEditDialog, {
  type ReasonPresetEditMode,
} from '../../../components/reasonPresets/ReasonPresetEditDialog';
import type { ReasonPreset } from '../../../services/reasonPreset.service';
import Animated from 'react-native-reanimated';
import { defectTypeService } from '../../../services/defectType.service';
import { qualityGradeService } from '../../../services/qualityGrade.service';
import { useFoldValues } from '../../../hooks/useFoldValues';
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
  TamburBypassSource,
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
/** Varsayılan kalite — tek kaynak (sıfırlama ayarı da bunu kullanır). */
const DEFAULT_QUALITY_CODE = '1.KALITE';
const DEFAULT_QUALITY_NAME = '1. Kalite';
const EMPTY_VOLUNTARY_ENTRY: VoluntaryEntryState = {
  length: '',
  qualityGrade: DEFAULT_QUALITY_CODE,
  qualityName: DEFAULT_QUALITY_NAME,
  targetOrderLineId: null,
  targetCustomerId: null,
  targetCustomerName: undefined,
};
const EMPTY_WORK: RollWorkState = {
  decisions: {},
  // ⚠️ BOŞ başlar (2026-08-10) — sabit '2-KAT' katalogda o değer yoksa geçersiz
  // bir ön-seçimdi. Değeri her zaman effect doldurur: iş emri planı → yoksa
  // katalogun ilk değeri (bkz. defaultFold).
  foldType: null,
  voluntaryCuts: [],
  voluntaryEntry: EMPTY_VOLUNTARY_ENTRY,
  errorEntry: EMPTY_ERROR_ENTRY,
};

/** Manuel Mod sebep alanı alt sınırı — backend de aynı sınırı uygular. */
/**
 * Manuel Mod otomatik ölçümünde `measureFromMachine`e verilen "kalan" değeri.
 * Manuel modda PARENT TOP YOKTUR, yani gerçek bir kalan da yok; bu sayı YALNIZ
 * simüle cihazın ürettiği sahte değerin üst sınırını besler (gerçek HC-06
 * okumasında hiç kullanılmaz). 0 geçilseydi simüle metre 0 döndürür ve giriş
 * "metraj pozitif olmalı" ile düşerdi — seed'de METER cihazları simüle doğduğu
 * için bu, sahada ilk denemede karşılaşılacak bir hataydı.
 */
const MANUAL_SIM_METER_BOUND = 100;

// Koyu header'da etiketli aksiyon pill'i (ikon + ne olduğu yazısı). Salt-ikon
// yerine her aksiyonun adı görünür. `accent` = ayrık birincil aksiyon (Etiket
// Değiştir) için hafif vurgu.
function HeaderChip({
  icon,
  label,
  onPress,
  accent,
  fill,
  active,
  iconOnly,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  accent?: boolean;
  /** true: 2. kat satırını (secondRow) eşit paylaşır — taşmaz, kaydırma gerekmez. */
  fill?: boolean;
  /**
   * AÇIK bir MODU temsil eden chip (aksiyon değil, durum): dolu amber zemin +
   * koyu yazı. Aksiyon chip'lerinin translucent dilinden bilinçli olarak ayrışır
   * — operatör hangi modda olduğunu tek bakışta görmeli (yanlış modda üretim
   * sessiz hataya döner).
   */
  active?: boolean;
  /** Yalnız ikon çiz — etiket erişilebilirlik adı olarak kalır (dar başlık). */
  iconOnly?: boolean;
}) {
  return (
    <TouchableRipple
      onPress={onPress}
      style={[
        styles.headerChip,
        accent && styles.headerChipAccent,
        fill && styles.headerChipFill,
        active && styles.headerChipOn,
      ]}
      borderless
      rippleColor={active ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.2)'}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={active === undefined ? undefined : { selected: active }}
    >
      <View
        style={[
          styles.headerChipInner,
          fill && styles.headerChipInnerFill,
          iconOnly && styles.headerChipInnerIcon,
        ]}
      >
        <Icon source={icon} size={18} color={active ? '#78350f' : '#fff'} />
        {!iconOnly && (
          <Text
            style={[styles.headerChipText, active && styles.headerChipTextOn]}
            numberOfLines={1}
          >
            {label}
          </Text>
        )}
      </View>
    </TouchableRipple>
  );
}

/**
 * KURŞUN BYPASS — SESSİZ KAPANIŞ (Tambur operatörü HİÇBİR ŞEY ONAYLAMAZ).
 *
 * Kurşun makinelerinde tablet yoktur: iş, Kurşun Dağıtım ekranından fiziksel bir
 * kurşun MAKİNESİNE atanır ve toplar Kurşun/KK2 adımında AÇIK bekler. Tambur
 * tabletinde kart okutulduğunda `by-card` ucu "bu adımda açık top yok" diye 400
 * atar; context ucu ise `bypassPending` döner. O noktada operatöre soru SORMAK
 * yanlıştı — kurşunu yapan o değil, kararı çoktan dağıtımcı verdi ve önizlemede
 * "onaylamayacağı" hiçbir şey yok. Bu yüzden adım burada sessizce kapatılır ve
 * kart normal Tambur işi olarak açılır; operatöre yalnız BİLGİ toast'ı gösterilir.
 *
 * `rollIds` ÖNİZLEMEDEN gider — backend kapsam paritesini tx içinde birebir
 * doğrular (eksik/fazla liste 409, yarım kapanış yok). Nadir yarışta (önizleme
 * ile kapanış arasında adıma yeni top girdi) kapsam tazelenip BİR KEZ yeniden
 * denenir; ikinci deneme de düşerse hata operatöre gösterilir.
 *
 * Dönüş:
 *  • `none`  → bu kartta bekleyen kurşun dağıtımı yok (çağıran kendi hatasını basar)
 *  • `done`  → adım kapandı ya da zaten kapalıydı → kart açılabilir
 *  • `error` → iki denemede de kapanmadı, mesaj operatöre gösterilir
 */
type SilentBypassResult =
  | { kind: 'none' }
  | {
      kind: 'done';
      movedRollCount: number;
      alreadyDone: boolean;
      /** Kapanışın kaynağı — bilgi metni buna göre değişir (dağıtılmış / dağıtımsız). */
      source: TamburBypassSource;
    }
  | { kind: 'error'; message: string };

async function completeKursunBypassSilently(
  barcode: string,
): Promise<SilentBypassResult> {
  // Context ucu bypass dışı sebeplerle de patlayabilir (ağ / yetki) — o durumda
  // "bekleyen dağıtım yok" deyip çağıranın ASIL hatasını göstermesi doğrudur.
  const readPending = () =>
    tamburService
      .getContext(barcode)
      .then((r) => (r.data as TamburContext | null)?.bypassPending ?? null)
      .catch(() => null);

  let pending = await readPending();
  if (!pending) return { kind: 'none' };
  // Kaynak İLK önizlemeden saklanır: yarışı kaybedip `pending` null'landığında
  // bile operatöre doğru bilgi metnini basabilmek için. Eski backend bu alanı
  // göndermez → dağıtılmış kabul edilir (o sürümdeki tek kaynak oydu).
  const source: TamburBypassSource = pending.source ?? 'ASSIGNED';

  let lastError: Error | null = null;
  // İki deneme: ilki önizlemedeki kapsamla, ikincisi TAZELENMİŞ kapsamla.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!pending) {
      // Yarışın kaybedeni olduk ama iş bitti (başka cihaz kapattı) — kart açılır.
      return { kind: 'done', movedRollCount: 0, alreadyDone: true, source };
    }
    try {
      const res = await tamburService.bypassComplete(
        barcode,
        pending.rolls.map((r) => r.rollId),
      );
      return {
        kind: 'done',
        movedRollCount: res.data.movedRollCount,
        alreadyDone: res.data.alreadyDone,
        source,
      };
    } catch (e) {
      lastError = e as Error;
      pending = await readPending();
    }
  }
  return { kind: 'error', message: lastError?.message ?? 'Bilinmeyen hata' };
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

  // ── Saha düzeltmesi kapısı ────────────────────────────────────────────────
  // "Topu Buraya Al" + "Manuel Top Ekle" YALNIZ yetkili operatörde çizilir.
  // Devre dışı gri buton GÖSTERİLMEZ: yetkisi olmayan operatörde "neden
  // çalışmıyor" sorusu üretir; backend zaten 403 döner (UI ikinci kapı değil).
  //
  // ⚠️ ERİŞİM SINIRI (backend kaynaklı, mobilde çözülemez): iki uç da hedef
  // olarak bir `targetStepId` ister ve mobilin adım kimliğini öğrenebildiği TEK
  // yol kartı çözmektir (`by-card` / `context`). İkisi de `assertWoAtStepKind`
  // üzerinden geçtiği için Tambur adımında AÇIK TOP YOKSA 400 atar ("… adımında
  // şu an açık top yok. Mevcut konum: Kurşun (3 rulo)"). Yani kart hiç
  // açılamadığında bu iki aksiyon da görünmez — tam da en çok istendikleri
  // durumda. Kartı bir kez açabilen operatör (adımda başka top varken ya da
  // hepsini finalize ettikten sonra sekme açık kalırken) sorunsuz kullanır.
  // Kalıcı çözüm backend tarafındadır: karttan Tambur adımını açık-top şartı
  // OLMADAN çözen bir okuma yolu (ör. `context`e `allowEmpty` dalı). Buraya
  // uydurma bir stepId türetme — yanlış adıma top bağlamak sessiz hatadır.
  const { has: hasPermission } = usePermissions();
  // Cihaz tercihi (sunucuya gitmez): kesimden sonra kalite 1. Kaliteye dönsün mü?
  const resetQualityAfterCut = useDeviceSettingsStore((st) => st.tamburResetQualityAfterCut);
  // KISA KESİM → OTOMATİK A1 (2026-08-19 saha isteği; kural: shortCutQuality.ts).
  // Bayrak + eşik cihaz tercihi; YALNIZ bayrak açıkken devreye girer.
  const shortCutEnabled = useDeviceSettingsStore((st) => st.tamburShortCutA1Enabled);
  const shortCutThresholdM = useDeviceSettingsStore((st) => st.tamburShortCutA1ThresholdM);
  // "Şu an seçili A1'i KURAL mı yazdı?" — elle yazımda eşik üstüne çıkınca geri
  // dönüş yalnız otomatik yazılan A1 için (operatörün kendi A1'i geri alınmaz).
  // Ana kesim + manuel mod aynı formu (voluntaryEntry) paylaşır → tek ref;
  // Top Kesme ayrı state taşır → ayrı ref.
  const shortCutAutoMainRef = useRef(false);
  const shortCutAutoRecutRef = useRef(false);
  const canFieldFix =
    hasPermission('mobile:tambur-duzelt') || hasPermission('roll:manual-adjust');
  const [fieldFixOpen, setFieldFixOpen] = useState(false);
  // "Sipariş Bağla" — planlama yetkisi taşıyan kişiye (süpervizör). Sıradan
  // operatörde tuş HİÇ çizilmez (403'lük gri buton bırakılmaz — proje kuralı).
  const canLinkOrders = hasPermission('workorder:write');
  const [orderLinkOpen, setOrderLinkOpen] = useState(false);
  // Saha düzeltmesi uçları ONLINE-ONLY (barkodu sunucu üretir, taşıma tx'i
  // sunucuda çözülür) — offline kuyruğuna girmez; modal bunu banda yazar.
  const isOnline = useOnlineStatus();

  // ── MANUEL EKLE modu (kartsız bitmiş ürün) ────────────────────────────────
  // Tambur ekranı normalde refakat KARTI bekler. Bu anahtar AÇIKKEN kart hiç
  // okutulmaz: operatör ürün/metraj/müşteri seçer ve çıkan top DOĞRUDAN Bitmiş
  // Depo'ya yazılır (`POST /tambur/manual/produce`). ACİL DURUM yoludur (top bir
  // yerde takıldı / elde kalan bitmiş mal acilen sisteme alınacak) — KK1 ham
  // girişinin kopyası DEĞİL (o olağan iş akışı, bu istisna).
  //
  // ⚠️ Tercih CİHAZDA kalıcı (tamburCutMode emsali) ama izin OTURUMDAN gelir:
  // render kararı her zaman `manualMode` (= tercih ∧ yetki) üzerinden verilir.
  // Ham tercihe bakılsaydı, anahtar açıkken yetkisi alınan bir operatör "manuel
  // ekran + 403 veren buton + moddan çıkış yolu yok" çıkmazında kalırdı.
  const tamburManualPref = useDeviceSettingsStore((s) => s.tamburManualMode);
  const setTamburManualPref = useDeviceSettingsStore((s) => s.setTamburManualMode);
  const manualMode = tamburManualPref && canFieldFix;

  const [cardBarcode, setCardBarcode] = useState('');
  const [resolvingCard, setResolvingCard] = useState(false);
  const [openJobs, setOpenJobs] = useState<OpenJob[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Aktif top'un çalışma state'i — top/sekme değişince sıfırlanır.
  const [work, setWork] = useState<RollWorkState>(EMPTY_WORK);
  // Kat seçenekleri katalogdan — tuşlar, ön-seçim ve metre rolü hep bu listeden.
  const { values: foldValues } = useFoldValues();
  // Kesim uzunluğu kaynağı. Faz 1'de MANUEL varsayılan (gerçek makine yok);
  // Otomatik'te uzunluk makineden ölçülür → input + numpad gizlenir.
  // CİHAZDA KALICI (deviceSettingsStore) ve "Top Kesme" ile AYNI tercih: seçim
  // aslında "bu istasyonda metre makinesi çalışıyor mu" gerçeğini yansıtır, o da
  // tek bir gerçektir — iki ayrı hafıza tutmak operatörü şaşırtırdı.
  const cutMode = useDeviceSettingsStore((s) => s.tamburCutMode);
  const setCutMode = useDeviceSettingsStore((s) => s.setTamburCutMode);
  
  const pendingRecutCleanupRef = useRef<{ remainingChild: Roll | null } | null>(null);

  // Etiket basımı modal state — finalize veya post-split sonrası yeni Roll'lar.
  // Roller tam obje olarak tutulur (item.color, variant dahil) → LabelPrinter
  // doğrudan basabilsin.
  const [pendingPrintRolls, setPendingPrintRolls] = useState<Roll[]>([]);

  // Geçmiş çıktı listesi modal state
  const [recentOutputOpen, setRecentOutputOpen] = useState(false);

  // Serbest etiket (topa bağlı olmayan bakım/uyarı etiketi) — sheet + baskı işi.
  const [standaloneOpen, setStandaloneOpen] = useState(false);
  const [standaloneJob, setStandaloneJob] = useState<{ templateId: string; copies: number } | null>(
    null,
  );

  // Yazdırılacak aktif rol — LabelPrinter bu state'i izler ve sıfırlanınca
  // hazır olur. Per-row "Bas" butonu bu state'i set eder.
  const [activePrintRoll, setActivePrintRoll] = useState<Roll | null>(null);
  // Etiket TÜRÜ normalde RENKTEN çözülür (renksiz = ham kumaş → ROLL_RAW).
  // Manuel Mod BİTMİŞ ürün üretir ve renk OPSİYONELDİR → renksiz manuel top ham
  // etiketle basılırdı. Bu yüzden tür baskı İŞİNE bağlanır: null = renkten çöz
  // (eski davranış, tüm mevcut yollar), değer = o iş için sabitlenmiş tür.
  // Global "manuel moddayken hep ROLL_FINISHED" YANLIŞ olurdu — mod açıkken
  // "Çıkanlar"dan yeniden basılan ESKİ bir ham top da bitmiş etiket alırdı.
  const [printKind, setPrintKind] = useState<'ROLL_RAW' | 'ROLL_FINISHED' | null>(null);
  /** Tek giriş kapısı: baskı slotunu ve (varsa) tür sabitlemesini birlikte yazar. */
  const startPrint = (
    roll: Roll,
    kind: 'ROLL_RAW' | 'ROLL_FINISHED' | null = null,
  ) => {
    setPrintKind(kind);
    setActivePrintRoll(roll);
  };

  // Kartelalık işareti — bu kesimde doğan çıktı topları depoda kartela sevki için
  // işaretlensin (yalnız WAREHOUSE çıktılarda etkili; sevki engellemez). Aynı topu
  // kartelaya kesen operatör için kesimler arası kalıcı, finalize'da sıfırlanır.
  const [markAsKartela, setMarkAsKartela] = useState(false);

  // Tambur'da çıkan top metresi kayıtlı kalanı aşabilir mi (admin flag, VARSAYILAN
  // AÇIK — hook fallback'i true, flags yüklenemese de açık; 2026-07-27 ürün kararı).
  // Açıkken aşımda onay diyaloğu çıkar (parmak hatası koruması) ve onaylanınca
  // backend kabul eder (parent tamamen tüketilir); admin kapatırsa aşan giriş engellenir.
  const overQuantityEnabled = useTamburOverQuantityEnabled();
  // 2-kat / 4-kat metre cihazları — tabletin atandığı makineden backend çözer
  // (admin Cihaz Kaydı'nda tanımlar). foldType→role ile seçilir; cihazın `simulate`
  // bayrağı açıksa sahte, değilse HAL (BT/HC-06) ile gerçek okuma.
  const meterPeripherals = useMachinePeripherals('METER');
  // "Kes" (otomatik) → makineden okuma uçuşurken footer'ı kilitle (çift-tık koruması).
  const [measuring, setMeasuring] = useState(false);
  /**
   * Onay bekleyen kesim — onaylanınca onConfirm() çalışır (ilgili mutate).
   *
   * İKİ AYRI SEBEP, TEK DİYALOG (`kind`):
   *   'over' → girilen metraj kayıtlı kalanı AŞIYOR (parmak hatası koruması).
   *   'all'  → girilen metraj kalanın TAMAMI. Bu kesim topu bitirir: kalan ~0
   *            kalınca akış otomatik finalize eder ve İŞ KAPANIR. Metraj alanı
   *            BOŞ bırakılıp "Kes"e basmak da bu yola girer ("Kes = kalanı kes"),
   *            yani en kolay yapılan hareket aynı zamanda en geri alınamaz
   *            olanıydı — saha isteği (2026-08-04): yanlışlıkla işi bitirmesin.
   */
  /**
   * RENKSİZ TOP ONAYI (2026-08-04): manuel modda renk seçmemek geçerli bir
   * durumdur (ham beyaz mal) ama SESSİZ olmamalı — operatör rengi seçmeyi
   * unutmuş da olabilir ve top envantere renksiz girdiğinde bunu ancak etikette
   * fark eder. Onaylanınca kayıt yapılır.
   */
  const [colorlessConfirm, setColorlessConfirm] = useState<(() => void) | null>(null);
  /**
   * PLAN-GERÇEK SAPMA onayı (2026-08-19, backend 409 PLAN_MISMATCH):
   * topun rengi/eni iş emri hedefinden sapıyorsa backend kesimi/bitirmeyi
   * onaysız yazmaz. Modal sapmayı satır satır gösterir; onaylanırsa AYNI istek
   * `confirmMismatch: true` ile tekrarlanır ve karar backend audit'ine düşer.
   * Onay TOP başına BİR KEZ istenir (`planMismatchConfirmedRef`): aynı topun
   * sonraki kesimleri bayrağı kendiliğinden taşır — seri kesimde her parçada
   * soru sormak operatöre uyarıyı okumamayı öğretirdi.
   */
  const [planMismatch, setPlanMismatch] = useState<{
    messages: string[];
    retry: () => void;
  } | null>(null);
  const planMismatchConfirmedRef = useRef<Set<string>>(new Set());
  /** 409 PLAN_MISMATCH mi — doluysa insan-okur sapma satırları. */
  const readPlanMismatch = (err: unknown): string[] | null => {
    const e = err as Error & { status?: number; details?: Record<string, unknown> };
    if (e?.status !== 409 || e?.details?.code !== 'PLAN_MISMATCH') return null;
    const mm = e.details?.mismatches;
    return Array.isArray(mm)
      ? mm.map((m) => String((m as { message?: string }).message ?? '')).filter(Boolean)
      : [];
  };
  const [overCutConfirm, setOverCutConfirm] = useState<{
    kind: 'over' | 'all';
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
  // Recut (Top Kesme) — açık kumaş akışıyla aynı: manuel/otomatik mod. AYNI
  // cihaz tercihini paylaşır (ayrı state DEĞİL): modalda değiştirilen mod ana
  // kesime de yansır, çünkü ikisi aynı metre makinesini kullanır.
  const recutMode = cutMode;
  const setRecutMode = setCutMode;
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
  // "Bu işten çıkanlar" panelinden açılan geri alma hedefi. `RecentOutputModal`
  // kendi içinde ayrı bir `undoTarget` tutuyor — o modal ayrı bir bileşen ve
  // state'i paylaşmıyorlar; ikisi aynı onay diyaloğunu kullanır.
  const [panelUndoTarget, setPanelUndoTarget] = useState<Roll | null>(null);
  // AÇIK KUMAŞ akışının kapanış kararı (2026-08-09). Recut'ınkinden AYRI state:
  // iki akış aynı anda ekranda olabiliyor ve tek bayrağı paylaşsalardı biri
  // kapanınca diğerinin modalı da kapanırdı.
  const [openFabricFinalizeOpen, setOpenFabricFinalizeOpen] = useState(false);
  // İdempotency: clientToken MANTIKSAL KESİM DENEMESİ başına bir kez üretilir —
  // timeout/hata sonrası tekrar "Kes" basışı AYNI token'ı gönderir (backend
  // P2002 ile cache'lenmiş child'ı döner, mükerrer kesim + çift metraj düşümü
  // olmaz). Token yalnız o topun BAŞARI yanıtı gelince düşer; top değişince
  // rollId anahtarı uyuşmaz → taze token. (Eski kod her mutate()'te yeni token
  // üretiyordu — koruma fiilen hiç devreye girmiyordu.)
  const cutTokenRef = useRef<{ rollId: string; token: string } | null>(null);
  const recutTokenRef = useRef<{ rollId: string; token: string } | null>(null);
  const takeCutToken = (
    ref: React.MutableRefObject<{ rollId: string; token: string } | null>,
    rollId: string,
  ): string => {
    if (!ref.current || ref.current.rollId !== rollId) {
      ref.current = { rollId, token: generateClientUuid() };
    }
    return ref.current.token;
  };
  // Son kesimden dönen güncel parent — X kapat sırasında etiketi basıma kuyruğa
  // atılır (operatör fiziksel etiketi yenilemeli, eski metraj artık geçersiz).
  const [recutLastParentRoll, setRecutLastParentRoll] = useState<Roll | null>(null);
  // İş emri siparişleri modal'ı — operatör kalan ihtiyaçları görmek için açar
  const [ordersModalOpen, setOrdersModalOpen] = useState(false);
  // Hata noktaları detay modal'ı (cetvel + sıralı/filtreli liste) ve
  // Tambur adım notu modal'ı (sticky header kutusundan açılır).
  const [errorsModalOpen, setErrorsModalOpen] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);

  // ── Manuel Mod formu ──────────────────────────────────────────────────────
  // Kart YOK → iş emrinden miras da YOK: ürün ZORUNLU, renk operatörün kararı.
  // Metraj / "Kime?" / Kalite AYRI state tutmaz — ana kesim akışının state'ini
  // (`cutMode`, `work.voluntaryEntry`) aynen paylaşır; ikinci bir hafıza aynı
  // alanın iki farklı değerini üretirdi.
  const [manualItemId, setManualItemId] = useState<string | null>(null);
  const [manualItemLabel, setManualItemLabel] = useState<string | null>(null);
  const [manualColorId, setManualColorId] = useState<string | null>(null);
  // En (cm) — MANUEL MODDA ZORUNLU (2026-08-04): kartsız doğan topun eni hiçbir
  // yerden miras alınmıyor; boş bırakılırsa envanterde eni bilinmeyen top kalır
  // ve sonradan düzeltmek için ayrı bir işlem gerekir.
  const [manualWidth, setManualWidth] = useState('');
  // KAT — manuel modda ZORUNLU: bu yolda miras alinacak bir baglam yok (is emri,
  // adim, parent hicbiri). Sorulmazsa top kalici olarak katsiz kalir. Onceden
  // secili varsayilan YOK — operator bilerek dokunsun.
  const [manualFoldType, setManualFoldType] = useState<string | null>(null);
  const [manualColorLabel, setManualColorLabel] = useState<string | null>(null);
  const [manualReason, setManualReason] = useState('');
  const [manualPicker, setManualPicker] = useState<'item' | 'color' | 'reason' | null>(null);
  /** 'Diğer' seçildi → picker içinde serbest metin formu açılır. */
  const [manualReasonFreeOpen, setManualReasonFreeOpen] = useState(false);
  const [manualReasonDraft, setManualReasonDraft] = useState('');
  // Elle top ekleme sebepleri de artık düzenlenebilir katalogdan gelir.
  const manualReasonPresets = useReasonPresets('ROLL_MANUAL_ENTRY');
  const [manualPresetEdit, setManualPresetEdit] = useState<{
    mode: ReasonPresetEditMode;
    preset: ReasonPreset | null;
  } | null>(null);
  // Kataloglar YALNIZ picker açılınca çekilir: ürün/renk listeleri ayrı yetki
  // ister (`item:read` / `property:read`) ve saf Tambur operatöründe olmayabilir
  // (TamburManualRollModal ile aynı gerekçe) — boşuna 403 üretme.
  const [manualItemCatalogWanted, setManualItemCatalogWanted] = useState(false);
  const [manualColorCatalogWanted, setManualColorCatalogWanted] = useState(false);
  // İdempotency: token MANTIKSAL DENEME başına bir kez üretilir. Hata sonrası
  // aynı payload'la tekrar basış AYNI token'ı gönderir (mükerrer top doğmaz);
  // payload değişirse bu artık başka bir denemedir → aşağıdaki effect düşürür.
  const manualTokenRef = useRef<string | null>(null);

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

  // Manuel Mod ürün/renk katalogları — picker açılmadan İSTENMEZ (yetki + ağ).
  const manualItemsQuery = useQuery({
    queryKey: ['items', 'tambur-manual-mode', 'FABRIC'],
    queryFn: () =>
      itemService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: 'code',
        sortOrder: 'asc',
        filters: { isActive: 'true', itemType: 'FABRIC' },
      }),
    enabled: manualItemCatalogWanted,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const manualColorsQuery = useQuery({
    queryKey: ['colors', 'tambur-manual-mode-public'],
    queryFn: () =>
      colorService.listPublicForPicker({
        page: 1,
        pageSize: 300,
        sortBy: 'name',
        sortOrder: 'asc',
      }),
    enabled: manualColorCatalogWanted,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const manualItemOptions = useMemo<PickerOption[]>(
    () =>
      (manualItemsQuery.data?.data ?? []).map((i) => ({
        value: i.id,
        label: i.name,
        sublabel: i.code,
      })),
    [manualItemsQuery.data],
  );

  const manualColorOptions = useMemo<PickerOption[]>(
    () =>
      (manualColorsQuery.data?.data ?? []).map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: c.code ?? undefined,
        badge: c.hex ? { text: ' ', color: c.hex } : undefined,
      })),
    [manualColorsQuery.data],
  );

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

  // Top/sekme değişimi → çalışma state'i temizlenir. İş emrinde PLANLANAN kat
  // otomatik seçili gelir; plan yoksa KATALOGUN İLK değeri. Operatör
  // değiştirebilir ama biri her zaman seçilidir (asla boş kalmaz).
  //
  // ⚠️ Eskiden `planned === '4-KAT' ? '4-KAT' : '2-KAT'` idi: ÜÇLÜ bir kararı
  // ikiliye indiriyordu. Katalog büyüyünce 6-KAT planlanmış bir iş emrinde
  // ekran sessizce 2-KAT'ı seçili gösterirdi — operatör fark etmezse top
  // YANLIŞ katla kaydedilir ve yanlış metreyle ölçülürdü.
  useEffect(() => {
    const planned = activeJob?.context?.plannedFoldType ?? null;
    const known = planned && foldValues.some((v) => v.code === planned) ? planned : null;
    // Plan katalogda yoksa (silinmiş/pasif değer) yine de PLANI KORU: iş emrinin
    // spec'ini istemci tarafında değiştirmek, sessizce başka bir ürün üretmektir.
    const defaultFold: TamburFoldType | null = known ?? planned ?? foldValues[0]?.code ?? null;
    setWork({ ...EMPTY_WORK, foldType: defaultFold });
  }, [activeCardId, activeJob?.selectedRollId, activeJob?.context?.plannedFoldType, foldValues]);


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

    // Sessiz bypass kapanışından sonra kartı YENİDEN çözmek gerekir; recursive
    // çağrı `finally` in-flight guard'ı temizlemeden yapılırsa kendi guard'ına
    // takılıp sessizce hiçbir şey yapmaz. Bu yüzden niyet burada işaretlenir,
    // çağrı try/catch/finally BİTTİKTEN sonra yapılır.
    let reopenAfterBypass = false;
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
      // KURŞUN BYPASS — kart Kurşun Dağıtım'a verilmişse toplar hâlâ kurşun
      // adımındadır; `by-card` "bu adımda açık top yok" diye 400 atar. Bu durumda
      // kurşun adımı SESSİZCE kapatılır (operatöre soru sorulmaz) ve kart normal
      // yolla yeniden açılır. Bekleyen dağıtım yoksa davranış AYNEN eskisi.
      const bypass = await completeKursunBypassSilently(barcode);
      if (bypass.kind === 'done') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Onay DEĞİL, bilgi: operatör kurşun adımının ne zaman kapandığını
        // görmezse kartın neden birden açıldığını da anlamaz. Dağıtımsız
        // kapanışta metin AÇIKÇA farklıdır — "dağıtım yapılmadı ama iş yürüdü"
        // bilgisi operatörün de planlamacıya iletebileceği bir şeydir.
        Toast.show(
          bypass.alreadyDone
            ? {
                type: 'info',
                text1: 'Kurşun/KK2 adımı zaten kapatılmış',
                text2: 'Kart Tambur işi olarak açılıyor',
              }
            : bypass.source === 'UNASSIGNED'
              ? {
                  type: 'info',
                  text1: 'Kurşun dağıtılmamıştı — adım kapatıldı',
                  text2: `${bypass.movedRollCount} top Tambur'a alındı`,
                }
              : {
                  type: 'info',
                  text1: 'Kurşun/KK2 bypass ile tamamlandı',
                  text2: `${bypass.movedRollCount} top Tambur'a alındı`,
                },
        );
        void qc.invalidateQueries({ queryKey: ['tambur'] });
        void qc.invalidateQueries({ queryKey: ['rolls'] });
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
        void qc.invalidateQueries({ queryKey: ['work-orders'] });
        reopenAfterBypass = true;
        if (fromInput) setCardBarcode('');
      } else if (bypass.kind === 'error') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Toast.show({
          type: 'error',
          text1: 'Kurşun bypass tamamlanamadı',
          text2: bypass.message,
        });
      } else {
        // BOŞ ADIM — saha düzeltmesi yolu (2026-08-03). Tambur adımında açık top
        // yoksa `by-card` 400 atar ve kart hiç açılmazdı; "Topu Buraya Al /
        // Manuel Top Ekle" TAM DA gerektikleri anda ulaşılamaz kalıyordu.
        // Backend artık yetkili operatöre kartı BOŞ açtırıyor (`emptyStep: true`);
        // yetkisiz operatörde 400 aynen döner, yani aşağıdaki dal hiç çalışmaz.
        const emptyCtx = canFieldFix
          ? await tamburService
              .getContext(barcode)
              .then((r) => r.data as TamburContext | null)
              .catch(() => null)
          : null;
        if (emptyCtx?.emptyStep) {
          const newJob: OpenJob = {
            cardId: barcode,
            cardBarcode: barcode,
            // Boş adımda `by-card` özeti yok; ekranın ihtiyaç duyduğu asgari
            // alanlar context'ten kurulur. `rolls: []` → kesim/finalize
            // aksiyonları zaten kendiliğinden kapalı kalır.
            stepSummary: {
              workOrderStepId: emptyCtx.stepId,
              stationName: emptyCtx.stationName,
              batchNumber: emptyCtx.batchNumber ?? '—',
              rolls: [],
            } as unknown as TamburStepSummary,
            context: emptyCtx,
            selectedRollId: null,
          };
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setOpenJobs((prev) => [...prev, newJob]);
          setActiveCardId(newJob.cardId);
          if (fromInput) setCardBarcode('');
          Toast.show({
            type: 'info',
            text1: 'Bu adımda bekleyen top yok',
            text2: 'Saha düzeltmesi yapabilirsiniz (Topu Buraya Al / Manuel Top Ekle)',
          });
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Toast.show({
            type: 'error',
            text1: 'Kart çözülemedi',
            text2: (err as Error).message,
          });
        }
      }
    } finally {
      setResolvingCard(false);
      resolveInFlightRef.current = false;
    }

    // Guard temizlendi — kart artık normal Tambur işi olarak açılabilir.
    if (reopenAfterBypass) await resolveCard(barcode, false);
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

  /**
   * Etiket türünü topun KENDİ kimliğinden çöz — renginden DEĞİL.
   *
   * Varsayılan (null) yol türü RENKTEN çıkarır: renksiz = ham kumaş → ROLL_RAW.
   * Bu, istasyondan çıkan ham kesim parçaları için doğrudur ama depoya inmiş bir
   * top için sessizce YANLIŞTIR: renksiz (ham beyaz) bitmiş bir topun etiketi ham
   * etiket olarak basılır. Yeni üretimde bu tuzağa `startPrint(roll,'ROLL_FINISHED')`
   * ile giriliyordu; YENİDEN BASIMDA ise açıkta kalıyordu — "Çıkanlar"dan basılan
   * WAREHOUSE topu türü yine renkten çözüyordu.
   *
   * Kural backend ile aynı kaynağa dayanır: `finalBarcodeType` satılabilire
   * (WAREHOUSE/A1_STOCK) inen topu "F" (final) damgalar. Yani barkodunda F yazan
   * top bitmiş etiket alır — iki yüzey artık aynı şeyi söyler.
   *
   * `null` dönüşü BİLİNÇLİ: depoya inmemiş top (üretime devam eden ham kesim
   * parçası) için eski davranış birebir korunur.
   */
  const printKindForRoll = (roll: Roll): 'ROLL_RAW' | 'ROLL_FINISHED' | null =>
    roll.status === 'WAREHOUSE' || roll.status === 'A1_STOCK' ? 'ROLL_FINISHED' : null;

  // "Etiketi Tekrar Bas" — varolan etiketi AYNEN bas, "kime?" SORMA.
  // labelContext=undefined → backend topun mevcut snapshot/effective etiketini
  // basar (yeni hedef seçilmez). Müşteri değiştirmek = "Etiket Değiştir" akışı.
  const reprintLabel = (roll: Roll) => {
    setLabelContext(undefined);
    startPrint(roll, printKindForRoll(roll));
  };

  // "Müşterisiz (Stok)" — müşteri bilgisi OLMADAN bas. labelContext={stock:true}
  // → backend müşteriyi zorla null bırakır (snapshot/WO atlanır); önizleme/geçmiş
  // reprint'inde tek dokunuşta müşterisiz etiket.
  const reprintLabelStock = (roll: Roll) => {
    setLabelContext({ stock: true });
    startPrint(roll, printKindForRoll(roll));
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
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
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
      /** Bu kesimde dogan cocugun kati — kalici ozellik (2026-08-04). */
      foldType?: string | null;
      targetOrderLineId?: string | null;
      // Müşteri hedefi — backend cut'a gider, child lastLabelSnapshot'a seed edilir.
      targetCustomerId?: string | null;
      markedForKartela?: boolean;
      /** Ağ-retry idempotency: kesim anında üretilir, retry'da aynı kalır. */
      clientToken?: string;
      /** Plan-gerçek sapma onayı — 409 PLAN_MISMATCH sonrası true ile tekrar. */
      confirmMismatch?: boolean;
    }) =>
      tamburService.cutOpenFabric(data.rollId, {
        lengthMeters: data.lengthMeters,
        status: data.status,
        qualityGrade: data.qualityGrade,
        // ⚠️ KAT BURADA UNUTULMUŞTU (2026-08-13 saha bulgusu): ekran gönderiyor,
        // tip tanımı taşıyor, ama gövde elle kurulurken alan düşüyordu — operatör
        // "6 Kat" seçip kesiyor, çocuk KATSIZ doğuyordu (hata yok, log yok; Zod'un
        // 2026-08-05'te sessizce sildiği alanın istemci-tarafı ikizi). Gövdeye
        // alan eklerken kaynak `data`dan HER alanı geçirdiğini kontrol et.
        foldType: data.foldType ?? null,
        targetOrderLineId: data.targetOrderLineId ?? null,
        // Niyet backend'e gider → child lastLabelSnapshot'a seed edilir (kalıcı).
        targetCustomerId: data.targetCustomerId ?? null,
        markedForKartela: data.markedForKartela ?? false,
        clientToken: data.clientToken,
        // ⚠️ Elle kurulan gövde = sessiz allowlist (KAT dersi, 2026-08-13):
        // bu satır düşerse operatör onaylar, bayrak isteğe girmez, 409 sürer.
        confirmMismatch: data.confirmMismatch,
      }),
    onSuccess: async (res, variables) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Bu denemenin token'ı görevini tamamladı — sıradaki kesim taze token alır.
      if (cutTokenRef.current?.rollId === variables.rollId) cutTokenRef.current = null;
      // Kesim parent metrajını düşürdü + child doğdu — rulo listeleri/picker bayat kalmasın.
      qc.invalidateQueries({ queryKey: ['rolls'] });
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
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
        // Tür topun kendi kimliğinden (bkz. printKindForRoll): depoya inen renksiz

        // çocuk da bitmiş etiket alır. Üretime devam eden STOCK parçasında null

        // döner → renkten çözülen eski davranış birebir korunur.

        startPrint(data.childRoll, printKindForRoll(data.childRoll));
      }
      // Uzunluk input'unu sıfırla. Kalite/sipariş varsayılan olarak KALIR
      // (seri kesim), ama Ayarlar → Çalışma Tercihleri'nden "her çıktıdan sonra
      // 1. Kaliteye dön" seçilebilir (2026-08-17 saha talebi: en son A1'e
      // basıldıysa orada takılı kalıyordu ve yanlış kalite basılabiliyordu).
      setWork((w) => ({
        ...w,
        voluntaryEntry: {
          ...w.voluntaryEntry,
          length: '',
          ...(resetQualityAfterCut
            ? { qualityGrade: DEFAULT_QUALITY_CODE, qualityName: DEFAULT_QUALITY_NAME }
            : {}),
        },
      }));
      // ⚠️ OTOMATİK BİTİŞ KALDIRILDI (2026-08-09, saha kararı).
      //
      // Eskiden kalan < 0,1 m olunca iş operatör hiç dokunmadan finalize
      // ediliyordu (`remainingAction: 'discard'`). İki şeyi birden bozuyordu:
      //  1) FİZİKSEL KUMAŞ KALMIŞSA KESİLEMİYORDU. Sahadan birebir örnek:
      //     "sistemde 40 metre az girilmiş olabilir, 2 parça 20'şer metre daha
      //     kesmesi gerekiyor" — kayıt bitince iş kapanıyor, mal elde kalıyordu.
      //     Backend aşımı ZATEN kabul ediyor (`tambur.overQuantityEnabled`
      //     varsayılan AÇIK); tek tıkaç bu istemci satırıydı.
      //  2) Kalan metraj SESSİZCE "discard" ediliyordu — yani operatörün hiç
      //     görmediği bir kayıt düzeltmesi yazılıyordu.
      //
      // Artık iş YALNIZ operatör "Bitir"e basınca kapanır. Kalan 0 olsa bile
      // kesmeye devam edilebilir.
      Toast.show({ type: 'success', text1: 'Top oluşturuldu' });
      await refetchActiveJob();
    },
    onError: (err: Error, variables) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      const mm = readPlanMismatch(err);
      if (mm) {
        // Onay modalı konuşur — kırmızı toast basılmaz (409 bir hata değil,
        // cevabı operatörde olan bir sorudur; KK1 mükerrer modalıyla aynı dil).
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setPlanMismatch({
          messages: mm,
          retry: () => {
            planMismatchConfirmedRef.current.add(variables.rollId);
            cutOpenFabricMutation.mutate({ ...variables, confirmMismatch: true });
          },
        });
        return;
      }
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
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
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
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
    },
    onError: (err, vars, context) => {
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
      const mm = readPlanMismatch(err);
      if (mm) {
        // Optimistic geri alındı (yukarıda) → top yine listede; onaylanırsa
        // aynı istek bayrakla tekrarlanır. Kırmızı toast basılmaz (soru, hata değil).
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setPlanMismatch({
          messages: mm,
          retry: () => {
            planMismatchConfirmedRef.current.add(vars.rollId);
            finalizeOpenFabricMutation.mutate({ ...vars, confirmMismatch: true });
          },
        });
        return;
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
      /** Plan-gerçek sapma onayı — 409 PLAN_MISMATCH sonrası true ile tekrar. */
      confirmMismatch?: boolean;
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
      // Bu denemenin token'ı görevini tamamladı — sıradaki kesim taze token alır.
      if (recutTokenRef.current?.rollId === variables.rollId) recutTokenRef.current = null;
      // Kesim parent metrajını düşürdü + child doğdu — rulo listeleri/picker bayat kalmasın.
      qc.invalidateQueries({ queryKey: ['rolls'] });
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
      const data = res.data;
      // Y11 paritesi (açık kumaş kesimindeki düzeltmenin aynısı): yanıt geldiğinde
      // ekranda BAŞKA top olabilir (istek uçuştayken operatör yeni top okuttu).
      // Ekran-state güncellemeleri yalnız yanıtın ait olduğu top hâlâ aktifken
      // yapılır; otomatik bitirme ise HER ZAMAN yanıtın KENDİ rollId'siyle çalışır
      // — aksi hâlde yanlış top TAMBUR_CONSUMED'a arşivlenip kalanı discard edilirdi.
      const isCurrent = variables.rollId === recutResolvedRollId;
      if (data?.childRoll?.barcode) {
        // Hedef "Kime" bölümünde zaten seçili → tekrar "Etiket kime?" SORMA,
        // doğrudan o hedefe bas (open fabric kesimiyle aynı). Hiçbir şey seçili
        // değilse = stok (explicit müşterisiz etiket — WO tahmini sızmasın);
        // sonradan "Etiket Değiştir" ile yönlendirilebilir. (Çocuk etiketi yanıtın
        // kendi verisi — top değişmiş olsa da basımı doğru.)
        setLabelContext(
          variables.targetCustomerId
            ? { customerId: variables.targetCustomerId }
            : variables.targetOrderLineId
              ? { orderLineId: variables.targetOrderLineId }
              : { stock: true },
        );
        // Tür topun kendi kimliğinden (bkz. printKindForRoll): depoya inen renksiz

        // çocuk da bitmiş etiket alır. Üretime devam eden STOCK parçasında null

        // döner → renkten çözülen eski davranış birebir korunur.

        startPrint(data.childRoll, printKindForRoll(data.childRoll));
      }
      // Parent metraj güncelle (sticky header anında yansır) — yalnız aynı top.
      if (isCurrent && data && typeof data.parentRemainingQty === 'number' && recutRollMeta) {
        setRecutRollMeta({ ...recutRollMeta, currentQty: data.parentRemainingQty });
      }
      // Güncel parent'ı tut — X kapat sırasında etiket yenilenmek için kuyruğa
      // atılır (backend initialQty'yi de reset etti, etiket fiziksel olarak da
      // yenilenmeli). Yalnız aynı top — bayat yanıt B oturumuna A'nın parent'ını yazmasın.
      if (isCurrent && data?.parentRoll) {
        setRecutLastParentRoll(data.parentRoll);
      }
      if (isCurrent) setRecutCutLength('');
      // ⚠️ OTOMATİK BİTİŞ KALDIRILDI (2026-08-09) — açık kumaş akışıyla aynı
      // gerekçe (oradaki uzun nota bak). Kalan 0'a inse bile iş açık kalır ve
      // operatör kesmeye devam edebilir; kapanış YALNIZ "Bitir" ile olur.
      const remaining = data?.parentRemainingQty ?? 0;
      Toast.show({
        type: 'success',
        text1: 'Top oluşturuldu',
        text2:
          remaining > 0.05
            ? `Kalan: ${remaining.toFixed(1)} m`
            : 'Kayıtlı metraj bitti — fiziksel kumaş varsa kesmeye devam edebilirsiniz',
      });
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
      varianceReasonCode,
      varianceReasonText,
    }: {
      rollId: string;
      remainingAction: 'keep_1kalite' | 'keep_a1' | 'scrap' | 'discard';
      varianceReasonCode?: string | null;
      varianceReasonText?: string | null;
    }) =>
      tamburService.finalizeWarehouseCut(rollId, {
        remainingAction,
        varianceReasonCode,
        varianceReasonText,
      }),
    onSuccess: (res, variables) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Top Kesme bitti', text2: 'Top arşivlendi' });
      const remainingChild = res.data?.remainingChild ?? null;
      // Y11 paritesi: bayat yanıt (otomatik bitirme uçuştayken operatör yeni top
      // okuttu) AKTİF oturumu sıfırlamasın — yalnız yanıtın topu hâlâ ekrandaysa
      // temizlik yapılır. Kalan-child etiketi ve liste tazeleme her durumda doğru.
      const isCurrent = variables.rollId === recutResolvedRollId;
      if (!isCurrent) {
        if (remainingChild) {
          setPendingPrintRolls((prev) => [...prev, remainingChild as Roll]);
        }
        qc.invalidateQueries({ queryKey: ['rolls'] });
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
        return;
      }
      setMarkAsKartela(false); // bir sonraki top için sıfırla

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
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
      }
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Bitirilemedi', text2: err.message });
    },
  });

  // MANUEL EKLE — kartsız bitmiş ürün. Hiçbir iş emrine/adıma/partiye bağlanmaz;
  // top doğrudan Bitmiş Depo'ya yazılır. Online-only (barkodu sunucu üretir) →
  // offline kuyruğuna GİRMEZ, bu yüzden mutationKey yok.
  const produceManualRollMutation = useMutation({
    mutationFn: (data: TamburManualProduceRequest) =>
      tamburService.produceFinishedRoll(data),
    onSuccess: (res, variables) => {
      // Deneme kapandı — sıradaki giriş taze token alır.
      manualTokenRef.current = null;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['rolls'] });
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
      const d = res.data;
      Toast.show({
        type: d.idempotentReplay ? 'info' : 'success',
        text1: d.idempotentReplay
          ? 'Bu top zaten eklenmişti (tekrar deneme)'
          : 'Bitmiş top depoya eklendi',
        text2: `Barkod: ${d.barcode ?? '—'}`,
      });
      // Etiket hedefi kesim akışlarıyla AYNI kural: "Kime?" bölümünde seçili olan
      // hedefe bas, tekrar SORMA; hiçbir şey seçili değilse explicit stok
      // (müşterisiz) — yoksa backend eski snapshot/WO tahminini basardı.
      setLabelContext(
        variables.targetCustomerId
          ? { customerId: variables.targetCustomerId }
          : variables.targetOrderLineId
            ? { orderLineId: variables.targetOrderLineId }
            : { stock: true },
      );
      // LabelPrinter topun yalnız `id`'sini kullanır; gövde yanıttan kurulur
      // (ek istek yok). Tür SABİTLENİR: manuel mod bitmiş ürün üretir, renksiz
      // olsa bile ham etiket basılmamalı (bkz. printKind gerekçesi).
      startPrint(
        {
          id: d.rollId,
          barcode: d.barcode,
          itemId: d.itemId,
          colorId: d.colorId,
          initialQty: d.currentQty,
          currentQty: d.currentQty,
          weightKg: null,
          width: null,
          qualityGrade: d.qualityGrade ?? '',
          status: 'WAREHOUSE',
          markedForKartela: d.markedForKartela,
        },
        'ROLL_FINISHED',
      );
      // Metraj sıfırlanır (sıradaki top), ürün/renk/sebep KALIR: aynı sebeple
      // arka arkaya birkaç top girmek tipik saha davranışı. Kalite ise cihaz
      // ayarına bağlı (bkz. yukarıdaki not).
      setWork((w) => ({
        ...w,
        voluntaryEntry: {
          ...w.voluntaryEntry,
          length: '',
          ...(resetQualityAfterCut
            ? { qualityGrade: DEFAULT_QUALITY_CODE, qualityName: DEFAULT_QUALITY_NAME }
            : {}),
        },
      }));
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return; // interceptor devralma/oturum bildirimini zaten gösterdi
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Top eklenemedi', text2: err.message });
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
    // KISA KESİM hunisi: elle yazılan uzunlukta kural formda ZATEN çalıştı
    // (input flip'i — orada seçim A1 olduğu için burada yeniden ateşlemez).
    // Bu dal, uzunluğun GÖNDERİM ANINDA çözüldüğü iki yolu kapar: makineden
    // ölçüm ve "kalanı kes". Kural ateşlerse ekrana da yazılır + toast söyler —
    // gönderilenle görünen ayrışmasın.
    const shortCutSug = shortCutOverride({
      enabled: shortCutEnabled,
      thresholdM: shortCutThresholdM,
      lengthM: length,
      currentCode: work.voluntaryEntry.qualityGrade,
      defaultCode: DEFAULT_QUALITY_CODE,
      grades: qualityGrades,
    });
    if (shortCutSug) {
      shortCutAutoMainRef.current = true;
      setWork((w) => ({
        ...w,
        voluntaryEntry: {
          ...w.voluntaryEntry,
          qualityGrade: shortCutSug.code,
          qualityName: shortCutSug.name,
        },
      }));
      Toast.show({
        type: 'info',
        text1: `Kısa kesim → ${shortCutSug.name}`,
        text2: `${length} m, ${shortCutThresholdM} m eşiğinin altında`,
      });
    }
    const effectiveCode = shortCutSug?.code ?? work.voluntaryEntry.qualityGrade;
    // Kalite kodu → RollStatus mapping (qualityGrade.targetStatus)
    const qg = qualityGrades.find((q) => q.code === effectiveCode);
    const status = (qg?.targetStatus ?? 'WAREHOUSE') as
      | 'WAREHOUSE'
      | 'SCRAP'
      | 'A1_STOCK';
    const runCut = () =>
      cutOpenFabricMutation.mutate({
        rollId: selectedRoll.rollId,
        lengthMeters: length,
        // KAT — ekrandaki seçim bu kesimin ÇOCUĞUNA yazılır (kalıcı özellik).
        // Operatör kesimler arasında değiştirirse her çocuk kendi değerini taşır.
        foldType: work.foldType,
        status,
        qualityGrade: qg?.code ?? '1.KALITE',
        targetOrderLineId: work.voluntaryEntry.targetOrderLineId,
        targetCustomerId: work.voluntaryEntry.targetCustomerId,
        markedForKartela: markAsKartela,
        // Ağ-retry idempotency: deneme başına SABİT token (tekrar basış = aynı token).
        clientToken: takeCutToken(cutTokenRef, selectedRoll.rollId),
        // Bu topta sapma bir kez onaylandıysa sonraki kesimler bayrağı taşır.
        confirmMismatch: planMismatchConfirmedRef.current.has(selectedRoll.rollId) || undefined,
      });
    // Aşımda parmak hatası koruması: onay iste (açık kumaşın tamamı tek topa döner).
    if (exceedsRemaining) {
      setOverCutConfirm({
        kind: 'over',
        recorded: selectedRoll.currentQty,
        entered: length,
        onConfirm: runCut,
      });
      return;
    }
    // KALANIN TAMAMINI KESME → onay (2026-08-04 saha isteği). Bu kesimden sonra
    // kalan ~0 olur, akış otomatik finalize eder ve İŞ KAPANIR — geri alınamaz
    // bir eşik. Tolerans aşım kontrolüyle AYNI (0.001) ve otomatik-bitiş eşiğiyle
    // (0.1 m) uyumlu: kalan 10 cm'nin altına inecekse zaten iş biter, o yüzden
    // "tamamı" sayılır. Otomatik modda da sorulur — makine kalanı okumuş olabilir.
    const consumesAll = length >= selectedRoll.currentQty - 0.1;
    if (consumesAll) {
      setOverCutConfirm({
        kind: 'all',
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
    // Kat KODU doğrudan yazılır — eskiden `=== '4-KAT' ? '4 Kat' : '2 Kat'` idi ve
    // katalog büyüyünce 6-KAT'lı bir topta ekranda "2 Kat metresi" yazardı.
    const katLabel = work.foldType ?? 'Kat';
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
        // ⚠️ Başka kata ait metreye SAPILMAZ (yanlış ölçüm) — elle girişe düşülür.
        text2: `Metrajı elle girin. Kalıcı çözüm: Admin → Cihaz Kaydı'ndan bu makineye "${katLabel}" rollü METER cihazı ekleyin.`,
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
  // Top Kesme ile Manuel Mod DIŞLAYAN modlardır ve manuel dal formCol
  // zincirinde önce gelir: manuel mod açıkken recut başlatılsa ekranda hiç
  // görünmez, ama arka planda bir top "kesim oturumuna" bağlanırdı. Tetikler
  // zaten gizleniyor; bu guard programatik yolu da kapatır (sessiz hâl yok).
  const openRecut = () => {
    if (manualMode) {
      Toast.show({
        type: 'info',
        text1: 'Manuel mod açık',
        text2: 'Top Kesme için önce manuel modu kapatın',
      });
      return;
    }
    drawerQueue.run(() => setRecutScannerOpen(true));
  };
  const openStandalone = () => drawerQueue.run(() => setStandaloneOpen(true));
  const openFieldFix = () => drawerQueue.run(() => setFieldFixOpen(true));

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

  /** Top Kesme uzunluk girişi — ana kesim input'uyla AYNI kısa-kesim flip/revert
   *  sözleşmesi (recut ayrı kalite state'i taşıdığı için ayrı sarmalayıcı). */
  const handleRecutLengthChange = (v: string) => {
    const len = parseFloat(v.trim().replace(',', '.'));
    const sug = shortCutOverride({
      enabled: shortCutEnabled,
      thresholdM: shortCutThresholdM,
      lengthM: len,
      currentCode: recutQualityGrade,
      defaultCode: DEFAULT_QUALITY_CODE,
      grades: qualityGrades,
    });
    const revert =
      shortCutRevert({
        enabled: shortCutEnabled,
        thresholdM: shortCutThresholdM,
        lengthM: len,
        currentCode: recutQualityGrade,
        autoApplied: shortCutAutoRecutRef.current,
      }) ||
      (!Number.isFinite(len) &&
        shortCutAutoRecutRef.current &&
        recutQualityGrade === SHORT_CUT_QUALITY_CODE);
    if (sug) {
      shortCutAutoRecutRef.current = true;
      setRecutQualityGrade(sug.code);
    } else if (revert) {
      shortCutAutoRecutRef.current = false;
      setRecutQualityGrade(DEFAULT_QUALITY_CODE);
    }
    setRecutCutLength(v);
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
    // KISA KESİM hunisi — ana kesimle aynı sözleşme (makine ölçümü + "kalanı
    // kes" yollarını kapar; elle yazımda input flip'i zaten çalıştı).
    const recutShortCutSug = shortCutOverride({
      enabled: shortCutEnabled,
      thresholdM: shortCutThresholdM,
      lengthM: cut,
      currentCode: recutQualityGrade,
      defaultCode: DEFAULT_QUALITY_CODE,
      grades: qualityGrades,
    });
    if (recutShortCutSug) {
      shortCutAutoRecutRef.current = true;
      setRecutQualityGrade(recutShortCutSug.code);
      Toast.show({
        type: 'info',
        text1: `Kısa kesim → ${recutShortCutSug.name}`,
        text2: `${cut} m, ${shortCutThresholdM} m eşiğinin altında`,
      });
    }
    const recutEffectiveCode = recutShortCutSug?.code ?? recutQualityGrade;
    // Ham (renksiz STOCK) top → operatörün seçtiği parça hedefini gönder.
    const isRawStock =
      recutRollMeta.status === 'STOCK' && recutRollMeta.colorId == null;
    const runCut = () =>
      cutWarehouseRollMutation.mutate({
        rollId: recutResolvedRollId,
        cutLength: cut,
        qualityGrade: recutEffectiveCode,
        targetOrderLineId: recutTargetLineId,
        targetCustomerId: recutTargetCustomerId,
        markedForKartela: markAsKartela,
        rawDestination: isRawStock ? recutRawDestination : undefined,
        // Ağ-retry idempotency: deneme başına SABİT token (tekrar basış = aynı token).
        clientToken: takeCutToken(recutTokenRef, recutResolvedRollId),
      });
    // Aşımda parmak hatası koruması: onay iste (top tamamen tüketilir).
    if (exceedsRemaining) {
      setOverCutConfirm({
        kind: 'over',
        recorded: recutRollMeta.currentQty,
        entered: cut,
        onConfirm: runCut,
      });
      return;
    }
    // Kalanın tamamı → onay. Ana kesimle AYNI gerekçe: burada da input BOŞ
    // bırakıp "Kes"e basmak kalanın tamamını keser (yukarıdaki kısayol), yani
    // en kolay hareket kaynak topu tamamen tüketip kesim oturumunu kapatıyor.
    const consumesAll = cut >= recutRollMeta.currentQty - 0.1;
    if (consumesAll) {
      setOverCutConfirm({
        kind: 'all',
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

  // ── MANUEL EKLE modu: form sıfırlama + anahtar + gönderim ─────────────────

  /**
   * Manuel giriş idempotency token'ı — MANTIKSAL DENEME başına BİR kez üretilir
   * (`takeCutToken` ile aynı sözleşme, orada anahtar rollId'dir; burada top
   * henüz YOK, deneme payload'ıyla tanımlanır → payload değişince effect düşürür).
   */
  const takeManualToken = (): string => {
    if (!manualTokenRef.current) manualTokenRef.current = generateClientUuid();
    return manualTokenRef.current;
  };

  /** Manuel forma özgü alanlar (paylaşılan `work` state'ine DOKUNMAZ). */
  const resetManualForm = () => {
    setManualItemId(null);
    setManualItemLabel(null);
    setManualColorId(null);
    setManualColorLabel(null);
    setManualReason('');
    setManualWidth('');
    setManualFoldType(null);
    setManualPicker(null);
    setManualReasonFreeOpen(false);
    setManualReasonDraft('');
    manualTokenRef.current = null;
  };

  /**
   * Mod anahtarı. İki yönde de "Kime?" hedefini ve metraj girişini TEMİZLER:
   * mod değişimi bir bağlam değişimidir ve iki akış aynı state'i paylaşır —
   * kart işinden kalan müşteri seçimi manuel topa (ya da tersi) sessizce
   * sızarsa etiket yanlış müşteriye basılır.
   */
  const toggleManualMode = () => {
    const next = !manualMode;
    void setTamburManualPref(next);
    resetManualForm();
    setWork((w) => ({
      ...w,
      voluntaryEntry: {
        ...w.voluntaryEntry,
        length: '',
        targetOrderLineId: null,
        targetCustomerId: null,
        targetCustomerName: undefined,
      },
    }));
    // Kartelalık işareti akışa özgüdür (resetRecut ile aynı gerekçe) — moddan
    // çıkarken taşınırsa sonraki kesimler sessizce kartelalık işaretlenirdi.
    setMarkAsKartela(false);
    // Kart bağımlı yüzeyler manuel modda gizleniyor; açık kalan modal arkada
    // asılı kalmasın.
    setFieldFixOpen(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Toast.show({
      type: 'info',
      text1: next ? 'MANUEL MOD AÇIK' : 'Manuel mod kapandı',
      text2: next
        ? 'Kart okutulmaz — çıkan top doğrudan Bitmiş Depo’ya yazılır'
        : 'Normal akış: refakat kartı okutulur',
    });
  };

  // Payload değişti → bu ARTIK aynı mantıksal deneme değildir, token düşer.
  // (Aynı token'la farklı içerik göndermek backend'de mükerrer koruma sayesinde
  // ESKİ topu geri döndürürdü: operatör 120 m yazıp gönderemez, 150 yapıp tekrar
  // dener ve sistemde sessizce 120 m'lik top kalırdı.)
  useEffect(() => {
    manualTokenRef.current = null;
  }, [
    manualItemId,
    manualColorId,
    manualReason,
    work.voluntaryEntry.length,
    work.voluntaryEntry.qualityGrade,
    work.voluntaryEntry.targetCustomerId,
    work.voluntaryEntry.targetOrderLineId,
    markAsKartela,
  ]);

  /**
   * Manuel modda seçilebilir kalite kataloğu — YALNIZ hedefi Bitmiş Depo olan
   * dereceler. Gerekçe: bu uç statüyü AÇIKÇA `WAREHOUSE` yazar (renk sezgisine
   * bırakmaz), yani kesim akışındaki "kalite → hedef statü" eşlemesi burada
   * ÇALIŞMAZ. Filtre olmasaydı FIRE seçen operatörün fiyresi Bitmiş Depo'ya
   * 1. kalite rafına düşerdi — hata yok, uyarı yok, sessiz yanlış. Seed'de üç
   * derecenin de hedefi WAREHOUSE olduğu için bugün filtre no-op'tur; admin
   * hedefi değiştirdiği gün devreye girer ve aşağıdaki not sebebi söyler.
   */
  const manualQualityGrades = useMemo(
    () => qualityGrades.filter((qg) => qg.targetStatus === 'WAREHOUSE'),
    [qualityGrades],
  );
  const manualGradeNote =
    manualQualityGrades.length < qualityGrades.length
      ? 'Hedefi Bitmiş Depo olmayan dereceler (fire / 2. kalite) manuel modda seçilemez — o kararlar normal kesim akışında verilir.'
      : null;
  /** Seçili kalite manuel modda GEÇERLİ mi (filtreden önce seçilmiş olabilir). */
  const manualGradeValid = manualQualityGrades.some(
    (qg) => qg.code === work.voluntaryEntry.qualityGrade,
  );

  /** Manuel modda eksik olan zorunlu alanlar — footer üstünde somut listelenir. */
  const manualMissing = useMemo(() => {
    const miss: string[] = [];
    if (!manualItemId) miss.push('ürün');
    if (cutMode === 'manual' && work.voluntaryEntry.length.trim() === '') {
      miss.push('metraj');
    }
    if (!(Number(manualWidth) > 0)) miss.push('en');
    if (!manualFoldType) miss.push('kat');
    if (!manualGradeValid) miss.push('kalite');
    if (manualReason.trim().length < MANUAL_MIN_REASON) miss.push('sebep');
    return miss;
  }, [manualItemId, cutMode, work.voluntaryEntry, manualWidth, manualFoldType, manualGradeValid, manualReason]);

  const submitManualProduce = (lengthOverride?: number) => {
    if (!manualItemId) {
      Toast.show({ type: 'error', text1: 'Ürün seçin', text2: 'Kart yok — ürün miras alınmaz' });
      return;
    }
    // Manuel modda BOŞ input "kalanı kes" DEĞİLDİR (kesilecek bir parent yok) —
    // metraj her zaman açıkça girilir ya da makineden ölçülür.
    const trimmed = work.voluntaryEntry.length.trim();
    const qty = lengthOverride ?? (trimmed === '' ? NaN : parseFloat(trimmed));
    if (!Number.isFinite(qty) || qty <= 0) {
      Toast.show({ type: 'error', text1: 'Metraj pozitif sayı olmalı' });
      return;
    }
    const widthNum = Number(manualWidth);
    if (!Number.isFinite(widthNum) || widthNum <= 0) {
      Toast.show({
        type: 'error',
        text1: 'En (cm) zorunlu',
        text2: 'Kartsız doğan topun eni hiçbir yerden miras alınmaz — ölçüp yazın',
      });
      return;
    }
    if (!manualFoldType) {
      Toast.show({
        type: 'error',
        text1: 'Kat seçin',
        text2: 'Kartsız üretimde kat hiçbir yerden miras alınmaz — 2 Kat / 4 Kat',
      });
      return;
    }
    if (!manualGradeValid) {
      Toast.show({
        type: 'error',
        text1: 'Kalite seçin',
        text2: 'Manuel modda yalnız hedefi Bitmiş Depo olan dereceler geçerli',
      });
      return;
    }
    const reason = manualReason.trim();
    if (reason.length < MANUAL_MIN_REASON) {
      Toast.show({
        type: 'error',
        text1: 'İşlem nedeni zorunlu',
        text2: `En az ${MANUAL_MIN_REASON} karakter — "bu top nereden geldi" sorusunun cevabı bu`,
      });
      return;
    }
    // KISA KESİM hunisi — manuel modda da aynı kural (makine ölçümü yolu);
    // katalog olarak manuel modun SEÇİLEBİLİR listesi geçer: A1 orada yoksa
    // (admin hedefini değiştirmişse) kural ateşlemez, seçilemeyen kod yazılmaz.
    const manualShortCutSug = shortCutOverride({
      enabled: shortCutEnabled,
      thresholdM: shortCutThresholdM,
      lengthM: qty,
      currentCode: work.voluntaryEntry.qualityGrade,
      defaultCode: DEFAULT_QUALITY_CODE,
      grades: manualQualityGrades,
    });
    if (manualShortCutSug) {
      shortCutAutoMainRef.current = true;
      setWork((w) => ({
        ...w,
        voluntaryEntry: {
          ...w.voluntaryEntry,
          qualityGrade: manualShortCutSug.code,
          qualityName: manualShortCutSug.name,
        },
      }));
      Toast.show({
        type: 'info',
        text1: `Kısa metraj → ${manualShortCutSug.name}`,
        text2: `${qty} m, ${shortCutThresholdM} m eşiğinin altında`,
      });
    }
    const manualEffectiveCode = manualShortCutSug?.code ?? work.voluntaryEntry.qualityGrade;
    const runProduce = () =>
      produceManualRollMutation.mutate({
        itemId: manualItemId,
      // null = AÇIKÇA renksiz. Statüyü etkilemez: backend her hâlükârda
      // WAREHOUSE yazar (renksiz bitmiş top ham stoğa düşmesin).
        colorId: manualColorId,
        initialQty: qty,
        width: widthNum,
        // KAT — manuel modda operatör seçer (bu yolda miras alınacak bağlam yok).
        foldType: manualFoldType,
        qualityGrade: manualEffectiveCode,
        targetOrderLineId: work.voluntaryEntry.targetOrderLineId,
        targetCustomerId: work.voluntaryEntry.targetCustomerId,
        markedForKartela: markAsKartela,
        reason,
        clientToken: takeManualToken(),
      });

    // Renk seçilmediyse SOR — geçerli bir durum ama sessiz geçilmemeli.
    if (!manualColorId) {
      setColorlessConfirm(() => runProduce);
      return;
    }
    runProduce();
  };

  /** Manuel modda "Depoya Ekle" — manuel: input; otomatik: makineden ölçülen. */
  const handleManualProduce = async () => {
    if (cutMode === 'auto') {
      if (measuring) return;
      setMeasuring(true);
      try {
        // Ölçüm cihazı ana kesimle AYNI yoldan çözülür (work.foldType → role);
        // manuel modda kat seçimi gösterilmediği için varsayılan 2-KAT metresi
        // (yoksa rolsüz cihaz) kullanılır — bkz. meterPeripheralFor.
        const measured = await measureFromMachine(MANUAL_SIM_METER_BOUND);
        if (measured == null) return; // okunamadı → hata gösterildi, kayıt yapma
        submitManualProduce(measured);
      } finally {
        setMeasuring(false);
      }
    } else {
      submitManualProduce();
    }
  };

  // "Kime" picker seçenekleri — recut akışında topa uyan TÜM açık satırlar
  // (getAvailableOrderLines), açık-kumaşta WO'ya bağlı sipariş satırları.
  // Bu WO'nun siparişlerindeki müşteri id'leri — picker'da öne alınır.
  // MANUEL MODDA BOŞ: kart yok, dolayısıyla "bu iş emrinde siparişi olan
  // müşteriler" diye bir küme de yok (arkada açık kalmış bir kart varsa onun
  // müşterileri manuel topa öne çıkarılmamalı).
  const orderCustomerIds = useMemo(
    () =>
      new Set<string>(
        manualMode ? [] : (activeJob?.context?.orders ?? []).map((o) => o.customerId),
      ),
    [manualMode, activeJob],
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

  // ── Kesim formunun ORTAK parçaları (ana kesim ⟷ MANUEL MOD) ───────────────
  // Kopya DEĞİL: birebir aynı bileşenler + aynı state (`cutMode`,
  // `work.voluntaryEntry`). Top Kesme (recut) kendi metraj/kalite state'ini
  // taşıdığı için bu blokları kullanmaz — orası ayrı bir top üzerinde çalışır.

  /** Uzunluk girişi + Manuel/Otomatik metraj kaynağı toggle'ı (metre cihazı dahil). */
  /**
   * @param halfWidth true → giriş kutusu bölümün YARISINI kaplar (manuel mod:
   *   En ve Metraj alt alta ve AYNI genişlikte dursun). Kart akışında false.
   */
  /**
   * @param halfWidth true → giriş kutusu bölümün YARISINI kaplar ve temizleme
   *   tuşu sütunun DIŞINDA durur. Manuel modda "En" kutusuyla tam hizalı olsun
   *   diye: tuş içeride kalsaydı giriş alanı %50 eksi tuş genişliği olurdu.
   *   Kart akışında false → bugünkü düzen bit bit aynı.
   */
  const renderCutLength = (placeholder: string, halfWidth = false) => {
    const input = (
      <NumpadInput
        mode="outlined"
        value={work.voluntaryEntry.length}
        onChangeText={(v) => {
          // KISA KESİM kuralı yazım ANINDA görünür çalışır: eşik altına inen
          // uzunluk kaliteyi A1'e çevirir (yalnız 1. Kalite seçiliyken), eşik
          // üstüne çıkan/temizlenen uzunluk OTOMATİK yazılmış A1'i geri alır.
          // Hesap setWork DIŞINDA (updater saf kalsın — kamera flip dersi).
          const len = parseFloat(v.trim().replace(',', '.'));
          const current = work.voluntaryEntry.qualityGrade;
          const sug = shortCutOverride({
            enabled: shortCutEnabled,
            thresholdM: shortCutThresholdM,
            lengthM: len,
            currentCode: current,
            defaultCode: DEFAULT_QUALITY_CODE,
            grades: qualityGrades,
          });
          // Boş/geçersiz uzunluk da geri döndürür: input silinip "kalanı kes"e
          // dönülürse ekranda bayat bir otomatik-A1 kalmasın (kalanın kalitesi
          // gönderim anında yeniden çözülür).
          const revert =
            shortCutRevert({
              enabled: shortCutEnabled,
              thresholdM: shortCutThresholdM,
              lengthM: len,
              currentCode: current,
              autoApplied: shortCutAutoMainRef.current,
            }) ||
            (!Number.isFinite(len) &&
              shortCutAutoMainRef.current &&
              current === SHORT_CUT_QUALITY_CODE);
          if (sug) shortCutAutoMainRef.current = true;
          else if (revert) shortCutAutoMainRef.current = false;
          setWork((w) => ({
            ...w,
            voluntaryEntry: {
              ...w.voluntaryEntry,
              length: v,
              ...(sug
                ? { qualityGrade: sug.code, qualityName: sug.name }
                : revert
                  ? { qualityGrade: DEFAULT_QUALITY_CODE, qualityName: DEFAULT_QUALITY_NAME }
                  : {}),
            },
          }));
        }}
        numpadLabel="Kesim uzunluğu"
        allowDecimal
        autoActivate
        numpadMaxLength={8}
        placeholder={placeholder}
        dense
        style={styles.input}
        useNativeKeyboard={compact}
      />
    );
    const clearBtn = (
      <IconButton
        icon="backspace-outline"
        mode="contained-tonal"
        size={24}
        iconColor="#475569"
        containerColor="#e2e8f0"
        onPress={() => {
          // Otomatik yazılmış A1 uzunlukla birlikte gider (bayat kalite kalmasın).
          const revert =
            shortCutAutoMainRef.current &&
            work.voluntaryEntry.qualityGrade === SHORT_CUT_QUALITY_CODE;
          if (revert) shortCutAutoMainRef.current = false;
          setWork((w) => ({
            ...w,
            voluntaryEntry: {
              ...w.voluntaryEntry,
              length: '',
              ...(revert
                ? { qualityGrade: DEFAULT_QUALITY_CODE, qualityName: DEFAULT_QUALITY_NAME }
                : {}),
            },
          }));
        }}
        disabled={!work.voluntaryEntry.length}
        accessibilityLabel="Uzunluğu temizle"
        style={{ margin: 0 }}
      />
    );
    const autoBox = (
      // Otomatik: uzunluk makineden gelir. Büyük "Uzunluk" etiketi,
      // toggle'ın neyi kontrol ettiğini netleştirir.
      <View style={styles.autoLengthBox}>
        <Icon source="ruler" size={24} color="#7c3aed" />
        <Text style={styles.autoLengthLabel}>Uzunluk</Text>
      </View>
    );
    const toggle = (
      <View style={styles.cutModeToggle}>
        {(['manual', 'auto'] as const).map((m) => {
          const active = cutMode === m;
          return (
            <TouchableRipple
              key={m}
              borderless
              onPress={() => void setCutMode(m)}
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
    );

    if (halfWidth) {
      // Geometri "Ürün / Renk" satırıyla BİREBİR: iki flex:1 sütun + 10px boşluk.
      // Sabit '50%' vermek 10px'lik boşluk yüzünden kıl payı geniş kalıyordu.
      return (
        <View style={styles.manualPickRow}>
          <View style={styles.manualPickCol}>
            {cutMode === 'manual' ? input : autoBox}
          </View>
          <View style={[styles.manualPickCol, styles.lengthSideCol]}>
            {cutMode === 'manual' && clearBtn}
            {toggle}
          </View>
        </View>
      );
    }

    return (
      <View style={styles.lengthModeRow}>
        <View style={styles.lengthCol}>
          {cutMode === 'manual' ? (
            <View style={styles.cutInputRow}>
              <View style={{ flex: 1 }}>{input}</View>
              {clearBtn}
            </View>
          ) : (
            autoBox
          )}
        </View>
        {toggle}
      </View>
    );
  };

  /**
   * "Kime?" + "Kalite" YAN YANA; her biri kendi içinde dikey liste. Kime uzarsa
   * kendi sütununda scroll olur, Kalite'yi etkilemez.
   *
   * `orderShortcuts` yalnız KART akışında verilir — manuel modda iş emri yoktur,
   * dolayısıyla sipariş kısayolu da yoktur (hedef "Listeden Seç" ile seçilir).
   * `grades` parametreli çünkü manuel mod kalite kataloğunu daraltır (bkz.
   * `manualQualityGrades` gerekçesi).
   */
  const renderKimeKalite = (opts: {
    orderShortcuts?: React.ReactNode;
    grades: QualityGrade[];
    gradeNote?: string | null;
  }) => (
    <View style={styles.kimeKaliteRow}>
      <View style={styles.kimeCol}>
        <Text style={styles.cutSubLabel}>Kime?</Text>
        {/* Açık "Stok" seçeneği — hiç seçim yokken aktif görünür. */}
        {stokChip}
        {/* SABİT — scroll'la kaymaz; tüm müşteriler (sipariştekiler önce) */}
        {kimeListChip}
        {opts.orderShortcuts}
        {/* ETİKETTE NE YAZACAK — kesim ve baskı aynı dokunuşta olduğu için
            operatörün müşterideki adı görebileceği TEK an burası (2026-08-13). */}
        <LabelNamePreview
          rollId={selectedRoll?.rollId ?? null}
          orderLineId={work.voluntaryEntry.targetOrderLineId ?? null}
          customerId={work.voluntaryEntry.targetCustomerId ?? null}
        />
      </View>

      <View style={styles.kaliteCol}>
        <Text style={styles.cutSubLabel}>Kalite</Text>
        <View style={styles.optionList}>
          {opts.grades.map((qg) => {
            const active = work.voluntaryEntry.qualityGrade === qg.code;
            return (
              <TouchableRipple
                key={qg.id}
                borderless
                onPress={() => {
                  // Elle seçim = kontrol operatörde; kısa-kesim kuralı bu
                  // seçimi geri almaz (yeni uzunluk yazılana dek yeniden de
                  // ateşlemez — kural yalnız varsayılan seçiliyken çalışır).
                  shortCutAutoMainRef.current = false;
                  setWork((w) => ({
                    ...w,
                    voluntaryEntry: {
                      ...w.voluntaryEntry,
                      qualityGrade: active ? '' : qg.code,
                      qualityName: active ? undefined : qg.name,
                    },
                  }));
                }}
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
        {!!opts.gradeNote && <Text style={styles.gradeNote}>{opts.gradeNote}</Text>}
      </View>
    </View>
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
    // Kartelalık işareti akışa özgüdür — X ile kapatınca da sıfırla; yoksa
    // SONRAKİ açık-kumaş kesimleri sessizce kartelalık işaretlenirdi (sızıntı).
    setMarkAsKartela(false);
    // Kesim yapıldıysa parent metrajı değişti — RollPickerModal / rulo listeleri
    // bayat kalmasın (finalize yollarındaki invalidation X-kapatta çalışmıyordu).
    qc.invalidateQueries({ queryKey: ['rolls'] });
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
  };

  const renderRightContent = () => {
    // MANUEL MOD: kart okutma çubuğu, açık iş sekmeleri ve top kuyruğu HİÇ
    // çizilmez — üçü de refakat kartına dayanır ve bu modda hiçbiri işletilmez.
    // Yerine ne olduğunu söyleyen bir panel + moddan çıkış (telefonda drawer'ın
    // içinden de ulaşılabilen ikinci kapı).
    if (manualMode) {
      return (
        <View style={styles.manualPane}>
          <Icon source="hand-back-right-outline" size={44} color="#f59e0b" />
          <Text style={styles.manualPaneTitle}>Manuel mod açık</Text>
          <Text style={styles.manualPaneHint}>
            Refakat kartı okutulmaz. Soldaki formdan ürün, metraj ve müşteri seçip
            “Depoya Ekle” dediğinde top doğrudan Bitmiş Depo’ya yazılır.
          </Text>
          {/* Aksiyon satırı KALDIRILDI (2026-08-04): Çıkanlar ve Serbest Etiket
              başlıkta zaten var; manuel modda paneli sadeleştirdik. */}
          <Button
            mode="contained"
            icon="close"
            buttonColor="#b45309"
            onPress={toggleManualMode}
            style={styles.manualPaneExit}
            contentStyle={styles.manualPaneExitContent}
          >
            Manuel modu kapat
          </Button>
        </View>
      );
    }
    return (
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
              {/* Sipariş Bağla — yalnız planlama yetkilisinde (workorder:write)
                  ve açık kart varken (iş emri hedefi ondan okunur). */}
              {canLinkOrders && activeJob && !manualMode && (
                <HeaderChip
                  icon="link-variant"
                  label="Sipariş Bağla"
                  onPress={() => setOrderLinkOpen(true)}
                />
              )}
              {/* Saha düzeltmesi — yalnız yetkili operatörde ve açık iş varken
                  (iki uç da bir Tambur ADIMINI hedef alır). */}
              {canFieldFix && activeJob && (
                <Button
                  mode="outlined"
                  icon="wrench-outline"
                  compact
                  onPress={() => openFieldFix()}
                  textColor="#6d28d9"
                >
                  Düzelt
                </Button>
              )}
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
            {/* Saha düzeltmesi — yalnız yetkili operatörde ve açık iş varken. */}
            {canFieldFix && activeJob && (
              <CompactAction
                icon="wrench-outline"
                label="Düzelt"
                bg="#ede9fe"
                color="#6d28d9"
                onPress={() => openFieldFix()}
              />
            )}
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
      {/* BU İŞTEN ÇIKANLAR (2026-08-09) — üstteki liste "işlenecek toplar"ı,
          bu panel "çıkan toplar"ı gösterir. Backend süzgeci zaten vardı. */}
      {activeJob && (
        <WorkOrderOutputPanel
          workOrderId={activeJob.stepSummary.workOrderId}
          onPrint={(r: Roll) => {
            // Kayıtlı etiket niyetiyle bas — "Kime?" TEKRAR SORULMAZ (kesim
            // akışlarındaki kuralın aynısı; hedef zaten topun üstünde).
            setLabelContext(undefined);
            startPrint(r, printKindForRoll(r));
          }}
          onUndo={(r: Roll) => setPanelUndoTarget(r)}
        />
      )}
    </>
    );
  };

  // Telefonda "Açık İşler" (operatörün açtığı kart sekmeleri), "Açık Kartlar"
  // ve "Tara" erişimi Kurşun/Ham Giriş ile aynı desende: header'da sıkışan tek
  // ikon yerine, başlığın ALTINDAKİ 2. katta yan yana üç etiketli chip
  // (secondRow) — hepsi drawer açmadan doğrudan erişilir. Çıkanlar/Kesme
  // telefonda drawer içinde kalır.
  // MANUEL MODDA kart chip'leri (Açık İşler / Açık Kartlar / Tara) ÇİZİLMEZ:
  // üçü de refakat kartına dayanır, modda hiçbiri işletilmez ve basıldığında
  // görünmeyen bir iş açarlar. Yerine moddan çıkış chip'i gelir — dar telefon
  // satırında mod anahtarı okunabilir kalsın diye (aksi hâlde 5 chip eşit
  // bölüşür ve etiketler tek harfe kırpılır).
  const phoneSecondRow = manualMode ? (
    <>
      <HeaderChip
        icon="hand-back-right"
        label="MANUEL MOD AÇIK — kapat"
        onPress={toggleManualMode}
        active
        fill
      />
      {/* Serbest Etiket telefonda da çizilmez — manuel modda sadeleştirme
          (2026-08-04); Çıkanlar drawer'ın içinden erişilebilir. */}
    </>
  ) : (
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
      {canLinkOrders && activeJob && (
        <HeaderChip
          icon="link-variant"
          label="Sipariş Bağla"
          onPress={() => setOrderLinkOpen(true)}
          fill
        />
      )}
      <HeaderChip
        icon="tag-multiple"
        label="Serbest Etiket"
        onPress={() => openStandalone()}
        fill
      />
      {canFieldFix && (
        <HeaderChip
          icon="hand-back-right-outline"
          label="Manuel Ekle"
          onPress={toggleManualMode}
          fill
        />
      )}
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
              {/* Kart aksiyonları — MANUEL MODDA çizilmez (kart okutulmuyor). */}
              {!manualMode && (
                <>
                  <HeaderChip
                    icon="format-list-bulleted"
                    label="Liste"
                    onPress={() => openList()}
                  />
                  <HeaderChip icon="camera" label="Tara" onPress={() => openScanner()} />
                </>
              )}
              <HeaderChip
                icon="printer-search"
                label="Çıkanlar"
                onPress={() => openRecentOutput()}
              />
              {/* Top Kesme, Manuel Mod ile DIŞLAYAN bir moddur — birlikte açılamaz. */}
              {!manualMode && (
                <HeaderChip
                  icon="content-cut"
                  label="Kesme"
                  onPress={() => openRecut()}
                />
              )}
              {/* Sipariş Bağla — yalnız planlama yetkilisinde (workorder:write)
                  ve açık kart varken (iş emri hedefi ondan okunur). */}
              {canLinkOrders && activeJob && !manualMode && (
                <HeaderChip
                  icon="link-variant"
                  label="Sipariş Bağla"
                  onPress={() => setOrderLinkOpen(true)}
                />
              )}
              {/* Saha düzeltmesi — yalnız yetkili operatörde ve açık iş varken
                  (iki uç da ekrandaki Tambur ADIMINI hedef alır; iş yoksa hedef
                  yok). Yetkisizde hiç çizilmez, gri buton bırakılmaz. */}
              {canFieldFix && activeJob && !manualMode && (
                <HeaderChip
                  icon="wrench-outline"
                  label="Düzelt"
                  onPress={() => openFieldFix()}
                  accent
                />
              )}
              {/* MANUEL EKLE anahtarı — aynı yetki kapısı (`canFieldFix`)
                  arkasında: backend ucu `roll:manual-adjust` /
                  `mobile:tambur-duzelt` ister, yetkisiz operatöre 403 verecek
                  gri buton gösterilmez. AÇIKKEN dolu amber: operatör hangi modda
                  olduğunu bir bakışta görmeli. (Telefonda karşılığı 2. kattaki
                  chip — bkz. phoneSecondRow.) */}
              {canFieldFix && (
                <HeaderChip
                  icon={manualMode ? 'hand-back-right' : 'hand-back-right-outline'}
                  label={manualMode ? 'MANUEL MOD AÇIK' : 'Manuel Ekle'}
                  onPress={toggleManualMode}
                  active={manualMode}
                />
              )}
              {/* Serbest Etiket — EN SAĞDA, profil tuşunun yanında ve YALNIZ İKON
                  (2026-08-04). MANUEL MODDA ÇİZİLMEZ: o modda ekran zaten form
                  dolu, kalabalığı azaltmak için yalnız "Çıkanlar" bırakılır. */}
              {!manualMode && (
                <HeaderChip
                  icon="tag-multiple"
                  label="Serbest Etiket"
                  onPress={() => openStandalone()}
                  iconOnly
                />
              )}
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
          {manualMode ? (
            // ══ MANUEL EKLE — kartsız BİTMİŞ ürün ══════════════════════════
            // Top Kesme ile aynı sınıfta EXCLUSIVE bir mod: kabuk aynı (band +
            // kaydırılabilir form + sticky CutActionBar), fark girdide. Kart
            // olmadığı için iş emrinden miras YOK → ürün/renk operatörün
            // kararıdır; hata noktaları / kat / adım notu / sipariş kısayolları
            // gibi karta dayanan her yüzey burada YOKTUR (veri de yok).
            // "Bitir" YOK: tüketilecek bir parent top yok, her giriş kendi
            // başına tamamlanmış bir topu depoya yazar.
            <>
              <Surface
                style={[
                  styles.headerBand,
                  styles.headerBandManual,
                  compact && styles.headerBandCompact,
                ]}
                elevation={2}
              >
                <View
                  style={[styles.headerTitleCol, !compact && styles.headerTitleFlex]}
                >
                  <View style={styles.manualTag}>
                    <Icon source="hand-back-right" size={13} color="#78350f" />
                    <Text style={styles.manualTagText}>MANUEL MOD · KART YOK</Text>
                  </View>
                  <Text style={styles.headerBarcode} numberOfLines={1}>
                    {manualItemLabel ?? 'Ürün seçilmedi'}
                  </Text>
                  <Text style={styles.headerSub} numberOfLines={2}>
                    {manualColorId ? manualColorLabel : 'Renksiz'} · çıkan top
                    doğrudan Bitmiş Depo’ya yazılır
                  </Text>
                </View>
                <View
                  style={[styles.headerBoxes, compact && styles.headerBoxesCompact]}
                >
                  <View
                    style={[
                      styles.headerBox,
                      styles.headerBoxGreen,
                      compact && styles.headerBoxFlex,
                    ]}
                  >
                    <Text style={styles.headerBoxValue}>
                      {cutMode === 'auto'
                        ? 'OTO'
                        : work.voluntaryEntry.length.trim() === ''
                          ? '—'
                          : work.voluntaryEntry.length.trim()}
                    </Text>
                    <Text style={styles.headerBoxSub}>
                      {cutMode === 'auto' ? 'makineden' : 'mt'}
                    </Text>
                  </View>
                  <IconButton
                    icon="close"
                    size={22}
                    iconColor="#78350f"
                    onPress={toggleManualMode}
                    accessibilityLabel="Manuel modu kapat"
                    style={{ margin: 0 }}
                  />
                </View>
              </Surface>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
              >
                <Surface style={styles.section} elevation={1}>
                  {/* Ürün + Renk — kart yok, iş emrinden MİRAS YOK. Ürün zorunlu. */}
                  <View style={styles.manualPickRow}>
                    <View style={styles.manualPickCol}>
                      <TouchableRipple
                        borderless
                        onPress={() => {
                          setManualItemCatalogWanted(true);
                          setManualPicker('item');
                        }}
                        style={[
                          styles.manualSelect,
                          !!manualItemId && styles.manualSelectFilled,
                        ]}
                      >
                        <View style={styles.manualSelectInner}>
                          <Text
                            style={[
                              styles.manualSelectText,
                              !manualItemId && styles.manualSelectTextMuted,
                            ]}
                            numberOfLines={1}
                          >
                            {manualItemLabel ?? 'Ürün Seç *'}
                          </Text>
                          <Icon source="chevron-down" size={20} color="#64748b" />
                        </View>
                      </TouchableRipple>
                      {manualItemsQuery.isError && (
                        <Text style={styles.manualErrorNote}>
                          Ürün listesi açılamadı (
                          {manualItemsQuery.error instanceof Error
                            ? manualItemsQuery.error.message
                            : 'yetki yok'}
                          ).
                        </Text>
                      )}
                    </View>

                    <View style={styles.manualPickCol}>
                      <View style={styles.manualColorRow}>
                        <TouchableRipple
                          borderless
                          onPress={() => {
                            setManualColorCatalogWanted(true);
                            setManualPicker('color');
                          }}
                          style={[
                            styles.manualSelect,
                            { flex: 1 },
                            !!manualColorId && styles.manualSelectFilled,
                          ]}
                        >
                          <View style={styles.manualSelectInner}>
                            <Text
                              style={[
                                styles.manualSelectText,
                                !manualColorId && styles.manualSelectTextMuted,
                              ]}
                              numberOfLines={1}
                            >
                              {manualColorLabel ?? 'Renk Seç (boş = renksiz)'}
                            </Text>
                            <Icon source="chevron-down" size={20} color="#64748b" />
                          </View>
                        </TouchableRipple>
                        {!!manualColorId && (
                          <IconButton
                            icon="close"
                            size={18}
                            mode="contained-tonal"
                            containerColor="#e2e8f0"
                            iconColor="#475569"
                            onPress={() => {
                              setManualColorId(null);
                              setManualColorLabel(null);
                            }}
                            accessibilityLabel="Rengi temizle (renksiz)"
                            style={{ margin: 0 }}
                          />
                        )}
                      </View>
                      {manualColorsQuery.isError && (
                        <Text style={styles.manualErrorNote}>
                          Renk listesi açılamadı (
                          {manualColorsQuery.error instanceof Error
                            ? manualColorsQuery.error.message
                            : 'yetki yok'}
                          ).
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* EN (üstte) + METRAJ (altta) — ikisi de bölümün YARISI
                      genişliğinde, alt alta hizalı. Etiketler yok; her alanın ne
                      olduğu placeholder'da yazıyor (2026-08-04). */}
                  <View style={styles.manualPickRow}>
                    <View style={styles.manualPickCol}>
                    <NumpadInput
                      mode="outlined"
                      dense
                      value={manualWidth}
                      onChangeText={setManualWidth}
                      numpadLabel="En Değeri (cm)"
                      allowDecimal={false}
                      numpadMaxLength={4}
                      placeholder="En Değeri (cm) *"
                      style={styles.input}
                      useNativeKeyboard={compact}
                    />
                    </View>
                    {/* Sağ yarı: KAT seçici. Eskiden boştu; kat manuel modda
                        ZORUNLU olduğu için (miras alınacak bağlam yok) buraya
                        oturdu — ekstra satır açmadan, En ile aynı hizada. */}
                    <View style={[styles.manualPickCol, styles.foldPickRow]}>
                      {/* Seçenekler KATALOGDAN (2026-08-10) — sabit iki çip,
                          panelden eklenen 6-KAT'ı tablette görünmez yapardı. */}
                      {foldValues.map((ft) => {
                        const active = manualFoldType === ft.code;
                        return (
                          <TouchableRipple
                            key={ft.code}
                            borderless
                            onPress={() => setManualFoldType(ft.code)}
                            style={[styles.manualFoldChip, active && styles.manualFoldChipOn]}
                          >
                            <Text
                              style={[styles.manualFoldChipText, active && styles.manualFoldChipTextOn]}
                            >
                              {ft.name}
                            </Text>
                          </TouchableRipple>
                        );
                      })}
                    </View>
                  </View>
                  {renderCutLength('Metraj Değeri (metre) *', true)}

                  {/* Kime? + Kalite — ana kesimle AYNI blok. Sipariş kısayolu
                      verilmez: kart yok, iş emri yok. */}
                  {renderKimeKalite({
                    grades: manualQualityGrades,
                    gradeNote: manualGradeNote,
                  })}

                  {/* İŞLEM NEDENİ — EN ALTTA ve topla ilgili alanlardan AYRI
                      (2026-08-04): ürün/renk/en/metraj topun KENDİSİNİ tarif
                      eder, bu not ise "neden elle girildi" sorusunun cevabıdır.
                      Ayrı bir blokta durması ikisini karıştırmayı önler. */}
                  <View style={styles.manualReasonBlock}>
                    <TouchableRipple
                      borderless
                      onPress={() => {
                        setManualReasonFreeOpen(false);
                        setManualReasonDraft('');
                        setManualPicker('reason');
                      }}
                      style={[
                        styles.manualSelect,
                        !!manualReason.trim() && styles.manualSelectFilled,
                      ]}
                    >
                      <View style={styles.manualSelectInner}>
                        <Icon
                          source="comment-alert-outline"
                          size={20}
                          color={manualReason.trim() ? '#0f172a' : '#64748b'}
                        />
                        <Text
                          style={[
                            styles.manualSelectText,
                            { flex: 1 },
                            !manualReason.trim() && styles.manualSelectTextMuted,
                          ]}
                          numberOfLines={2}
                        >
                          {manualReason.trim() || 'İşlem Nedeni Seç *'}
                        </Text>
                        <Icon source="chevron-down" size={20} color="#64748b" />
                      </View>
                    </TouchableRipple>
                  </View>
                </Surface>
              </ScrollView>

              {!isOnline && (
                <View style={styles.manualMissingStrip}>
                  <Icon source="wifi-off" size={16} color="#b45309" />
                  <Text style={styles.manualMissingText}>
                    Çevrimdışı — manuel giriş kuyruğa alınmaz (barkodu sunucu
                    üretir), bağlantı gelince tekrar deneyin.
                  </Text>
                </View>
              )}

              {/* Sticky footer — "Bitir" YOK (tüketilecek parent top yok). */}
              <CutActionBar
                compact={compact}
                kartelaOn={markAsKartela}
                onToggleKartela={() => setMarkAsKartela((v) => !v)}
                onKes={handleManualProduce}
                kesLoading={produceManualRollMutation.isPending || measuring}
                kesDisabled={manualMissing.length > 0 || !isOnline}
                kesLabel={
                  cutMode === 'auto'
                    ? 'Makineden Ölç — Depoya Ekle'
                    : 'Depoya Ekle'
                }
              />
            </>
          ) : recutResolvedRollId && recutRollMeta ? (
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
                              onChangeText={handleRecutLengthChange}
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
                            onPress={() => handleRecutLengthChange('')}
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
                            onPress={() => void setRecutMode(m)}
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
                              onPress={() => {
                                // Elle seçim = kontrol operatörde (ana kesimle aynı).
                                shortCutAutoRecutRef.current = false;
                                setRecutQualityGrade(qg.code);
                              }}
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

              {/* Sticky footer (Kartela + Bitir + Kes) — Top Kesme akışı. Son
                  kesimde kalan ~0 olunca depo topu OTOMATİK arşivlenir; kalan
                  varken operatör "Bitir" ile karar modalını (1.KALITE/A1/FIRE)
                  açar — parent arşivlenir, kalan child olarak yaşar. */}
              <CutActionBar
                compact={compact}
                kartelaOn={markAsKartela}
                onToggleKartela={() => setMarkAsKartela((v) => !v)}
                onBitir={() => setRecutFinalizeOpen(true)}
                bitirDisabled={
                  cutWarehouseRollMutation.isPending ||
                  finalizeWarehouseCutMutation.isPending ||
                  measuring ||
                  recutRollMeta.currentQty <= 0
                }
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
                  {/* Barkod YOKSA satır hiç basılmaz (2026-08-04): barkodsuz açık
                      kumaşta buraya `Açık Kumaş · 4baa35e7` gibi bir UUID parçası
                      yazılıyordu — operatöre hiçbir şey söylemeyen, okutulamayan
                      bir kimlik. Kumaş/renk/en zaten alt satırda. */}
                  {selectedRoll.barcode && (
                    <Text style={styles.headerBarcode} numberOfLines={1}>
                      {selectedRoll.barcode}
                    </Text>
                  )}
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
                            {/* Değer de basılır ("Gramaj: 50 gr") — final kararı
                                veren operatör kurşundaki seçimi görmeli (VAL-03). */}
                            {p.value ? `${p.name}: ${p.value.name}` : p.name}
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
                          // TURUNCU (2026-08-04): koyu lacivert kutu metre/katlama
                          // kutularının arasında kaybolup gidiyordu; sipariş bilgisi
                          // kesim kararının girdisi, kendini belli etsin.
                          styles.headerBoxOrders,
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
                  // HATA YOKSA BÖLÜM HİÇ ÇİZİLMEZ (2026-08-04 saha isteği): dar
                  // Tambur kolonunda "Hata Noktaları (0) / Kayıtlı hata yok"
                  // kutusu iki satır yer kaplıyordu ve hiçbir bilgi vermiyordu —
                  // sıfır zaten YOKLUKTUR, ayrıca söylenmesi gerekmez. Kesim
                  // bölümü yukarı kayar. Hata girildiği anda bölüm geri gelir.
                  if (errs.length === 0) return null;
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
                      onPress={() => setErrorsModalOpen(true)}
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
                          <Icon source="chevron-right" size={18} color="#94a3b8" />
                        </View>
                        <DefectRuler
                          errors={errs}
                          defectTypes={defectTypes}
                          rulerMax={rulerMaxForErrors(selectedRoll.currentQty, errs)}
                        />
                      </View>
                    </TouchableRipple>
                  );
                })()}

                {/* Kesim — operatör fiziksel kesim yapar, anında sisteme girer.
                    Her "Top Oluştur" tıklaması child Roll oluşturur + etiket basar. */}
                <Surface style={styles.section} elevation={1}>
                  {/* Katlama (2/4 kat) — başlıksız, bölümün en üstünde. */}
                  <View style={styles.foldInlineRow}>
                    {/* Seçenekler KATALOGDAN (2026-08-10). Seçilen kod hem topa
                        yazılır hem METRE cihazının rolüyle BİREBİR eşleştirilir. */}
                    {foldValues.map((ft) => {
                      const active = work.foldType === ft.code;
                      return (
                        <TouchableRipple
                          key={ft.code}
                          borderless
                          // Biri her zaman seçili kalmalı → aktif chip'e basınca
                          // boşa düşmez; sadece diğerine geçiş yapılır.
                          onPress={() => setWork((w) => ({ ...w, foldType: ft.code }))}
                          style={[styles.foldChipSm, active && styles.foldChipActive]}
                        >
                          <Text
                            style={[
                              styles.foldChipText,
                              active && styles.foldChipTextActive,
                            ]}
                          >
                            {ft.name}
                          </Text>
                        </TouchableRipple>
                      );
                    })}
                  </View>

                  {/* Uzunluk girişi + Manuel/Otomatik metraj kaynağı — MANUEL
                      MOD ile ORTAK blok (aynı bileşen, aynı state; kopya değil). */}
                  {renderCutLength('Boş = kalanı kes (metre)')}

                  {/* Kime? + Kalite — MANUEL MOD ile ORTAK blok. Tek fark
                      sipariş kısayolları: kart akışında iş emrinin sipariş
                      satırları tek dokunuşla hedef seçilir (2. tık seçimi
                      kaldırır = stok). Manuel modda iş emri yok → kısayol yok. */}
                  {renderKimeKalite({
                    grades: qualityGrades,
                    orderShortcuts: (
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
                    ),
                  })}
                </Surface>

              </ScrollView>

              {/* Sticky footer — ASIL aksiyon "Kes". "Bitir" 2026-08-09'da
                  EKLENDİ: otomatik bitiş kaldırıldı, iş yalnız operatör
                  basınca kapanır. Kalan 0 olsa da buton AÇIK kalır — tersi
                  vaka (sistemde metraj görünürken fiziksel kumaş bitmiş) o
                  topu sonsuza dek açık bırakırdı. Kalan > 0 iken karar
                  penceresi zorunludur; kalan 0 ise tek dokunuşta biter. */}
              <CutActionBar
                compact={compact}
                kartelaOn={markAsKartela}
                onToggleKartela={() => setMarkAsKartela((v) => !v)}
                onKes={handleKes}
                onBitir={() => {
                  if (selectedRoll.currentQty > 0.05) {
                    setOpenFabricFinalizeOpen(true);
                  } else {
                    // Kalan yok → sorulacak bir şey de yok. `discard` gönderilir
                    // ama sapma satırı DOĞMAZ (qty 0 → `recordVarianceTx` atlar).
                    finalizeOpenFabricMutation.mutate({
                      rollId: selectedRoll.rollId,
                      remainingAction: 'discard',
                      foldType: work.foldType ?? null,
                    });
                  }
                }}
                bitirLoading={finalizeOpenFabricMutation.isPending}
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

      {/* Saha düzeltmesi (Topu Buraya Al / Manuel Top Ekle) — kardeş dosyada.
          Yetki + açık iş yoksa hiç mount edilmez: hedef adım (targetStepId)
          olmadan iki ucun da anlamı yok. */}
      {canFieldFix && activeJob && (
        <TamburFieldFix
          visible={fieldFixOpen}
          onDismiss={() => setFieldFixOpen(false)}
          targetStepId={activeJob.stepSummary.workOrderStepId}
          stationName={activeJob.stepSummary.stationName}
          workOrderNumber={activeJob.stepSummary.batchNumber}
          qualityGrades={qualityGrades}
          online={isOnline}
          onApplied={() => {
            // Mevcut Tambur desenİ: adım + context tazelenir. Ayrıca top
            // listeleri (Listeden Seç / Çıkanlar) bayat kalmasın.
            void refetchActiveJob();
            qc.invalidateQueries({ queryKey: ['rolls'] });
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
          }}
        />
      )}

      {/* Kurşun Bypass'ın ONAY MODALI YOKTUR (2026-08-01): kart okutulunca kurşun
          adımı `resolveCard` içinde sessizce kapanır ve kart normal Tambur işi
          olarak açılır. Tambur operatörü kurşunu yapan kişi değildir — ona
          onaylatacak bir karar yok, yalnız bilgi toast'ı gösterilir. */}

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
      {/* "Bu işten çıkanlar" panelinden geri alma — aynı onay diyaloğu.
          Bitince ana ekran tazelenir: geri alınan metraj kalana geri döner ve
          kapanmış iş emri dirilmiş olabilir. */}
      <TamburUndoConfirmModal
        rollId={panelUndoTarget?.id ?? null}
        barcode={panelUndoTarget?.barcode ?? null}
        onDismiss={() => setPanelUndoTarget(null)}
        onDone={() => {
          setPanelUndoTarget(null);
          void refetchActiveJob();
          void qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
        }}
      />

      {/* AÇIK KUMAŞ kapanışı (2026-08-09) — "Bitir" kalan metraj varken bunu
          açar. Recut'ın modalıyla aynı bileşen: iki akış aynı dili konuşsun
          (kararlar ve sebep katalogu tek yerde). */}
      <FinalizeRemainingModal
        canEditPresets={canFieldFix}
        visible={openFabricFinalizeOpen}
        remainingQty={selectedRoll?.currentQty ?? 0}
        onDismiss={() => setOpenFabricFinalizeOpen(false)}
        loading={finalizeOpenFabricMutation.isPending}
        onChoose={(action, reasonCode, reasonText) => {
          const rollId = selectedRoll?.rollId;
          if (!rollId) return;
          setOpenFabricFinalizeOpen(false);
          finalizeOpenFabricMutation.mutate({
            rollId,
            remainingAction: action,
            foldType: work.foldType ?? null,
            varianceReasonCode: reasonCode,
            varianceReasonText: reasonText,
            // Bu topta sapma kesim sırasında onaylandıysa bitirme yeniden sormaz.
            confirmMismatch: planMismatchConfirmedRef.current.has(rollId) || undefined,
          });
        }}
      />

      <FinalizeRemainingModal
        canEditPresets={canFieldFix}
        visible={recutFinalizeOpen}
        remainingQty={recutRollMeta?.currentQty ?? 0}
        onDismiss={() => setRecutFinalizeOpen(false)}
        loading={finalizeWarehouseCutMutation.isPending}
        onChoose={(action, reasonCode, reasonText) => {
          if (!recutResolvedRollId) return;
          finalizeWarehouseCutMutation.mutate({
            rollId: recutResolvedRollId,
            remainingAction: action,
            varianceReasonCode: reasonCode,
            varianceReasonText: reasonText,
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
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
          }
        }}
      />

      {/* Aşım onayı — operatör kayıtlı kalandan fazla metraj girdi (flag açık).
          Parmak hatası koruması: somut kayıtlı/girilen değerleri göster, onayla geç.
          Onaylanınca kaynak kumaş tamamen kapanır (backend parent'ı tüketir). */}

      {/* RENKSİZ ONAYI — manuel modda renk seçilmeden kayıt. Geçerli bir durum
          (ham beyaz mal) ama unutma ihtimali yüksek: top envantere renksiz
          girdiğinde operatör bunu ancak etikette fark ederdi. */}
      {/* Sipariş Bağla — süpervizör planlama modalı (uygun/tümü + override). */}
      {activeJob ? (
        <TamburOrderLinkSheet
          visible={orderLinkOpen}
          onDismiss={() => setOrderLinkOpen(false)}
          workOrderId={activeJob.stepSummary.workOrderId}
          onLinked={() => void refetchActiveJob()}
        />
      ) : null}

      {/* PLAN-GERÇEK SAPMA onayı — backend 409 PLAN_MISMATCH cevabı (soru, hata
          değil). Renk/en sapan top yine de depoya inecekse operatör imza atar;
          karar backend audit'inde. colorlessConfirm ile aynı görsel dil. */}
      <AppModal
        visible={!!planMismatch}
        onDismiss={() => setPlanMismatch(null)}
        position="center"
        swipeToDismiss={false}
        contentStyle={overCutStyles.sheet}
      >
        <View>
          <View style={overCutStyles.header}>
            <Icon source="alert-circle-outline" size={26} color="#b45309" />
            <Text style={overCutStyles.title}>Plan ile top uyuşmuyor</Text>
          </View>
          {(planMismatch?.messages ?? []).map((m, i) => (
            <Text key={i} style={overCutStyles.body}>
              • {m}
            </Text>
          ))}
          <Text style={overCutStyles.body}>
            Mal <Text style={overCutStyles.strong}>olduğu gibi</Text> depoya iner —
            bu onay topun kaydını DEĞİŞTİRMEZ. Yanlış olan iş emriyse süpervizör
            "Sipariş Bağla / Düzelt" ile düzeltir.
          </Text>
          <View style={overCutStyles.actions}>
            <Button
              mode="outlined"
              style={overCutStyles.btn}
              onPress={() => setPlanMismatch(null)}
            >
              Vazgeç
            </Button>
            <Button
              mode="contained"
              style={overCutStyles.btn}
              buttonColor="#b45309"
              onPress={() => {
                const pm = planMismatch;
                setPlanMismatch(null);
                pm?.retry();
              }}
            >
              Onayla ve Devam Et
            </Button>
          </View>
        </View>
      </AppModal>

      <AppModal
        visible={!!colorlessConfirm}
        onDismiss={() => setColorlessConfirm(null)}
        position="center"
        swipeToDismiss={false}
        contentStyle={overCutStyles.sheet}
      >
        <View>
          <View style={overCutStyles.header}>
            <Icon source="palette-outline" size={26} color="#b45309" />
            <Text style={overCutStyles.title}>Renk seçilmedi</Text>
          </View>
          <Text style={overCutStyles.body}>
            Bu top <Text style={overCutStyles.strong}>renksiz (ham)</Text> olarak
            kaydedilecek. Boyalı bir mal giriyorsan Vazgeç deyip rengi seç.
          </Text>
          <View style={overCutStyles.actions}>
            <Button
              mode="outlined"
              style={overCutStyles.btn}
              onPress={() => setColorlessConfirm(null)}
            >
              Vazgeç
            </Button>
            <Button
              mode="contained"
              style={overCutStyles.btn}
              buttonColor="#b45309"
              onPress={() => {
                const fn = colorlessConfirm;
                setColorlessConfirm(null);
                fn?.();
              }}
            >
              Evet, renksiz
            </Button>
          </View>
        </View>
      </AppModal>

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
              <Icon
                source={overCutConfirm.kind === 'all' ? 'flag-checkered' : 'alert-outline'}
                size={26}
                color="#b45309"
              />
              <Text style={overCutStyles.title}>
                {overCutConfirm.kind === 'all'
                  ? 'Kalanın tamamı kesilecek — iş bitecek'
                  : 'Kayıtlı metrajı aşıyor'}
              </Text>
            </View>
            {overCutConfirm.kind === 'all' ? (
              <Text style={overCutStyles.body}>
                Kalan{' '}
                <Text style={overCutStyles.strong}>
                  {overCutConfirm.recorded.toFixed(1)} m
                </Text>
                {'’nin tamamı '}
                <Text style={overCutStyles.strong}>
                  {overCutConfirm.entered.toFixed(1)} m
                </Text>
                {' olarak tek topa dönecek. Bu kesimden sonra kumaş bitecek ve '}
                <Text style={overCutStyles.strong}>bu iş kapanacak</Text>
                {'. Daha az kesmek istiyorsan Vazgeç deyip metrajı yaz.'}
              </Text>
            ) : (
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
            )}
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
                {overCutConfirm.kind === 'all'
                  ? `Evet, ${overCutConfirm.entered.toFixed(1)} m kes ve bitir`
                  : `Evet, ${overCutConfirm.entered.toFixed(1)} m`}
              </Button>
            </View>
          </View>
        )}
      </AppModal>

      {/* Tambur'dan çıkmış toplar listesi — geçmişten etiket yeniden basımı */}
      <RecentOutputModal
        visible={recentOutputOpen}
        onDismiss={() => setRecentOutputOpen(false)}
        // TOPLU baskı — hedef zaten yazıldı, kuyruğa ver ve listeyi kapat.
        // Kuyruk ekranın kanıtlanmış tekil baskı zinciridir; yeni bir toplu
        // baskı yolu yazmak ikinci bir yazıcı/hata davranışı doğururdu.
        onBulkPrint={(bulkRolls) => {
          setRecentOutputOpen(false);
          setLabelContext(undefined); // hedef topun ÜSTÜNE yazıldı; tekrar sorma
          setPendingPrintRolls((prev) => [...prev, ...bulkRolls]);
        }}
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
        onUndone={() => {
          // Geri alma ana ekranı değiştirir (SINGLE: kalan metraj artar; FULL:
          // parent Tambur'a döner, WO + kart dirilir) — saha düzeltmesi
          // (`onApplied`) ile AYNI tazeleme sözleşmesi.
          void refetchActiveJob();
          qc.invalidateQueries({ queryKey: ['rolls'] });
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
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
          VARSAYILAN tür renkten çözülür: renksiz top = ham kumaş → ham etiket
          (ROLL_RAW); renkli/boyanmış = bitmiş (ROLL_FINISHED). Tambur ham kesim
          parçaları renksiz olduğundan ham etiketle basılır.
          İSTİSNA: Manuel Mod çıktısı BİTMİŞ üründür (backend statüyü açıkça
          WAREHOUSE yazar) — renksiz olsa da bitmiş etiket basılmalı; o iş türü
          `startPrint(roll, 'ROLL_FINISHED')` ile sabitler (printKind). */}
      <LabelPrinter
        roll={activePrintRoll}
        kind={
          printKind ?? (activePrintRoll?.colorId == null ? 'ROLL_RAW' : 'ROLL_FINISHED')
        }
        labelContext={labelContext}
        onDone={(printed) => {
          // Yalnız HÂLÂ güncel slotu temizle: baskı uçuştayken slota yeni top
          // (B) atandıysa onun işi kuyruktadır — A'nın bitişi B'yi ezmesin.
          if (activePrintRoll?.id === printed.id) {
            setActivePrintRoll(null);
            setPrintKind(null);
            setLabelContext(undefined);
          }
        }}
      />

      {/* Serbest Etiket Bas — topa bağlı olmayan bakım/uyarı etiketi. Sheet
          şablon + kopya seçtirir, StandaloneLabelPrinter istasyon yazıcısında basar. */}
      <StandaloneLabelSheet
        visible={standaloneOpen}
        onDismiss={() => setStandaloneOpen(false)}
        onPrint={(templateId, copies) => {
          setStandaloneOpen(false);
          setStandaloneJob({ templateId, copies });
        }}
      />
      <StandaloneLabelPrinter job={standaloneJob} onDone={() => setStandaloneJob(null)} />

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

      {/* MANUEL MOD — ürün / renk seçimi (kart yok → iş emrinden miras yok). */}
      <PickerModal
        visible={manualPicker === 'item'}
        title="Kumaş Seç"
        options={manualItemOptions}
        selectedValue={manualItemId}
        loading={manualItemsQuery.isLoading}
        numColumns={compact ? 1 : 2}
        emptyText={
          manualItemsQuery.isError ? 'Ürün listesi açılamadı' : 'Ürün bulunamadı'
        }
        onSelect={(value) => {
          setManualItemId(value);
          setManualItemLabel(
            manualItemOptions.find((o) => o.value === value)?.label ?? null,
          );
          setManualPicker(null);
        }}
        onDismiss={() => setManualPicker(null)}
      />

      <PickerModal
        visible={manualPicker === 'color'}
        title="Renk Seç"
        options={manualColorOptions}
        selectedValue={manualColorId}
        loading={manualColorsQuery.isLoading}
        numColumns={compact ? 1 : 2}
        emptyText={
          manualColorsQuery.isError ? 'Renk listesi açılamadı' : 'Renk bulunamadı'
        }
        onSelect={(value) => {
          setManualColorId(value);
          setManualColorLabel(
            manualColorOptions.find((o) => o.value === value)?.label ?? null,
          );
          setManualPicker(null);
        }}
        onDismiss={() => setManualPicker(null)}
      />

      {/* MANUEL MOD — işlem nedeni: hazır kategoriler + 'Diğer' serbest metin.
          Serbest yazım KALDIRILMADI, İKİNCİ PLANA alındı: kataloğa girmeyen
          gerçek bir durum olabilir ve sistem operatörü yalan söylemeye
          zorlamamalı. */}
      <PickerModal
        visible={manualPicker === 'reason'}
        title="İşlem Nedeni"
        // ⚠️ Liste artık SUNUCUDAN gelir (fabrika düzenleyebilsin) — gömülü
        // `MANUAL_REASON_PRESETS` yalnız çevrimdışı zemindir (`useReasonPresets`).
        // `value` kayda yazılan METİNDİR: bu listede satıra kod değil metin
        // gider (`Roll.entryReason`), o yüzden `fullText` seçilir.
        options={manualReasonPresets.presets.map((r) => ({
          value: r.fullText ?? r.label,
          label: r.label,
        }))}
        optionActions={
          canFieldFix
            ? (opt) => {
                const row = manualReasonPresets.presets.find(
                  (r) => (r.fullText ?? r.label) === opt.value,
                );
                if (!row || isBuiltinPreset(row)) return [];
                return [
                  {
                    icon: 'pencil-outline',
                    accessibilityLabel: `${row.label} — düzenle`,
                    onPress: () => setManualPresetEdit({ mode: 'edit', preset: row }),
                  },
                  {
                    icon: 'content-copy',
                    accessibilityLabel: `${row.label} — çoğalt`,
                    onPress: () => setManualPresetEdit({ mode: 'duplicate', preset: row }),
                  },
                ];
              }
            : undefined
        }
        selectedValue={manualReason.trim() || null}
        numColumns={1}
        emptyText="Hazır sebep yok"
        leadingAction={{
          label: 'Diğer — kendim yazayım',
          sublabel: 'Listede olmayan bir durum',
          icon: 'pencil-outline',
          onPress: () => {
            // Kutu BOŞ açılır: seçili hazır sebep taşınmaz. "Diğer" demek
            // "listedekiler değil" demektir; hazır metni düzenletmek operatörü
            // önce silmeye zorlardı.
            setManualReasonDraft('');
            setManualReasonFreeOpen(true);
          },
        }}
        quickAddSlot={
          manualReasonFreeOpen ? (
            <View style={styles.reasonFreeBox}>
              <TextInput
                mode="outlined"
                dense
                autoFocus
                value={manualReasonDraft}
                onChangeText={setManualReasonDraft}
                placeholder="Sebebi yaz (en az 3 karakter)"
                maxLength={500}
                style={styles.input}
              />
              <View style={styles.reasonFreeActions}>
                <Button mode="outlined" onPress={() => setManualReasonFreeOpen(false)}>
                  Vazgeç
                </Button>
                <Button
                  mode="contained"
                  disabled={manualReasonDraft.trim().length < MANUAL_MIN_REASON}
                  onPress={() => {
                    setManualReason(manualReasonDraft.trim());
                    setManualReasonFreeOpen(false);
                    setManualPicker(null);
                  }}
                >
                  Kaydet
                </Button>
              </View>
            </View>
          ) : null
        }
        onSelect={(value) => {
          setManualReason(value);
          setManualReasonFreeOpen(false);
          setManualPicker(null);
        }}
        onDismiss={() => {
          setManualReasonFreeOpen(false);
          setManualPicker(null);
        }}
      />

      {/* Elle ekleme sebeplerinin düzenleyicisi — Tambur fire ekranındakiyle
          AYNI bileşen; iki yüzeyde iki farklı düzenleme deneyimi olmasın. */}
      <ReasonPresetEditDialog
        visible={!!manualPresetEdit}
        mode={manualPresetEdit?.mode ?? 'edit'}
        kind="ROLL_MANUAL_ENTRY"
        preset={manualPresetEdit?.preset ?? null}
        onDismiss={() => setManualPresetEdit(null)}
        onSaved={(row) => {
          if (manualPresetEdit?.mode !== 'edit') {
            setManualReason(row.fullText ?? row.label);
            setManualPicker(null);
          }
        }}
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
          // Tür yine topun kendi kimliğinden — "Yeni Etiket" hedefi değiştirir,
          // topun ham/bitmiş olmasını değiştirmez (bkz. printKindForRoll).
          startPrint(r, printKindForRoll(r));
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
                      {(o.customerName || '?').trim().charAt(0).toLocaleUpperCase('tr')}
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
  onUndo,
  stacked,
  selectMode,
  selected,
}: {
  roll: Roll;
  onPress: () => void;
  /** "Geri Al" ikonu — Tambur işlemini iptal akışını açar (önizleme onaylı). */
  onUndo?: () => void;
  /** Telefon-dik: tek satır sığmaz → okunur 3 satırlı kart. */
  stacked?: boolean;
  /** Toplu seçim açık — satır solunda kutucuk, dokunma seçer (önizlemez). */
  selectMode?: boolean;
  selected?: boolean;
}) {
  const color = roll.color ?? null;
  const grade = roll.qualityGrade ?? '—';
  const gradeBg =
    grade === 'FIRE' ? '#fee2e2' : grade === 'A1' ? '#fef3c7' : '#dcfce7';
  // "Manuel Ekle" modunda kartsız doğan top. Listede kesim çocuklarıyla YAN YANA
  // durur (ikisi de Tambur çıktısı, ikisinin de etiketi buradan yeniden basılır),
  // ama kimlikleri farklı: birinin arkasında bir iş emri var, diğerinin yok.
  // İşaret olmasaydı operatör "bu top hangi işten çıktı" sorusuna listeye bakarak
  // yanlış cevap verirdi — satırdaki iş emri alanı manuel topta boştur.
  const isManual = roll.entrySource === 'TAMBUR_MANUAL';
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
            {isManual && (
              <View style={relabelStyles.manualPill}>
                <Text style={relabelStyles.manualPillText}>MANUEL</Text>
              </View>
            )}
            {onUndo && (
              <IconButton
                icon="undo-variant"
                size={22}
                iconColor="#b45309"
                onPress={onUndo}
                style={{ margin: 0 }}
                accessibilityLabel="İşlemi geri al"
              />
            )}
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
            {/* Telefon-dik: ayrı sütun yok → metrajın yanında (ayraçla). */}
            {`  ·  ${formatOutputDate(roll.createdAt)}`}
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
      {/* TABLO DÜZENİ (2026-08-04): kalite · barkod · kumaş · renk · en · metraj.
          Kumaş+renk ve metraj+en eskiden tek metinde birleşikti ("A · 330 cm"
          gibi) — sütunlara ayrıldı, ayraçlarla ayrıştırıldı. */}
      <View style={relabelStyles.rowInner}>
        {/* Seçim kutucuğu — YALNIZ seçim modunda. Kapalıyken satır bugünküyle
            bayt-bayt aynı çizilir (kolon genişlikleri kaymasın). */}
        {selectMode && (
          <Icon
            source={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={22}
            color={selected ? '#1e40af' : '#94a3b8'}
          />
        )}
        <View style={[relabelStyles.gradePill, { backgroundColor: gradeBg }]}>
          <Text style={relabelStyles.gradePillText}>{grade}</Text>
        </View>
        <Text style={relabelStyles.rowBarcode} numberOfLines={1}>
          {roll.barcode ?? '—'}
        </Text>
        {isManual && (
          <View style={relabelStyles.manualPill}>
            <Text style={relabelStyles.manualPillText}>MANUEL</Text>
          </View>
        )}
        <View style={relabelStyles.colItem}>
          <Text style={relabelStyles.colItemText} numberOfLines={1}>
            {roll.item?.name ?? '—'}
          </Text>
        </View>
        <View style={relabelStyles.colColor}>
          {color && (
            <View
              style={[
                relabelStyles.colorDot,
                { backgroundColor: color.hex ?? '#e2e8f0' },
              ]}
            />
          )}
          <Text style={relabelStyles.colMutedText} numberOfLines={1}>
            {color?.name ?? '—'}
          </Text>
        </View>
        <View style={relabelStyles.colWidth}>
          <Text style={relabelStyles.colMutedText}>
            {roll.width != null ? `${Number(roll.width).toFixed(0)} cm` : '—'}
          </Text>
        </View>
        {/* ÜRETİM ANI — gün + saat (2026-08-09 saha isteği).
            ⚠️ `createdAt` kullanılır, `updatedAt` DEĞİL: bu liste "bu top ne
            zaman ÇIKTI" sorusuna bakar. `updatedAt` etiket yeniden basımında da
            değişir ve sıralamayı yalanlar (envanter kuralı: listede TEK tarih
            kolonu görünür ve SIRALANAN kolonun aynısıdır — liste
            `createdAt desc` sıralı). Vardiya içi ayırt etmek için saat şart. */}
        <View style={relabelStyles.colDate}>
          <Text style={relabelStyles.colMutedText} numberOfLines={1}>
            {formatOutputDate(roll.createdAt)}
          </Text>
        </View>
        <View style={relabelStyles.colQty}>
          <Text style={relabelStyles.colQtyText}>
            {roll.currentQty != null ? `${Number(roll.currentQty).toFixed(1)} m` : '—'}
          </Text>
        </View>
        {onUndo && (
          <IconButton
            icon="undo-variant"
            size={22}
            iconColor="#b45309"
            onPress={onUndo}
            style={{ margin: 0 }}
            accessibilityLabel="İşlemi geri al"
          />
        )}
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
  // Filtre şeridi arama kutusuyla AYNI hizadan başlasın (searchRow paddingH: 12).
  filterBar: { paddingHorizontal: 12 },
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
  // "MANUEL" rozeti — kalite hapıyla aynı geometri, ama mor (aksiyon rengi):
  // kalite bir ÖLÇÜM, bu bir KÖKEN işareti; aynı renkte olsalardı operatör
  // ikisini aynı sınıf bilgi sanardı. `flexShrink: 0` → uzun ürün adı rozeti
  // ezmesin (satırda daralan taraf ürün metnidir).
  manualPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#ede9fe',
    borderWidth: 1,
    borderColor: '#c4b5fd',
    flexShrink: 0,
  },
  manualPillText: { fontSize: 10, fontWeight: '800', color: '#5b21b6' },
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
  // ── Son Çıkan Toplar tablo sütunları (RollListItem ile aynı dil) ───────────
  colItem: { flex: 1, minWidth: 0, paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: '#e2e8f0' },
  colColor: {
    width: 118,
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  colWidth: {
    width: 66,
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
    alignItems: 'flex-end',
  },
  colQty: {
    width: 82,
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
    alignItems: 'flex-end',
  },
  // Üretim anı — "GG.AA SS:dd" için yeterli, kumaş adını daha fazla kırpmayan
  // en dar genişlik.
  colDate: {
    width: 92,
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
    alignItems: 'flex-end',
  },
  colItemText: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  colMutedText: { fontSize: 13, color: '#475569', flexShrink: 1, fontVariant: ['tabular-nums'] },
  colQtyText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    fontVariant: ['tabular-nums'],
  },
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
  bulkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#eff6ff',
  },
  bulkCount: { fontSize: 14, fontWeight: '800', color: '#1e40af' },
  footerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
  },
});

/**
 * Üretim anı — "GG.AA SS:dd". Yıl BİLEREK yok: liste en yeniden eskiye sıralı
 * ve pratikte son günleri gösteriyor; yıl sütunu daralttığı için kumaş adı
 * kırpılırdı. Serbest tarih filtresi zaten hangi aralığa bakıldığını söylüyor.
 */
function formatOutputDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * ARŞİV (emekli) statüleri — backend `K18_DEAD_STATUSES` ile aynı küme.
 *
 * ⚠️ Mobil backend'i import EDEMEZ (bağımsız proje), bu yüzden liste burada
 * AYNALANIR. Backend'e yeni bir emekli statü eklenirse burası da güncellenmeli;
 * ayrışırsa arşiv topu tarama yolundan sızar ve etiketi basılabilir hale gelir.
 */
const ARCHIVED_ROLL_STATUSES: string[] = [
  'TAMBUR_CONSUMED',
  'SUBCONTRACTOR_CONSUMED',
  'KARTELA_CONSUMED',
  'CANCELLED',
];

/** Operatöre "neden basılamıyor" sorusunu somut cevaplar — sessiz ret en kötüsü. */
function archivedStatusText(status: string): string {
  switch (status) {
    case 'TAMBUR_CONSUMED':
      return 'kesilerek tüketildi';
    case 'SUBCONTRACTOR_CONSUMED':
      return 'fasona gitti';
    case 'KARTELA_CONSUMED':
      return 'kartelaya ayrıldı';
    case 'CANCELLED':
      return 'iptal edildi';
    default:
      return status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tambur'dan çıkmış son toplar listesi — etiketleri sonradan tekrar basmak için
// ─────────────────────────────────────────────────────────────────────────────
function RecentOutputModal({
  visible,
  onDismiss,
  onPrint,
  onNewLabel,
  onPrintStock,
  onBulkPrint,
  onUndone,
}: {
  visible: boolean;
  onDismiss: () => void;
  /** "Bas" — mevcut etiketi aynen tekrar bas. */
  onPrint: (roll: Roll) => void;
  /** "Yeni Etiket" — yönlendir (kime? → yeni etiket). */
  onNewLabel: (roll: Roll) => void;
  /**
   * TOPLU baskı (2026-08-09) — seçili topların etiket hedefi YAZILDIKTAN sonra
   * çağrılır. Yeni bir toplu baskı yolu yazılmadı: ekranın kanıtlanmış tekil
   * baskı kuyruğuna (`pendingPrintRolls`) verilir, sırayla basar.
   */
  onBulkPrint: (rolls: Roll[]) => void;
  /** "Müşterisiz (Stok)" — müşteri bilgisi olmadan bas. */
  onPrintStock: (roll: Roll) => void;
  /**
   * GERİ AL başarıyla uygulandı — EKRANI da tazele (2026-08-04 saha bulgusu).
   *
   * Bu modal kendi listesini `q.refetch()` ile yeniliyordu ama geri alma ANA
   * EKRANI da değiştirir: SINGLE'da metraj parent'a geri döner (kalan artar),
   * FULL'de parent Tambur adımına geri gelir ve kapanmış iş emri + refakat kartı
   * dirilir. Bu bileşenin `refetchActiveJob`'a erişimi olmadığı için ekran bayat
   * kalıyor ve operatör elle "yenile"ye basmak zorunda kalıyordu.
   */
  onUndone: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const isCompactPortrait = winH > winW;
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  // Modal kapanınca aramayı sıfırla — sonraki açılış temiz başlasın.
  useEffect(() => {
    if (!visible) {
      setSearch('');
      // Filtre de sıfırlanır: sonraki açılış "her şey" ile başlasın. Aksi hâlde
      // operatör dün "Bugün" seçip kapatır, ertesi gün listeyi boş bulup
      // "kayıtlar kayboldu" derdi (filtre şeridi ekranın üstünde ama küçük).
      setFilter(EMPTY_ROLL_FILTER);
      setOnlyMyMachine(false);
    }
  }, [visible]);

  // ── Filtre (zaman + kumaş + personel) — KK1 "Tüm Girişler" ile ORTAK bileşen ──
  // Süzme SUNUCUDA: liste cursor'lu sonsuz kaydırma, istemcide süzmek yalnız
  // o anki sayfayı süzer ve operatör "kayıt yok" sanardı.
  const [filter, setFilter] = useState<RollHistoryFilterState>(EMPTY_ROLL_FILTER);
  // "BU MAKİNE" (2026-08-12 saha isteği): İKİ aktif Tambur makinesi var ve bu
  // liste HEPSİNİN kesimlerini gösterir (varsayılan korunur — "hepsi görünüyorsa
  // aynen kalsın" kararı). Tuş, listeyi oturumun makinesine daraltır; makinesi
  // olmayan oturumda (teorik) tuş hiç çizilmez.
  const [onlyMyMachine, setOnlyMyMachine] = useState(false);
  const sessionMachineId = useSessionStore((st) => st.active?.machineId ?? null);
  // Personel seçenekleri: top yaratmış kullanıcılar (KK1 lookup'ının aynısı).
  // 2+ seçenek yoksa çip çizilmez — tek kişilik listede ayırt edeceği şey yok.
  const operatorsQuery = useQuery({
    queryKey: ['rolls', 'entry-users'],
    queryFn: () => rollService.getEntryUsers(),
    enabled: visible,
    staleTime: 5 * 60 * 1000,
  });
  const operatorOptions = useMemo<PickerOption[] | undefined>(() => {
    const rows = operatorsQuery.data?.data ?? [];
    if (rows.length < 2) return undefined;
    return rows.map((u) => ({ value: u.id, label: u.name, sublabel: u.code ?? undefined }));
  }, [operatorsQuery.data]);
  const filterKey = filterQueryKey(filter);
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
    queryKey: ['tambur', 'recent-output-rolls', debouncedSearch, filterKey, onlyMyMachine],
    queryFn: ({ pageParam }) => {
      // Gün sınırı SORGU ANINDA çözülür — `now` anahtara girmez.
      const fp = buildRollQueryParams(filter, new Date());
      return tamburService.recentOutputRolls({
        limit: 30,
        cursor: pageParam,
        search: debouncedSearch || undefined,
        withTotal: !pageParam,
        dateFrom: fp.dateFrom,
        dateTo: fp.dateTo,
        itemId: fp.filters.itemId,
        createdById: fp.filters.createdById,
        createdMachineId: onlyMyMachine && sessionMachineId ? sessionMachineId : undefined,
      });
    },
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

  // ── TOPLU SEÇİM (2026-08-09) ────────────────────────────────────────────
  // Saha isteği: *"son çıkan etiketleri toplu seçim yapıp etiketleri
  // çıkarabilelim, istersek toplu müşteri de değişebilelim. Kuşakları değişen
  // ürünlerin toplu etiket çıkarıp yenilenmesi gerekebilir."*
  //
  // AKIŞ (kullanıcı kararı): seç → "Kime?" sor → hepsine YAZ → hepsini BAS.
  // Ayrı "müşteri değiştir" butonu YOK — "değiştirdim ama basmayı unuttum"
  // durumu doğmasın diye tek akış.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTargetOpen, setBulkTargetOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Modal kapanınca seçim TEMİZLENİR — bir sonraki açılışta bayat seçimle
  // karşılaşmak, yanlış topa etiket basmanın en kolay yoludur.
  useEffect(() => {
    if (!visible) {
      setSelectMode(false);
      setSelected(new Set());
    }
  }, [visible]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Seçimin ilk topu = "Kime?" sheet'inin bağlamı (sipariş listesi ona göre
  // süzülür). Seçim KARIŞIK spec taşıyorsa sipariş kalemi hedefi anlamsızdır —
  // kalem tek bir spec'e aittir ve farklı spec'li toplara yazmak sessizce
  // yanlış tahsis üretirdi.
  const selectedRolls = useMemo(
    () => rolls.filter((r) => selected.has(r.id)),
    [rolls, selected],
  );
  const bulkFirst = selectedRolls[0] ?? null;
  const bulkMixedSpec = useMemo(() => {
    if (selectedRolls.length < 2) return false;
    const key = (r: Roll) => `${r.itemId}|${r.colorId ?? ''}|${r.width ?? ''}`;
    const first = key(selectedRolls[0]!);
    return selectedRolls.some((r) => key(r) !== first);
  }, [selectedRolls]);

  /** Seçili topların hedefini yaz, sonra hepsini baskı kuyruğuna ver. */
  const applyBulkTarget = async (ctx: LabelTargetContext | undefined) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await labelService.seedSnapshotBulk(ids, {
        orderLineId: ctx?.orderLineId ?? null,
        customerId: ctx?.customerId ?? null,
        stock: ctx?.stock === true,
      });
      const { seeded, failed } = res.data;
      // ⚠️ ATLANANLAR YUTULMAZ. "42 yazıldı" deyip 8'inin sebebini söylememek
      // en kötü davranıştır (kurşun toplu dağıtımıyla aynı kural).
      if (failed.length) {
        Toast.show({
          type: 'error',
          text1: `${failed.length} top atlandı`,
          text2: failed
            .slice(0, 3)
            .map((f: { barcode: string | null; reason: string }) => `${f.barcode ?? '?'}: ${f.reason}`)
            .join(' · '),
          visibilityTime: 8000,
        });
      }
      if (seeded.length) {
        // Baskı: yeni bir toplu yol YAZILMADI — ekranın kanıtlanmış tekil
        // baskı kuyruğu (`pendingPrintRolls`) kullanılır, sırayla basar.
        const seededSet = new Set(seeded);
        onBulkPrint(rolls.filter((r) => seededSet.has(r.id)));
        Toast.show({
          type: 'success',
          text1: `${seeded.length} topun etiketi yenileniyor`,
        });
      }
      setSelected(new Set());
      setSelectMode(false);
      void q.refetch();
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Toplu işlem başarısız', text2: (e as Error).message });
    } finally {
      setBulkBusy(false);
      setBulkTargetOpen(false);
    }
  };

  // "Geri Al" — Tambur kesim/finalize iptali (önizleme onaylı, yıkıcı-işlem kuralı).
  const [undoTarget, setUndoTarget] = useState<Roll | null>(null);

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
      // ⚠️ ARŞİV KORUMASI (2026-08-09). Liste zaten emekli statüleri gizliyor
      // (`status notIn K18_DEAD_STATUSES`) ama TARAMA yolu o süzgeci hiç
      // geçmiyordu: arşivdeki topun önizlemesi açılıyor ve ETİKETİ BASILABİLİYORDU
      // — fiziksel olarak var olmayan topun etiketi kumaşa yapıştırılabilirdi.
      if (ARCHIVED_ROLL_STATUSES.includes(roll.status)) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Toast.show({
          type: 'error',
          text1: 'Bu top arşivde',
          text2: `${trimmed} — ${archivedStatusText(roll.status)}. Etiket basılamaz.`,
          visibilityTime: 5000,
        });
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
        title="Son Çıkan Toplar"
        icon="printer-search"
        iconColor="#1e40af"
        headerTint="#dbeafe"
        // Tabloya geçince 6 sütun oldu (kalite·barkod·kumaş·renk·en·metraj) —
        // %50 dar kalıyordu, kumaş adı sürekli kırpılıyordu.
        widthRatio={isCompactPortrait ? 0.96 : 0.78}
        heightRatio={isCompactPortrait ? 0.9 : 0.85}
        loading={q.isLoading}
        fetching={q.isFetching && !q.isFetchingNextPage}
        isError={q.isError}
        errorMessage={(q.error as Error | undefined)?.message}
        onRefresh={() => q.refetch()}
        successMessage="Son çıkan toplar güncellendi"
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
          <View>
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
              disabled={scanResolving || selectMode}
              accessibilityLabel="Kameradan okut"
              style={relabelStyles.scanBtn}
            />
            {/* Seçim modu anahtarı — "kuşağı değişen ürünlerin toplu
                yenilenmesi" için. Kapalıyken ekran bugünküyle aynı. */}
            <IconButton
              icon={selectMode ? 'close' : 'checkbox-multiple-marked-outline'}
              mode="contained"
              size={26}
              containerColor={selectMode ? '#b45309' : '#475569'}
              iconColor="#fff"
              onPress={() => {
                setSelectMode((v) => !v);
                setSelected(new Set());
              }}
              accessibilityLabel={selectMode ? 'Seçimi kapat' : 'Toplu seçim'}
              style={relabelStyles.scanBtn}
            />
            </View>
            {/* Ortak filtre şeridi — KK1 "Tüm Girişler" ile AYNI bileşen.
                style: arama kutusuyla AYNI 12px iç boşluk (searchRow) — şerit
                soldan taşmış görünüyordu (2026-08-12 saha bulgusu). */}
            <RollFilterBar
              value={filter}
              onChange={setFilter}
              itemOptions={itemOptions}
              itemsLoading={itemsQuery.isLoading}
              onItemPickerOpen={() => void itemsQuery.refetch()}
              operatorOptions={operatorOptions}
              operatorsLoading={operatorsQuery.isLoading}
              style={relabelStyles.filterBar}
              extraChips={
                sessionMachineId
                  ? [
                      {
                        key: 'my-machine',
                        label: 'Bu makine',
                        icon: 'robot-industrial',
                        active: onlyMyMachine,
                        onPress: () => setOnlyMyMachine((v) => !v),
                      },
                    ]
                  : []
              }
            />
          </View>
        }
        footer={
          selectMode ? (
            /* SEÇİM ÇUBUĞU — sayaç + tek aksiyon. Ayrı "müşteri değiştir"
               butonu YOK: tek akış (seç → Kime? → yaz + bas). */
            <View style={relabelStyles.bulkBar}>
              <Text style={relabelStyles.bulkCount}>{selected.size} top seçili</Text>
              <View style={{ flex: 1 }} />
              <Button
                mode="text"
                compact
                onPress={() => {
                  setSelectMode(false);
                  setSelected(new Set());
                }}
                disabled={bulkBusy}
              >
                Vazgeç
              </Button>
              <Button
                mode="contained"
                icon="printer"
                compact
                disabled={selected.size === 0 || bulkBusy}
                loading={bulkBusy}
                onPress={() => setBulkTargetOpen(true)}
                buttonColor="#1e40af"
              >
                Etiket Bas
              </Button>
            </View>
          ) : total != null ? (
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
          // SEÇİM MODUNDA dokunma anlamı DEĞİŞİR: önizleme yerine seç/bırak.
          // Aynı dokunuşun iki anlamı olması kafa karıştırır, o yüzden mod
          // açıkken satır aksiyonları (geri al) da çizilmez.
          <RelabelRollRow
            roll={roll}
            stacked={isCompactPortrait}
            selectMode={selectMode}
            selected={selected.has(roll.id)}
            onPress={() => (selectMode ? toggleSelect(roll.id) : setPreviewRoll(roll))}
            onUndo={selectMode ? undefined : () => setUndoTarget(roll)}
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

      {/* Geri Al — önizleme onaylı Tambur iptali. Bitince liste tazelenir. */}
      <TamburUndoConfirmModal
        rollId={undoTarget?.id ?? null}
        barcode={undoTarget?.barcode ?? null}
        onDismiss={() => setUndoTarget(null)}
        onDone={() => {
          setUndoTarget(null);
          void q.refetch(); // bu modalın kendi "Çıkanlar" listesi
          onUndone(); // ana ekran: aktif iş + kalan metraj + top listeleri
        }}
      />

      {/* TOPLU "Kime?" — seçili topların hepsine AYNI hedef yazılır.
          Bağlam olarak ilk seçili top verilir (sipariş listesi onun spec'ine
          göre süzülür); seçim karışık spec taşıyorsa sheet sipariş kalemini
          HİÇ göstermez ve yalnız müşteri/stok seçtirir. */}
      <LabelTargetSheet
        roll={
          bulkTargetOpen && bulkFirst
            ? {
                id: bulkFirst.id,
                barcode: bulkFirst.barcode,
                itemId: bulkFirst.itemId,
                colorId: bulkFirst.colorId,
                width: bulkFirst.width != null ? Number(bulkFirst.width) : null,
                itemName: bulkFirst.item?.name,
                colorName: bulkFirst.color?.name ?? null,
                lastLabelSnapshot: null,
              }
            : null
        }
        bulkCount={selected.size}
        mixedSpec={bulkMixedSpec}
        onCancel={() => setBulkTargetOpen(false)}
        onConfirm={(ctx) => void applyBulkTarget(ctx)}
      />

      {/* Kameradan üretilen topu okut → çözülünce o topun önizlemesi açılır. */}
      <BarcodeScannerModal
        visible={scanOpen}
        title="Çıkan Topu Okut"
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
                    {/* TABLO DÜZENİ (2026-08-04): iş emri no · kumaş · renk · top ·
                        bekleme. İŞ EMRİ NO İKİ KEZ yazılıyordu — `cardNumber` ile
                        `batchNumber` alanlarının İKİSİ DE iş emri numarasını
                        taşıyor (backend tambur.service.ts:1744 `batchNumber:
                        s.workOrder.workOrderNumber`), biri kaldırıldı. İstasyon adı
                        da düştü: sorgu zaten yalnız TAMBUR adımlarını getiriyor
                        (:1690), her satırda aynı değer yazıyordu. */}
                    <View style={cameraStyles.rowInner}>
                      <Text style={cameraStyles.rowCardNo} numberOfLines={1}>
                        {item.cardNumber}
                      </Text>
                      <View style={cameraStyles.rowColItem}>
                        <Text style={cameraStyles.rowItemText} numberOfLines={1}>
                          {item.itemName ?? '—'}
                        </Text>
                      </View>
                      <View style={cameraStyles.rowColColor}>
                        <Text style={cameraStyles.rowMutedText} numberOfLines={1}>
                          {item.colorName ?? '—'}
                        </Text>
                      </View>
                      <View style={cameraStyles.rowColCount}>
                        <Text style={cameraStyles.rowStrongText}>
                          {item.openRollCount} top
                        </Text>
                      </View>
                      <View style={cameraStyles.rowColWait}>
                        <Text style={cameraStyles.rowMutedText} numberOfLines={1}>
                          {item.oldestEnteredAt
                            ? formatRelativeWait(item.oldestEnteredAt)
                            : '—'}
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
        {/* TEK SATIR, TABLO DÜZENİ (2026-08-04 saha isteği): kumaş · renk · en ·
            boy. Barkod/UUID kısaltması ve üretim özellikleri KALDIRILDI —
            operatörün seçim kararına girmiyorlar (barkodsuz açık kumaşta zaten
            `4baa35e7` gibi anlamsız bir kimlik parçası basılıyordu). Satır tek
            satır ama iki satırlık YÜKSEKLİKTE (minHeight): eldivenli parmakla
            seçimi kolay kalsın. Sütunlar dikey ayraçlarla ayrılır. */}
        <View style={helperStyles.rollInner}>
          <View style={helperStyles.rollIndex}>
            <Text style={helperStyles.rollIndexText}>{index + 1}</Text>
          </View>

          {/* KUMAŞ — esneyen sütun (uzun ad kırpılır, komşuyu ezmez) */}
          <View style={helperStyles.rollColName}>
            <Text style={helperStyles.rollItemName} numberOfLines={1}>
              {roll.itemName}
            </Text>
            {/* Hata işareti: sayı/metin YOK, yalnız uyarı üçgeni. Ayrı sütun
                açmadan sinyali korur; ayrıntı top seçilince "Hata Noktaları"
                bölümünde okunur. */}
            {roll.errorCount > 0 && (
              <Icon source="alert-circle" size={14} color="#dc2626" />
            )}
          </View>

          {/* RENK */}
          <View style={helperStyles.rollColColor}>
            <Text style={helperStyles.rollColorText} numberOfLines={1}>
              {roll.colorName ?? '—'}
            </Text>
          </View>

          {/* EN */}
          <View style={helperStyles.rollColWidth}>
            <Text style={helperStyles.rollWidth}>
              {roll.width != null ? `${roll.width} cm` : '—'}
            </Text>
          </View>

          {/* BOY (metraj) — kararın ana sayısı, en belirgin sütun */}
          <View style={helperStyles.rollColMeter}>
            <Text style={helperStyles.rollMeter}>
              {roll.currentQty.toFixed(1)} mt
            </Text>
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
  canEditPresets,
}: {
  visible: boolean;
  remainingQty: number;
  onDismiss: () => void;
  onChoose: (
    action: TamburFinalizeRemainingAction,
    reasonCode: string | null,
    reasonText: string | null,
  ) => void;
  loading: boolean;
  onModalHide?: () => void;
  /** Hazır mesajları düzenleme/çoğaltma yetkisi (Tambur düzeltme yetkisi). */
  canEditPresets?: boolean;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  // Sebep sorulacak karar (fire / kayıt düzeltmesi) seçilince adım 2'ye geçilir.
  const [pending, setPending] = useState<'scrap' | 'discard' | null>(null);
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');
  // Düzenleyici — hangi satır, hangi kip (düzenle / çoğalt / yeni).
  const [editing, setEditing] = useState<{ mode: ReasonPresetEditMode; preset: ReasonPreset | null } | null>(null);

  // Katalog SUNUCUDAN gelir (fabrika düzenleyebilsin); çevrimdışında diskteki
  // son liste, o da yoksa APK'ya gömülü zemin kullanılır — sebep zorunlu bir
  // alan olduğu için liste ASLA boş kalmamalı.
  const scrapPresets = useReasonPresets('ROLL_SCRAP');
  const correctionPresets = useReasonPresets('ROLL_RECORD_CORRECTION');
  const presets = pending === 'discard' ? correctionPresets.presets : scrapPresets.presets;
  const presetKind = pending === 'discard' ? 'ROLL_RECORD_CORRECTION' : 'ROLL_SCRAP';
  // Serbest metin kutusunun bağlanacağı satır ("Diğer"). Katalogdan gizlenmiş
  // olabilir — o zaman yazılan metin seçili koda NOT olarak eklenir.
  const freeTextPreset = presets.find((r) => r.requiresText) ?? null;
  const selected = presets.find((r) => r.code === reasonCode) ?? null;
  // ⚠️ EN ÜSTTEKİ KUTUYA YAZMAK, hazır liste yerine serbest metni seçmek demektir:
  // operatör yazmaya başlayınca "Diğer" KENDİLİĞİNDEN seçilir. Aksi halde
  // metni yazıp "Kaydet"in hâlâ kapalı olduğunu görürdü (eski akışta serbest
  // kutu listenin ALTINDA ve yalnız "Diğer" seçiliyse görünüyordu).
  // Modal her kapanışta sıfırlanır — bir sonraki top temiz başlasın, yoksa
  // önceki topun sebebi sessizce yeni karara yapışırdı.
  useEffect(() => {
    if (!visible) {
      setPending(null);
      setReasonCode(null);
      setReasonText('');
      setEditing(null);
    }
  }, [visible]);
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

        {/* ADIM 1 — karar. `keep_*` sapma DEĞİLDİR ve tek dokunuşta biter;
            sebep yalnız fire / kayıt düzeltmesinde sorulur (adım 2). */}
        {pending === null ? (
          <View style={{ padding: 16, gap: 10 }}>
            <Text style={{ color: '#475569', fontSize: 13 }}>
              Bu açık kumaştan kalan {qtyText} kumaşı nasıl kaydedeyim?
            </Text>
            <Button
              mode="contained"
              icon="check-circle"
              onPress={() => onChoose('keep_1kalite', null, null)}
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
              onPress={() => onChoose('keep_a1', null, null)}
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
              onPress={() => setPending('scrap')}
              disabled={loading}
              buttonColor="#dc2626"
              contentStyle={{ paddingVertical: 6 }}
              labelStyle={{ fontSize: 15, fontWeight: '700' }}
            >
              Fire Top Yap ({qtyText})
            </Button>
            {/* ⚠️ ESKİ AD "Kayıt Dışı (Operatör Attı)" İDİ ve yanıltıyordu:
                "attı" fire çağrıştırıyor, oysa bu kararın anlamı "bu metraj
                fiziksel olarak HİÇ YOKTU". İkisini aynı kovaya atmak fire
                oranını sistematik olarak şişirir (bkz. RollVarianceKind). */}
            <Button
              mode="outlined"
              icon="clipboard-edit-outline"
              onPress={() => setPending('discard')}
              disabled={loading}
              textColor="#475569"
              contentStyle={{ paddingVertical: 6 }}
              labelStyle={{ fontSize: 14 }}
            >
              Kayıt Düzeltmesi ({qtyText} aslında yoktu)
            </Button>
          </View>
        ) : (
          /* ADIM 2 — SEBEP. Hazır katalog: eldivenli operatör vardiya ortasında
             metin yazmıyor, "aaa" yazıyor ve o boş bırakmaktan kötüdür. */
          <View style={{ padding: 16, gap: 8 }}>
            <Text style={{ color: '#0f172a', fontSize: 14, fontWeight: '700' }}>
              {pending === 'scrap'
                ? `${qtyText} FİRE — sebep nedir?`
                : `${qtyText} KAYIT DÜZELTMESİ — sebep nedir?`}
            </Text>
            <Text style={{ color: '#64748b', fontSize: 12, marginBottom: 2 }}>
              {pending === 'scrap'
                ? 'Mal vardı ama kullanılamaz. Fire oranına girer.'
                : 'Bu metraj fiziksel olarak hiç yoktu — kayıt yanlıştı. Fire DEĞİLDİR.'}
            </Text>
            {/* ── SERBEST METİN EN ÜSTTE (2026-08-19 saha isteği) ──────────
                Eskiden kutu listenin ALTINDAYDI ve yalnız "Diğer" seçilince
                görünüyordu: kendi cümlesini yazmak isteyen operatör önce sekiz
                satırı geçip en dibe iniyor, sonra kutuyu bulmak için ikinci kez
                kaydırıyordu. Artık ilk eleman o; yazmaya başlamak "Diğer"i
                kendiliğinden seçer. Hazır mesajlar hemen ALTINDA başlar. */}
            <TextInput
              mode="outlined"
              dense
              placeholder={
                freeTextPreset
                  ? 'Kendin yaz (en az 3 karakter) — ya da aşağıdan seç'
                  : 'Açıklama (isteğe bağlı)'
              }
              value={reasonText}
              onChangeText={(t) => {
                setReasonText(t);
                // Yazmaya başlayınca serbest metin satırı seçilir; kutu
                // temizlenirse seçim de bırakılır (operatör vazgeçti).
                if (freeTextPreset) {
                  if (t.trim() && reasonCode !== freeTextPreset.code) setReasonCode(freeTextPreset.code);
                  else if (!t.trim() && reasonCode === freeTextPreset.code) setReasonCode(null);
                }
              }}
              disabled={loading}
              style={{ backgroundColor: '#fff' }}
              left={<TextInput.Icon icon="pencil-outline" />}
            />

            {presets.map((r) => {
              const active = reasonCode === r.code;
              const editable = canEditPresets && !isBuiltinPreset(r);
              return (
                <View key={r.code} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <TouchableRipple
                    onPress={() => {
                      setReasonCode(r.code);
                      // Hazır satıra geçildiyse serbest metin NOT olarak kalır;
                      // "Diğer"den çıkıldığında da silinmez — operatör yazdığı
                      // cümleyi kaybetmemeli.
                    }}
                    disabled={loading}
                    style={{
                      flex: 1,
                      minHeight: 52,
                      justifyContent: 'center',
                      paddingHorizontal: 14,
                      borderRadius: 10,
                      borderWidth: active ? 2 : 1,
                      borderColor: active ? '#1d4ed8' : '#cbd5e1',
                      backgroundColor: active ? '#eff6ff' : '#fff',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: active ? '700' : '500',
                        color: active ? '#1d4ed8' : '#334155',
                      }}
                    >
                      {r.label}
                    </Text>
                  </TouchableRipple>
                  {editable && (
                    <>
                      <IconButton
                        icon="pencil-outline"
                        size={20}
                        disabled={loading}
                        onPress={() => setEditing({ mode: 'edit', preset: r })}
                        style={{ margin: 0 }}
                        accessibilityLabel={`${r.label} — düzenle`}
                      />
                      <IconButton
                        icon="content-copy"
                        size={20}
                        disabled={loading}
                        onPress={() => setEditing({ mode: 'duplicate', preset: r })}
                        style={{ margin: 0 }}
                        accessibilityLabel={`${r.label} — çoğalt`}
                      />
                    </>
                  )}
                </View>
              );
            })}

            {canEditPresets && (
              <Button
                mode="text"
                icon="plus"
                compact
                disabled={loading}
                onPress={() => setEditing({ mode: 'create', preset: null })}
                labelStyle={{ fontSize: 13 }}
              >
                Yeni sebep ekle
              </Button>
            )}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <Button
                mode="outlined"
                onPress={() => {
                  setPending(null);
                  setReasonCode(null);
                  setReasonText('');
                }}
                disabled={loading}
                style={{ flex: 1 }}
                contentStyle={{ paddingVertical: 6 }}
              >
                Geri
              </Button>
              <Button
                mode="contained"
                onPress={() => onChoose(pending, reasonCode, reasonText.trim() || null)}
                // Sebep seçilmeden "Kaydet" AÇIK OLMAZ: backend eski istemciler
                // için sebepsiz çağrıyı kabul ediyor ("BELIRTILMEDI"), ama YENİ
                // istemcinin o kovaya yazması özelliği anlamsızlaştırırdı.
                // ⚠️ Geçerlilik artık DİNAMİK listeden çözülür: kural
                // (`isVarianceReasonValid`) gömülü katalogda olmayan yeni bir
                // fabrika sebebini "katalog dışı" sayıp Kaydet'i sonsuza dek
                // kapalı bırakırdı.
                disabled={
                  loading ||
                  !reasonCode ||
                  (!!selected?.requiresText && reasonText.trim().length < VARIANCE_MIN_REASON_TEXT)
                }
                loading={loading}
                buttonColor={pending === 'scrap' ? '#dc2626' : '#475569'}
                style={{ flex: 2 }}
                contentStyle={{ paddingVertical: 6 }}
                labelStyle={{ fontSize: 15, fontWeight: '700' }}
              >
                Kaydet
              </Button>
            </View>
          </View>
        )}
      </View>

      {/* Hazır mesaj düzenleyici — aynı bileşen "düzenle", "çoğalt" ve "yeni"
          kiplerini taşır; sunucu kaydı yapıp katalogu tazeler. */}
      <ReasonPresetEditDialog
        visible={!!editing}
        mode={editing?.mode ?? 'edit'}
        kind={presetKind}
        preset={editing?.preset ?? null}
        onDismiss={() => setEditing(null)}
        onSaved={(row) => {
          // Yeni/çoğaltılmış satır ANINDA seçili gelsin — operatör onu eklemek
          // için zaten buradaydı, listede ikinci kez aramamalı.
          if (editing?.mode !== 'edit') setReasonCode(row.code);
        }}
      />
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

/**
 * Tambur GERİ AL onay modalı — yıkıcı-işlem kuralı: etkilenen HER kayıt somut
 * listelenir (parça barkodları + dönen metraj + yeniden açılacak hatalar + WO
 * diriltme uyarısı). Mod (SINGLE/FULL) backend'de çözülür; canApply=false ise
 * yalnız sebep gösterilir, uygula düğmesi kapalıdır.
 */
function TamburUndoConfirmModal({
  rollId,
  barcode,
  onDismiss,
  onDone,
}: {
  rollId: string | null;
  barcode: string | null;
  onDismiss: () => void;
  onDone: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const phone = winW < 600;
  const qc = useQueryClient();

  // MOD ARTIK OPERATÖRDEN (2026-08-09). Backend `options[]` ile yapılabilecek
  // her modu anlatır; burada seçilir. `null` = henüz seçilmedi → backend'in
  // `defaultMode`u (her zaman EN DAR olan) kullanılır.
  const [mode, setMode] = useState<TamburUndoMode | null>(null);
  const [fullReason, setFullReason] = useState('');
  useEffect(() => {
    if (rollId === null) {
      setMode(null);
      setFullReason('');
    }
  }, [rollId]);

  const previewQ = useQuery({
    queryKey: ['tambur', 'undo-preview', rollId, mode],
    queryFn: () => tamburService.undoPreview(rollId!, mode ?? undefined),
    enabled: !!rollId,
    staleTime: 0,
    gcTime: 0,
    // Mod değişince önceki görünüm dursun — kart seçiminde modal titremesin.
    placeholderData: keepPreviousData,
  });
  const preview: TamburUndoPreview | null = previewQ.data?.data ?? null;
  const effectiveMode = mode ?? preview?.defaultMode ?? null;
  const needsReason =
    preview?.options?.find((o) => o.mode === effectiveMode)?.requiresReason ?? false;

  const applyMut = useMutation({
    mutationFn: () =>
      tamburService.applyUndo(rollId!, {
        mode: effectiveMode ?? undefined,
        reason: fullReason.trim() || undefined,
      }),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'İşlem geri alındı', text2: res.message });
      void qc.invalidateQueries({ queryKey: ['tambur'] });
      void qc.invalidateQueries({ queryKey: ['rolls'] });
      // "Bu işten çıkanlar" paneli AYNI ANDA tazelensin — anahtarı ['rolls']
      // altında değil ve operatör kesimden sonra kendi topunu panelde
      // GÖREMEYİNCE elle yenilemek zorunda kalıyordu (2026-08-12 saha bulgusu).
      qc.invalidateQueries({ queryKey: ['tambur', 'wo-output'] });
      void qc.invalidateQueries({ queryKey: ['work-orders'] });
      onDone();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Geri alınamadı', text2: e.message });
      // Yarışta durum değişmiş olabilir — önizlemeyi tazele, operatör görsün.
      void previewQ.refetch();
    },
  });

  const isManualUndo = preview?.mode === 'MANUAL';
  // ⚠️ AÇIKLAMA ARTIK BACKEND'DEN GELİR (`option.description`). Eskiden istemci
  // kendi cümlesini kuruyordu ve `canApply`e BAKMIYORDU: engelli bir kapanışta
  // diyalog "TÜMDEN geri alınacak — tüm parçalar iptal olur" diye ilan edip
  // hemen altında "İPTAL EDİLECEK PARÇALAR (0)" ve "geri alınamaz" yazıyordu.
  // Aynı ekranda üç çelişkili cümle — sahadan gelen fotoğraf tam buydu.
  const activeOption = preview?.options?.find((o) => o.mode === effectiveMode) ?? null;
  const modeText = activeOption?.description ?? '';
  // GÖRÜNÜM KURGUSU (2026-08-12 saha geri bildirimi: "çok kalabalık" + metin
  // seti kararı):
  //  • Tek-top işlemleri (SINGLE / SINGLE_RESTORE) modalın gövdesidir. Kaynak
  //    arşivdeyse İKİ gerçek olabilir — kumaş elde (→ iş emrine geri al) ya da
  //    kayıt yanlıştı (→ iptal + kayıt düzeltmesi) — ve bunu YALNIZ operatör
  //    bilir: iki kart gösterilir, ÖN SEÇİM YOKTUR, seçilmeden onay kapalıdır.
  //  • FULL bir süpervizör aracıdır; altta ÇERÇEVELİ buton olarak durur (düz
  //    metin "tıklanabilir hissi vermiyor" — saha). Yetkisizde de görünür,
  //    dokununca engel sebebi o görünümde söylenir (kullanıcı kararı).
  const SINGLE_FAMILY: TamburUndoMode[] = ['SINGLE', 'SINGLE_RESTORE'];
  const singleChoices =
    preview?.options?.filter((o) => SINGLE_FAMILY.includes(o.mode)) ?? [];
  const fullOption = preview?.options?.find((o) => o.mode === 'FULL') ?? null;
  const inSingleFamily = effectiveMode != null && SINGLE_FAMILY.includes(effectiveMode);
  // Kart görünümü: birden fazla tekil yol varsa. Operatör henüz seçmediyse
  // (mode null) onay düğmesi kapalı kalır — yanlış varsayılanla arşive
  // yazmaktansa bir dokunuş daha iyidir.
  const showChoiceCards = inSingleFamily && singleChoices.length > 1;
  const choicePending = showChoiceCards && mode === null;

  return (
    <AppModal
      visible={rollId !== null}
      onDismiss={() => {
        if (!applyMut.isPending) onDismiss();
      }}
    >
      <View
        style={[
          undoStyles.sheet,
          { width: phone ? winW * 0.94 : Math.min(560, winW * 0.55), maxHeight: winH * 0.85 },
        ]}
      >
        <View style={undoStyles.header}>
          <View style={undoStyles.headerIcon}>
            <Icon source="undo-variant" size={20} color="#7c2d12" />
          </View>
          <Text style={undoStyles.title}>
            {isManualUndo ? 'Elle Eklenen Topu Geri Al' : 'Tambur İşlemini Geri Al'}
          </Text>
          <IconButton icon="close" size={22} onPress={onDismiss} disabled={applyMut.isPending} style={{ margin: 0 }} />
        </View>

        {previewQ.isLoading ? (
          <View style={undoStyles.loading}>
            <ActivityIndicator color="#b45309" />
          </View>
        ) : previewQ.isError ? (
          <Text style={undoStyles.blockText}>{(previewQ.error as Error).message}</Text>
        ) : preview && !preview.canApply ? (
          /* ⛔ ENGELLİ — YALNIZ SEBEP. Mod açıklaması, kaynak top metrajı ve
             parça sayacı BASILMAZ: yapılmayacak bir işi ilan eden diyalog,
             hiç açılmayan diyalogdan kötüdür (sahadan gelen fotoğraf). */
          <ScrollView contentContainerStyle={undoStyles.body}>
            {barcode ? <Text style={undoStyles.rowLine}>Okutulan: {barcode}</Text> : null}
            <Text style={undoStyles.blockText}>⛔ {preview.blockReason}</Text>
            {/* Diğer yol açıksa operatörü ÇIKMAZDA bırakma — söyle. */}
            {preview.options
              .filter((o) => o.mode !== effectiveMode && o.canApply)
              .map((o) => (
                <Button
                  key={o.mode}
                  mode="outlined"
                  onPress={() => setMode(o.mode)}
                  style={{ marginTop: 12 }}
                >
                  {o.label}
                </Button>
              ))}
          </ScrollView>
        ) : preview ? (
          <ScrollView contentContainerStyle={undoStyles.body}>
            {/* Mod HÂLÂ operatörden gelir (2026-08-08 vakasının düzeltmesi) —
                yalnız sorma biçimi duruma göre: tek yol varsa düz anlatım,
                iki tekil yol varsa seçim kartları. */}
            {showChoiceCards ? (
              <View style={{ gap: 8 }}>
                {singleChoices.map((o) => {
                  const active = mode === o.mode;
                  return (
                    <TouchableRipple
                      key={o.mode}
                      onPress={() => setMode(o.mode)}
                      disabled={applyMut.isPending}
                      style={[
                        undoStyles.choiceCard,
                        active && undoStyles.choiceCardActive,
                        !o.canApply && { opacity: 0.55 },
                      ]}
                    >
                      <View>
                        <Text
                          style={[undoStyles.choiceTitle, active && { color: '#7c2d12' }]}
                        >
                          {o.label}
                        </Text>
                        <Text style={undoStyles.choiceDesc}>
                          {o.canApply ? o.description : `⛔ ${o.blockReason}`}
                        </Text>
                      </View>
                    </TouchableRipple>
                  );
                })}
              </View>
            ) : (
              <Text style={undoStyles.modeText}>{modeText}</Text>
            )}

            {/* SINGLE'da ayrı "kaynak top" / "iptal edilecek parçalar" blokları
                BASILMAZ: tek etkilenen kayıt zaten yukarıdaki cümlede barkodu ve
                metrajıyla adlandırılıyor (yıkıcı-işlem kuralı böylece sağlanıyor).
                Aynısını ikinci kez listelemek ekranı kalabalıklaştıran şeydi. */}
            {effectiveMode === 'FULL' && (
              <>
                {barcode ? (
                  <Text style={undoStyles.rowLine}>Okutulan parça: {barcode}</Text>
                ) : null}
                <Text style={undoStyles.sectionTitle}>Kaynak top</Text>
                <Text style={undoStyles.rowLine}>
                  {preview.parent.barcode ?? 'barkodsuz açık kumaş'} — geri dönecek metraj: {preview.restoredQty} m
                </Text>
                <Text style={undoStyles.sectionTitle}>
                  İptal edilecek parçalar ({preview.children.length})
                </Text>
                {preview.children.map((c) => (
                  <Text key={c.id} style={[undoStyles.rowLine, c.blockReason ? undoStyles.blockedRow : null]}>
                    • {c.barcode ?? c.id} — {c.qty} m{c.blockReason ? `  ⛔ ${c.blockReason}` : ''}
                  </Text>
                ))}
              </>
            )}

            {/* MANUAL: iptal edilecek kayıt topun kendisi — somut listelenir. */}
            {isManualUndo && (
              <>
                <Text style={undoStyles.sectionTitle}>İptal edilecek kayıt</Text>
                {preview.children.map((c) => (
                  <Text key={c.id} style={[undoStyles.rowLine, c.blockReason ? undoStyles.blockedRow : null]}>
                    • {c.barcode ?? c.id} — {c.qty} m{c.blockReason ? `  ⛔ ${c.blockReason}` : ''}
                  </Text>
                ))}
              </>
            )}

            {preview.reopenErrorCount > 0 && (
              <Text style={undoStyles.warnText}>
                {preview.reopenErrorCount} kapatılmış hata kaydı yeniden açılacak
              </Text>
            )}
            {preview.workOrder?.willRevive && (
              <Text style={undoStyles.warnText}>
                {preview.workOrder.workOrderNumber} yeniden AÇILACAK (refakat kartı tekrar aktif)
              </Text>
            )}
            {preview.warnings.map((w) => (
              <Text key={w} style={undoStyles.warnText}>⚠ {w}</Text>
            ))}
            {/* SEBEP — yalnız tümden geri almada. İş emrinin geçmişini yeniden
                yazan bir işlem "neden" sorusunu cevapsız bırakmamalı; backend
                de sebepsiz çağrıyı 403'ler (tek kaynak: fullGateBlockReason). */}
            {needsReason && (
              <View style={{ marginTop: 10, gap: 4 }}>
                <Text style={undoStyles.sectionTitle}>Sebep (zorunlu)</Text>
                <TextInput
                  mode="outlined"
                  dense
                  placeholder="Neden tümden geri alıyorsunuz?"
                  value={fullReason}
                  onChangeText={setFullReason}
                  disabled={applyMut.isPending}
                  style={{ backgroundColor: '#fff' }}
                />
              </View>
            )}

            {/* TÜMDEN GERİ ALMA — süpervizör aracı, ÇERÇEVELİ buton (düz metin
                "tıklanabilir hissi vermiyor" — 2026-08-12 saha). Yetkisizde de
                çizilir; dokununca engel sebebi o görünümde açıkça söylenir
                ("yapılamayanı ilan etme" kuralı bozulmaz — ilan değil kapı). */}
            {effectiveMode !== 'FULL' && fullOption && (
              <Button
                mode="outlined"
                compact
                icon="undo-variant"
                textColor="#7c2d12"
                disabled={applyMut.isPending}
                onPress={() => setMode('FULL')}
                style={undoStyles.fullBtn}
              >
                {fullOption.label}
              </Button>
            )}
            {effectiveMode === 'FULL' && singleChoices.length > 0 && (
              <Button
                mode="text"
                compact
                textColor="#64748b"
                disabled={applyMut.isPending}
                onPress={() => setMode(null)}
                style={{ marginTop: 12, alignSelf: 'flex-start' }}
              >
                ‹ Tek top işlemleri
              </Button>
            )}
          </ScrollView>
        ) : null}

        <View style={undoStyles.actions}>
          <Button mode="outlined" onPress={onDismiss} disabled={applyMut.isPending} style={undoStyles.actionBtn}>
            Vazgeç
          </Button>
          <Button
            mode="contained"
            buttonColor="#b45309"
            loading={applyMut.isPending}
            disabled={
              !preview?.canApply ||
              applyMut.isPending ||
              // İki tekil yol varken operatör SEÇMEDEN onay yok — yanlış
              // varsayılanla arşive yazmaktansa bir dokunuş daha iyidir.
              choicePending ||
              // Sebep zorunluysa yazılana dek kapalı — backend zaten 403'ler,
              // ama operatörü sunucuya gidip hata yiyerek öğrenmeye zorlamak
              // kötü bir yüzeydir.
              (needsReason && fullReason.trim().length < 3)
            }
            onPress={() => applyMut.mutate()}
            style={undoStyles.actionBtn}
          >
            {/* METİN SETİ (2026-08-12 kullanıcı kararı): tuş yaptığı işin adını
                taşır — arşive yazan işleme "Geri Al" demek operatörü metrajın
                döneceğine inandırıyordu. */}
            {effectiveMode === 'FULL'
              ? 'Tümden Geri Al'
              : effectiveMode === 'SINGLE_RESTORE'
                ? 'İş Emrine Geri Al'
                : effectiveMode === 'MANUAL'
                  ? 'Kaydı İptal Et'
                  : choicePending
                    ? 'Önce seçim yapın'
                    : preview?.parentArchived
                      ? 'Topu İptal Et'
                      : 'Kesimi Geri Al'}
          </Button>
        </View>
      </View>
    </AppModal>
  );
}

const undoStyles = StyleSheet.create({
  sheet: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#ffedd5',
  },
  headerIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#fed7aa',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: '#7c2d12' },
  loading: { padding: 28, alignItems: 'center' },
  body: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  modeText: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#64748b', marginTop: 10, textTransform: 'uppercase' },
  rowLine: { fontSize: 15, color: '#334155', paddingVertical: 2 },
  blockedRow: { color: '#b91c1c' },
  warnText: { fontSize: 14, color: '#b45309', fontWeight: '600', marginTop: 6 },
  blockText: { fontSize: 15, color: '#b91c1c', fontWeight: '700', marginTop: 10, paddingHorizontal: 4 },
  // Tekil yol seçim kartları — "kumaş elde mi, kayıt mı yanlıştı" sorusunu
  // yalnız operatör bilir; kartlar o soruyu somutlaştırır. Ön seçim YOK.
  choiceCard: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  choiceCardActive: { borderWidth: 2, borderColor: '#b45309', backgroundColor: '#fff7ed' },
  choiceTitle: { fontSize: 15, fontWeight: '800', color: '#334155' },
  choiceDesc: { fontSize: 13, color: '#64748b', marginTop: 2 },
  // "Tüm işlemi geri al" — çerçeveli süpervizör butonu (düz metin bağlantı
  // tıklanabilir hissi vermiyordu, 2026-08-12 saha).
  fullBtn: { marginTop: 14, alignSelf: 'flex-start', borderColor: '#fdba74', borderRadius: 8 },
  actions: {
    flexDirection: 'row', gap: 10, padding: 14,
    borderTopWidth: 1, borderTopColor: '#f1f5f9',
  },
  actionBtn: { flex: 1, minHeight: 48, justifyContent: 'center' },
});

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
  // İkon-only: kare orantı, dokunma hedefi korunur (etiket yok ama alan aynı).
  headerChipInnerIcon: { paddingHorizontal: 11, gap: 0 },
  // secondRow'da (telefon) 3 chip eşit paylaşır — taşmaz, kaydırma gerekmez.
  headerChipFill: { flex: 1, marginLeft: 0 },
  headerChipInnerFill: { justifyContent: 'center' },
  headerChipText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  // AÇIK MOD chip'i (Manuel Ekle) — translucent aksiyon dilinden bilinçli
  // ayrışma: dolu amber + koyu yazı. Durum, aksiyon değil.
  headerChipOn: {
    backgroundColor: '#fbbf24',
    borderColor: '#fcd34d',
  },
  headerChipTextOn: { color: '#78350f', fontWeight: '800' },
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
  // MANUEL MOD bandı — koyu lacivert yerine amber: operatör ekranın tepesine
  // baktığında "normal iş değil" bilgisini renkten okur (yanlış modda üretim
  // sessiz hataya döner). Header chip'i ile aynı amber ailesi.
  headerBandManual: { backgroundColor: '#b45309' },
  manualTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#fcd34d',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  manualTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#78350f',
    letterSpacing: 0.4,
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
  // Kumaş · renk · en — barkod satırı barkodsuz açık kumaşta hiç basılmadığı
  // için başlığın ASIL kimlik satırı bu oldu (2026-08-04): büyütüldü + kalınlaştı.
  headerSub: { fontSize: 15, fontWeight: '700', color: '#e2e8f0', marginTop: 2 },
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
  // Siparişler kutusu — turuncu. Yeşil (metre) / mor (katlama) / kırmızı (uyarı)
  // paletinde boşta olan tek belirgin renk; hiçbiriyle karışmaz.
  headerBoxOrders: { backgroundColor: '#ea580c' },
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
  // Kalite listesinin altındaki gerekçe notu (manuel modda daraltılmış katalog).
  gradeNote: { fontSize: 11, color: '#b45309', lineHeight: 15, marginTop: 6 },
  // Sütun içi dikey seçenek listesi.
  optionList: { gap: 6 },

  // ── MANUEL MOD formu ──
  manualReq: { color: '#dc2626' },
  manualPickRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  manualPickCol: { flex: 1, minWidth: 0 },
  // Manuel mod kat seçici — En kutusuyla aynı yükseklik, iki eşit chip.
  // Ad `manualFold*`: kart akışının `foldChip*` stilleri AYRI (aynı adı
  // kullanmak StyleSheet'te sessiz üzerine yazma üretiyordu).
  foldPickRow: { flexDirection: 'row', gap: 8 },
  manualFoldChip: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#c4b5fd',
    backgroundColor: '#f5f3ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualFoldChipOn: { borderColor: '#7c3aed', backgroundColor: '#7c3aed' },
  manualFoldChipText: { fontSize: 15, fontWeight: '700', color: '#6d28d9' },
  manualFoldChipTextOn: { color: '#fff' },
  manualColorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // BUTON görünümü (2026-08-04): düz beyaz kutu "metin alanı" gibi okunuyordu,
  // oysa basılınca modal açan bir seçici. Mor (marka aksiyon rengi) çerçeve +
  // açık zemin + koyu mor yazı → dokunulabilir olduğu bir bakışta anlaşılır.
  manualSelect: {
    minHeight: 52,
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#c4b5fd',
    borderRadius: 10,
    backgroundColor: '#f5f3ff',
  },
  // Seçim YAPILDIĞINDA daha koyu: "boş" ile "dolu" ayrımı korunur.
  manualSelectFilled: { borderColor: '#7c3aed', backgroundColor: '#ede9fe' },
  manualSelectInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  manualSelectText: { flex: 1, fontSize: 15, fontWeight: '700', color: '#0f172a' },
  // Boşken de SOLUK DEĞİL: buton olduğu belli olsun diye mor yazı.
  manualSelectTextMuted: { color: '#6d28d9', fontWeight: '700' },
  manualHint: { fontSize: 11, color: '#64748b', lineHeight: 15, marginTop: 4 },
  manualErrorNote: { fontSize: 11, color: '#b91c1c', lineHeight: 15, marginTop: 4 },
  // Footer üstü uyarı şeridi — "buton neden kapalı" sorusunun somut cevabı.
  manualMissingStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fffbeb',
    borderTopWidth: 1,
    borderTopColor: '#fde68a',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  manualMissingText: { flex: 1, fontSize: 12, fontWeight: '700', color: '#b45309' },
  // Sağ panel (tablet kolonu / telefon drawer'ı) manuel modda bilgilendirir.
  manualPane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  manualPaneTitle: { fontSize: 18, fontWeight: '800', color: '#b45309' },
  manualPaneHint: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 340,
  },
  manualPaneExit: { alignSelf: 'stretch', borderRadius: 10 },
  manualPaneExitContent: { minHeight: 56 },
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
  // Manuel mod: En ve Metraj ALT ALTA, ikisi de bölümün yarısı genişliğinde.
  // Kart akışındaki kesim bloğu bundan ETKİLENMEZ (renderCutLength'e yalnız
  // manuel dal `halfWidth` geçirir).
  // Metraj satırının sağ yarısı: temizleme tuşu + Manuel/Otomatik anahtarı.
  lengthSideCol: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // İşlem nedeni — topu tarif eden alanlardan görsel olarak ayrılmış blok.
  reasonFreeBox: { gap: 8, paddingHorizontal: 4, paddingBottom: 4 },
  reasonFreeActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  manualReasonBlock: { marginTop: 4, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10 },
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
    paddingHorizontal: 8,
    // Tek satır içerik ama İKİ SATIRLIK yükseklik — dokunma hedefi korunur
    // (fabrika eldiveni; mobil/CLAUDE.md 56dp kuralının bu liste için karşılığı).
    minHeight: 52,
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
  // ── Tek satır tablo sütunları ──────────────────────────────────────────────
  // Ayraç `borderLeftWidth` ile: ayrı <View> ayraç eklemek hizalamayı bozardı.
  rollColName: {
    flex: 1,
    minWidth: 0, // uzun kumaş adı komşu sütunu ezmesin (flex taşma kuralı)
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rollColColor: {
    width: 92,
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
  },
  rollColWidth: {
    width: 62,
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
    alignItems: 'flex-end',
  },
  rollColMeter: {
    width: 78,
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
    alignItems: 'flex-end',
  },
  rollItemName: { fontSize: 13, fontWeight: '600', color: '#0f172a', flexShrink: 1 },
  rollColorText: { fontSize: 12, color: '#475569' },
  rollMeter: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    fontVariant: ['tabular-nums'],
  },
  rollWidth: {
    fontSize: 12,
    color: '#475569',
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
  // ── Açık Kartlar tablo sütunları (RollListItem ile aynı dil) ───────────────
  rowColItem: { flex: 1, minWidth: 0, paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: '#e2e8f0' },
  rowColColor: { width: 110, paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: '#e2e8f0' },
  rowColCount: {
    width: 74,
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
    alignItems: 'flex-end',
  },
  rowColWait: {
    width: 92,
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
    alignItems: 'flex-end',
  },
  rowItemText: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  rowMutedText: { fontSize: 13, color: '#475569' },
  rowStrongText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    fontVariant: ['tabular-nums'],
  },
});
