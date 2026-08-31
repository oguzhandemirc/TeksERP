// ============================================================================
// [YENİ — 2026-05-18] TODO: appliesProperty ayrımı yansıtılmadı
// ----------------------------------------------------------------------------
// Backend `SubcontractorCategory` artık iki bayrak tutuyor:
//   - appliesColor    → fason kabulde renk uygulanır mı?
//   - appliesProperty → fason kabulde özellik uygulanır mı? (BAĞIMSIZ)
//
// Bu ekran şu an "Uygulanacak Renk + Özellikler" bloğunu tek `appliesColor`
// koşuluna bağlıyor (aşağıda satır ~ "appliesColor &&" altı). Yeni mantıkta:
//   - Renk seçici/önizleme → step.requiredCategory.appliesColor === true
//   - Özellik seçici/önizleme → step.requiredCategory.appliesProperty === true
//   - İkisi de true ise (Boyahane gibi) iki blok da görünür.
//   - Yalnız appliesProperty=true bir kategori (örn. ileride Zımpara) için
//     renk seçici GÖSTERİLMEZ, sadece özellik seçici çıkar.
//
// Backend `subcontractor.service.ts` artık `appliedPropertyIds` çözümünü
// `appliesProperty` bayrağı üzerinden yapıyor; mobil eski `appliesColor`
// üzerinden override gönderse de geri uyumlu çalışır, ancak UI yanıltıcıdır.
// Kullanıcı bilinçli olarak ayrı bir iterasyonda ele alınacağını söyledi.
// ============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  Pressable,
  Keyboard,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Surface,
  ActivityIndicator,
  Checkbox,
  TouchableRipple,
  Icon,
  SegmentedButtons,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import {
  KeyboardAwareScrollView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useQuery,
  useInfiniteQuery,
  keepPreviousData,
  useMutation,
  useQueryClient,
  onlineManager,
} from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';

import ScreenChrome from '../../../components/ScreenChrome';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import RemoteListSheet from '../../../components/RemoteListSheet';
import ConfirmDialog from '../../../components/ConfirmDialog';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import { useVisibleScreens } from '../../../hooks/useVisibleScreens';
import { ReceiptRow, ReceiptDetailModal } from '../../../components/receipt';
import ColorSelectField from '../../../components/ColorSelectField';
import NumpadInput from '../../../components/NumpadInput';
import {
  subcontractorService,
  type PendingReturnErrorDetails,
  type NeedsDispatchDetails,
  type MaybeWrongReceiptDetails,
} from '../../../services/subcontractor.service';
import { travelerCardService } from '../../../services/travelerCard.service';
import { STATION_MUT } from '../../../offline/mutations';
import { useReasonPresets } from '../../../hooks/useReasonPresets';
import { useFasonShrinkWarn } from '../../../hooks/useFeatureFlags';
import SyncStatusChip from '../../../components/SyncStatusChip';
import { SkeletonList } from '../../../components/motion';
import {
  NewRollRow,
  ReceiveMode,
  makeNewRollRow,
  rebuildPrefilledNewRolls,
  switchReceiveMode,
} from './newRolls.helper';
import {
  parseNewRolls,
  buildReceivePayload,
  parseAppliedWidth,
  consumedTotalOf,
  resolveReturns,
  shrinkExceedsTolerance,
  shrinkInfo,
} from './receivePayload.helper';
import {
  onReceiveFailed,
  onReceiveSucceeded,
  receiveFingerprint,
  tokenForReceive,
  type ReceiveAttempt,
} from './receiveAttempt';
import type {
  PendingReturnGroup,
  PendingReturnParty,
  PendingReturnSummary,
  ReceiveRequest,
  ReceiveNewRollInput,
  TravelerCardLookup,
  FabricProperty,
  ReceiptCancelPreview,
} from '../../../types/models';
import type { MainStackParamList } from '../../../navigation/types';
import { foldSearchText } from '../../../utils/searchFold';

const RECEIPTS_PAGE_SIZE = 12;
const DRAFT_KEY = 'fason_kabul_draft_v1';
const DRAFT_TTL_MS = 8 * 60 * 60 * 1000;

interface RollRow {
  rollId: string;
  /** Açık kumaş Roll'lar (boyahane öncesi) için NULL; ama fasona giden hep barkodlu. */
  barcode: string | null;
  itemName: string;
  colorName?: string | null;
  /** Topun fasondaki KALANI (currentQty) — kısmi teslimat sonrası düşmüş olabilir. */
  dispatchedQty: number;
  /** SEVK EDİLEN metraj (sevk kalemi). Kalanın altına düşmüşse top YARIM KALANDIR. */
  sentQty: number | null;
  /** Sevk tarihi — "N gündür fasonda" yaş bandı için. */
  sentAt: string | null;
  /**
   * KISMİ KABUL: bu teslimatta GELEN metraj (ham metin; varsayılan = kalan).
   * Kalanın altına indirilirse kabul KISMİ olur — top fasonda bekler.
   */
  receivedQtyStr: string;
  width: number | null;
  qualityGrade: string;
  checked: boolean;
  notes: string;
  noteOpen: boolean;
}

/** Satırın beyan edilen GELEN metrajı (geçersizse kalanın tamamı = TAM kabul). */
function rowGelen(r: RollRow): number {
  const n = parseFloat((r.receivedQtyStr ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : Number(r.dispatchedQty ?? 0);
}
/** Satır KISMİ mi — gelen, kalanın 0.01 m'den fazla altında. */
function rowIsPartial(r: RollRow): boolean {
  return r.checked && rowGelen(r) < Number(r.dispatchedQty ?? 0) - 0.01;
}

/**
 * Kart okutmada aksiyona ÇEVRİLEBİLEN backend teşhisi. Yalnız operatörün tek
 * dokunuşla çözebileceği iki kod kartı hak eder; gerisi (ör. iş emri gerçekten
 * başka istasyonda) bilgi mesajıdır ve toast olarak kalır.
 */
type ScanActionState =
  | { kind: 'NEEDS_DISPATCH'; message: string; details: NeedsDispatchDetails }
  | { kind: 'MAYBE_WRONG_RECEIPT'; message: string; details: MaybeWrongReceiptDetails };

// Sevk/parti numarasını gösterirken baştaki gereksiz sıfırları at:
// "SD-2606-000013" → "SD-2606-13". Depolanan değer sıralama/benzersizlik için
// 6-hane sıfır-dolgulu KALIR (backend nextPrefixedSequence lexicographic DESC'e
// dayanır, padding'i bozmak max-bulmayı kırar) — bu yalnızca gösterim.
function formatPartyNo(no: string | null | undefined): string | null {
  if (!no) return null;
  const parts = no.split('-');
  parts[parts.length - 1] = parts[parts.length - 1].replace(/^0+(?=\d)/, '');
  return parts.join('-');
}

// FARK/EKSİK yüzeylerinde metraj gösterimi — eşikle (0.01 m) AYNI hassasiyet,
// gereksiz sıfırsız: 0.03 → "0.03", 120.5 → "120.5", 100 → "100". toFixed(1)
// kullanılınca 0.02-0.04 m'lik gerçek fark "FARK +0.0 m" olarak görünüp
// operatörü "sıfır farka onay" paradoksuna sokuyordu.
const fmtMeters = (n: number) => String(Math.round(n * 100) / 100);

// İptal Edilebilirler = receipts whose all bornRolls are safe (still cancellable).
// Geçmiş Kabuller = settled receipts (at least one bornRoll has moved on / been
// processed). İki sekme ayırması operatörün kafa karışıklığını engeller —
// "iptal edebilir miyim?" sorusu artık tab seçimiyle yanıtlanır.
type RightTab = 'pending' | 'cancellable' | 'history';

// Koyu header'da ikon + etiketli aksiyon pill'i — Tambur ekranıyla aynı kalıp.
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
      <View style={[styles.headerChipInner, accent && styles.headerChipInnerLarge]}>
        <Icon source={icon} size={accent ? 22 : 18} color="#fff" />
        <Text style={styles.headerChipText}>{label}</Text>
      </View>
    </TouchableRipple>
  );
}

export default function FasonKabulScreen() {
  const device = useDeviceType();
  const isPhone = device === 'phone';
  const manualBarcodeEntry = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  // Fason Sevk'e yönlendirme YALNIZ ekran görünürse sunulur — yetkisi olmayanda
  // rota hiç kayıtlı değildir (MainNavigator visibleScreens'ten kaydeder), buton
  // "gezinme hedefi bulunamadı" ile patlardı.
  const { visibleScreens } = useVisibleScreens();
  const canGoFasonSevk = visibleScreens.some((s) => s.key === 'FasonSevk');
  const insets = useSafeAreaInsets();
  const keyboard = useReanimatedKeyboardAnimation();
  const footerAnimStyle = useAnimatedStyle(() => ({
    // useReanimatedKeyboardAnimation.height NEGATİF (0 → -H); pozitife çevir.
    // ScreenChrome content'i zaten paddingBottom:insets.bottom uygular → onu düş.
    bottom: Math.max(0, -keyboard.height.value - insets.bottom),
  }));

  // ── Form state ──
  const [selectedGroup, setSelectedGroup] = useState<PendingReturnGroup | null>(null);
  /**
   * Çoklu sevkte (aynı adıma birden çok parti) operatör ÖNCE hangi partinin
   * geldiğini seçer; form yalnız o partinin toplarına/açık kumaşına çalışır.
   * Tek parti varsa selectGroup otomatik seçer. Her parti ayrı receive() → ayrı
   * fiş. null + çoklu parti = parti seçim ekranı gösterilir.
   */
  const [selectedParty, setSelectedParty] = useState<PendingReturnParty | null>(null);
  const [rows, setRows] = useState<RollRow[]>([]);
  const [manifestNo, setManifestNo] = useState('');
  const [notes, setNotes] = useState('');
  /**
   * Receipt seviyesinde uygulanan renk + özellik (Refactor 9 — Boyahane akışı).
   * Adımın `requiredCategory.appliesColor === true` olduğunda WO.targetColor /
   * targetProperties ÖN SEÇİLİ gelir; operatör değiştirebilir.
   *
   * 2026-08-05: renk artık dokunulamaz bir ETİKET değil, seçilebilir bir alan.
   * Eskiden yalnız gösteriliyordu ve iş emrinde hedef renk yoksa operatörün
   * yapabileceği hiçbir şey yoktu — kabul 400 ile kilitleniyordu (saha vakası
   * IE0508260006). Kimlik olarak ID tutulur; ad/hex'i `ColorSelectField` çözer,
   * böylece müşteriye özel bir renk seçili olsa bile adı doğru görünür.
   */
  const [appliedColorId, setAppliedColorId] = useState<string | null>(null);
  const [appliedProperties, setAppliedProperties] = useState<FabricProperty[]>([]);
  /**
   * Kabulde ÖLÇÜLEN en (cm) — kabul BAŞINA tek değer, doğan tüm parçalara uygulanır
   * (aynı sevkten dönen parçaların eni aynıdır; 10 parçalı kabulde 10 giriş yerine 1).
   *
   * ⚠️ Renkten farklı olarak `appliesColor`'a BAĞLI DEĞİL — her fason dönüşünde
   * sorulur. Gerekçe: topun eni sisteme ilk kez burada giriyor (ham girişte en
   * tasarım gereği yazılmıyor; KK1 kaynaklı 47 topun 47'si ensiz). Yalnız
   * boyahanede sorulsaydı zımparadan dönen top sonsuza dek ensiz kalırdı.
   * Ham metin tutulur (NumpadInput sözleşmesi); parse `receivePayload.helper`de.
   */
  const [appliedWidth, setAppliedWidth] = useState('');
  /**
   * "Uygulanan" paneli açık mı? Renk ve en İŞ EMRİNDEN dolu geldiyse panel KAPALI
   * açılır ve tek satırlık özete iner — rutin kabulde operatörün önünde yer kaplamaz.
   * Eksik varsa panel kendiliğinden AÇILIR (aşağıda `appliedPanelOpen`), çünkü o
   * durumda operatörün vermesi gereken bir karar vardır. Emsal: aynı ekranın
   * "İrsaliye No / Kabul Notu" satırı (opsiyonel olan kapalı başlar).
   */
  const [appliedOpen, setAppliedOpen] = useState(false);
  /**
   * Seçili rengin ADI — yalnız KAPALI paneldeki özet satırı için. Panel kapalıyken
   * `ColorSelectField` mount edilmediği için adı kendisi çözemez; bu yüzden parti
   * yüklenirken iş emrinin renk adından doldurulur, panel açılınca alanın kendi
   * çözümü (`onLabelResolved`) üstüne yazar. Kimlik hâlâ `appliedColorId`'dir —
   * bu alan yalnız GÖSTERİM, backend'e gitmez.
   */
  const [appliedColorLabel, setAppliedColorLabel] = useState<string | null>(null);

  /**
   * Fasondan dönen açık kumaş parçaları — backend min(1) zorunlu.
   * Boyahane gibi açık kumaş döndüren fasonlarda irsaliyede kaç parça/metre
   * geldiği yazılı; operatör buradan girer. KK2/Kurşun ekranı bu kayıtları
   * doğar doğmaz görür. Birden fazla parça varsa "Parça ekle" ile artırılır.
   *
   * UX: Sevkedilen her top için 1 satır + metre = topun sevk metresi
   * otomatik dolar (`prefilled=true`). Operatör değiştirirse rozet düşer ve
   * gerçek doğrulamanın yapıldığı izlenebilir. Ağırlık alanı yok —
   * fason kabul terazide tartılmıyor, sonraki istasyon ölçer.
   */
  const [newRolls, setNewRolls] = useState<NewRollRow[]>([]);
  /**
   * Kabul modu — varsayılan SINGLE: boyahane topları dikerek TEK parça döndürür,
   * ön-dolu tek satır = işaretli topların toplam metresi. İstisna (PER_ROLL,
   * "adet adet geldi"): gittiği parça kadar satır, her biri kendi sevk metresiyle.
   */
  const [receiveMode, setReceiveMode] = useState<ReceiveMode>('SINGLE');
  /**
   * FASONDA KALAN (2026-08-21) — "kalan var mı?" anahtarı + tek metraj kutusu.
   *
   * Varsayılan KAPALI: normal dönüş, malın tamamının geldiği dönüştür. Açılınca
   * operatör TEK sayı yazar (fasonda kalan toplam metre), dağıtımı
   * `resolveReturns` büyük toptan başlayarak yapar. Eski akışta bu bilgi top top
   * "Gelen (m)" alanlarından çıkarsanıyordu ve boyahanenin dikip tek parça
   * döndürdüğü işte o sorunun fiziksel cevabı yoktu.
   */
  const [remainderOpen, setRemainderOpen] = useState(false);
  const [remainderStr, setRemainderStr] = useState('');
  /**
   * TOP BAZLI GİRİŞ — kaçış kapısı (etiketi korunmuş parça, tek toplu kabul).
   * Açıkken satır başına "Gelen (m)" görünür ve kalan kutusu devre dışı kalır:
   * ikisi aynı şeyi iki dille söyler, ikisini birden okumak çelişkiyi sessizce
   * çözmek olurdu (`resolveReturns` sözleşmesi).
   */
  const [perRollQtyOpen, setPerRollQtyOpen] = useState(false);

  // Kabul iptal modalı
  const [cancelTargetReceiptId, setCancelTargetReceiptId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  /**
   * Kart okutmada backend'in koyduğu TEŞHİS — toast değil KALICI aksiyon kartı.
   * Toast 4 saniyede kaybolur; operatör "ne yapacağım?" sorusuyla baş başa kalır
   * (saha bulgusu: sabit "Yanlış istasyon" başlığı üstelik yanlıştı — mal doğru
   * istasyondaydı, sadece henüz sevk edilmemişti). Kart boş-durum bloğunda
   * render edilir → tablette de telefonda da TEK yerde çalışır.
   */
  const [scanAction, setScanAction] = useState<ScanActionState | null>(null);

  // ── Right column ──
  const [rightTab, setRightTab] = useState<RightTab>('pending');
  // Phone modal'da gösterilen alt sekme. Tablet'te bu state kullanılmaz
  // (rightTab zaten 3 değer ile aynı işi yapar), sadece phone HistoryReceiptsModal'a.
  // Default 'history' — operatörün asıl ihtiyacı tüm kabul geçmişi; iptal-edilebilir
  // filtre ikincil bir alt-küme görünümü.
  const [modalSubTab, setModalSubTab] = useState<'cancellable' | 'history'>(
    'history',
  );
  // Telefon modunda alttaki "Bekleyen / Geçmiş" paneli daraltılabilir —
  // operatör formla çalışırken dikey alan kazansın.
  const [cardBarcode, setCardBarcode] = useState('');
  const [resolvingCard, setResolvingCard] = useState(false);
  const [highlightedWorkOrderId, setHighlightedWorkOrderId] = useState<string | null>(null);
  const [detailReceiptId, setDetailReceiptId] = useState<string | null>(null);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [groupLoading, setGroupLoading] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  // Telefon dikeyde Geçmiş Kabuller alt panelde değil, header butonundan
  // açılan ayrı bir modal'da gösterilir.
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

  // ── Mal kabul onayı ── giden/gelen uyuşmazsa (eksik top ya da metraj farkı)
  // iki-tık yerine belirgin bir uyarı modalı çıkar.
  const [mismatchConfirmOpen, setMismatchConfirmOpen] = useState(false);
  /**
   * Plandan FARKLI renk kabul ediliyor (2026-08-21): kaydetmeden önce TEK soru —
   * "iş emri de bu renge dönsün" mü, "sadece bu toplar" mı. Karar ref'te tutulur
   * (payload kurulurken okunur), form sıfırlanınca temizlenir.
   */
  const [colorChoiceOpen, setColorChoiceOpen] = useState(false);
  const planColorActionRef = useRef<'APPLY_TO_PLAN' | 'ROLLS_ONLY' | null>(null);
  // ── "Kalan gelmeyecek" kapaması ── hedef top satırı (null = modal kapalı).
  // Fasondaki kalan FİRE kararıyla kapatılır (sebep zorunlu, sapma defterine yazılır).
  const [remainderTarget, setRemainderTarget] = useState<RollRow | null>(null);
  // Footer'daki İrsaliye No / Kabul Notu (ikisi de opsiyonel) varsayılan KAPALI;
  // operatör isterse açar. Her kart yüklemesinde kapanır (applyParty/resetForm).
  const [extrasOpen, setExtrasOpen] = useState(false);

  // ── Draft yedekleme (Android LMK koruması) ──
  // Telefonda OS uygulamayı arka planda öldürünce form state sıfırlanır.
  // 8 saat (1 vardiya) TTL: vardiya içi kaza → kaldığın yerden devam;
  // ertesi gün → temiz başla.
  const draftRestoredRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY).then((raw) => {
      if (raw) {
        try {
          const d = JSON.parse(raw) as Record<string, unknown>;
          const age = typeof d.savedAt === 'number' ? Date.now() - d.savedAt : Infinity;
          if (age < DRAFT_TTL_MS) {
            if (d.selectedGroup) setSelectedGroup(d.selectedGroup as PendingReturnGroup);
            if (d.selectedParty) setSelectedParty(d.selectedParty as PendingReturnParty);
            if (Array.isArray(d.rows) && d.rows.length > 0) {
              setRows((d.rows as RollRow[]).map((r) => ({
                ...r,
                noteOpen: false,
                // Eski taslaklar kısmi-kabul alanlarını taşımaz — varsayılana düş.
                sentQty: r.sentQty ?? null,
                sentAt: r.sentAt ?? null,
                receivedQtyStr: r.receivedQtyStr ?? String(Number(r.dispatchedQty ?? 0)),
              })));
            }
            if (typeof d.manifestNo === 'string' && d.manifestNo) setManifestNo(d.manifestNo);
            if (typeof d.notes === 'string' && d.notes) setNotes(d.notes);
            if (Array.isArray(d.newRolls) && d.newRolls.length > 0) {
              type StoredNR = { qty: string; notes: string; prefilled: boolean };
              setNewRolls((d.newRolls as StoredNR[]).map((r) => ({
                ...makeNewRollRow(r.qty, r.prefilled),
                notes: r.notes,
              })));
            }
            if (typeof d.appliedColorId === 'string') setAppliedColorId(d.appliedColorId);
            if (typeof d.appliedWidth === 'string') setAppliedWidth(d.appliedWidth);
            if (Array.isArray(d.appliedProperties)) setAppliedProperties(d.appliedProperties as FabricProperty[]);
            if (d.receiveMode === 'SINGLE' || d.receiveMode === 'PER_ROLL') {
              setReceiveMode(d.receiveMode);
            }
            if (typeof d.remainderStr === 'string' && d.remainderStr) {
              setRemainderStr(d.remainderStr);
              setRemainderOpen(true);
            }
            if (d.perRollQtyOpen === true) setPerRollQtyOpen(true);
          } else {
            AsyncStorage.removeItem(DRAFT_KEY);
          }
        } catch {
          AsyncStorage.removeItem(DRAFT_KEY);
        }
      }
      draftRestoredRef.current = true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftRestoredRef.current) return;
    const t = setTimeout(() => {
      if (!selectedGroup) {
        AsyncStorage.removeItem(DRAFT_KEY);
        return;
      }
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        selectedGroup,
        selectedParty,
        rows: rows.map((r) => ({ ...r, noteOpen: false })),
        manifestNo,
        notes,
        newRolls: newRolls.map((r) => ({ qty: r.qty, notes: r.notes, prefilled: r.prefilled })),
        appliedColorId,
        appliedWidth,
        appliedProperties,
        receiveMode,
        // Kalan beyanı taslağa girer: vardiya ortasında OS uygulamayı öldürünce
        // operatörün fasonla konuşup öğrendiği sayı kaybolmasın.
        remainderStr: remainderOpen ? remainderStr : '',
        perRollQtyOpen,
      }));
    }, 600);
    return () => clearTimeout(t);
  }, [selectedGroup, selectedParty, rows, manifestNo, notes, newRolls, appliedColorId, appliedWidth, appliedProperties, receiveMode, remainderOpen, remainderStr, perRollQtyOpen]);

  // ── Queries ──
  // staleTime 30sn: ekran focus / tab geçişi tetikli otomatik refetch'leri susturur,
  // operatörün refresh butonu tek doğru kanal. Sahada gerçek değişim sıklığı zaten
  // sevk-kabul ölçeğinde (dakikalar), 30sn'lik cache yeter.
  const pendingQuery = useQuery({
    queryKey: ['pending-returns', 'all'],
    queryFn: () => subcontractorService.pendingReturns(),
    staleTime: 30 * 1000,
  });

  // İPTAL EDİLEBİLİRLER (cancellable:'yes') — born rolls güvenli durumda.
  // Operatör hala iptal edebilir; UI'da İptal Et butonu gösterilir.
  // Cursor (keyset) + infinite scroll: count yok → MAX_OFFSET tavanı + her-sayfa
  // COUNT maliyeti yok. `cancellable` filtresi sunucuda korunur.
  const cancellableReceiptsQuery = useInfiniteQuery({
    queryKey: ['receipts', 'cancellable'],
    queryFn: ({ pageParam }) =>
      subcontractorService.listReceiptsCursor({
        cancellable: 'yes',
        limit: RECEIPTS_PAGE_SIZE,
        cursor: pageParam,
        withTotal: !pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.nextCursor : undefined,
    placeholderData: keepPreviousData,
    enabled: rightTab === 'cancellable' || historyModalOpen,
    staleTime: 30 * 1000,
  });

  // TÜM KABULLER (cancellable filtresi yok) — iptal edilmemiş tüm receipts.
  // Backend zaten cancelledAt:null koşulu uyguluyor; cancellable filtresi olmadan
  // hem hala-iptal-edilebilir hem settled olanlar tek listede dönüyor.
  // UI'da iptal butonu YOK — sadece detay görüntüleme (iptal aksiyonu ayrı tab).
  const receiptsQuery = useInfiniteQuery({
    queryKey: ['receipts', 'all'],
    queryFn: ({ pageParam }) =>
      subcontractorService.listReceiptsCursor({
        limit: RECEIPTS_PAGE_SIZE,
        cursor: pageParam,
        withTotal: !pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.nextCursor : undefined,
    placeholderData: keepPreviousData,
    // Tablet'te tab history iken, telefonda Geçmiş modal açıkken aktif
    enabled: rightTab === 'history' || historyModalOpen,
    staleTime: 30 * 1000,
  });

  // Sayfaları düzleştir — infinite query birikimi.
  const cancellableReceipts = useMemo(
    () => cancellableReceiptsQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [cancellableReceiptsQuery.data],
  );
  const allReceipts = useMemo(
    () => receiptsQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [receiptsQuery.data],
  );
  // Telefon "Geçmiş Kabuller" modal'ında aktif alt-sekmenin query'si + listesi.
  const modalActiveQuery =
    modalSubTab === 'cancellable' ? cancellableReceiptsQuery : receiptsQuery;
  const modalReceipts =
    modalSubTab === 'cancellable' ? cancellableReceipts : allReceipts;

  // Modal açılışında otomatik refresh — operatör manuel refresh basmasın.
  useRefetchOnOpen(pendingQuery.refetch, listModalOpen);
  useRefetchOnOpen(receiptsQuery.refetch, historyModalOpen);

  // Header "Yenile" — aktif sağ-tab'ın listesini tazeler. Standart hook:
  // offline guard + zaman aşımı + tek tip animasyon/haptic/toast (ham
  // isFetching offline'da hiç dönmüyordu).
  const refresh = useManualRefresh(
    () => {
      if (rightTab === 'pending') return pendingQuery.refetch();
      if (rightTab === 'cancellable') return cancellableReceiptsQuery.refetch();
      return receiptsQuery.refetch();
    },
    rightTab === 'pending'
      ? 'Bekleyen sevkler güncellendi'
      : rightTab === 'cancellable'
        ? 'İptal listesi güncellendi'
        : 'Kabul listesi güncellendi',
  );

  // ── Mutations ──
  // OFFLINE-AWARE: mutationFn `setMutationDefaults`'ta tanımlı; persist sonrası
  // app restart'ında resolve. Backend idempotent: bir step bir kez receive olur
  // (subcontractor.service.ts:receive() başında step-based check + cached
  // SubcontractorReceipt dönüşü). onMutate'te form anında temizlenir + toast
  // (offline ise "sync bekliyor"). Form rollback kompleks olduğu için
  // yapılmadı — operatör offline hatasında yeniden seçim/giriş yapar.
  /**
   * DÜŞMÜŞ DENEMENİN İZİ (BULGU-T2-007) — `useRef`, `useState` DEĞİL: bu değer
   * hiçbir şey çizmez ve render tetiklemesi gereksiz yeniden hesaplama olurdu.
   * Aynı teslimat belirsiz bir hatadan (ağ/timeout/5xx) sonra yeniden
   * gönderilirse AYNI token'la gider → sunucu cached makbuzu döner, ikinci
   * makbuz doğmaz. Sınırlar `receiveAttempt.ts`te gerekçeli.
   */
  const failedAttemptRef = useRef<ReceiveAttempt | null>(null);

  const receiveMutation = useMutation<
    Awaited<ReturnType<typeof subcontractorService.receive>>,
    Error,
    ReceiveRequest
  >({
    mutationKey: STATION_MUT.FASON_KABUL_RECEIVE,
    onMutate: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Mal kabul tamamlandı',
        text2: onlineManager.isOnline()
          ? undefined
          : 'Çevrimdışı — sync bekliyor',
      });
      resetForm();
    },
    onSuccess: () => {
      // Makbuz kesildi → yapışkanlık BİTER. Sürseydi bir sonraki MEŞRU teslimat
      // cached makbuzu alır ve sessizce kaybolurdu (BULGU-T2-007).
      failedAttemptRef.current = onReceiveSucceeded();
      // Server confirm — query'leri tazele (kalan dönüşler, kabul geçmişi vs.)
      qc.invalidateQueries({ queryKey: ['pending-returns'] });
      qc.invalidateQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['rolls'] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
    },
    onError: (err, vars) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // ⚠️ ERKEN return'lerden ÖNCE: token yalnız sonucu BELİRSİZ bırakan hatada
      // yapışır (ağ/timeout/5xx). Aşağıdaki TARGET_COLOR_CHANGED bir 409'dur →
      // hiçbir şey yazılmadığı KESİNDİR → yapışkanlık temizlenir (BULGU-T2-007).
      failedAttemptRef.current = onReceiveFailed(
        vars.clientToken ?? '',
        receiveFingerprint(vars),
        err,
      );
      // Planlamacı kabul sürerken iş emrinin rengini değiştirdi (2026-08-21):
      // sunucu eski rengi yazmak yerine 409 döndü. Bekleyen dönüşler tazelenir ki
      // parti yeniden seçilince YENİ renk ön seçili gelsin; mesaj ne yapılacağını söyler.
      const code = (err as Error & { details?: { code?: string } }).details?.code;
      if (code === 'TARGET_COLOR_CHANGED') {
        qc.invalidateQueries({ queryKey: ['pending-returns'] });
        qc.invalidateQueries({ queryKey: ['work-orders'] });
        Toast.show({
          type: 'error',
          text1: 'İş emrinin rengi değişti',
          text2: err.message,
          visibilityTime: 7000,
        });
        return;
      }
      Toast.show({ type: 'error', text1: 'Kabul başarısız', text2: err.message });
    },
  });

  // "Kalan gelmeyecek" — ONLINE aksiyon, offline kuyruğa girmez (fire kararı
  // taze kalan metraj ister; kuyruklanmış kapama bayat rakam yazardı).
  const closeRemainderMutation = useMutation({
    mutationFn: (vars: { stepId: string; rollId: string; reasonCode: string; reasonText?: string | null }) =>
      subcontractorService.closeRemainder(vars),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Kalan kapatıldı', text2: res.message });
      setRemainderTarget(null);
      // Kapatılan top formdan düşer; parça prefill'i kalanlara göre yeniden kurulur.
      setRows((prev) => {
        const next = prev.filter((r) => r.rollId !== res.data.rollId);
        setNewRolls((curr) =>
          rebuildPrefilledNewRolls(curr, expectedQtysFor(next), receiveMode),
        );
        return next;
      });
      qc.invalidateQueries({ queryKey: ['pending-returns'] });
      qc.invalidateQueries({ queryKey: ['rolls'] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
    },
    onError: (err) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Kapama başarısız', text2: (err as Error).message });
    },
  });

  // İptal modali açıldığında backend'den preview çek — operatöre türeyen
  // açık kumaş Roll'larını ve cascade güvenliğini göster.
  const cancelPreviewQuery = useQuery({
    queryKey: ['receipt-cancel-preview', cancelTargetReceiptId],
    queryFn: () => subcontractorService.getCancelPreview(cancelTargetReceiptId!),
    enabled: !!cancelTargetReceiptId,
    staleTime: 0,
  });
  const cancelPreview: ReceiptCancelPreview | null =
    cancelPreviewQuery.data?.data ?? null;

  const cancelReceiptMutation = useMutation({
    mutationFn: ({
      id,
      reason,
      cascadeRollIds,
    }: {
      id: string;
      reason: string;
      cascadeRollIds: string[];
    }) => subcontractorService.cancelReceipt(id, { reason, cascadeRollIds }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Mal kabul iptal edildi',
        text2: 'Toplar fasona geri döndü — kartı tekrar okutabilirsiniz',
      });
      setCancelTargetReceiptId(null);
      setCancelReason('');
      // Teşhis kartı ("bu iş emrinde kabul zaten yapılmış") artık doğru değil.
      setScanAction(null);
      qc.invalidateQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['pending-returns'] });
      qc.invalidateQueries({ queryKey: ['rolls'] });
    },
    onError: (err: Error) => {
      // 409 — sonraki adımda iz var ("Top X: Sonraki adımda işlem yapılmış...")
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'İptal edilemedi',
        text2: err.message,
      });
    },
  });

  // İki yerde mount edilen CancelReceiptModal'ın onConfirm handler'ı — iki ayrı
  // inline yazsak validation kopyası çıkar. Tek noktadan.
  const handleConfirmCancelReceipt = () => {
    if (!cancelTargetReceiptId) return;
    if (cancelReason.trim().length < 3) {
      Toast.show({
        type: 'error',
        text1: 'Sebep çok kısa',
        text2: 'En az 3 karakter gerekli',
      });
      return;
    }
    // K14 parti uyuşmazlığı ayrı bir sebep — "toplar işlenmiş" mesajı burada
    // YANLIŞ yönlendirir (yapılacak iş panelden parti birleştirmektir).
    if (cancelPreview?.batchMismatch?.blocked) {
      Toast.show({
        type: 'error',
        text1: 'Parti uyuşmazlığı',
        text2: 'Panelden partileri birleştirin, sonra iptali tekrar deneyin',
        visibilityTime: 6000,
      });
      return;
    }
    if (cancelPreview && !cancelPreview.allSafe) {
      Toast.show({
        type: 'error',
        text1: 'İptal güvenli değil',
        text2: 'Bazı açık kumaş topları işlenmiş — önce onları temizleyin',
      });
      return;
    }
    cancelReceiptMutation.mutate({
      id: cancelTargetReceiptId,
      reason: cancelReason.trim(),
      cascadeRollIds: cancelPreview?.bornRolls.map((b) => b.id) ?? [],
    });
  };

  // ── Handlers ──
  const resetForm = () => {
    setScanAction(null);
    setSelectedGroup(null);
    setSelectedParty(null);
    setRows([]);
    setManifestNo('');
    setNotes('');
    setNewRolls([]);
    setReceiveMode('SINGLE');
    setRemainderOpen(false);
    setRemainderStr('');
    setPerRollQtyOpen(false);
    setAppliedColorId(null);
    setAppliedColorLabel(null);
    setAppliedWidth('');
    planColorActionRef.current = null;
    setColorChoiceOpen(false);
    setAppliedProperties([]);
    setAppliedOpen(false);
    setMismatchConfirmOpen(false);
    setExtrasOpen(false);
    setHighlightedWorkOrderId(null);
    AsyncStorage.removeItem(DRAFT_KEY);
  };

  const updateNewRoll = (key: string, patch: Partial<NewRollRow>) => {
    // qty/notes değiştiyse prefilled rozeti düşer; noteOpen toggle sayılmaz.
    const touchesValue = "qty" in patch || "notes" in patch;
    setNewRolls((prev) =>
      prev.map((r) =>
        r.key === key
          ? { ...r, ...patch, ...(touchesValue ? { prefilled: false } : {}) }
          : r
      )
    );
  };
  const addNewRoll = () => {
    setNewRolls((prev) => [...prev, makeNewRollRow()]);
  };
  const removeNewRoll = (key: string) => {
    setNewRolls((prev) => prev.filter((r) => r.key !== key));
  };

  // Eski/kimliksiz payload (parties yok) için: grubun tamamını tek partiye sar.
  const syntheticParty = (g: PendingReturnGroup): PendingReturnParty => ({
    dispatchId: g.lastDispatch?.id ?? null,
    dispatchNo: g.lastDispatch?.dispatchNo ?? null,
    dispatchedAt: g.lastDispatch?.dispatchedAt ?? null,
    plateNumber: g.lastDispatch?.plateNumber ?? null,
    driverName: g.lastDispatch?.driverName ?? null,
    subcontractorId: g.lastDispatch?.subcontractorId ?? null,
    subcontractor: g.lastDispatch?.subcontractor ?? null,
    rolls: g.rolls,
    rollCount: g.rolls.length,
    totalQty: g.totalQty,
  });

  // Formu SEÇİLEN partiye göre doldur — toplar, açık kumaş satırları, renk/özellik.
  const applyParty = (g: PendingReturnGroup, party: PendingReturnParty) => {
    setSelectedGroup(g);
    setSelectedParty(party);
    setRows(
      party.rolls.map((r) => ({
        rollId: r.id,
        barcode: r.barcode,
        itemName: r.item?.name ?? '—',
        colorName: r.color?.name ?? null,
        dispatchedQty: r.currentQty,
        // Kısmi teslimat bilgisi (eski backend'de alanlar yok → null, rozet çizilmez).
        sentQty: r.dispatchedQty ?? null,
        sentAt: r.dispatchedAt ?? null,
        receivedQtyStr: String(Number(r.currentQty ?? 0)),
        width: r.width ?? null,
        qualityGrade: r.qualityGrade,
        checked: true,
        notes: '',
        noteOpen: false,
      }))
    );
    // Renk ve en İŞ EMRİNDEN ön gelir; ikisi de doluysa panel KAPALI açılır
    // (aşağıdaki `appliedReady`) — rutin işte operatörün önünü kalabalıklaştırmaz.
    //
    // ⚠️ En'in kaynağı `workOrder.width`, GİDEN TOPUN eni DEĞİL: iş emrinin eni
    // işlem SONRASI hedeftir, giden topunki ise terbiye ÖNCESİ ölçüdür ve ram/
    // fikse/sanfor tam da onu değiştirir. Giden topun eninden doldurmak,
    // ölçülmemiş bir rakamı ölçülmüş gibi kaydetmek olurdu (ipucu olarak yazılır).
    setAppliedColorId(g.workOrder.targetColor?.id ?? null);
    setAppliedColorLabel(g.workOrder.targetColor?.name ?? null);
    setAppliedWidth(g.workOrder.width != null ? String(g.workOrder.width) : '');
    setAppliedProperties(g.workOrder.targetProperties ?? []);
    // Her parti yüklemesi varsayılan moda döner — SINGLE: dikili tek parça,
    // kalan yok, top bazlı giriş kapalı (basit yol her kartta yeniden başlar).
    setReceiveMode('SINGLE');
    setRemainderOpen(false);
    setRemainderStr('');
    setPerRollQtyOpen(false);
    setNewRolls(
      party.rolls.length > 0
        ? rebuildPrefilledNewRolls(
            [],
            party.rolls.map((r) => Number(r.currentQty ?? 0)),
            'SINGLE',
          )
        : [makeNewRollRow()]
    );
    setManifestNo('');
    setNotes('');
    setExtrasOpen(false);
  };

  // Parti seçim ekranından bir parti seçilince.
  const selectParty = (party: PendingReturnParty) => {
    if (!selectedGroup) return;
    applyParty(selectedGroup, party);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const selectGroup = async (summary: PendingReturnSummary | PendingReturnGroup) => {
    if (groupLoading) return;
    // Bir grup seçildiği an teşhis kartı geçersiz — operatör başka yoldan devam etti.
    setScanAction(null);

    // PendingReturnGroup (rolls mevcut) ise doğrudan kullan — refakat kartı akışı.
    // PendingReturnSummary (rolls yok) ise backend'den lazy-load.
    let g: PendingReturnGroup;
    if ('rolls' in summary) {
      g = summary as PendingReturnGroup;
    } else {
      setGroupLoading(true);
      try {
        const res = await subcontractorService.getPendingReturnGroup(summary.step.id);
        g = res.data;
      } catch (err) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Toast.show({ type: 'error', text1: 'Grup detayı alınamadı', text2: (err as Error).message });
        return;
      } finally {
        setGroupLoading(false);
      }
    }

    // "Sevk bekliyor" satırı: adımda top VAR ama fasona çıkmamış (konum düzeltmesi
    // sonrası içeride bekliyor). Kabul formu açılırsa operatör boş bir forma bakar
    // ve neden kabul edemediğini yine anlamaz — teşhis kartına yönlendir.
    // Kart okutma yolundaki NEEDS_DISPATCH ile AYNI aksiyon.
    if (g.rollCount === 0 && g.awaitingDispatch) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setScanAction({
        kind: 'NEEDS_DISPATCH',
        message:
          `Toplar '${g.step.station.name}' adımında ama henüz fasona SEVK EDİLMEMİŞ ` +
          `(konum düzeltmesi sonrası mal içeride bekliyor). ` +
          `Önce Fason Sevk yapın, sonra kabul edin.`,
        details: {
          code: 'NEEDS_DISPATCH',
          workOrderId: g.workOrder.id,
          stepId: g.step.id,
          stationName: g.step.station.name,
          rollCount: g.awaitingDispatchRollCount ?? 0,
        },
      });
      return;
    }

    const parties = g.parties ?? [];
    if (parties.length > 1) {
      // Çoklu parti — operatör hangi partinin geldiğini önce seçsin (teyit).
      setSelectedGroup(g);
      setSelectedParty(null);
      setRows([]);
      setNewRolls([]);
      setAppliedColorId(g.workOrder.targetColor?.id ?? null);
      setAppliedColorLabel(g.workOrder.targetColor?.name ?? null);
      setAppliedWidth(g.workOrder.width != null ? String(g.workOrder.width) : '');
      setAppliedProperties(g.workOrder.targetProperties ?? []);
      setManifestNo('');
      setNotes('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Toast.show({
        type: 'info',
        text1: `${parties.length} parti bekliyor`,
        text2: 'Hangi parti(ler)in geldiğini seçin — her parti ayrı kabul edilir',
      });
      return;
    }

    // Tek parti (veya eski payload) — doğrudan forma geç.
    applyParty(g, parties[0] ?? syntheticParty(g));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const appliesColor = !!selectedGroup?.step.requiredCategory?.appliesColor;
  const partyList = selectedGroup?.parties ?? [];
  const isMultiParty = partyList.length > 1;
  // Çoklu parti + henüz parti seçilmedi → parti seçim ekranı göster.
  const showPartyChooser = !!selectedGroup && !selectedParty && isMultiParty;

  const handleResolveCard = async (overrideBarcode?: string) => {
    const barcode = (overrideBarcode ?? cardBarcode).trim();
    if (!barcode) return;
    // Yeni okutma = önceki teşhis geçersiz; kart eskiyi ekranda bırakmasın.
    setScanAction(null);
    setResolvingCard(true);
    try {
      const res = await travelerCardService.findByBarcode(barcode);
      const card = res.data as TravelerCardLookup | null;
      if (!card) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Toast.show({ type: 'error', text1: 'Refakat kartı bulunamadı', text2: barcode });
        return;
      }
      if (card.status !== 'ACTIVE') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Toast.show({
          type: 'error',
          text1: `Kart geçersiz: ${card.status}`,
          text2: card.cardNumber,
        });
        return;
      }

      // Backend bekleyen kabul yoksa SEBEBİ söyleyen 400 atar ve `details.code`
      // ile doğru aksiyonu bildirir. Eski kod her sebebi sabit "Yanlış istasyon"
      // başlığıyla gösteriyordu — mal doğru istasyonda, sadece sevk edilmemişken
      // bile. Aksiyonu olan iki kod kalıcı karta, gerisi dürüst başlıklı toast'a.
      let matching: PendingReturnGroup[];
      try {
        const pr = await subcontractorService.pendingReturnsByWorkOrder(card.workOrderId);
        matching = pr.data ?? [];
      } catch (err) {
        const e = err as Error & { details?: PendingReturnErrorDetails };
        const details = e.details;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        if (details?.code === 'NEEDS_DISPATCH') {
          setCardBarcode('');
          setScanAction({ kind: 'NEEDS_DISPATCH', message: e.message, details });
          return;
        }
        if (details?.code === 'MAYBE_WRONG_RECEIPT') {
          setCardBarcode('');
          setScanAction({ kind: 'MAYBE_WRONG_RECEIPT', message: e.message, details });
          return;
        }
        Toast.show({
          type: 'error',
          text1:
            details?.code === 'WO_NOT_AT_SUBCONTRACTOR'
              ? 'Bu iş emri fasonda değil'
              : 'Bekleyen kabul bulunamadı',
          text2: e.message,
          visibilityTime: 6000,
        });
        return;
      }

      if (matching.length === 0) {
        Toast.show({
          type: 'info',
          text1: 'Bekleyen sevk yok',
          text2: 'Bu iş emrinde fasonda dönecek top kalmamış.',
        });
        return;
      }

      setCardBarcode('');
      setHighlightedWorkOrderId(card.workOrderId);
      setRightTab('pending');

      if (matching.length === 1) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Toast.show({
          type: 'success',
          text1: 'Sevk bulundu',
          text2: `${matching[0].workOrder.batchNumber} · ${matching[0].step.station.name}`,
        });
        selectGroup(matching[0]);
      } else {
        Toast.show({
          type: 'info',
          text1: `${matching.length} fason adımı bulundu`,
          text2: 'Hangi adımı kabul edeceğinizi seçin',
        });
      }
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'Kart sorgulanamadı',
        text2: (err as Error).message,
      });
    } finally {
      setResolvingCard(false);
    }
  };

  /** Beyan edilen kalan (basit yol). Top bazlı giriş açıkken YOK SAYILIR. */
  const remainderQty = useMemo(() => {
    if (!remainderOpen || perRollQtyOpen) return null;
    const n = parseFloat(remainderStr.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [remainderOpen, perRollQtyOpen, remainderStr]);

  /**
   * Ön-dolu parça metrajlarının TABANI — "bu kabulde kaç metre bekliyoruz".
   *
   * ⚠️ Ham `currentQty` DEĞİL: fasonda kalan beyan edildiyse beklenen metraj o
   * kadar düşer (250 giden - 30 kalan = 220). Ham kalanı yazmak, operatörün
   * kendi söylediği sayıyı yok sayıp her seferinde 30 m'lik sahte bir çekme
   * göstermek olurdu.
   */
  const expectedQtysFor = (src: RollRow[]): number[] =>
    resolveReturns(
      src.map((r) => ({
        rollId: r.rollId,
        checked: r.checked,
        notes: r.notes,
        receivedQtyStr: perRollQtyOpen ? r.receivedQtyStr : undefined,
        remainingQty: Number(r.dispatchedQty ?? 0),
      })),
      remainderQty,
    )
      .filter((r) => !r.dropped)
      .map((r) => r.consumedQty);

  // Kalan beyanı değişince ön-dolu metraj da değişir (elle yazılan korunur —
  // `rebuildPrefilledNewRolls` manuel satıra dokunmaz).
  useEffect(() => {
    if (rows.length === 0) return;
    setNewRolls((curr) => rebuildPrefilledNewRolls(curr, expectedQtysFor(rows), receiveMode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainderQty, perRollQtyOpen]);

  const updateRow = (rollId: string, patch: Partial<RollRow>) => {
    // BİRLEŞTİRME: redesign submitArmed'i kaldırdı (onay modalına geçti); bug-fix'in
    // rebuildPrefilledNewRolls (kısmi kabul) mantığı korunur, setSubmitArmed çağrıları düşer.
    const nextRows = rows.map((r) => (r.rollId === rollId ? { ...r, ...patch } : r));
    setRows(nextRows);
    // Bir top "geldi/gelmedi" işaretlenince ön-dolu açık-kumaş parçalarını
    // işaretli toplara göre yeniden kur (operatörün elle girdiği satırlar korunur).
    // Bu olmadan eksik gelen top işaretten çıkınca ön-dolu parça kalıp fazladan
    // born roll doğuyordu (kısmi kabulde 2 top → KK2'ye 3 top saha bug'ı).
    if ('checked' in patch) {
      setNewRolls((curr) =>
        rebuildPrefilledNewRolls(curr, expectedQtysFor(nextRows), receiveMode),
      );
    }
  };

  /** Gelen metraj değişince ön-dolu parçaları beyana göre yeniden kur. */
  const updateRowQty = (rollId: string, value: string) => {
    const nextRows = rows.map((r) => (r.rollId === rollId ? { ...r, receivedQtyStr: value } : r));
    setRows(nextRows);
    setNewRolls((curr) =>
      rebuildPrefilledNewRolls(curr, expectedQtysFor(nextRows), receiveMode),
    );
  };
  const toggleAllRows = () => {
    const someUnchecked = rows.some((r) => !r.checked);
    const nextRows = rows.map((r) => ({ ...r, checked: someUnchecked }));
    setRows(nextRows);
    setNewRolls((curr) =>
      rebuildPrefilledNewRolls(curr, expectedQtysFor(nextRows), receiveMode),
    );
  };

  // Kabul modu değişince ön-dolu satırlar yeni moda göre yeniden kurulur;
  // operatörün elle eklediği satırlar (prefilled=false) korunur.
  const changeReceiveMode = (mode: ReceiveMode) => {
    if (mode === receiveMode) return;
    setReceiveMode(mode);
    // Mod geçişi operatörün yazdığını KORUR (bkz. switchReceiveMode): parça
    // parçadan tek parçaya geçerken satırlar toplanır, tersinde dokunulmamış
    // toplam top başına açılır. Naif rebuild burada iki satır üretip dönen
    // metrajı sessizce ikiye katlıyordu.
    setNewRolls((curr) => switchReceiveMode(curr, expectedQtysFor(rows), mode));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const checkedCount = rows.filter((r) => r.checked).length;
  const missingCount = rows.length - checkedCount;
  // Tek WO = tek kumaş/en → ilk dolu en değerini referans olarak göster (gelen kumaşın eni).
  const fabricWidth = rows.find((r) => r.width != null)?.width ?? null;

  const parsedNewRolls = useMemo<ReceiveNewRollInput[]>(
    () => parseNewRolls(newRolls),
    [newRolls],
  );
  const hasValidNewRolls = parsedNewRolls.length > 0;

  // ── KALAN DAĞITIMI + ÇEKME (2026-08-21) ───────────────────────────────────
  // Beyan edilen kalan (basit yol) ya da satır başına "Gelen (m)" (kaçış kapısı)
  // TEK yerde dönüş satırlarına çevrilir; ekran da payload da aynı fonksiyonu
  // okur, böylece "gördüğüm ile gönderilen farklı" sınıfı hatalar kapanır.
  const payloadRows = useMemo(
    () =>
      rows.map((r) => ({
        rollId: r.rollId,
        checked: r.checked,
        notes: r.notes,
        receivedQtyStr: perRollQtyOpen ? r.receivedQtyStr : undefined,
        remainingQty: Number(r.dispatchedQty ?? 0),
      })),
    [rows, perRollQtyOpen],
  );
  const effReturns = useMemo(
    () => resolveReturns(payloadRows, remainderQty),
    [payloadRows, remainderQty],
  );
  const effByRoll = useMemo(
    () => new Map(effReturns.map((r) => [r.rollId, r])),
    [effReturns],
  );
  /** Fasonun hesabından bu kabulde DÜŞÜLEN metraj (dönenin kıyas tabanı). */
  const consumedTotal = useMemo(() => consumedTotalOf(effReturns), [effReturns]);
  /** Fasonda kalmaya devam edecek toplam metraj. */
  const leftAtSubTotal = useMemo(
    () => Math.round(effReturns.reduce((s, r) => s + r.leftQty, 0) * 100) / 100,
    [effReturns],
  );
  const leftRollCount = effReturns.filter((r) => r.leftQty > 0.01).length;
  const returnedTotal = useMemo(
    () => parsedNewRolls.reduce((s, r) => s + r.qty, 0),
    [parsedNewRolls],
  );
  /** Dönen − düşülen. Eksi = ÇEKME (boyahanede kumaş çeker; hata değil). */
  const shrink = useMemo(
    () => shrinkInfo(consumedTotal, returnedTotal),
    [consumedTotal, returnedTotal],
  );
  const shrinkCfg = useFasonShrinkWarn();
  /** Uyarı YALNIZ fabrikanın belirlediği toleransın üstünde çıkar. */
  const shrinkWarn = useMemo(
    () => shrinkExceedsTolerance(shrink, shrinkCfg),
    [shrink, shrinkCfg],
  );
  /**
   * "Ölçtün mü?" sondası — tek parça modunda sayı hâlâ OTOMATİK (dokunulmamış)
   * ve giden ile birebir aynıysa, muhtemelen kimse metreye bakmadı. Engel DEĞİL,
   * hatırlatma: eski ekranın kırmızı modalı yerine tek satırlık bir soru.
   */
  /** İşaretli topların fasondaki toplam kalanı — beyan edilen kalanın tavanı. */
  const checkedRemainingTotal = useMemo(
    () =>
      Math.round(
        rows.filter((r) => r.checked).reduce((s, r) => s + Number(r.dispatchedQty ?? 0), 0) * 100,
      ) / 100,
    [rows],
  );
  /**
   * Beyan edilen kalan işaretli toplamın TAMAMINI (ya da fazlasını) yiyorsa
   * kabul edilecek hiçbir metraj kalmaz — bu bir kabul değil, "hiç gelmedi"
   * beyanıdır ve yolu topları işaretten çıkarmaktır. Sessizce boş payload
   * üretip "top seçilmedi" demek operatöre sebebi söylemezdi.
   */
  const remainderInvalid =
    remainderOpen &&
    !perRollQtyOpen &&
    remainderQty != null &&
    remainderQty >= checkedRemainingTotal - 0.01;

  const returnedUntouched =
    receiveMode === 'SINGLE' &&
    newRolls.length === 1 &&
    newRolls[0]!.prefilled &&
    consumedTotal > 0 &&
    Math.abs(returnedTotal - consumedTotal) <= 0.01;

  /**
   * "Bu kabulde uygulanan" eksikleri — ZORUNLULUK BURADA yaşar, API'de değil.
   * Backend'de zorunlu yapmak, alanları göndermeyen sahadaki eski APK'ların HER
   * fason kabulünü 400'e düşürürdü; sözleşme opsiyonel kalır, ekran ısrar eder.
   *
   * Renk yalnız "renk veren" kategoride (boyahane) aranır, en HER dönüşte.
   */
  const missingColor = appliesColor && !appliedColorId;
  /** Plandan FARKLI renk seçildi mi (iş emrinin hedefi varken) — kayıt öncesi tek soru. */
  const planColorId = selectedGroup?.workOrder.targetColor?.id ?? null;
  const planColorName = selectedGroup?.workOrder.targetColor?.name ?? null;
  const colorDiffers = appliesColor && !!planColorId && !!appliedColorId && appliedColorId !== planColorId;
  const missingWidth = parseAppliedWidth(appliedWidth) == null;
  /**
   * Panel AÇIK mı? İki durumda açılır: (a) operatör kendisi açtı (override), ya da
   * (b) eksik var — o zaman operatörün vermesi gereken bir karar vardır ve panel
   * KENDİLİĞİNDEN açılır. İş emrinden ikisi de dolu geldiyse kapalı kalır ve tek
   * satırlık özete iner. FAIL-OPEN bilinçli: "eksikse gizle" davranışı, operatörün
   * göremediği bir alan yüzünden basamadığı bir butonla baş başa bırakırdı.
   */
  const appliedPanelOpen = appliedOpen || missingColor || missingWidth;
  /** Pasif butonun ÜSTÜNE yazılacak eksik metni — buton yalnız grileşip susmaz. */
  const appliedMissingLabel = missingColor
    ? missingWidth
      ? 'Renk ve en girilmeden kabul yapılamaz'
      : 'Renk seçilmeden kabul yapılamaz'
    : missingWidth
      ? 'En girilmeden kabul yapılamaz'
      : null;

  const canSubmit =
    !!selectedGroup &&
    checkedCount > 0 &&
    hasValidNewRolls &&
    !missingColor &&
    !missingWidth &&
    !remainderInvalid;
  // NOT: receiveMutation.isPending bilerek dahil edilmedi — offline'da paused
  // mutation hook'un isPending'i true kalır ve sıradaki kabul aksiyonunu
  // engelleyebilir. Optimistic onMutate zaten form'u temizliyor.
  const hasMissing = missingCount > 0;

  const buildPayload = (): ReceiveRequest | null => {
    // Çoklu sevkte seçilen partinin firması; tekli/eski akışta lastDispatch.
    // Yan etki (Toast) ekranda kalır — payload üretimi saf buildReceivePayload'da.
    if (selectedGroup) {
      const subId = selectedParty?.subcontractorId ?? selectedGroup.lastDispatch?.subcontractorId;
      if (!subId) {
        Toast.show({
          type: 'error',
          text1: 'Fason firma bulunamadı',
          text2: 'Bu adımın aktif sevki yok.',
        });
        return null;
      }
    }
    const base = buildReceivePayload({
      selectedGroup,
      selectedParty,
      // `payloadRows` ekranın da okuduğu satırlardır (top bazlı giriş kapalıysa
      // `receivedQtyStr` hiç taşınmaz) — çekme bandı ile gönderilen payload aynı
      // kaynaktan doğar.
      rows: payloadRows,
      newRolls,
      manifestNo,
      notes,
      appliesColor,
      appliedColorId,
      appliedProperties,
      appliedWidth,
      remainderQty,
      planColorAction: planColorActionRef.current,
    });
    if (!base) return null;
    // İDEMPOTENCY (BULGU-T2-007): aynı teslimat belirsiz bir hatadan sonra
    // yeniden gönderiliyorsa AYNI token'la gitmeli — yoksa sunucu ikinci bir
    // makbuz açar ve metraj çift düşer. Karar `receiveAttempt.ts`te.
    return {
      ...base,
      clientToken: tokenForReceive(failedAttemptRef.current, receiveFingerprint(base)),
    };
  };

  const doSubmit = () => {
    const payload = buildPayload();
    if (!payload) return;
    receiveMutation.mutate(payload);
  };

  const handleSubmitClick = () => {
    if (!selectedGroup) return;
    if (checkedCount === 0) {
      Toast.show({ type: 'error', text1: 'Eksik alan', text2: 'Hiçbir top işaretlenmedi' });
      return;
    }
    if (!hasValidNewRolls) {
      Toast.show({
        type: 'error',
        text1: 'Açık kumaş eksik',
        text2: 'En az bir parça için metraj gir',
      });
      return;
    }
    if (missingColor) {
      Toast.show({
        type: 'error',
        text1: 'Renk seçilmedi',
        text2: 'Bu kabulde uygulanan rengi seçin',
      });
      return;
    }
    if (missingWidth) {
      Toast.show({
        type: 'error',
        text1: 'En girilmedi',
        text2: 'Dönen kumaşın enini (cm) ölçüp yazın',
      });
      return;
    }
    if (!canSubmit) return;
    // Plandan FARKLI renk (2026-08-21): önce tek soru — karar verilmeden kayıt yok.
    if (colorDiffers && planColorActionRef.current == null) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setColorChoiceOpen(true);
      return;
    }
    proceedSubmit();
  };

  /** Renk kararı (varsa) verildikten sonraki yol — uyuşmazlık modalı ya da kayıt. */
  const proceedSubmit = () => {
    // ⚠️ ONAY MODALI ARTIK YALNIZ İKİ DURUMDA (2026-08-21):
    //   • bir top HİÇ gelmedi (işaretsiz) — beyan edilmemiş bir eksik,
    //   • fark toleransı AŞTI — beklenenden fazla çekme / fazla dönen.
    // Beyan edilmiş kalan (operatörün kendi yazdığı sayı) modal ÇIKARMAZ: eski
    // ekran her kısmi satır için kırmızı "giden/gelen uyuşmuyor" basıyordu ve
    // operatörün bilerek yaptığı işi hata gibi gösteriyordu. Kalanın özeti
    // kutunun altında zaten yazılı.
    if (hasMissing || shrinkWarn) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setMismatchConfirmOpen(true);
      return;
    }
    doSubmit();
  };

  const allGroups = pendingQuery.data?.data ?? [];

  // Sıralama: highlight'lı en üstte, sonra dispatch tarihine göre yeni-üstte
  const sortedGroups = useMemo(() => {
    const list = [...allGroups];
    list.sort((a, b) => {
      const aHi = highlightedWorkOrderId && a.workOrder.id === highlightedWorkOrderId ? 1 : 0;
      const bHi = highlightedWorkOrderId && b.workOrder.id === highlightedWorkOrderId ? 1 : 0;
      if (aHi !== bHi) return bHi - aHi;
      const aT = a.lastDispatch?.dispatchedAt ?? '';
      const bT = b.lastDispatch?.dispatchedAt ?? '';
      return bT.localeCompare(aT);
    });
    return list;
  }, [allGroups, highlightedWorkOrderId]);

  const filteredGroups = useMemo(() => {
    const q = foldSearchText(searchQ);
    if (q.length < 2) return sortedGroups;
    const hit = (s?: string | null) => !!s && foldSearchText(s).includes(q);
    const hitAny = (arr?: string[]) => !!arr && arr.some((s) => hit(s));
    return sortedGroups.filter(
      (g) =>
        hit(g.workOrder.batchNumber) ||
        hit(g.lastDispatch?.subcontractor?.name) ||
        hit(g.step.station.name) ||
        hitAny(g.itemNames) ||
        hitAny(g.colorNames) ||
        hitAny(g.cardNumbers),
    );
  }, [sortedGroups, searchQ]);

  // ── Render ──
  return (
    <ScreenChrome
      title="Fason Kabul"
      headerExtras={
        <View style={styles.headerExtrasRow}>
          {/* Telefon dikeyde aksiyonlar alt baş-parmak barına taşınır. Tablet
              header'ında soldan: "Kamera ile Okut" + "Bekleyen Sevkler" +
              "Yenile" (en sağda, profilin solunda). Kamera çalışıyorken okutma
              buradaki chip'ten; kamera arızalı seçiliyse chip gizlenir, sağ
              kolonda HID/elle metin girişi açılır. */}
          {!isPhone && !manualBarcodeEntry && (
            <HeaderChip
              icon="camera"
              label="Kamera ile Okut"
              onPress={() => setScannerOpen(true)}
              accent
            />
          )}
          <SyncStatusChip />
          {!isPhone && (
            <HeaderChip
              icon="format-list-bulleted"
              label="Bekleyen Sevkler"
              onPress={() => setListModalOpen(true)}
            />
          )}
          {!isPhone && (
            <RefreshButton
              headerStyle
              label="Yenile"
              onPress={refresh.onRefresh}
              refreshing={refresh.refreshing}
              isError={refresh.isError}
              errorMessage={refresh.errorMessage}
              successMessage={refresh.successMessage}
            />
          )}
        </View>
      }
    >
      <View style={[styles.body, isPhone && styles.bodyPhone]}>
        {/* Telefon dikey: kart giriş bandı ÜST sabit çubuk olarak — klavye
            açılınca altında kalmasın (rightCol telefonda render edilmiyor). */}
        {isPhone && manualBarcodeEntry && (
          <View style={styles.cardInputWrap}>
            <ScannerEntryBar
              value={cardBarcode}
              onChangeText={setCardBarcode}
              placeholder="Refakat kartı barkodu okut/yaz..."
              onResolve={() => handleResolveCard()}
              resolving={resolvingCard}
              tone="green"
            />
          </View>
        )}
        {/* ════════ SOL: form ════════ */}
        {/* Klavye yönetimi: Toplar listesi KeyboardAwareScrollView (klavye kapalıyken
            düz ScrollView), sabit footer ise footerAnimStyle ile klavyenin üstüne
            YUMUŞAKÇA çıkar (bottom offset = klavye yüksekliği − alt inset). Kolon
            seviyesinde KAV YOK — çift telafi olmasın diye düz View. */}
        <View
          style={[styles.formCol, isPhone && !selectedGroup && styles.formColPhone]}
        >
          {!selectedGroup ? (
            scanAction ? (
              /* ════ Kart okutuldu ama kabul edilemez — SEBEP + AKSİYON ════ */
              <ScanActionCard
                action={scanAction}
                canGoFasonSevk={canGoFasonSevk}
                onGoFasonSevk={() => {
                  const woId =
                    scanAction.kind === 'NEEDS_DISPATCH'
                      ? scanAction.details.workOrderId
                      : null;
                  setScanAction(null);
                  nav.navigate('FasonSevk', woId ? { workOrderId: woId } : undefined);
                }}
                onCancelReceipt={() => {
                  if (scanAction.kind !== 'MAYBE_WRONG_RECEIPT') return;
                  // Hazır iptal akışını kullan (yeni akış YOK): hedef makbuzu set et,
                  // CancelReceiptModal önizlemesiyle birlikte açılsın.
                  setCancelReason('');
                  setCancelTargetReceiptId(scanAction.details.receiptId);
                }}
                onDismiss={() => setScanAction(null)}
              />
            ) : (
              <View style={styles.emptyState}>
                <Icon source="package-down" size={64} color="#cbd5e1" />
                <Text style={styles.emptyTitle}>Sevk seçilmedi</Text>
                <Text style={styles.emptyHint}>
                  {isPhone
                    ? 'Alttan "Bekleyen"e basıp bir sevk seçin veya "Kamera ile Okut" ile refakat kartını okutun'
                    : 'Sağdan bekleyen bir sevke tıklayın veya refakat kartını okutun'}
                </Text>
              </View>
            )
          ) : showPartyChooser ? (
            /* ════ Çoklu sevk: ÖNCE hangi parti geldi teyidi ════ */
            <>
              <Surface style={styles.headerBand} elevation={2}>
                <View style={styles.headerCellMain}>
                  <Text style={styles.headerBatch} numberOfLines={1}>
                    {selectedGroup.workOrder.batchNumber}
                  </Text>
                  <View style={styles.headerFirmRow}>
                    <Icon source="factory" size={13} color="#94a3b8" />
                    <Text style={styles.headerFirmName} numberOfLines={1}>
                      {selectedGroup.lastDispatch?.subcontractor?.name ?? '—'}
                    </Text>
                  </View>
                </View>
                <IconButton
                  icon="close"
                  size={20}
                  onPress={resetForm}
                  accessibilityLabel="Sıfırla"
                  style={{ margin: 0 }}
                />
              </Surface>

              <View style={styles.partyHintCard}>
                <Icon source="call-split" size={20} color="#b45309" />
                <Text style={styles.partyHintText}>
                  Bu adımda {partyList.length} ayrı parti boyahanede, ayrı ayrı
                  dönebilir. Geleni seçin — her parti AYRI kabul edilir, diğerleri
                  beklemede kalır.
                </Text>
              </View>

              <ScrollView
                style={styles.rollsScroll}
                contentContainerStyle={styles.rollsContent}
              >
                {partyList.map((party, idx) => (
                  <TouchableRipple
                    key={party.dispatchId ?? `p-${idx}`}
                    onPress={() => selectParty(party)}
                    style={styles.partyCard}
                    borderless
                  >
                    <View style={styles.partyCardInner}>
                      <View style={styles.partyIndexBadge}>
                        <Text style={styles.partyIndexText}>{idx + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.partyCardTitle} numberOfLines={1}>
                          {formatPartyNo(party.dispatchNo) ?? 'Parti (kimliksiz)'}
                        </Text>
                        <Text style={styles.partyCardMeta} numberOfLines={1}>
                          {party.rollCount} top · {party.totalQty.toFixed(1)} m
                          {party.subcontractor?.name
                            ? ` · ${party.subcontractor.name}`
                            : ''}
                        </Text>
                        {party.dispatchedAt && (
                          <Text style={styles.partyCardDate}>
                            Sevk: {dayjs(party.dispatchedAt).format('DD.MM.YYYY HH:mm')}
                          </Text>
                        )}
                      </View>
                      <Icon source="chevron-right" size={26} color="#94a3b8" />
                    </View>
                  </TouchableRipple>
                ))}
              </ScrollView>
            </>
          ) : (
            <>
              {/* Sticky header band — Parti Kodu, altında fason firma adı (adım
                  YAZMAZ; firma adından hangi işlem olduğu zaten anlaşılır), onun da
                  altında uygulanacak renk + üretim özellikleri (boyahane kategorisi). */}
              <Surface style={styles.headerBand} elevation={2}>
                <View style={styles.headerCellMain}>
                  <Text style={styles.headerBatch} numberOfLines={1}>
                    {selectedGroup.workOrder.batchNumber}
                  </Text>
                  <View style={styles.headerFirmRow}>
                    <Icon source="factory" size={13} color="#94a3b8" />
                    <Text style={styles.headerFirmName} numberOfLines={1}>
                      {selectedParty?.subcontractor?.name ??
                        selectedGroup.lastDispatch?.subcontractor?.name ??
                        '—'}
                    </Text>
                  </View>
                </View>
                {/* Üretim özellikleri SAĞDA — salt bilgi, dokunulmaz.
                    RENK BURADAN TAŞINDI (2026-08-05): artık seçilebilir bir alan
                    olduğu için başlığın altındaki "uygulanan" satırında yaşıyor —
                    56dp dokunma hedefi bu dar başlık şeridine sığmaz. */}
                {appliesColor && appliedProperties.length > 0 && (
                  <View style={styles.headerAppliesRow}>
                    {appliedProperties.map((p) => (
                      <View key={p.id} style={styles.appliesPropertyChip}>
                        <Text style={styles.appliesPropertyChipText}>
                          {p.name}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                <IconButton
                  icon="close"
                  size={20}
                  onPress={resetForm}
                  accessibilityLabel="Sıfırla"
                  style={{ margin: 0 }}
                />
              </Surface>

              {/* ── BU KABULDE UYGULANAN: renk (varsa) + en ────────────────────
                  Renk YALNIZ "renk veren" kategoride (boyahane) sorulur; EN HER
                  fason dönüşünde sorulur — ikisinin koşulu bilerek AYRI. Topun eni
                  sisteme ilk kez burada giriyor (ham girişte en tasarım gereği
                  yazılmıyor), yani yalnız boyahaneye bağlansaydı zımparadan dönen
                  top sonsuza dek ensiz kalırdı.
                  Yeni BÖLÜM açılmadı: tek satır, başlığın hemen altında — ekran
                  uzamasın, operatör nereye basacağını aramasın. */}
              <Surface style={styles.appliedBand} elevation={1}>
                {/* KAPALI: iş emrinden renk+en dolu geldi → tek satır özet.
                    Dokununca açılır (override). Emsal: "İrsaliye No / Kabul Notu". */}
                {!appliedPanelOpen ? (
                  <TouchableRipple
                    onPress={() => setAppliedOpen(true)}
                    style={styles.appliedToggle}
                    borderless
                    accessibilityLabel="Uygulanan renk ve eni değiştir"
                  >
                    <View style={styles.appliedToggleInner}>
                      <Icon source="pencil" size={15} color="#64748b" />
                      <Text style={styles.appliedToggleText} numberOfLines={1}>
                        {[
                          appliesColor
                            ? `Renk: ${appliedColorLabel ?? '—'}`
                            : null,
                          `En: ${appliedWidth} cm`,
                        ]
                          .filter(Boolean)
                          .join('  ·  ')}
                        {'   '}(değiştirmek için dokun)
                      </Text>
                    </View>
                  </TouchableRipple>
                ) : (
                  <>
                <View style={styles.appliedRow}>
                  {appliesColor && (
                    <View style={styles.appliedCol}>
                      <Text style={styles.appliedLabel}>UYGULANAN RENK</Text>
                      <ColorSelectField
                        value={appliedColorId}
                        onChange={setAppliedColorId}
                        onLabelResolved={setAppliedColorLabel}
                        showClear={false}
                      />
                    </View>
                  )}
                  <View style={[styles.appliedCol, styles.appliedColWidth]}>
                    <Text style={styles.appliedLabel}>EN (cm)</Text>
                    <NumpadInput
                      mode="outlined"
                      dense
                      value={appliedWidth}
                      onChangeText={setAppliedWidth}
                      numpadLabel="En (cm)"
                      placeholder="ölç ve yaz"
                      useNativeKeyboard
                      autoActivate={false}
                      style={styles.appliedWidthInput}
                    />
                  </View>
                </View>
                {/* GİDEN topun eni yalnız İPUCU — alana ÖN DOLDURULMAZ. Ön değer
                    İŞ EMRİNİN hedef eninden gelir; giden topunki terbiye ÖNCESİ
                    ölçüdür ve ram/fikse/sanfor tam da onu değiştirir. Oradan
                    doldurmak, ölçülmemiş bir rakamı ölçülmüş gibi kaydetmek olurdu. */}
                <Text style={styles.appliedHint}>
                  {fabricWidth != null
                    ? `Bu kabuldeki tüm parçalara uygulanır · giden topun eni: ${fabricWidth} cm`
                    : 'Bu kabuldeki tüm parçalara uygulanır'}
                </Text>
                  </>
                )}
              </Surface>

              {/* Çoklu parti: aktif parti + diğerlerine dönüş */}
              {isMultiParty && selectedParty && (
                <TouchableRipple
                  onPress={() => {
                    setSelectedParty(null);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  borderless
                  style={styles.activePartyBar}
                >
                  <View style={styles.activePartyBarInner}>
                    <Icon source="arrow-left" size={18} color="#1d4ed8" />
                    <Text style={styles.activePartyBarText} numberOfLines={1}>
                      {formatPartyNo(selectedParty.dispatchNo) ?? '—'} ·{' '}
                      diğer {partyList.length - 1} parti beklemede
                    </Text>
                    {fabricWidth != null && (
                      <View style={styles.partyWidthPill}>
                        <Icon
                          source="arrow-expand-horizontal"
                          size={13}
                          color="#1d4ed8"
                        />
                        <Text style={styles.partyWidthPillText}>
                          En {fabricWidth} cm
                        </Text>
                      </View>
                    )}
                    <Text style={styles.activePartyBarChange}>Değiştir</Text>
                  </View>
                </TouchableRipple>
              )}

              {/* Toplar listesi. KeyboardAwareScrollView klavye açılınca odaklı
                  input'u (Metre/Not) üste kaydırır; klavye kapalıyken düz ScrollView
                  gibi davranır (regresyon yok). */}
              <KeyboardAwareScrollView
                style={styles.rollsScroll}
                contentContainerStyle={styles.rollsContent}
                keyboardShouldPersistTaps="handled"
                bottomOffset={120}
              >
                <View style={styles.rollsHeaderRow}>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusBadgeText}>
                      {checkedCount}/{rows.length} onaylı
                    </Text>
                    {missingCount > 0 && (
                      <View style={styles.missingPill}>
                        <Text style={styles.missingPillText}>
                          {missingCount} eksik
                        </Text>
                      </View>
                    )}
                  </View>
                  <Button
                    mode="text"
                    compact
                    onPress={toggleAllRows}
                    icon={
                      rows.every((r) => r.checked)
                        ? 'checkbox-blank-outline'
                        : 'checkbox-marked-outline'
                    }
                  >
                    {rows.every((r) => r.checked) ? 'Hepsini Kaldır' : 'Hepsini İşaretle'}
                  </Button>
                </View>

                {rows.map((row, idx) => (
                  <Surface
                    key={row.rollId}
                    style={[styles.rollItem, !row.checked && styles.rollItemMissing]}
                    elevation={0}
                  >
                    <TouchableRipple
                      borderless
                      onPress={() => updateRow(row.rollId, { checked: !row.checked })}
                      style={styles.rollTouch}
                    >
                      <View style={styles.rollRow}>
                        <Checkbox
                          status={row.checked ? 'checked' : 'unchecked'}
                          onPress={() =>
                            updateRow(row.rollId, { checked: !row.checked })
                          }
                        />
                        <View style={styles.rollIndex}>
                          <Text
                            style={[
                              styles.rollIndexText,
                              !row.checked && { color: '#dc2626' },
                            ]}
                          >
                            {idx + 1}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.rollTopLine}>
                            <Text style={styles.rollBarcode} numberOfLines={1}>
                              {row.barcode ?? '—'}
                            </Text>
                            {!row.checked && (
                              <View style={styles.missingTag}>
                                <Text style={styles.missingTagText}>EKSİK</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.rollItemName} numberOfLines={1}>
                            {row.itemName}
                            {row.colorName ? ` · ${row.colorName}` : ''}
                          </Text>
                          <View style={styles.rollBadges}>
                            <Badge icon="arrow-expand-vertical">
                              {`${Number(row.dispatchedQty ?? 0).toFixed(1)} mt`}
                            </Badge>
                            {row.sentQty != null &&
                              Number(row.dispatchedQty ?? 0) < row.sentQty - 0.01 && (
                                <View style={styles.partialTag}>
                                  <Text style={styles.partialTagText}>
                                    {`YARIM · ${fmtMeters(Number(row.dispatchedQty ?? 0))}/${fmtMeters(row.sentQty)} m`}
                                  </Text>
                                </View>
                              )}
                            {row.sentAt != null &&
                              (() => {
                                const days = Math.floor(
                                  (Date.now() - new Date(row.sentAt).getTime()) / 86_400_000,
                                );
                                if (days < 1) return null;
                                // 7+ gün: amber — "kalan gelmeyecek mi?" sorusunun görünür hâli
                                // (kapama ELLE yapılır, sistem yalnız yaşı gösterir).
                                const aged = days >= 7;
                                return (
                                  <View style={[styles.ageTag, aged && styles.ageTagWarn]}>
                                    <Text style={[styles.ageTagText, aged && styles.ageTagTextWarn]}>
                                      {`${days} gündür fasonda`}
                                    </Text>
                                  </View>
                                );
                              })()}
                            {row.width != null && (
                              <Badge icon="arrow-expand-horizontal">
                                {`${row.width} cm`}
                              </Badge>
                            )}
                            <Badge icon="star-circle">{row.qualityGrade}</Badge>
                            {row.notes && (
                              <Badge icon="note-text">{`Not: ${row.notes.slice(0, 24)}${row.notes.length > 24 ? '…' : ''}`}</Badge>
                            )}
                          </View>
                        </View>
                        <IconButton
                          icon={
                            row.noteOpen
                              ? 'chevron-up'
                              : row.notes
                                ? 'pencil'
                                : 'pencil-plus-outline'
                          }
                          size={22}
                          iconColor={row.notes ? '#0369a1' : '#64748b'}
                          onPress={() =>
                            updateRow(row.rollId, { noteOpen: !row.noteOpen })
                          }
                          accessibilityLabel="Topa not ekle"
                          style={{ margin: 0 }}
                        />
                        {/* Kalan gelmeyecek — fasondaki kalanı FİRE kararıyla kapat
                            (kısmi teslimat sonrası kalan ya da hiç dönmeyecek top). */}
                        <IconButton
                          icon="fire-alert"
                          size={22}
                          iconColor="#b45309"
                          onPress={() => setRemainderTarget(row)}
                          accessibilityLabel="Fasondaki kalanı kapat (gelmeyecek)"
                          style={{ margin: 0 }}
                        />
                      </View>
                    </TouchableRipple>
                    {/* TOP BAZLI GİRİŞ — varsayılan GİZLİ (2026-08-21).
                        "Bu toptan kaç metre geldi?" sorusunun boyahane işinde
                        fiziksel cevabı yok: parçalar dikilip tek parça boyanır.
                        Kaçış kapısı olarak duruyor (aşağıdaki anahtarla açılır);
                        normal yolda kalan TEK kutudan beyan edilir. */}
                    {row.checked && perRollQtyOpen && (
                      <View style={styles.gelenRow}>
                        <Text style={styles.gelenLabel}>Gelen (m)</Text>
                        <TextInput
                          mode="outlined"
                          dense
                          value={row.receivedQtyStr}
                          onChangeText={(v) => updateRowQty(row.rollId, v)}
                          keyboardType="numeric"
                          style={styles.gelenInput}
                          right={
                            rowIsPartial(row) ? (
                              <TextInput.Icon icon="clock-alert-outline" color="#b45309" />
                            ) : undefined
                          }
                        />
                        {rowIsPartial(row) && (
                          <Text style={styles.gelenPartialText}>
                            {`Kalan ${fmtMeters(Number(row.dispatchedQty ?? 0) - rowGelen(row))} m fasonda BEKLEMEDE kalacak`}
                          </Text>
                        )}
                      </View>
                    )}
                    {/* Basit yolda kalanın hangi topa yığıldığını SATIRIN KENDİSİ
                        söyler — dağıtım sistemin kurgusudur, operatör onu
                        gördüğü yerde doğrulayabilmeli. */}
                    {row.checked && !perRollQtyOpen && (effByRoll.get(row.rollId)?.leftQty ?? 0) > 0.01 && (
                      <View style={styles.leftHintRow}>
                        <Icon source="clock-alert-outline" size={14} color="#b45309" />
                        <Text style={styles.leftHintText}>
                          {effByRoll.get(row.rollId)!.dropped
                            ? `Bu top gelmedi — ${fmtMeters(effByRoll.get(row.rollId)!.leftQty)} m fasonda kalacak`
                            : `${fmtMeters(effByRoll.get(row.rollId)!.leftQty)} m fasonda kalacak · ${fmtMeters(effByRoll.get(row.rollId)!.consumedQty)} m kabul`}
                        </Text>
                      </View>
                    )}
                    {row.noteOpen && (
                      <View style={styles.noteWrap}>
                        <TextInput
                          mode="outlined"
                          value={row.notes}
                          onChangeText={(v) => updateRow(row.rollId, { notes: v })}
                          placeholder="Bu topa dair not (hasarlı, kirli vb.)..."
                          dense
                          style={styles.input}
                        />
                      </View>
                    )}
                  </Surface>
                ))}

                {/* ── Fasonda kalan var mı? (2026-08-21) ──────────────────────
                    Kısmi teslimatın TEK soruluk hâli. Eski akışta operatör bu
                    bilgiyi satır satır "Gelen (m)" alanlarını düşürerek anlatmak
                    zorundaydı ve her düşürdüğü satır ayrı bir yarım top
                    doğuruyordu; boyahane topları dikip tek parça döndürdüğü için
                    o metrajların topa göre dağılımı zaten uydurmaydı.

                    ⚠️ YERLEŞİM DİKEY — SORU, CEVAP, DETAY ALT ALTA. 2026-08-25'e kadar
                    başlık ile SegmentedButtons AYNI SATIRDAYDI ve sahada "devasa
                    boşluk, ortasında evet/hayır" olarak görüldü. Mekanizma (tablette
                    uiautomator ile ölçüldü): RN Paper SegmentedButtons'ın her düğmesi
                    `flex: 1`dir; Yoga, flex-grow çocuğu olan bir kabı "at-most"
                    ölçümünde MEVCUT GENİŞLİĞİN TAMAMINA açar → yanındaki `flex: 1`
                    başlık kutusu SIFIR genişlik alır → sıfır genişlikte metin
                    karakter karakter alt alta sarılır ("Fasonda kalan var mı?" 21
                    karakter × ~18 px ≈ 380 px GÖRÜNMEZ yükseklik; açıklama ~100
                    karakter → asıl "devasa" boşluk). Soru hiç ekrana çıkmıyordu; bu
                    yüzden operatör "neyin evet/hayır'ı" diye sordu. Bekçi:
                    `segmented-buttons-row.guard.test.ts`. */}
                <Surface style={styles.remainderCard} elevation={0}>
                  <View style={styles.remainderTitleRow}>
                    <Icon source="help-circle-outline" size={18} color="#0f172a" />
                    <Text style={styles.remainderTitle}>Fasonda kalan var mı?</Text>
                  </View>
                  {perRollQtyOpen ? (
                    /* İki dil aynı anda okunmaz: top bazlı girişte kalan her satırda
                       ayrı yazılır, tek soru gizlenir. */
                    <Text style={styles.remainderHint}>
                      Top bazlı giriş açık — her topun geleni satırında yazılır, kalan
                      oradan hesaplanır.
                    </Text>
                  ) : (
                    <>
                      <Text style={styles.remainderHint}>
                        Boyahane malın bir kısmını sonra gönderecekse toplam metresini
                        yaz — hangi toptan düşüleceğini sistem hesaplar.
                      </Text>
                      {/* Seçenek metinleri KENDİNİ ANLATIR ("Evet/Hayır" DEĞİL): başlık
                          okunmasa da hangi kararın verildiği düğmeden belli olsun. */}
                      <SegmentedButtons
                        value={remainderOpen ? 'partial' : 'all'}
                        onValueChange={(v) => {
                          const on = v === 'partial';
                          setRemainderOpen(on);
                          if (!on) setRemainderStr('');
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                        style={styles.remainderSwitch}
                        buttons={[
                          { value: 'all', label: 'Hepsi geldi', icon: 'check-all' },
                          {
                            value: 'partial',
                            label: 'Bir kısmı fasonda kaldı',
                            icon: 'clock-alert-outline',
                          },
                        ]}
                      />
                    </>
                  )}
                  {remainderOpen && !perRollQtyOpen && (
                    <View style={styles.remainderBody}>
                      <TextInput
                        mode="outlined"
                        label="Fasonda kalan (m)"
                        value={remainderStr}
                        onChangeText={setRemainderStr}
                        keyboardType="decimal-pad"
                        dense
                        error={remainderInvalid}
                        style={styles.remainderInput}
                      />
                      {remainderInvalid ? (
                        <Text style={styles.remainderError}>
                          {`Kalan, işaretli topların toplamından (${fmtMeters(checkedRemainingTotal)} m) az olmalı — hiç mal gelmediyse topları işaretten çıkarın.`}
                        </Text>
                      ) : leftAtSubTotal > 0.01 ? (
                        <Text style={styles.remainderSummary}>
                          {`${fmtMeters(leftAtSubTotal)} m (${leftRollCount} top) fasonda bekleyecek · ${fmtMeters(consumedTotal)} m bu kabulde düşülecek. Kalan geldiğinde AYNI kartı okutup ikinci kabulü yapın.`}
                        </Text>
                      ) : null}
                    </View>
                  )}
                  {/* KAÇIŞ KAPISI — etiketi korunmuş parça / tek toplu kabulde
                      metraj gerçekten top bazlı bilinir. Açıkken kalan kutusu
                      devre dışı: iki dil aynı anda okunmaz. */}
                  <TouchableRipple
                    onPress={() => {
                      setPerRollQtyOpen((v) => !v);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={styles.remainderModeToggle}
                    borderless
                  >
                    <View style={styles.remainderModeToggleInner}>
                      <Icon
                        source={perRollQtyOpen ? 'chevron-up' : 'table-edit'}
                        size={15}
                        color="#64748b"
                      />
                      <Text style={styles.remainderModeToggleText}>
                        {perRollQtyOpen
                          ? 'Basit girişe dön (tek kalan kutusu)'
                          : 'Top bazlı gir (her topun geleni ayrı)'}
                      </Text>
                    </View>
                  </TouchableRipple>
                </Surface>

                {/* ── Dönen Açık Kumaş ── */}
                <View style={styles.newRollSection}>
                  <View style={styles.newRollHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.newRollTitle}>Dönen Açık Kumaş</Text>
                      <Text style={styles.newRollHint} numberOfLines={3}>
                        {receiveMode === 'SINGLE'
                          ? 'Toplar dikili TEK parça döndü — GELEN TOPLAM METREYİ yaz. Parça parça geldiyse "Adet Adet Geldi"yi seç.'
                          : 'İrsaliyede yazılı her parça için metraj gir. KK2/Kurşun ekranı ve stok bu kayıtlardan beslenir.'}
                      </Text>
                    </View>
                    {/* "Parça Ekle" YALNIZ parça-parça modunda: tek parça derken
                        ikinci bir parça satırı açmak modun kendisiyle çelişir
                        (ve dönen metrajı sessizce ikiye katlıyordu). */}
                    {receiveMode === 'PER_ROLL' && (
                      <Button
                        mode="contained-tonal"
                        icon="plus"
                        onPress={addNewRoll}
                        compact
                      >
                        Parça Ekle
                      </Button>
                    )}
                  </View>
                  {/* Varsayılan: dikili tek parça. İstisna: gittiği adet kadar geldi. */}
                  <SegmentedButtons
                    value={receiveMode}
                    onValueChange={(v) => changeReceiveMode(v as ReceiveMode)}
                    density="small"
                    style={styles.modeSwitch}
                    buttons={[
                      {
                        value: 'SINGLE',
                        label: 'Tek Parça (Dikili)',
                        icon: 'needle',
                      },
                      {
                        value: 'PER_ROLL',
                        label: 'Adet Adet Geldi',
                        icon: 'format-list-numbered',
                      },
                    ]}
                  />
                  {/* ÇEKME BANDI (2026-08-21) — eski "EKSİK DÖNEN / uyuşmuyor"
                      alarmının yerine. Boyahanede kumaş çeker: 250 m giden mal
                      220 m döner ve bu bir HATA DEĞİL üretim gerçeğidir. Bant
                      farkı ADIYLA yazar; kırmızıya yalnız fabrikanın belirlediği
                      tolerans aşılınca döner. */}
                  {shrink.significant && (
                    <Surface
                      style={[styles.diffBanner, shrinkWarn && styles.diffBannerWarn]}
                      elevation={0}
                    >
                      <Text
                        style={[styles.diffBannerTitle, shrinkWarn && styles.diffBannerTitleWarn]}
                      >
                        {shrink.shrink
                          ? `ÇEKME: ${fmtMeters(Math.abs(shrink.diff))} m (%${shrink.pct})`
                          : `FAZLA DÖNEN: +${fmtMeters(shrink.diff)} m (%${shrink.pct})`}
                      </Text>
                      <Text style={styles.diffBannerBody}>
                        {`Giden ${fmtMeters(consumedTotal)} m  ·  Gelen ${fmtMeters(returnedTotal)} m`}
                        {shrinkWarn
                          ? `  —  beklenenin (%${shrinkCfg.tolerancePct}) üstünde, onay istenecek`
                          : shrinkCfg.enabled
                            ? `  —  normal aralıkta (%${shrinkCfg.tolerancePct} tolerans)`
                            : ''}
                      </Text>
                    </Surface>
                  )}
                  {returnedUntouched && (
                    <Text style={styles.untouchedHint}>
                      Gelen metre giden ile aynı ve otomatik dolduruldu — kumaşı ölçtünüz mü?
                    </Text>
                  )}
                  {newRolls.length === 0 ? (
                    <Surface style={styles.newRollEmpty} elevation={0}>
                      <Text style={styles.newRollEmptyText}>
                        {receiveMode === 'SINGLE'
                          ? 'Gelen topları işaretleyin — metre kutusu burada açılır'
                          : 'En az bir açık kumaş parçası gerekli — "Parça Ekle"'}
                      </Text>
                    </Surface>
                  ) : receiveMode === 'SINGLE' ? (
                    /* TEK PARÇA — ekranın TEK sorusu. Kutu bilerek büyük: bu
                       sayı kabulün en önemli verisidir ve otomatik dolduğu için
                       gözden kaçmaya en açık olanıdır. */
                    <View style={styles.singleQtyWrap}>
                      <TextInput
                        mode="outlined"
                        label="Gelen toplam metre"
                        value={newRolls[0]!.qty}
                        onChangeText={(v) => updateNewRoll(newRolls[0]!.key, { qty: v })}
                        keyboardType="decimal-pad"
                        style={styles.singleQtyInput}
                        error={!hasValidNewRolls && newRolls[0]!.qty.length > 0}
                        right={<TextInput.Affix text="m" />}
                      />
                      <Text style={styles.singleQtyHint}>
                        {`Giden: ${fmtMeters(consumedTotal)} m${
                          newRolls[0]!.prefilled ? '  ·  otomatik dolduruldu' : ''
                        }`}
                      </Text>
                    </View>
                  ) : (
                    newRolls.map((r, idx) => {
                      const qtyNum = parseFloat(r.qty.replace(',', '.'));
                      const qtyValid = Number.isFinite(qtyNum) && qtyNum > 0;
                      return (
                        <Surface
                          key={r.key}
                          style={[
                            styles.newRollItem,
                            !qtyValid && styles.newRollItemInvalid,
                          ]}
                          elevation={0}
                        >
                          <View style={styles.newRollRow}>
                            <View style={styles.newRollIndex}>
                              <Text style={styles.newRollIndexText}>{idx + 1}</Text>
                            </View>
                            <TextInput
                              mode="outlined"
                              label="Metre (m)"
                              value={r.qty}
                              onChangeText={(v) => updateNewRoll(r.key, { qty: v })}
                              keyboardType="decimal-pad"
                              dense
                              style={styles.newRollQty}
                              error={!qtyValid && r.qty.length > 0}
                            />
                            <IconButton
                              icon={
                                r.noteOpen
                                  ? 'chevron-up'
                                  : r.notes
                                    ? 'pencil'
                                    : 'pencil-plus-outline'
                              }
                              size={22}
                              iconColor={r.notes ? '#0369a1' : '#64748b'}
                              onPress={() =>
                                updateNewRoll(r.key, { noteOpen: !r.noteOpen })
                              }
                              accessibilityLabel="Parçaya not ekle"
                              style={{ margin: 0 }}
                            />
                            <IconButton
                              icon="close"
                              size={22}
                              iconColor="#dc2626"
                              onPress={() => removeNewRoll(r.key)}
                              disabled={newRolls.length === 1}
                              accessibilityLabel="Parçayı sil"
                            />
                          </View>
                          {r.noteOpen && (
                            <View style={styles.newRollNoteWrap}>
                              <TextInput
                                mode="outlined"
                                value={r.notes}
                                onChangeText={(v) =>
                                  updateNewRoll(r.key, { notes: v })
                                }
                                placeholder="Örn: ikinci yarı leke var"
                                dense
                                autoFocus
                                returnKeyType="done"
                                onSubmitEditing={() =>
                                  updateNewRoll(r.key, { noteOpen: false })
                                }
                                style={styles.input}
                              />
                            </View>
                          )}
                          {!r.noteOpen && r.notes && (
                            <Text
                              style={styles.newRollNotePreview}
                              numberOfLines={1}
                            >
                              Not: {r.notes}
                            </Text>
                          )}
                        </Surface>
                      );
                    })
                  )}
                </View>
              </KeyboardAwareScrollView>

              {/* Sabit footer — footerAnimStyle klavye açılınca bu footer'ı
                  (bottom offset ile) yumuşakça klavyenin üstüne çıkarır, kapanınca
                  indirir. Animated.View relative flex çocuğu; Surface aynen içinde. */}
              <Animated.View style={footerAnimStyle}>
              <Surface style={styles.footer} elevation={4}>
                {/* İrsaliye No / Kabul Notu opsiyonel → varsayılan kapalı. Kapalıyken
                    dolu ise özet, boşsa "ekle" etiketi; tıklayınca açılır. */}
                <TouchableRipple
                  onPress={() => setExtrasOpen((v) => !v)}
                  style={styles.footerExtrasToggle}
                  borderless
                >
                  <View style={styles.footerExtrasToggleInner}>
                    <Icon
                      source={
                        extrasOpen
                          ? 'chevron-up'
                          : manifestNo || notes
                            ? 'pencil'
                            : 'plus'
                      }
                      size={16}
                      color="#64748b"
                    />
                    <Text style={styles.footerExtrasToggleText} numberOfLines={1}>
                      {extrasOpen
                        ? 'İrsaliye No / Kabul Notu'
                        : manifestNo || notes
                          ? [
                              manifestNo ? `İrsaliye: ${manifestNo}` : null,
                              notes ? `Not: ${notes}` : null,
                            ]
                              .filter(Boolean)
                              .join('  ·  ')
                          : 'İrsaliye No / Kabul Notu ekle (opsiyonel)'}
                    </Text>
                  </View>
                </TouchableRipple>
                {extrasOpen && (
                  <View style={styles.footerInputs}>
                    <TextInput
                      mode="outlined"
                      label="İrsaliye No"
                      value={manifestNo}
                      onChangeText={setManifestNo}
                      placeholder="Opsiyonel"
                      dense
                      autoCapitalize="characters"
                      style={[styles.footerInput, { flex: 1 }]}
                    />
                    <TextInput
                      mode="outlined"
                      label="Kabul Notu"
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="Opsiyonel"
                      dense
                      style={[styles.footerInput, { flex: 1.2 }]}
                    />
                  </View>
                )}
                <Button
                  mode="contained"
                  icon={
                    hasMissing || shrinkWarn ? 'alert-circle-outline' : 'package-check'
                  }
                  onPress={handleSubmitClick}
                  disabled={!canSubmit}
                  style={styles.submitBtn}
                  contentStyle={styles.submitBtnContent}
                  labelStyle={styles.submitBtnLabel}
                  buttonColor={hasMissing || shrinkWarn ? '#d97706' : '#059669'}
                >
                  {/* Eksik varsa buton NE eksik olduğunu yazar; sadece grileşip
                      susmak operatörü "niye basamıyorum" diye aratır.
                      ⚠️ Tolerans İÇİNDEKİ çekme butonu SARARTMAZ — normal işi
                      uyarı rengiyle boyamak, uyarının anlamını tüketir. */}
                  {appliedMissingLabel
                    ? appliedMissingLabel
                    : remainderInvalid
                      ? 'Kalan metraj işaretli toplardan fazla'
                      : hasMissing
                        ? `Mal Kabulü Yap · ${missingCount} top GELMEDİ`
                        : shrinkWarn
                          ? `Mal Kabulü Yap · ${shrink.shrink ? 'ÇEKME' : 'FAZLA'} ${fmtMeters(Math.abs(shrink.diff))} m`
                          : leftAtSubTotal > 0.01
                            ? `Mal Kabulü Yap · ${fmtMeters(leftAtSubTotal)} m fasonda kalacak`
                            : `Mal Kabulü Yap (${checkedCount} top → ${fmtMeters(returnedTotal)} m)`}
                </Button>
              </Surface>
              </Animated.View>
            </>
          )}
        </View>

        {/* ════════ SAĞ: bekleyen + geçmiş (tablet) / sadece manuel input (telefon + kamera arızalı) ════════
            Telefon dikey + kamera-only modda kart okuma, liste ve geçmiş aksiyonları
            header butonlarına taşındı → rightCol komple gizli. Manuel mode aktifse
            sadece input bandı görünür, header butonları input ile birlikte çalışır. */}
        {!isPhone && (
        <View style={[styles.rightCol, isPhone && styles.rightColPhone]}>
          <>
          {/* Kart giriş bandı — yalnız "Kamera arızalı" (manuel) modda görünür.
              Kamera çalışıyorken okutma top bar'daki "Kamera ile Okut" chip'inden
              yapılır; bu bant gizlidir. */}
          {manualBarcodeEntry && (
            <View style={styles.cardInputWrap}>
              <ScannerEntryBar
                value={cardBarcode}
                onChangeText={setCardBarcode}
                placeholder="Refakat kartı barkodu okut/yaz..."
                onResolve={() => handleResolveCard()}
                resolving={resolvingCard}
                tone="green"
              />
            </View>
          )}

          {!isPhone && (
          <>
          {/* Tab bar + aktif tab'ı yenileyen buton. Üç tab:
              - Bekleyen: fasondan dönen ama henüz kabul edilmemiş kartlar
              - İptal Edilebilirler: kabul edilmiş, born roll'lar henüz işlenmedi (filtre)
              - Tüm Kabuller: iptal edilmemiş tüm kabuller (settled + hala-iptal-edilebilir) */}
          <View style={styles.tabBar}>
            <Tab
              label="Bekleyen"
              count={allGroups.length}
              active={rightTab === 'pending'}
              onPress={() => setRightTab('pending')}
              activeColor="#d97706"
            />
            <Tab
              label="İptal Edilebilirler"
              active={rightTab === 'cancellable'}
              onPress={() => setRightTab('cancellable')}
              activeColor="#dc2626"
            />
            <Tab
              label="Tüm Kabuller"
              active={rightTab === 'history'}
              onPress={() => setRightTab('history')}
              activeColor="#059669"
            />
          </View>

          {/* Tab içeriği */}
          {rightTab === 'pending' && (
            <PendingPane
              loading={pendingQuery.isLoading}
              groupLoading={groupLoading}
              groups={filteredGroups}
              selectedStepId={selectedGroup?.step.id ?? null}
              highlightedWorkOrderId={highlightedWorkOrderId}
              searchQ={searchQ}
              onSearchChange={setSearchQ}
              onSelect={selectGroup}
            />
          )}
          {rightTab === 'cancellable' && (
            <HistoryPane
              loading={cancellableReceiptsQuery.isLoading}
              error={cancellableReceiptsQuery.isError ? (cancellableReceiptsQuery.error as Error) : null}
              receipts={cancellableReceipts}
              hasNextPage={cancellableReceiptsQuery.hasNextPage}
              isFetchingNextPage={cancellableReceiptsQuery.isFetchingNextPage}
              onEndReached={() => cancellableReceiptsQuery.fetchNextPage()}
              onShowDetail={setDetailReceiptId}
              onCancel={(id) => {
                setCancelTargetReceiptId(id);
                setCancelReason('');
              }}
              onRefresh={() => cancellableReceiptsQuery.refetch()}
            />
          )}
          {rightTab === 'history' && (
            <HistoryPane
              loading={receiptsQuery.isLoading}
              error={receiptsQuery.isError ? (receiptsQuery.error as Error) : null}
              receipts={allReceipts}
              hasNextPage={receiptsQuery.hasNextPage}
              isFetchingNextPage={receiptsQuery.isFetchingNextPage}
              onEndReached={() => receiptsQuery.fetchNextPage()}
              onShowDetail={setDetailReceiptId}
              /* onCancel verilmedi → ReceiptRow iptal butonunu gizler.
                 Geçmiş kabuller artık iptal edilemez (born roll'lar işleme girdi). */
              onRefresh={() => receiptsQuery.refetch()}
            />
          )}
          </>
          )}
          </>
        </View>
        )}

        {/* Telefon dikey — ekran altında baş-parmak aksiyon barı.
            30 / 40 / 30: Geçmiş (sol) · Kamera ile Okut (orta, ana eylem) ·
            Bekleyen (sağ). Kamera ortada vurgulu dolgulu blok.
            Yalnız bir iş emri/sevk AÇILMAMIŞKEN (selectedGroup yok) görünür —
            kabul ekranı açılınca bu üç tuş anlamsızlaşır (yeşil "Mal Kabulü Yap"
            footer'ı devralır), çıkmak için header'daki ✕ kullanılır. */}
        {isPhone && !selectedGroup && (
          <View style={styles.bottomBar}>
            {/* Flex oranı dış hücre View'lerinde — TouchableRipple'a doğrudan
                flex vermek Paper'da güvenilir değil; ripple hücreyi flex:1 ile
                doldurur. */}
            <View style={styles.bottomBarCellSide}>
              <TouchableRipple
                onPress={() => setHistoryModalOpen(true)}
                style={styles.bottomBarBtn}
                rippleColor="rgba(71, 85, 105, 0.12)"
                accessibilityLabel="Geçmiş kabuller"
              >
                <View style={styles.bottomBarBtnInner}>
                  <Icon source="history" size={24} color="#475569" />
                  <Text style={[styles.bottomBarBtnText, { color: '#475569' }]}>
                    Geçmiş
                  </Text>
                </View>
              </TouchableRipple>
            </View>

            <View style={styles.bottomBarCellPrimary}>
              <TouchableRipple
                onPress={() => setScannerOpen(true)}
                style={[styles.bottomBarBtn, styles.bottomBarBtnPrimaryFill]}
                rippleColor="rgba(255,255,255,0.25)"
                accessibilityLabel="Kamera ile okut"
              >
                <View style={styles.bottomBarBtnInner}>
                  <Icon source="camera" size={30} color="#fff" />
                  <Text style={[styles.bottomBarBtnText, { color: '#fff' }]}>
                    Kamera ile Okut
                  </Text>
                </View>
              </TouchableRipple>
            </View>

            <View style={styles.bottomBarCellSide}>
              <TouchableRipple
                onPress={() => setListModalOpen(true)}
                style={styles.bottomBarBtn}
                rippleColor="rgba(217, 119, 6, 0.12)"
                accessibilityLabel="Bekleyen sevkler"
              >
                <View style={styles.bottomBarBtnInner}>
                  <Icon source="format-list-bulleted" size={24} color="#d97706" />
                  <Text style={[styles.bottomBarBtnText, { color: '#d97706' }]}>
                    Bekleyen
                  </Text>
                </View>
              </TouchableRipple>
            </View>
          </View>
        )}
      </View>

      {/* Plandan FARKLI renk (2026-08-21): kaydetmeden önce TEK soru. Onay = iş
          emri de bu renge döner (plan + toplar); açıklamadaki ikinci düğme =
          sadece bu toplar (sapma kabulde deftere, Tambur tekrar sormaz);
          Vazgeç = hiçbir şey. */}
      <ConfirmDialog
        visible={colorChoiceOpen}
        kind="simple"
        onDismiss={() => setColorChoiceOpen(false)}
        title={`İş emri ${planColorName ?? '—'} istiyor, ${appliedColorLabel ?? 'başka renk'} kabul ediyorsun`}
        confirmLabel={`İş emri de ${appliedColorLabel ?? 'bu renk'} olsun`}
        cancelLabel="Vazgeç"
        onConfirm={() => {
          planColorActionRef.current = 'APPLY_TO_PLAN';
          setColorChoiceOpen(false);
          proceedSubmit();
        }}
        description={
          <View style={{ gap: 10 }}>
            <Text style={styles.mismatchLead}>
              Müşteri rengi değiştirdiyse iş emri de bu renge dönsün. Boyahane yanlış
              boyadıysa yalnız bu toplar bu renkte kalsın — iş emri değişmez.
            </Text>
            <Pressable
              onPress={() => {
                planColorActionRef.current = 'ROLLS_ONLY';
                setColorChoiceOpen(false);
                proceedSubmit();
              }}
              style={({ pressed }) => ({
                alignSelf: 'flex-start',
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: '#b45309',
                opacity: pressed ? 0.7 : 1,
              })}
              accessibilityRole="button"
            >
              <Text style={{ color: '#b45309', fontWeight: '700' }}>Sadece bu toplar — iş emri değişmesin</Text>
            </Pressable>
          </View>
        }
      />

      {/* Giden/gelen uyuşmazlığı — iki-tık yerine belirgin uyarı modalı. */}
      <ConfirmDialog
        visible={mismatchConfirmOpen}
        kind="destructive"
        onDismiss={() => setMismatchConfirmOpen(false)}
        title={hasMissing ? 'Gelmeyen top var' : 'Fark beklenenden büyük'}
        confirmLabel="Yine de Kabul Et"
        cancelLabel="Vazgeç"
        onConfirm={() => {
          setMismatchConfirmOpen(false);
          doSubmit();
        }}
        description={
          <View style={{ gap: 10 }}>
            <Text style={styles.mismatchLead}>
              {hasMissing
                ? 'İşaretlenmemiş top var. Yine de kabul etmek istediğine emin misin?'
                : 'Giden ile gelen arasındaki fark fabrikanın beklediği aralığın üstünde. Metreyi bir daha kontrol et.'}
            </Text>
            {hasMissing && (
              <View style={styles.mismatchRow}>
                <Icon source="alert-circle-outline" size={18} color="#b45309" />
                <Text style={styles.mismatchRowText}>
                  {missingCount} top işaretlenmedi — bu toplar kabul
                  EDİLMEYECEK, adımda beklemede kalacak. ({checkedCount}/
                  {rows.length} kabul)
                </Text>
              </View>
            )}
            {shrinkWarn && (
              <View style={styles.mismatchRow}>
                <Icon source="arrow-expand-vertical" size={18} color="#b45309" />
                <Text style={styles.mismatchRowText}>
                  {shrink.shrink
                    ? `ÇEKME ${fmtMeters(Math.abs(shrink.diff))} m (%${shrink.pct}) — giden ${fmtMeters(consumedTotal)} m, gelen ${fmtMeters(returnedTotal)} m. Beklenen tolerans %${shrinkCfg.tolerancePct}.`
                    : `FAZLA DÖNEN +${fmtMeters(shrink.diff)} m (%${shrink.pct}) — giden ${fmtMeters(consumedTotal)} m, gelen ${fmtMeters(returnedTotal)} m. Başka partiden parça karışmış olabilir.`}
                </Text>
              </View>
            )}
            {/* Beyan edilen kalan modalı TETİKLEMEZ (operatörün kendi kararı),
                ama modal zaten açıldıysa sonucu burada da yazılır. */}
            {leftAtSubTotal > 0.01 && (
              <View style={styles.mismatchRow}>
                <Icon source="clock-alert-outline" size={18} color="#0369a1" />
                <Text style={styles.mismatchRowText}>
                  {`${fmtMeters(leftAtSubTotal)} m (${leftRollCount} top) fasonda BEKLEMEDE kalacak. `}
                  Kalan geldiğinde aynı kartı okutup ikinci kabulü yapın; doğan toplar
                  yeni parti numarası alır.
                </Text>
              </View>
            )}
          </View>
        }
      />

      {/* "Kalan gelmeyecek" — fasondaki kalanı FİRE kararıyla kapat (sebep zorunlu). */}
      <CloseRemainderModal
        target={remainderTarget}
        stepId={selectedGroup?.step.id ?? null}
        loading={closeRemainderMutation.isPending}
        onDismiss={() => setRemainderTarget(null)}
        onConfirm={(reasonCode, reasonText) => {
          if (!remainderTarget || !selectedGroup) return;
          closeRemainderMutation.mutate({
            stepId: selectedGroup.step.id,
            rollId: remainderTarget.rollId,
            reasonCode,
            reasonText,
          });
        }}
      />

      {/* Detay modal — kendi AppModal'ı (Portal + swipe). Telefon Geçmiş modalı
          açık olsa bile ayrı Portal'da üstte açılır; aşağı çekerek kapanır ve
          alttaki listenin swipe'ını tetiklemez. */}
      <ReceiptDetailModal
        receiptId={detailReceiptId}
        onDismiss={() => setDetailReceiptId(null)}
      />

      {/* Bekleyen sevk listesi — hızlı seçim için */}
      <CameraScanModal
        visible={listModalOpen}
        loading={pendingQuery.isLoading}
        fetching={pendingQuery.isFetching}
        isError={pendingQuery.isError}
        errorMessage={(pendingQuery.error as Error | undefined)?.message}
        groups={filteredGroups}
        groupLoading={groupLoading}
        searchQ={searchQ}
        onSearchChange={setSearchQ}
        onDismiss={() => { setListModalOpen(false); setSearchQ(''); }}
        onSelect={(g) => {
          setListModalOpen(false);
          setSearchQ('');
          selectGroup(g);
        }}
        onRefresh={() => pendingQuery.refetch()}
      />

      {/* Telefon dikeyde sağ paneldeki "Geçmiş Kabuller" sekmesi modal olarak açılır.
          overlay: hem detay hem iptal modal'ı history'nin RNModal portal'ı içinde
          render edilir → ikinci RNModal çakışması (invisible overlay tıklama yutuyor) yok. */}
      <HistoryReceiptsModal
        visible={historyModalOpen}
        onDismiss={() => setHistoryModalOpen(false)}
        tab={modalSubTab}
        onTabChange={setModalSubTab}
        loading={modalActiveQuery.isLoading}
        fetching={modalActiveQuery.isFetching}
        error={modalActiveQuery.isError ? (modalActiveQuery.error as Error) : null}
        receipts={modalReceipts}
        hasNextPage={modalActiveQuery.hasNextPage}
        isFetchingNextPage={modalActiveQuery.isFetchingNextPage}
        onEndReached={() => modalActiveQuery.fetchNextPage()}
        onShowDetail={setDetailReceiptId}
        onCancel={
          modalSubTab === 'cancellable'
            ? (id) => {
                setCancelTargetReceiptId(id);
                setCancelReason('');
              }
            : undefined
        }
        overlayActive={!!cancelTargetReceiptId}
        onRefresh={() => modalActiveQuery.refetch()}
        overlay={
          <CancelReceiptModal
            visible={!!cancelTargetReceiptId}
            preview={cancelPreview}
            previewLoading={cancelPreviewQuery.isLoading}
            previewError={
              cancelPreviewQuery.error
                ? (cancelPreviewQuery.error as Error).message
                : null
            }
            onDismiss={() => {
              setCancelTargetReceiptId(null);
              setCancelReason('');
            }}
            reason={cancelReason}
            onReasonChange={setCancelReason}
            submitting={cancelReceiptMutation.isPending}
            onConfirm={handleConfirmCancelReceipt}
          />
        }
      />

      {/* Refakat kartı QR/barkod okuma — gerçek kamera */}
      <BarcodeScannerModal
        visible={scannerOpen}
        title="Refakat Kartı QR Okut"
        onDismiss={() => setScannerOpen(false)}
        onScan={(data) => {
          setScannerOpen(false);
          handleResolveCard(data);
        }}
      />

      {/* Mal kabul iptal modalı — telefon history modal AÇIK iken overlay olarak
          render edilir (yukarıda); değilse üst seviyede mount. RNModal-içinde-
          RNModal çakışmasını önler. */}
      {!historyModalOpen && (
        <CancelReceiptModal
          visible={!!cancelTargetReceiptId}
          preview={cancelPreview}
          previewLoading={cancelPreviewQuery.isLoading}
          previewError={
            cancelPreviewQuery.error
              ? (cancelPreviewQuery.error as Error).message
              : null
          }
          onDismiss={() => {
            setCancelTargetReceiptId(null);
            setCancelReason('');
          }}
          reason={cancelReason}
          onReasonChange={setCancelReason}
          submitting={cancelReceiptMutation.isPending}
          onConfirm={handleConfirmCancelReceipt}
        />
      )}
    </ScreenChrome>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Kart okutma teşhis kartı — "hata" değil, YAPILACAK İŞ.
// ─────────────────────────────────────────────────────────────────────────────
// Saha bulgusu (2026-08-02/03): kabul edilemeyen kart okutulduğunda ekran sabit
// "Yanlış istasyon" toast'ı basıyordu. Mesaj hem yanlıştı (mal doğru istasyonda,
// yalnız fasona SEVK EDİLMEMİŞTİ) hem de kayboluyordu. Burada sebep kalıcı durur
// ve tek dokunuşluk doğru aksiyon sunulur.
function ScanActionCard({
  action,
  canGoFasonSevk,
  onGoFasonSevk,
  onCancelReceipt,
  onDismiss,
}: {
  action: ScanActionState;
  canGoFasonSevk: boolean;
  onGoFasonSevk: () => void;
  onCancelReceipt: () => void;
  onDismiss: () => void;
}) {
  const needsDispatch = action.kind === 'NEEDS_DISPATCH';
  return (
    // ScrollView: telefon dikeyde (üstte kart bandı, altta sabit aksiyon barı)
    // metin + iki buton ekrana sığmayabilir — kaydırılabilir olmazsa buton
    // görünmez kalır ve kart yine "yapılacak iş" söylemekten çıkar.
    <ScrollView
      style={scanActionStyles.wrap}
      contentContainerStyle={scanActionStyles.wrapContent}
    >
      <Surface style={scanActionStyles.card} elevation={2}>
        <View style={scanActionStyles.header}>
          <Icon
            source={needsDispatch ? 'truck-alert' : 'receipt-text-remove'}
            size={26}
            color="#b45309"
          />
          <Text style={scanActionStyles.title}>
            {needsDispatch
              ? 'Önce Fason Sevk yapılmalı'
              : 'Bu iş emrinde kabul zaten yapılmış'}
          </Text>
        </View>

        <Text style={scanActionStyles.message}>{action.message}</Text>

        {needsDispatch ? (
          <View style={scanActionStyles.metaBox}>
            <Text style={scanActionStyles.metaText}>
              {action.details.stationName} · {action.details.rollCount} top içeride
              bekliyor
            </Text>
            <Text style={scanActionStyles.metaHint}>
              Konum düzeltmesi malı fabrikadan ÇIKARMAZ; çıkış yalnız Fason Sevk ile
              olur. Sevkten sonra bu kartı tekrar okutun.
            </Text>
          </View>
        ) : (
          <View style={scanActionStyles.metaBox}>
            <Text style={scanActionStyles.metaText}>
              Makbuz {action.details.receiptNo} ·{' '}
              {dayjs(action.details.receivedAt).format('DD.MM.YYYY HH:mm')}
            </Text>
            <Text style={scanActionStyles.metaHint}>
              Mal fiziksel olarak hâlâ fasondaysa (kabul yanlış iş emrine yapıldıysa)
              doğru araç "Konumu Düzelt" DEĞİL, kabul iptalidir: toplar fasona geri
              döner ve sevk yeniden açılır.
            </Text>
          </View>
        )}

        <View style={scanActionStyles.actions}>
          {needsDispatch ? (
            canGoFasonSevk ? (
              <Button
                mode="contained"
                icon="truck-fast"
                buttonColor="#b45309"
                onPress={onGoFasonSevk}
                contentStyle={scanActionStyles.btnContent}
                labelStyle={scanActionStyles.btnLabel}
              >
                Fason Sevk'e Git
              </Button>
            ) : (
              // Yetkisi yoksa buton YOK (rota kayıtlı değil) — ama ne yapılacağı yazılı.
              <Text style={scanActionStyles.noPermText}>
                Fason Sevk yetkiniz yok — sevki yapacak kişiye iletin.
              </Text>
            )
          ) : (
            <Button
              mode="contained"
              icon="close-circle-outline"
              buttonColor="#dc2626"
              onPress={onCancelReceipt}
              contentStyle={scanActionStyles.btnContent}
              labelStyle={scanActionStyles.btnLabel}
            >
              Makbuzu İptal Et
            </Button>
          )}
          <Button
            mode="outlined"
            onPress={onDismiss}
            contentStyle={scanActionStyles.btnContent}
            labelStyle={scanActionStyles.btnLabel}
          >
            Kapat
          </Button>
        </View>
      </Surface>
    </ScrollView>
  );
}

const scanActionStyles = StyleSheet.create({
  wrap: { flex: 1 },
  wrapContent: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  card: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 14,
    padding: 16,
    gap: 12,
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 18, fontWeight: '700', color: '#78350f', flexShrink: 1 },
  message: { fontSize: 15, color: '#0f172a', lineHeight: 21 },
  metaBox: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  metaText: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  metaHint: { fontSize: 13, color: '#57534e', lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // 56dp dokunma hedefi (fabrika eldiveni) — kök UI kuralı.
  btnContent: { height: 56, paddingHorizontal: 12 },
  btnLabel: { fontSize: 16, fontWeight: '700' },
  noPermText: { fontSize: 14, color: '#92400e', flex: 1, lineHeight: 19 },
});

function CancelReceiptModal({
  visible,
  preview,
  previewLoading,
  previewError,
  onDismiss,
  reason,
  onReasonChange,
  submitting,
  onConfirm,
}: {
  visible: boolean;
  preview: ReceiptCancelPreview | null;
  previewLoading: boolean;
  previewError: string | null;
  onDismiss: () => void;
  reason: string;
  onReasonChange: (v: string) => void;
  submitting: boolean;
  onConfirm: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboard = useReanimatedKeyboardAnimation();
  const sheetKbStyle = useAnimatedStyle(() => {
    const kb = -keyboard.height.value; // pozitif klavye yüksekliği (0 = kapalı)
    const maxHeight = Math.min(winH * 0.85, winH - kb - insets.top - insets.bottom - 24);
    const lift = kb > 0 ? kb / 2 : 0;
    return { maxHeight, transform: [{ translateY: -lift }] };
  });
  // `allSafe` backend'de K14'ü zaten içerir; `batchMismatch` ayrıca okunur ki
  // alan gelen ama allSafe'i bayat bir sürümde de buton kilitli kalsın.
  const canSubmit =
    !submitting &&
    reason.trim().length >= 3 &&
    !previewLoading &&
    !previewError &&
    (preview ? preview.allSafe && !preview.batchMismatch?.blocked : true);

  if (!visible) return null;

  // RNModal SARMAZ — HistoryReceiptsModal overlay'i içine render edilebilsin
  // diye absolute fill overlay pattern (ReceiptDetailModal ile aynı yapı).
  // İki RNModal aynı anda mount edilince ikincisinin invisible overlay'i
  // ilkinin tıklamalarını yutuyordu (FasonKabul telefon dikey bug'ı).
  return (
    <View style={cancelStyles.overlay} pointerEvents="auto">
      <Pressable
        style={cancelStyles.backdrop}
        onPress={submitting ? undefined : onDismiss}
        accessibilityLabel="Kapat"
      />
      <Animated.View
        style={[
          cancelStyles.sheet,
          { width: winW * 0.9 },
          sheetKbStyle,
        ]}
      >
        <View style={cancelStyles.header}>
          <Icon source="alert-circle" size={22} color="#dc2626" />
          <Text variant="titleMedium" style={cancelStyles.title}>
            Mal Kabulü İptal Et
            {preview?.receiptNo ? ` — ${preview.receiptNo}` : ''}
          </Text>
        </View>

        <ScrollView
          style={cancelStyles.scrollArea}
          contentContainerStyle={{ gap: 12 }}
        >
          <Text style={cancelStyles.body}>
            Bu kabul iptal edilecek. Orijinal rulolar fason firmaya geri
            dönecek, renk/özellik bilgisi (uygulandıysa) silinecek.
          </Text>

          {previewLoading && (
            <View style={cancelStyles.loadingBox}>
              <ActivityIndicator size="small" />
              <Text style={cancelStyles.loadingText}>
                İptal etkileri hesaplanıyor…
              </Text>
            </View>
          )}

          {previewError && (
            <View style={cancelStyles.errorBox}>
              <Icon source="alert" size={16} color="#dc2626" />
              <Text style={cancelStyles.errorText}>{previewError}</Text>
            </View>
          )}

          {/* K14 parti uyuşmazlığı — born-roll uyarılarının YANINDA, ayrı sebep.
              Birleştirme butonu bilinçli olarak YOK: birleştirme geri alınamaz ve
              hayatta kalan parti (en eski) mobilde seçilemiyor → panele yönlendir. */}
          {preview?.batchMismatch?.blocked && (
            <View style={cancelStyles.mismatchBox}>
              <View style={cancelStyles.bornHeader}>
                <Icon source="call-split" size={18} color="#b91c1c" />
                <Text style={cancelStyles.mismatchTitle}>
                  Parti uyuşmazlığı — iptal edilemez
                </Text>
              </View>
              {preview.batchMismatch.items.map((m) => (
                <View key={m.rollId} style={cancelStyles.rollRow}>
                  <Text style={cancelStyles.mismatchRollText}>
                    {m.barcode} → şu an{' '}
                    <Text style={cancelStyles.mismatchStrong}>
                      {m.rollBatchNumber ?? 'partisiz'}
                    </Text>{' '}
                    partisinde
                  </Text>
                  <Text style={cancelStyles.mismatchRollMeta}>
                    Sevk {m.dispatchNo} →{' '}
                    <Text style={cancelStyles.mismatchStrong}>
                      {m.dispatchBatchNumber ?? 'partisiz'}
                    </Text>{' '}
                    partisine bağlı
                  </Text>
                </View>
              ))}
              <Text style={cancelStyles.mismatchHint}>
                Toplar kabulden sonra başka bir partiye taşınmış/birleştirilmiş.
                Panelden İş Emri → Partiler → Birleştir ile bu partileri birleştirin,
                sonra iptali tekrar deneyin. (Birleştirme geri alınamaz — bu yüzden
                tablette yapılmaz.)
              </Text>
            </View>
          )}

          {preview && preview.totalBornRolls > 0 && (
            <View style={cancelStyles.bornBox}>
              <View style={cancelStyles.bornHeader}>
                <Icon
                  source={preview.allSafe ? 'cancel' : 'alert-octagon'}
                  size={18}
                  color={preview.allSafe ? '#0f172a' : '#dc2626'}
                />
                <Text style={cancelStyles.bornTitle}>
                  Türeyen {preview.totalBornRolls} açık kumaş top'u da iptal
                  edilecek:
                </Text>
              </View>

              {preview.bornRolls.map((roll, idx) => (
                <View
                  key={roll.id}
                  style={[
                    cancelStyles.rollRow,
                    !roll.safeToCancel && cancelStyles.rollRowUnsafe,
                  ]}
                >
                  <View style={cancelStyles.rollLine}>
                    <Text style={cancelStyles.rollIdx}>{idx + 1}.</Text>
                    <Text style={cancelStyles.rollMain}>
                      {roll.itemCode} · {roll.itemName}
                      {roll.colorName ? ` · ${roll.colorName}` : ''}
                    </Text>
                    <Text style={cancelStyles.rollQty}>
                      {Number(roll.currentQty ?? 0).toFixed(1)} m
                    </Text>
                  </View>
                  {roll.blockingReasons.length > 0 && (
                    <View style={cancelStyles.blockReasons}>
                      {roll.blockingReasons.map((r, j) => (
                        <Text key={j} style={cancelStyles.blockReason}>
                          ⚠ {r}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              ))}

              {!preview.allSafe && (
                <View style={cancelStyles.unsafeBanner}>
                  <Icon source="alert-octagon" size={16} color="#b91c1c" />
                  <Text style={cancelStyles.unsafeBannerText}>
                    Bazı toplar işlenmiş — iptal güvenli değil. Önce o topları
                    Kurşun/KK2/Tambur'da geri al, sonra iptal et.
                  </Text>
                </View>
              )}
            </View>
          )}

          <TextInput
            mode="outlined"
            label="İptal sebebi"
            value={reason}
            onChangeText={onReasonChange}
            placeholder="Örn. operatör yanlış receipt seçti"
            multiline
            numberOfLines={3}
            style={cancelStyles.input}
          />
        </ScrollView>

        <View style={cancelStyles.actions}>
          <Button mode="outlined" onPress={onDismiss} disabled={submitting}>
            Vazgeç
          </Button>
          <Button
            mode="contained"
            buttonColor="#dc2626"
            onPress={onConfirm}
            loading={submitting}
            disabled={!canSubmit}
          >
            İptal Et
          </Button>
        </View>
      </Animated.View>
    </View>
  );
}

const cancelStyles = StyleSheet.create({
  // ReceiptDetailModal ile aynı overlay pattern'i
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    elevation: 10,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    gap: 12,
    overflow: 'hidden',
  },
  scrollArea: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontWeight: '700', color: '#0f172a', flexShrink: 1 },
  body: { fontSize: 13, color: '#475569', lineHeight: 18 },
  input: { backgroundColor: '#fff' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },

  loadingBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  loadingText: { fontSize: 13, color: '#64748b' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
  },
  errorText: { fontSize: 13, color: '#b91c1c', flexShrink: 1 },

  bornBox: {
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  bornHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bornTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a', flexShrink: 1 },

  mismatchBox: {
    padding: 12,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fecaca',
    gap: 8,
  },
  mismatchTitle: { fontSize: 13, fontWeight: '700', color: '#b91c1c', flexShrink: 1 },
  mismatchRollText: { fontSize: 13, color: '#0f172a' },
  mismatchRollMeta: { fontSize: 12, color: '#64748b' },
  mismatchStrong: { fontWeight: '700', color: '#0f172a' },
  mismatchHint: { fontSize: 12, color: '#991b1b', lineHeight: 17 },

  rollRow: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 4,
  },
  rollRowUnsafe: { borderColor: '#fecaca', backgroundColor: '#fffbfb' },
  rollLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rollIdx: { fontSize: 12, fontWeight: '700', color: '#64748b', width: 22 },
  rollMain: { fontSize: 13, color: '#0f172a', flex: 1 },
  rollQty: { fontSize: 13, fontWeight: '700', color: '#0f172a' },

  blockReasons: { paddingLeft: 28, gap: 2 },
  blockReason: { fontSize: 12, color: '#b91c1c' },

  unsafeBanner: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
  },
  unsafeBannerText: { fontSize: 12, color: '#991b1b', flexShrink: 1, lineHeight: 17 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcı bileşenler
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Bekleyen sevk listesi modal'ı — fasondan dönecek sevkleri listeler.
// RemoteListSheet generic kabuğunu kullanır; sadece row render'ı ve hint
// metni burada özelleşir.
// ─────────────────────────────────────────────────────────────────────────────
function CameraScanModal({
  visible,
  loading,
  fetching,
  isError,
  errorMessage,
  groups,
  groupLoading,
  searchQ,
  onSearchChange,
  onDismiss,
  onSelect,
  onRefresh,
}: {
  visible: boolean;
  loading: boolean;
  fetching: boolean;
  isError: boolean;
  errorMessage?: string;
  groups: PendingReturnSummary[];
  groupLoading: boolean;
  searchQ: string;
  onSearchChange: (q: string) => void;
  onDismiss: () => void;
  onSelect: (g: PendingReturnSummary) => void;
  onRefresh: () => void;
}) {
  return (
    <RemoteListSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Bekleyen Sevkler"
      icon="format-list-bulleted"
      loading={loading}
      fetching={fetching || groupLoading}
      isError={isError}
      errorMessage={errorMessage}
      onRefresh={onRefresh}
      // Modal içi refresh tuşu da başarıda toast göstersin — ekran header'ındaki
      // "Yenile" ile tutarlı (önceden successMessage yoktu → sessiz kalıyordu).
      successMessage="Bekleyen sevkler güncellendi"
      items={groups}
      keyExtractor={(g) => g.step.id}
      renderItem={(item) => (
        <PendingDispatchRow group={item} onPress={() => onSelect(item)} />
      )}
      emptyIcon="package-variant"
      emptyText={searchQ.length >= 2 ? 'Eşleşen sevk yok' : 'Fasonda bekleyen sevk yok'}
      subHeader={
        <View style={cameraStyles.searchRow}>
          <Icon source="magnify" size={18} color="#94a3b8" />
          <TextInput
            mode="flat"
            placeholder="Parti, kumaş, renk, kart no, fason..."
            value={searchQ}
            onChangeText={onSearchChange}
            style={cameraStyles.searchInput}
            underlineColor="transparent"
            activeUnderlineColor="transparent"
            dense
          />
          {searchQ.length > 0 && (
            <IconButton icon="close-circle" size={16} onPress={() => onSearchChange('')} style={cameraStyles.searchClear} />
          )}
        </View>
      }
      hint={{ text: 'Refakat kartı yoksa aşağıdan dönecek sevki seçerek devam edin.' }}
    />
  );
}

// Gruptaki distinct kumaş + renk adlarını "Kumaş · Renk" tek satırına indirger.
// Hiçbiri yoksa null (satır gizlenir).
function fabricLabel(g: PendingReturnSummary): string | null {
  const item = g.itemNames?.join(', ') || '';
  const color = g.colorNames?.join(', ') || '';
  if (item && color) return `${item} · ${color}`;
  return item || color || null;
}

function PendingDispatchRow({
  group,
  onPress,
}: {
  group: PendingReturnSummary;
  onPress: () => void;
}) {
  const fabric = fabricLabel(group);
  // Fason adımında DURAN ama fasona ÇIKMAMIŞ top ("Konumu Düzelt" sonrası mal
  // içeride bekliyor). Rozetsiz bırakılırsa satır normal bir bekleyen sevkten
  // ayırt edilemez; operatör kabul sanıp basar ve ancak teşhis kartında öğrenir.
  const awaitingCount = group.awaitingDispatch ? (group.awaitingDispatchRollCount ?? 0) : 0;
  // rollCount === 0 → satır HİÇ kabul edilemez (önce sevk). rollCount > 0 →
  // kabul edilebilir bir kısım VAR, geri kalanı sevk bekliyor (kısmi uyarı).
  const awaitingOnly = awaitingCount > 0 && group.rollCount === 0;
  return (
    <Surface style={cameraStyles.row} elevation={1}>
      <TouchableRipple borderless onPress={onPress} style={cameraStyles.rowTouch}>
        <View style={cameraStyles.rowInner}>
          <View style={{ flex: 1 }}>
            <Text style={cameraStyles.rowBatch}>{group.workOrder.batchNumber}</Text>
            {awaitingCount > 0 && (
              <View style={cameraStyles.awaitingBadge}>
                <Icon source="truck-alert" size={12} color="#78350f" />
                <Text style={cameraStyles.awaitingBadgeText} numberOfLines={2}>
                  {awaitingOnly
                    ? `SEVK BEKLİYOR · ${awaitingCount} top içeride`
                    : `+${awaitingCount} top sevk bekliyor`}
                </Text>
              </View>
            )}
            {fabric && (
              <View style={cameraStyles.rowMeta}>
                <Icon source="palette" size={12} color="#475569" />
                <Text style={cameraStyles.rowMetaText} numberOfLines={1}>
                  {fabric}
                </Text>
              </View>
            )}
            <View style={cameraStyles.rowMeta}>
              <Icon source="map-marker-path" size={12} color="#475569" />
              <Text style={cameraStyles.rowMetaText} numberOfLines={1}>
                #{group.step.stepSequence} · {group.step.station.name}
              </Text>
            </View>
            <View style={cameraStyles.rowMeta}>
              <Icon source="factory" size={12} color="#475569" />
              <Text style={cameraStyles.rowMetaText} numberOfLines={1}>
                {group.lastDispatch?.subcontractor?.name ?? '—'}
              </Text>
            </View>
            <View style={cameraStyles.rowFooter}>
              <Text style={cameraStyles.rowQty}>
                {group.rollCount} parça · {Number(group.totalQty ?? 0).toFixed(1)} mt
              </Text>
              {group.lastDispatch && (
                <Text style={cameraStyles.rowDate}>
                  {dayjs(group.lastDispatch.dispatchedAt).format('DD.MM HH:mm')}
                </Text>
              )}
            </View>
          </View>
          <Icon source="chevron-right" size={22} color="#94a3b8" />
        </View>
      </TouchableRipple>
    </Surface>
  );
}

function Tab({
  label,
  count,
  active,
  activeColor,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  activeColor: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple
      borderless
      onPress={onPress}
      style={[
        styles.tab,
        active && { borderBottomColor: activeColor, borderBottomWidth: 3 },
      ]}
    >
      <View style={styles.tabInner}>
        <Text style={[styles.tabLabel, active && { color: activeColor }]}>{label}</Text>
        {typeof count === 'number' && count > 0 && (
          <View style={[styles.tabCount, active && { backgroundColor: activeColor }]}>
            <Text style={[styles.tabCountText, active && { color: '#fff' }]}>
              {count}
            </Text>
          </View>
        )}
      </View>
    </TouchableRipple>
  );
}

/**
 * "Kalan gelmeyecek" onay modalı — fasondaki kalan metrajı FİRE kararıyla kapatır.
 * Sebep ZORUNLU ve fire kataloğundan gelir (fabrika panelden düzenler; Tambur
 * kalan-karar modalıyla aynı desen: serbest metin EN ÜSTTE, yazmaya başlamak
 * "Diğer"i kendiliğinden seçer). ONLINE aksiyondur — kuyruklanmaz.
 */
function CloseRemainderModal({
  target,
  stepId,
  loading,
  onDismiss,
  onConfirm,
}: {
  target: RollRow | null;
  stepId: string | null;
  loading: boolean;
  onDismiss: () => void;
  onConfirm: (reasonCode: string, reasonText: string | null) => void;
}) {
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');
  const { presets } = useReasonPresets('ROLL_SCRAP');
  const freeTextPreset = presets.find((r) => r.requiresText) ?? null;
  const selected = presets.find((r) => r.code === reasonCode) ?? null;
  // Her açılışta temiz başla — önceki topun sebebi yenisine yapışmasın.
  useEffect(() => {
    if (!target) {
      setReasonCode(null);
      setReasonText('');
    }
  }, [target]);
  const canConfirm =
    !!reasonCode && !loading && (!selected?.requiresText || reasonText.trim().length >= 3);
  const kalan = target ? Number(target.dispatchedQty ?? 0) : 0;

  return (
    <ConfirmDialog
      visible={target != null}
      kind="destructive"
      onDismiss={loading ? () => {} : onDismiss}
      title="Kalan gelmeyecek mi?"
      confirmLabel={`Kalanı Kapat (${fmtMeters(kalan)} m FİRE)`}
      cancelLabel="Vazgeç"
      confirming={loading}
      onConfirm={() => {
        // ConfirmDialog buton-kilidi sunmuyor — eksik sebep burada yakalanır
        // (buton grileşmek yerine NE eksik olduğunu söyler).
        if (!canConfirm || !stepId) {
          Toast.show({
            type: 'error',
            text1: 'Sebep gerekli',
            text2: selected?.requiresText
              ? 'Açıklama en az 3 karakter olmalı'
              : 'Listeden bir sebep seçin (ya da üstteki kutuya yazın)',
          });
          return;
        }
        onConfirm(reasonCode!, reasonText.trim() || null);
      }}
      description={
        <View style={{ gap: 8 }}>
          <Text style={styles.mismatchLead}>
            {target?.barcode ?? 'Top'} — fasonda bekleyen {fmtMeters(kalan)} m
            kapatılacak ve FİRE olarak sapma defterine yazılacak. Bu işlem kabul
            DEĞİLDİR ve geri alınamaz; mal sonradan gelirse yönetici düzeltmesi gerekir.
          </Text>
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
            return (
              <TouchableRipple
                key={r.code}
                onPress={() => setReasonCode(r.code)}
                disabled={loading}
                style={{
                  minHeight: 48,
                  justifyContent: 'center',
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? '#b45309' : '#cbd5e1',
                  backgroundColor: active ? '#fffbeb' : '#fff',
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: active ? '700' : '500',
                    color: active ? '#b45309' : '#334155',
                  }}
                >
                  {r.label}
                </Text>
              </TouchableRipple>
            );
          })}
        </View>
      }
    />
  );
}

function Badge({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <View style={styles.badge}>
      <Icon source={icon} size={12} color="#0f172a" />
      <Text style={styles.badgeText}>{children}</Text>
    </View>
  );
}

// Telefon dikeyde sağ paneldeki kabul geçmişi sekmesinin modal sürümü. Header'ın
// altında iki sub-tab: İptal Edilebilirler (filtre) / Tüm Kabuller (default).
// RemoteListSheet generic kabuğunu kullanır; sayfalama footer'da render edilir.
function HistoryReceiptsModal({
  visible,
  onDismiss,
  loading,
  fetching,
  error,
  receipts,
  hasNextPage,
  isFetchingNextPage,
  onEndReached,
  onShowDetail,
  onCancel,
  onRefresh,
  overlay,
  overlayActive,
  tab,
  onTabChange,
}: {
  visible: boolean;
  onDismiss: () => void;
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  receipts: import('../../../types/models').SubcontractorReceiptListItem[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Liste sonuna yaklaşınca bir sonraki sayfayı çeker (cursor infinite scroll). */
  onEndReached: () => void;
  onShowDetail: (id: string) => void;
  /** Yalnız 'cancellable' tab'da görünür — settled tab'da undefined. */
  onCancel?: (id: string) => void;
  onRefresh: () => void;
  /** Sheet'in üstüne render edilen overlay (detay modal) — aynı RNModal
   *  portal'ında olduğu için detay listeyi örtüp listeye geri dönüyor. */
  overlay?: React.ReactNode;
  /** Bir overlay (detay/iptal) açık mı — açıkken sheet swipe'ı kapatılır ki
   *  overlay tepesinden çekiş yanlışlıkla listeyi kapatmasın. */
  overlayActive?: boolean;
  /** Sub-tab: 'cancellable' = iptal butonu görünür, 'history' = sadece detay. */
  tab: 'cancellable' | 'history';
  onTabChange: (t: 'cancellable' | 'history') => void;
}) {
  return (
    <RemoteListSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Kabul Geçmişi"
      icon="history"
      widthRatio={0.9}
      swipeToDismiss={!overlayActive}
      loading={loading}
      fetching={fetching}
      isError={!!error}
      errorMessage={error?.message}
      onRefresh={onRefresh}
      successMessage="Kabul listesi güncellendi"
      items={receipts}
      keyExtractor={(r) => r.id}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) onEndReached();
      }}
      listFooterComponent={
        isFetchingNextPage ? (
          <View style={styles.loadingMore}>
            <ActivityIndicator size="small" color="#64748b" />
          </View>
        ) : null
      }
      overlay={overlay}
      subHeader={
        <View style={modalTabStyles.tabRow}>
          <TouchableRipple
            onPress={() => onTabChange('cancellable')}
            borderless
            style={[
              modalTabStyles.tab,
              tab === 'cancellable' && { borderBottomColor: '#dc2626' },
            ]}
          >
            <Text
              style={[
                modalTabStyles.tabLabel,
                tab === 'cancellable' && { color: '#dc2626', fontWeight: '700' },
              ]}
            >
              İptal Edilebilirler
            </Text>
          </TouchableRipple>
          <TouchableRipple
            onPress={() => onTabChange('history')}
            borderless
            style={[
              modalTabStyles.tab,
              tab === 'history' && { borderBottomColor: '#059669' },
            ]}
          >
            <Text
              style={[
                modalTabStyles.tabLabel,
                tab === 'history' && { color: '#059669', fontWeight: '700' },
              ]}
            >
              Tüm Kabuller
            </Text>
          </TouchableRipple>
        </View>
      }
      renderItem={(item) => (
        <ReceiptRow
          receipt={item}
          // Geçmiş kabuller modalını kapatma — detay modal üstüne çıksın,
          // kapanınca operatör listede kaldığı yerden devam etsin.
          onShowDetail={onShowDetail}
          onCancel={onCancel}
        />
      )}
      emptyIcon="package-check"
      emptyText={
        tab === 'cancellable'
          ? 'İptal edilebilir kabul yok'
          : 'Henüz kabul yapılmamış'
      }
    />
  );
}

const modalTabStyles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabLabel: { fontSize: 14, color: '#64748b', fontWeight: '600' },
});

function PendingPane({
  loading,
  groupLoading,
  groups,
  selectedStepId,
  highlightedWorkOrderId,
  searchQ,
  onSearchChange,
  onSelect,
}: {
  loading: boolean;
  groupLoading: boolean;
  groups: PendingReturnSummary[];
  selectedStepId: string | null;
  highlightedWorkOrderId: string | null;
  searchQ: string;
  onSearchChange: (q: string) => void;
  onSelect: (g: PendingReturnSummary) => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.paneSearchRow}>
        <Icon source="magnify" size={18} color="#94a3b8" />
        <TextInput
          mode="flat"
          placeholder="Parti no, fason firma, istasyon..."
          value={searchQ}
          onChangeText={onSearchChange}
          style={styles.paneSearchInput}
          underlineColor="transparent"
          activeUnderlineColor="transparent"
          dense
        />
        {searchQ.length > 0 && (
          <IconButton icon="close-circle" size={16} onPress={() => onSearchChange('')} style={styles.paneSearchClear} />
        )}
      </View>
      {/* Arama input'u dışına tap → klavye kapanır (boş alan / empty-state). */}
      <Pressable style={{ flex: 1 }} onPress={() => Keyboard.dismiss()} accessible={false}>
        {loading ? (
          <SkeletonList count={6} />
        ) : groups.length === 0 ? (
          <View style={styles.paneEmpty}>
            <Icon source="package-variant" size={48} color="#cbd5e1" />
            <Text style={styles.paneEmptyText}>
              {searchQ.length >= 2 ? 'Eşleşen sevk yok' : 'Fasonda bekleyen sevk yok'}
            </Text>
          </View>
        ) : (
          <FlashList
            data={groups}
            keyExtractor={(g) => g.step.id}
            contentContainerStyle={{ padding: 8 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            renderItem={({ item }) => (
              <PendingCard
                group={item}
                selected={item.step.id === selectedStepId}
                highlighted={
                  !!highlightedWorkOrderId && item.workOrder.id === highlightedWorkOrderId
                }
                loading={groupLoading && item.step.id === selectedStepId}
                onPress={() => onSelect(item)}
              />
            )}
          />
        )}
      </Pressable>
    </View>
  );
}

function PendingCard({
  group,
  selected,
  highlighted,
  loading,
  onPress,
}: {
  group: PendingReturnSummary;
  selected: boolean;
  highlighted: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Surface
      style={[
        styles.pendingCard,
        highlighted && styles.pendingCardHighlight,
        selected && styles.pendingCardSelected,
      ]}
      elevation={selected ? 2 : 1}
    >
      <TouchableRipple borderless onPress={onPress} style={styles.pendingTouch}>
        <View style={styles.pendingInner}>
          <View style={styles.pendingTopRow}>
            <Text style={styles.pendingBatch} numberOfLines={1}>
              {group.workOrder.batchNumber}
            </Text>
            {highlighted && (
              <View style={styles.pendingFlag}>
                <Icon source="card-search" size={10} color="#fff" />
                <Text style={styles.pendingFlagText}>KART</Text>
              </View>
            )}
            {selected && !loading && (
              <View style={[styles.pendingFlag, { backgroundColor: '#059669' }]}>
                <Icon source="check" size={10} color="#fff" />
                <Text style={styles.pendingFlagText}>SEÇİLİ</Text>
              </View>
            )}
            {loading && (
              <ActivityIndicator size={14} color="#059669" style={{ marginLeft: 4 }} />
            )}
          </View>
          {fabricLabel(group) && (
            <View style={styles.pendingMidRow}>
              <Icon source="palette" size={12} color="#475569" />
              <Text style={styles.pendingStep} numberOfLines={1}>
                {fabricLabel(group)}
              </Text>
            </View>
          )}
          <View style={styles.pendingMidRow}>
            <Icon source="map-marker-path" size={12} color="#475569" />
            <Text style={styles.pendingStep} numberOfLines={1}>
              #{group.step.stepSequence} · {group.step.station.name}
            </Text>
          </View>
          <View style={styles.pendingMidRow}>
            <Icon source="factory" size={12} color="#475569" />
            <Text style={styles.pendingCompany} numberOfLines={1}>
              {group.lastDispatch?.subcontractor?.name ?? '—'}
            </Text>
          </View>
          {/* Fason adımında DURAN ama fasona ÇIKMAMIŞ top ("Konumu Düzelt"
              sonrası mal içeride bekliyor). Rozetsiz satır normal bir bekleyen
              sevkten ayırt edilemez; operatör kabul sanıp basar. */}
          {!!group.awaitingDispatch && (group.awaitingDispatchRollCount ?? 0) > 0 && (
            <View style={styles.pendingAwaiting}>
              <Icon source="truck-alert" size={12} color="#78350f" />
              <Text style={styles.pendingAwaitingText} numberOfLines={2}>
                {group.rollCount === 0
                  ? `SEVK BEKLİYOR · ${group.awaitingDispatchRollCount} top içeride`
                  : `+${group.awaitingDispatchRollCount} top sevk bekliyor`}
              </Text>
            </View>
          )}
          <View style={styles.pendingFooter}>
            <Text style={styles.pendingQty}>
              {group.rollCount} parça · {Number(group.totalQty ?? 0).toFixed(1)} mt
            </Text>
            {group.lastDispatch && (
              <Text style={styles.pendingDate}>
                {dayjs(group.lastDispatch.dispatchedAt).format('DD.MM HH:mm')}
              </Text>
            )}
          </View>
        </View>
      </TouchableRipple>
    </Surface>
  );
}

function HistoryPane({
  loading,
  error,
  receipts,
  hasNextPage,
  isFetchingNextPage,
  onEndReached,
  onShowDetail,
  onCancel,
  onRefresh,
}: {
  loading: boolean;
  error: Error | null;
  receipts: import('../../../types/models').SubcontractorReceiptListItem[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Liste sonuna yaklaşınca bir sonraki sayfayı çeker (cursor infinite scroll). */
  onEndReached: () => void;
  onShowDetail: (id: string) => void;
  /** Verilirse her satırda İptal Et butonu görünür. Settled tab'ında verilmez
      → ReceiptRow iptal butonunu otomatik gizler. */
  onCancel?: (id: string) => void;
  onRefresh: () => void;
}) {
  if (loading) {
    return <SkeletonList count={6} />;
  }
  if (error) {
    return (
      <View style={styles.paneEmpty}>
        <Text style={styles.paneEmptyText}>Liste yüklenemedi</Text>
        <Text style={styles.paneEmptyHint}>{error.message}</Text>
        <Button mode="outlined" onPress={onRefresh} style={{ marginTop: 8 }}>
          Tekrar dene
        </Button>
      </View>
    );
  }
  if (receipts.length === 0) {
    return (
      <View style={styles.paneEmpty}>
        <Icon source="package-check" size={48} color="#cbd5e1" />
        <Text style={styles.paneEmptyText}>Henüz mal kabul yok</Text>
      </View>
    );
  }
  return (
    <View style={styles.paneFlex}>
      <FlashList
        data={receipts}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 8 }}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) onEndReached();
        }}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.loadingMore}>
              <ActivityIndicator size="small" color="#64748b" />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ReceiptRow
            receipt={item}
            onShowDetail={onShowDetail}
            onCancel={onCancel}
          />
        )}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  body: { flex: 1, flexDirection: 'row', backgroundColor: '#f8fafc' },
  bodyPhone: { flexDirection: 'column' },

  // Top bar aksiyonları — Tambur ekranındaki HeaderChip kalıbıyla aynı stil.
  headerExtrasRow: { flexDirection: 'row', alignItems: 'center' },
  headerChip: {
    borderRadius: 10,
    marginLeft: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  headerChipAccent: {
    backgroundColor: 'rgba(30,64,175,0.45)',
    borderColor: 'rgba(147,197,253,0.7)',
  },
  headerChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  headerChipInnerLarge: {
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  headerChipText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Sol — form
  formCol: { flex: 1.4, backgroundColor: '#f8fafc' },
  // Telefon dikey: scroll içeriği alt sabit bar'ın altına gizlenmesin.
  formColPhone: { paddingBottom: 72 },

  // Telefon dikey alt sabit aksiyon barı — liste (sol) + kamera (sağ).
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 64,
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: -2 },
    shadowRadius: 6,
  },
  // 30 / 40 / 30 oranı dış hücrelerde — orta (kamera) ana eylem.
  bottomBarCellSide: { flex: 3 },
  bottomBarCellPrimary: { flex: 4 },
  bottomBarBtn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  // Orta kamera bloğu dolgulu yeşil hero — sahada en sık basılan eylem.
  bottomBarBtnPrimaryFill: { backgroundColor: '#059669' },
  bottomBarBtnInner: { alignItems: 'center', gap: 2 },
  bottomBarBtnText: { fontSize: 12, fontWeight: '700', color: '#0f172a' },

  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#475569' },
  emptyHint: { fontSize: 13, color: '#94a3b8', textAlign: 'center', maxWidth: 280 },

  // Sticky header
  headerBand: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0f172a',
    gap: 8,
  },
  headerCellMain: { flex: 1, justifyContent: 'center' },
  headerBatch: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  // Parti kodunun altında fason firma adı (eski "Adım X · istasyon"ın yerine).
  headerFirmRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  headerFirmName: { flexShrink: 1, fontSize: 12, color: '#e2e8f0', fontWeight: '600' },
  // Uygulanacak renk + üretim özellikleri — header'ın SAĞ tarafında, parti/firma
  // kolonunun yanında (ayrı satır değil). flexShrink + maxWidth ile firma adını ezmez.
  headerAppliesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    flexShrink: 1,
    maxWidth: '50%',
    gap: 6,
  },

  // ── Çoklu parti (çoklu sevk) teyit ekranı ──
  partyHintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  partyHintText: { flex: 1, fontSize: 13, lineHeight: 18, color: '#92400e', fontWeight: '600' },
  partyCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    marginBottom: 10,
  },
  partyCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  partyIndexBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  partyIndexText: { fontSize: 16, fontWeight: '800', color: '#4338ca' },
  partyCardTitle: { fontFamily: 'monospace', fontSize: 15, fontWeight: '700', color: '#1e293b' },
  partyCardMeta: { fontSize: 13, color: '#475569', fontWeight: '600', marginTop: 2 },
  partyCardDate: { fontSize: 11, color: '#94a3b8', marginTop: 2 },

  // Aktif parti şeridi (form üstünde) — diğer partilere dönüş
  activePartyBar: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 10,
    marginTop: 8,
  },
  activePartyBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  activePartyBarText: { flex: 1, fontSize: 12.5, color: '#1e3a8a', fontWeight: '700' },
  partyWidthPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#dbeafe',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  partyWidthPillText: { fontSize: 11.5, fontWeight: '800', color: '#1d4ed8' },
  activePartyBarChange: { fontSize: 12, color: '#1d4ed8', fontWeight: '800' },

  // Mini bilgi şeridi
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fef3c7',
    borderBottomWidth: 1,
    borderBottomColor: '#fbbf24',
  },
  warningText: { fontSize: 11, color: '#92400e', flex: 1 },

  // Boyahane / "renk veren" kategori uygulama bilgisi (header band içindeki şeritte).
  // "Bu kabulde uygulanan" şeridi — başlığın hemen altında TEK satır.
  // (Eski salt-okunur renk çipi stilleri — appliesColorChip / colorSwatch /
  // appliesColorChipText / appliesColorEmpty — 2026-08-05'te kaldırıldı: renk
  // artık gösterilen değil SEÇİLEN bir alan, ColorSelectField kendi stilini taşır.)
  appliedBand: {
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 4,
  },
  appliedRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  // min-w-0 karşılığı: flex çocuğu uzun renk adında komşusuna binmesin.
  appliedCol: { flex: 1, minWidth: 0, gap: 3 },
  // En kutusu dar ve SABİT — sayı 3 hane, renk adı uzun; eşit bölmek en'i şişirirdi.
  appliedColWidth: { flex: 0, width: 118 },
  appliedLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#64748b',
  },
  appliedWidthInput: { backgroundColor: '#ffffff' },
  appliedHint: { fontSize: 11, color: '#94a3b8' },
  // Kapalı özet satırı — 56dp dokunma hedefi korunur (paddingVertical 12 + metin).
  appliedToggle: { borderRadius: 6, paddingVertical: 12, paddingHorizontal: 4 },
  appliedToggleInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  appliedToggleText: { flex: 1, minWidth: 0, fontSize: 12.5, color: '#475569', fontWeight: '600' },
  appliesPropertyChip: {
    backgroundColor: '#ede9fe',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  appliesPropertyChipText: { fontSize: 11, fontWeight: '600', color: '#5b21b6' },

  // Toplar — scrollable
  rollsScroll: { flex: 1 },
  rollsContent: { padding: 12, gap: 4 },
  rollsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusBadgeText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  missingPill: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  missingPillText: { fontSize: 11, fontWeight: '700', color: '#dc2626' },

  rollItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rollItemMissing: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  rollTouch: { borderRadius: 8 },
  rollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 4,
    gap: 2,
  },
  rollIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#dcfce7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  rollIndexText: { fontSize: 11, fontWeight: '700', color: '#059669' },
  rollTopLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rollBarcode: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  missingTag: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  missingTagText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  rollItemName: { fontSize: 12, color: '#475569', marginTop: 1 },
  rollBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: { fontSize: 10, color: '#0f172a', fontWeight: '600' },

  noteWrap: { paddingHorizontal: 10, paddingBottom: 8 },
  input: { backgroundColor: '#fff' },

  // Kısmi teslimat (2026-08-19)
  partialTag: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#f59e0b',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  partialTagText: { fontSize: 10, fontWeight: '700', color: '#92400e' },
  ageTag: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  ageTagWarn: { backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#f59e0b' },
  ageTagText: { fontSize: 10, fontWeight: '600', color: '#475569' },
  ageTagTextWarn: { color: '#92400e', fontWeight: '700' },
  gelenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  gelenLabel: { fontSize: 12, fontWeight: '600', color: '#475569' },
  gelenInput: { backgroundColor: '#fff', width: 110, height: 36 },
  gelenPartialText: { fontSize: 11, fontWeight: '700', color: '#b45309', flexShrink: 1 },
  // (2026-08-21) "KISMİ KABUL" bandı kaldırıldı — kalan artık beyan edilen bir
  // sayı ve özeti kendi kutusunun (remainderCard) altında yazıyor.

  // Dönen Açık Kumaş
  newRollSection: {
    marginTop: 16,
    marginHorizontal: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  newRollHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  newRollTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  newRollHint: { fontSize: 11, color: '#64748b', marginTop: 2 },
  modeSwitch: { marginBottom: 10 },
  newRollEmpty: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  newRollEmptyText: { fontSize: 12, color: '#92400e', fontWeight: '600' },
  // ⚠️ VARSAYILAN RENK NÖTR (bilgi), UYARI DEĞİL: çekme normal bir üretim
  // gerçeğidir ve her kabulde görünür. Amber'i varsayılan yapmak, gerçekten
  // dikkat isteyen durumu (tolerans aşımı) sıradanlaştırırdı.
  diffBanner: {
    backgroundColor: '#eff6ff',
    borderColor: '#93c5fd',
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  diffBannerWarn: { backgroundColor: '#fef3c7', borderColor: '#d97706' },
  diffBannerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1e3a8a',
    letterSpacing: 0.3,
  },
  diffBannerTitleWarn: { color: '#92400e' },
  diffBannerBody: {
    fontSize: 12,
    color: '#1e40af',
    marginTop: 2,
    fontWeight: '600',
  },
  untouchedHint: {
    fontSize: 12,
    fontWeight: '700',
    color: '#b45309',
    marginBottom: 10,
    marginTop: -2,
  },
  // TEK PARÇA girişi — ekranın en önemli sayısı, en büyük kutusu.
  singleQtyWrap: { gap: 4 },
  singleQtyInput: { backgroundColor: '#fff', fontSize: 20, height: 58 },
  singleQtyHint: { fontSize: 12, color: '#475569', fontWeight: '600' },
  // "Fasonda kalan var mı?" kartı
  remainderCard: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 4,
    marginBottom: 12,
  },
  // ⚠️ SegmentedButtons bir SATIRIN (flexDirection:'row') içine KONMAZ — yanındaki
  // kutuyu sıfır genişliğe iter (gerekçe JSX'teki notta). Burada her şey alt alta.
  remainderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  remainderTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a', flexShrink: 1 },
  remainderHint: { fontSize: 12, color: '#475569', marginTop: 3, lineHeight: 17 },
  remainderSwitch: { marginTop: 10 },
  remainderBody: { marginTop: 10, gap: 6 },
  remainderInput: { backgroundColor: '#fff', height: 46 },
  remainderError: { fontSize: 12, fontWeight: '700', color: '#b91c1c' },
  remainderSummary: { fontSize: 12, fontWeight: '600', color: '#1e40af' },
  remainderModeToggle: { marginTop: 8, borderRadius: 8 },
  remainderModeToggleInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  remainderModeToggleText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  // Kalanın hangi topa yığıldığı — satırın kendi altında.
  leftHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  leftHintText: { fontSize: 11, fontWeight: '700', color: '#92400e', flexShrink: 1 },
  newRollItem: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    marginBottom: 8,
    gap: 6,
  },
  newRollItemInvalid: { borderColor: '#fca5a5', backgroundColor: '#fef2f2' },
  newRollRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  newRollIndex: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  newRollIndexText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  newRollQty: { flex: 1, backgroundColor: '#fff' },
  newRollNoteWrap: { marginTop: 4 },
  newRollNotePreview: {
    fontSize: 11,
    color: '#0369a1',
    fontStyle: 'italic',
    marginTop: 2,
    paddingLeft: 4,
  },

  // Sticky footer
  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    padding: 10,
    gap: 8,
  },
  // Giden/gelen uyuşmazlık modalı (ConfirmDialog description) satırları.
  mismatchLead: { fontSize: 14, color: '#475569', lineHeight: 20 },
  mismatchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 8,
    padding: 8,
  },
  mismatchRowText: { flex: 1, fontSize: 13, color: '#92400e', lineHeight: 18 },
  footerInputs: { flexDirection: 'row', gap: 8 },
  footerInput: { backgroundColor: '#fff' },
  // İrsaliye/Kabul Notu açılır-kapanır tetik satırı (kapalıyken footer kısa kalır).
  footerExtrasToggle: { borderRadius: 8 },
  footerExtrasToggleInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  footerExtrasToggleText: { flex: 1, fontSize: 13, color: '#475569', fontWeight: '600' },
  submitBtn: { borderRadius: 10 },
  submitBtnContent: { height: 56 },
  submitBtnLabel: { fontSize: 15, fontWeight: '700' },

  // Sağ
  rightCol: {
    flex: 1,
    backgroundColor: '#fff',
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
  },
  rightColPhone: {
    borderLeftWidth: 0,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  // Telefon modunda daraltıldığında — sadece kollaps şeridi görünür;
  // form üst kolonu kalan alanı kapsasın diye flex sıfır.
  rightColCollapsed: { flex: 0, flexGrow: 0 },
  collapseStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
    backgroundColor: '#eff6ff',
    borderBottomWidth: 1,
    borderBottomColor: '#dbeafe',
  },
  collapseStripText: { fontSize: 13, color: '#0f172a', fontWeight: '600' },
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

  // Tabs
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tab: {
    flex: 1,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  tabLabel: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  tabCount: {
    backgroundColor: '#cbd5e1',
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    minWidth: 22,
    alignItems: 'center',
  },
  tabCountText: { fontSize: 11, fontWeight: '700', color: '#0f172a' },
  // Pane (tab içeriği)
  paneFlex: { flex: 1 },
  loadingMore: { paddingVertical: 16, alignItems: 'center' },
  paneEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 6,
  },
  paneEmptyText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
  paneEmptyHint: { fontSize: 12, color: '#cbd5e1', textAlign: 'center' },

  paneSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 4,
  },
  paneSearchInput: {
    flex: 1,
    backgroundColor: 'transparent',
    fontSize: 13,
    height: 36,
  },
  paneSearchClear: { margin: 0, width: 28, height: 28 },

  // Bekleyen kart
  pendingCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  pendingCardHighlight: {
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
    borderWidth: 2,
  },
  pendingCardSelected: {
    borderColor: '#059669',
    backgroundColor: '#f0fdf4',
    borderWidth: 2,
  },
  pendingTouch: { borderRadius: 10 },
  pendingInner: { padding: 10, gap: 3 },
  pendingTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pendingBatch: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  pendingFlag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#f59e0b',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  pendingFlagText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  // Teşhis kartıyla AYNI amber dili — aynı sorunun listedeki yüzü.
  pendingAwaiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginTop: 3,
  },
  pendingAwaitingText: { fontSize: 10, fontWeight: '700', color: '#78350f', flexShrink: 1 },
  pendingMidRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pendingStep: { fontSize: 11, color: '#475569', fontWeight: '600', flex: 1 },
  pendingCompany: { fontSize: 11, color: '#475569', flex: 1 },
  pendingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  pendingQty: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  pendingDate: { fontSize: 10, color: '#94a3b8' },

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
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  rowQty: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  rowDate: { fontSize: 11, color: '#94a3b8' },
  // "Sevk bekliyor" rozeti — teşhis kartıyla aynı amber dili (aynı sorunun
  // listedeki yüzü; ayrı renk kullanmak iki ayrı sorun izlenimi verirdi).
  awaitingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginBottom: 4,
  },
  awaitingBadgeText: { fontSize: 11, fontWeight: '700', color: '#78350f', flexShrink: 1 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 4,
  },
  searchInput: {
    flex: 1,
    backgroundColor: 'transparent',
    fontSize: 13,
    height: 36,
  },
  searchClear: { margin: 0, width: 28, height: 28 },
});
