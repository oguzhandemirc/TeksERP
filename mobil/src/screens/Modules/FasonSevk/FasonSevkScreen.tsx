import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppModal from '../../../components/AppModal';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Surface,
  ActivityIndicator,
  Chip,
  TouchableRipple,
  Icon,
  Appbar,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
  onlineManager,
} from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  useReducedMotion,
} from 'react-native-reanimated';
import { palette } from '../../../theme/tokens';
import { springs } from '../../../theme/motion';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import ScreenChrome from '../../../components/ScreenChrome';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import { useDeviceType } from '../../../hooks/useDeviceType';
import WorkOrderDetailPanel from '../../../components/workOrder/WorkOrderDetailPanel';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { workOrderService } from '../../../services/workOrder.service';
import { rollService } from '../../../services/roll.service';
import { travelerCardService } from '../../../services/travelerCard.service';
import {
  subcontractorService,
  DispatchRequest,
  type ItemMismatchDetails,
  type RouteSkipDetails,
} from '../../../services/subcontractor.service';
import { STATION_MUT } from '../../../offline/mutations';
import { useFasonNoteMobileEntry } from '../../../hooks/useFeatureFlags';
import SyncStatusChip from '../../../components/SyncStatusChip';
import { SkeletonList } from '../../../components/motion';
import type { Roll, WorkOrderStep } from '../../../types/models';
import type { MainStackParamList } from '../../../navigation/types';
import {
  WORK_ORDER_STATUS_LABEL,
  WORK_ORDER_STATUS_COLOR,
  STEP_STATUS_LABEL,
  ROLL_STATUS_LABEL,
  fasonNoteLabel,
  trLabel,
} from '../../../utils/labels';

// Barkod tipi sezgisi — yanlış alana okutmayı backend 404'üne güvenmeden anında,
// net mesajla yakalar. Refakat kartı "İE" (= iş emri no; eski kartlar "RK"), top
// (rulo) "T" + rakam ile başlar; çakışmaz. Yalnızca KESİN ters tipi reddederiz.
const looksLikeRollBarcode = (code: string) => /^T\d/i.test(code.trim());
const looksLikeCardBarcode = (code: string) => /^(IE|RK)/i.test(code.trim());

// Android LMK: OS uzun süre arka planda bırakılan uygulamayı öldürür.
// Form taslağını AsyncStorage'a yazarak uygulama yeniden açılınca geri yükleriz.
const DRAFT_KEY = 'fason_sevk_draft_v1';

// Detay paneli (telefon) sürükleme — 3 yaslama konumu (kapalı/orta/büyük) +
// yaylı geçiş. Kapalı yükseklik sabit (başlık görünür kadar); orta/büyük ekran
// oranından hesaplanır.
const SHEET_COLLAPSED_H = 88;
const SHEET_SPRING = { damping: 22, stiffness: 240, mass: 0.6 };

interface ScannedRoll {
  id: string;
  /** Açık kumaş Roll'lar barkodsuz olabilir; fasona giden hep barkodlu. Defansif. */
  barcode: string | null;
  /** Topun kumaşı (Item) — sevk anında WO hedef kumaşıyla override hesaplamak için. */
  itemId: string | null;
  itemName: string;
  colorName?: string | null;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  status: string;
}

export default function FasonSevkScreen() {
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const device = useDeviceType();
  const isPhone = device === 'phone';
  const manualBarcodeEntry = useDeviceSettingsStore((s) => s.manualBarcodeEntry);

  // ── Form state ──
  const [workOrderId, setWorkOrderId] = useState('');
  const [workOrderLabel, setWorkOrderLabel] = useState('');
  const [stepId, setStepId] = useState('');
  const [subcontractorId, setSubcontractorId] = useState('');
  const [subcontractorLabel, setSubcontractorLabel] = useState('');
  // Planlamada hangi firma seçilmişti (snapshot) — override uyarısı için kullanılır
  const [plannedSubId, setPlannedSubId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<'wo' | 'step' | 'subcontractor' | null>(
    null
  );

  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedRolls, setScannedRolls] = useState<ScannedRoll[]>([]);
  const [scanning, setScanning] = useState(false);
  // Telefon modunda alttaki "İş Emri Detayları" paneli daraltılabilir.
  // Daraltıldığında sadece başlık satırı görünür → operatör form alanına yer açar.
  // Default olarak kapalı gelir, WO seçildiğinde açılır.
  const [detailsCollapsed, setDetailsCollapsed] = useState(true);
  // Refakat kartı: manuel input + kamera + liste — üçü de aynı WO seçim akışına bağlı.
  const [cardScannerOpen, setCardScannerOpen] = useState(false);
  const [resolvingCard, setResolvingCard] = useState(false);
  const [cardInput, setCardInput] = useState('');
  // Top barkodu kamera tarama — okutulan barkod barcodeInput'a yazılır + resolve edilir.
  const [rollScannerOpen, setRollScannerOpen] = useState(false);
  const [rollPickerOpen, setRollPickerOpen] = useState(false);

  const [plateNumber, setPlateNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [notes, setNotes] = useState('');
  // Fason adım talimatı — sevk notundan ayrı. Operatör girişi yalnızca flag
  // açıkken (Electron ayarı, default kapalı); kapalıyken talimat adımın notundan gelir.
  const [instruction, setInstruction] = useState('');
  const fasonNoteMobileEntry = useFasonNoteMobileEntry();
  // Sevk bilgileri (plaka/sürücü/not) opsiyonel — katlanır bölüm, varsayılan kapalı.
  const [shippingOpen, setShippingOpen] = useState(false);

  // ── Telefon: sürüklenebilir "İş Emri Detayları" paneli (3 yaslama konumu) ──
  // sheetH = panelin canlı yüksekliği (shared value). detailsCollapsed yalnızca
  // chevron yönü + tablet flex'i için tutulur; sürükleme onu runOnJS ile eşler.
  const { height: winH } = useWindowDimensions();
  const SHEET_MIDDLE_H = Math.round(winH * 0.42);
  const SHEET_EXPANDED_H = Math.round(winH * 0.78);
  const sheetH = useSharedValue(SHEET_COLLAPSED_H);
  const sheetStartH = useSharedValue(0);
  const sheetStyle = useAnimatedStyle(() => ({ height: sheetH.value }));
  const snapTo = useCallback(
    (target: number) => {
      sheetH.value = withSpring(target, SHEET_SPRING);
      setDetailsCollapsed(target <= SHEET_COLLAPSED_H + 1);
    },
    [sheetH],
  );
  const sheetPan = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          sheetStartH.value = sheetH.value;
        })
        .onUpdate((e) => {
          const h = sheetStartH.value - e.translationY;
          sheetH.value = Math.min(SHEET_EXPANDED_H, Math.max(SHEET_COLLAPSED_H, h));
        })
        .onEnd((e) => {
          // Hız-duyarlı en yakın yaslama: kapalı / orta / büyük.
          const projected = sheetH.value - e.velocityY * 0.12;
          let target = SHEET_COLLAPSED_H;
          if (Math.abs(projected - SHEET_MIDDLE_H) < Math.abs(projected - target)) {
            target = SHEET_MIDDLE_H;
          }
          if (Math.abs(projected - SHEET_EXPANDED_H) < Math.abs(projected - target)) {
            target = SHEET_EXPANDED_H;
          }
          sheetH.value = withSpring(target, SHEET_SPRING);
          runOnJS(setDetailsCollapsed)(target <= SHEET_COLLAPSED_H + 1);
        }),
    [SHEET_MIDDLE_H, SHEET_EXPANDED_H, sheetH, sheetStartH],
  );

  // Kamera taramasında okunan barkod — işleme, modal TAM kapandıktan sonra
  // (onModalHide) yapılır ki hata/başarı toast'ı modal-içi toast yerine KÖK
  // toast'ta görünsün; aksi halde modal kapanışıyla toast anında kayboluyor.
  const pendingCardScanRef = useRef<string | null>(null);

  // ── Draft yedekleme (Android LMK koruması) ──
  // OS uygulamayı arka planda öldürünce React state sıfırlanır. Taslağı
  // AsyncStorage'a yazarak uygulama yeniden açılınca geri yükleriz.
  // 8 saat (1 vardiya) sonra otomatik sona erer — eski toplar başka sevkte
  // gönderilmiş olabilir, yeni vardiyanın temiz başlaması daha güvenli.
  const DRAFT_TTL_MS = 8 * 60 * 60 * 1000;
  const draftRestoredRef = useRef(false);

  // Mount: daha önce kaydedilmiş taslak varsa ve 8 saatten genç ise geri yükle.
  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY).then((raw) => {
      if (raw) {
        try {
          const d = JSON.parse(raw) as Record<string, unknown>;
          const age = typeof d.savedAt === 'number' ? Date.now() - d.savedAt : Infinity;
          if (age < DRAFT_TTL_MS) {
            if (typeof d.workOrderId === 'string' && d.workOrderId) setWorkOrderId(d.workOrderId);
            if (typeof d.workOrderLabel === 'string' && d.workOrderLabel) setWorkOrderLabel(d.workOrderLabel);
            if (typeof d.stepId === 'string' && d.stepId) setStepId(d.stepId);
            if (typeof d.subcontractorId === 'string' && d.subcontractorId) setSubcontractorId(d.subcontractorId);
            if (typeof d.subcontractorLabel === 'string' && d.subcontractorLabel) setSubcontractorLabel(d.subcontractorLabel);
            if (typeof d.plannedSubId === 'string') setPlannedSubId(d.plannedSubId);
            if (Array.isArray(d.scannedRolls) && d.scannedRolls.length > 0) setScannedRolls(d.scannedRolls as ScannedRoll[]);
            if (typeof d.plateNumber === 'string' && d.plateNumber) setPlateNumber(d.plateNumber);
            if (typeof d.driverName === 'string' && d.driverName) setDriverName(d.driverName);
            if (typeof d.notes === 'string' && d.notes) setNotes(d.notes);
            if (typeof d.instruction === 'string' && d.instruction) setInstruction(d.instruction);
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

  // Autosave: her değişiklikte 600 ms debounce ile yazar. Restore tamamlanmadan
  // (draftRestoredRef=false) asla yazmaz — sıfır state ile taslağı silmez.
  useEffect(() => {
    if (!draftRestoredRef.current) return;
    const t = setTimeout(() => {
      if (!workOrderId && scannedRolls.length === 0) {
        AsyncStorage.removeItem(DRAFT_KEY);
        return;
      }
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        workOrderId, workOrderLabel, stepId,
        subcontractorId, subcontractorLabel, plannedSubId,
        scannedRolls, plateNumber, driverName, notes, instruction,
      }));
    }, 600);
    return () => clearTimeout(t);
  }, [workOrderId, workOrderLabel, stepId, subcontractorId, subcontractorLabel,
      plannedSubId, scannedRolls, plateNumber, driverName, notes, instruction]);

  // ── WO picker server-side state ──
  const WO_PAGE_SIZE = 30;
  type WoSort = 'createdAt' | 'plannedEndDate';
  const [woSearch, setWoSearch] = useState('');
  const [woSort, setWoSort] = useState<WoSort>('createdAt');

  // Picker açılınca state'i sıfırla + güncel veri için cache'i bypass eden refetch.
  // (Aynı queryKey'e dönülürse react-query cache döner; refetch zorunlu.)
  useEffect(() => {
    if (pickerOpen === 'wo') {
      setWoSearch('');
      setWoSort('createdAt');
      qc.invalidateQueries({ queryKey: ['work-orders', 'fason-sevk'] });
    }
  }, [pickerOpen]);

  // ── İş emirleri (PLANNED + IN_PROGRESS) — server-side paginated ──
  // withOrderDetail=true: picker satırı için tarih + termin + ürün + hedef.
  // Detay (müşteri, renk, dispatch progress) seçim sonrası `getById` ile gelir.
  // Cursor + infinite scroll. Fason (EXTERNAL) adımı sevke açık WO filtresi artık
  // SUNUCUDA (hasOpenExternalStep) — eski client-side `externalOpenWOs` filtresi
  // pager'ı yanıltıyor + over-fetch yapıyordu. Çoklu sevk: COMPLETED EXTERNAL adım
  // da uygundur (backend `status: { not: SKIPPED }`).
  const woQuery = useInfiniteQuery({
    queryKey: ['work-orders', 'fason-sevk', woSearch, woSort],
    queryFn: ({ pageParam }) =>
      workOrderService.getAllCursor(
        {
          limit: WO_PAGE_SIZE,
          cursor: pageParam,
          sortBy: woSort,
          sortOrder: woSort === 'plannedEndDate' ? 'asc' : 'desc',
          filters: { status: 'PLANNED,IN_PROGRESS' },
          search: woSearch || undefined,
        },
        { withOrderDetail: true, hasOpenExternalStep: true },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.nextCursor : null,
    enabled: pickerOpen === 'wo',
    placeholderData: keepPreviousData,
  });

  const externalOpenWOs = useMemo(
    () => woQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [woQuery.data],
  );

  // Kompakt picker: tarih · termin · ürün · hedef metraj. Müşteri/renk/reçete
  // detayları seçim sonrası sağdaki "İş Emri Detayları" panelinde görünür.
  const woOptions = useMemo<PickerOption[]>(() => {
    return externalOpenWOs.map((w) => {
      const details: string[] = [];

      // En erken termin — sort yerine reduce ile min (küçük array, temiz)
      let earliestDeadlineMs: number | null = null;
      for (const link of w.orderLinks ?? []) {
        const d = link.orderLine?.order?.deadline;
        if (!d) continue;
        const ms = new Date(d).getTime();
        if (earliestDeadlineMs === null || ms < earliestDeadlineMs) {
          earliestDeadlineMs = ms;
        }
      }
      const earliestDeadline = w.plannedEndDate
        ? dayjs(w.plannedEndDate)
        : earliestDeadlineMs !== null
          ? dayjs(earliestDeadlineMs)
          : null;

      // Ürünler — ilk 2 unique
      const itemMap = new Map<string, string>();
      for (const link of w.orderLinks ?? []) {
        const item = link.orderLine?.item;
        if (item) itemMap.set(item.id, item.name);
      }
      const items = Array.from(itemMap.values());
      const itemLabel =
        items.length > 0
          ? items.slice(0, 2).join(', ') +
            (items.length > 2 ? ` +${items.length - 2}` : '')
          : null;

      // Tek satır: tarih · termin · ürün(ler) — dikey yer tasarrufu
      const line1: string[] = [];
      if (w.createdAt) {
        line1.push(`📅 ${dayjs(w.createdAt).format('DD.MM.YYYY')}`);
      }
      if (earliestDeadline) {
        line1.push(`⏳ ${earliestDeadline.format('DD.MM.YYYY')}`);
      }
      if (itemLabel) {
        line1.push(`🧵 ${itemLabel}`);
      }
      if (line1.length > 0) details.push(line1.join('  ·  '));

      // 2. satır (opsiyonel): hedef metraj — alt referans bilgisi
      if (w.targetQuantity) {
        details.push(
          `📐 ${w.targetQuantity} mt${w.width ? ` · ${w.width} cm` : ''}`,
        );
      }

      return {
        value: w.id,
        label: w.workOrderNumber,
        details,
        badge: {
          text: trLabel(WORK_ORDER_STATUS_LABEL, w.status),
          color: WORK_ORDER_STATUS_COLOR[w.status] ?? '#64748b',
        },
      } as PickerOption;
    });
  }, [externalOpenWOs]);

  // ── Seçilen iş emri detayı (steps dahil) ──
  const woDetailQuery = useQuery({
    queryKey: ['work-order', workOrderId],
    queryFn: () => workOrderService.getById(workOrderId),
    enabled: !!workOrderId,
  });

  // Seçili WO'nun zenginleştirilmiş kaydı — picker (list) artık hafif, detayı
  // `getById` (woDetailQuery) sağlar: orderLinks(+customer), targetColor,
  // dispatchedTotalQty hepsi burada.
  const selectedWo = woDetailQuery.data?.data ?? null;

  const externalSteps = useMemo<WorkOrderStep[]>(() => {
    const steps = woDetailQuery.data?.data?.steps ?? [];
    // Çoklu sevk: COMPLETED fason adımı da seçilebilir (ek parti gönderilince
    // backend adımı yeniden ACTIVE'e açar). Sadece SKIPPED/CANCELLED hariç.
    return steps.filter(
      (s) =>
        s.station?.type === 'EXTERNAL' &&
        s.status !== 'SKIPPED' &&
        s.status !== 'CANCELLED'
    );
  }, [woDetailQuery.data]);

  // İş emri seçilince tek EXTERNAL step varsa otomatik seç
  useEffect(() => {
    if (externalSteps.length === 1 && !stepId) {
      setStepId(externalSteps[0].id);
    } else if (externalSteps.length === 0) {
      setStepId('');
    }
  }, [externalSteps]);

  // Refakat kartı kamera ile okutulunca: barkod → WO çözümle → otomatik seç.
  const handleCardScan = async (rawBarcode: string) => {
    const barcode = rawBarcode.trim();
    if (!barcode) return;
    // Yanlış tip: top barkodu (T...) kart alanına okutulduysa anında net hata.
    if (looksLikeRollBarcode(barcode)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Toast.show({
        type: 'error',
        text1: 'Bu bir top barkodu',
        text2: 'Buraya refakat kartı / iş emri barkodu okutun.',
      });
      return;
    }
    setResolvingCard(true);
    try {
      const res = await travelerCardService.findByBarcode(barcode);
      const card = res.data;
      if (!card) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Toast.show({ type: 'error', text1: 'Kart bulunamadı', text2: barcode });
        return;
      }
      if (card.status !== 'ACTIVE') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Toast.show({
          type: 'error',
          text1: 'Kart aktif değil',
          text2: `Durum: ${card.status}`,
        });
        return;
      }
      const wo = card.workOrder;
      if (!wo) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Toast.show({ type: 'error', text1: 'İş emri yüklenemedi' });
        return;
      }
      if (wo.status !== 'PLANNED' && wo.status !== 'IN_PROGRESS') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Toast.show({
          type: 'error',
          text1: 'Bu iş emri sevke uygun değil',
          text2: `Durum: ${wo.status}`,
        });
        return;
      }
      // Çoklu sevk: açık sevk olması artık kart okutmayı engellemez — boyahaneye
      // ek parti gönderilebilir (aynı topu iki kez gönderme backend per-roll
      // status kontrolüyle zaten engelli).
      // Picker filtresiyle aynı: sevke uygun (SKIPPED/CANCELLED olmayan) en az
      // bir EXTERNAL adım olmalı; COMPLETED adım ek parti için yeniden açılır.
      const hasOpenExternal = (wo.steps ?? []).some(
        (s) =>
          s.station?.type === 'EXTERNAL' &&
          s.status !== 'SKIPPED' &&
          s.status !== 'CANCELLED',
      );
      if (!hasOpenExternal) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Toast.show({
          type: 'error',
          text1: 'Sevke uygun fason adımı yok',
          text2: wo.workOrderNumber,
        });
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setWorkOrderId(wo.id);
      setWorkOrderLabel(`${wo.workOrderNumber} · ${trLabel(WORK_ORDER_STATUS_LABEL, wo.status)}`);
      setStepId('');
      setSubcontractorId('');
      setSubcontractorLabel('');
      setPlannedSubId(null);
      setCardInput('');
      snapTo(SHEET_MIDDLE_H);
      Toast.show({
        type: 'success',
        text1: 'İş emri seçildi',
        text2: wo.workOrderNumber,
      });
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'Kart okuma hatası',
        text2: (err as Error).message,
      });
    } finally {
      setResolvingCard(false);
    }
  };

  // Seçilen step (planlama bilgileri için)
  const selectedStep = useMemo(
    () => externalSteps.find((s) => s.id === stepId) ?? null,
    [externalSteps, stepId]
  );
  const requiredCategoryId = selectedStep?.requiredCategoryId ?? null;
  const requiredCategoryName = selectedStep?.requiredCategory?.name ?? null;

  // Adım seçildiğinde planlanan firmayı otomatik ön-seç
  useEffect(() => {
    if (selectedStep?.plannedSubcontractor) {
      setPlannedSubId(selectedStep.plannedSubcontractor.id);
      // Override yoksa otomatik seç
      if (!subcontractorId) {
        setSubcontractorId(selectedStep.plannedSubcontractor.id);
        setSubcontractorLabel(
          `${selectedStep.plannedSubcontractor.code} — ${selectedStep.plannedSubcontractor.name}`
        );
      }
    } else {
      setPlannedSubId(null);
    }
  }, [selectedStep?.id]);

  // ── Fason firmalar — adımın requiredCategoryId'sine göre filtrelenir ──
  const subcontractorsQuery = useQuery({
    queryKey: ['subcontractors', requiredCategoryId ?? 'all'],
    queryFn: () =>
      subcontractorService.listSubcontractors({
        page: 1,
        pageSize: 500,
        sortBy: 'name',
        sortOrder: 'asc',
        filters: {
          isActive: 'true',
          ...(requiredCategoryId ? { categoryId: requiredCategoryId } : {}),
        },
      }),
    // Step seçilmeden firma listesi gösterme — kategori bilinmeden filtre eksik kalır
    enabled: !!stepId,
  });

  useEffect(() => {
    if (subcontractorsQuery.error) {
      Toast.show({
        type: 'error',
        text1: 'Fason firmalar yüklenemedi',
        text2: (subcontractorsQuery.error as Error).message,
      });
    }
  }, [subcontractorsQuery.error]);

  const subcontractorOptions = useMemo<PickerOption[]>(
    () =>
      (subcontractorsQuery.data?.data ?? []).map((s) => {
        const isPlanned = plannedSubId && s.id === plannedSubId;
        return {
          value: s.id,
          label: s.name,
          sublabel: s.code,
          badge: isPlanned ? { text: '⭐ Planlanan', color: '#10b981' } : undefined,
        };
      }),
    [subcontractorsQuery.data, plannedSubId]
  );

  // Plandan farklı firma seçildi mi?
  const isOverride =
    !!plannedSubId && !!subcontractorId && plannedSubId !== subcontractorId;

  const stepOptions = useMemo<PickerOption[]>(
    () =>
      externalSteps.map((s) => ({
        value: s.id,
        label: s.station?.name ?? '—',
        sublabel: `Adım ${s.stepSequence} · ${trLabel(STEP_STATUS_LABEL, s.status)}`,
      })),
    [externalSteps]
  );

  // Geçmiş sevkler artık ayrı tam sayfada (FasonSevkGecmisi) — cursor + filtreli.

  // Item mismatch modal state — backend "ITEM_MISMATCH" döndüğünde set edilir,
  // kullanıcı onayla → retry with allowItemOverride. Vars saklanır ki retry
  // aynı payload + override flag ile yapılabilsin.
  const [itemMismatch, setItemMismatch] = useState<{
    details: ItemMismatchDetails;
    originalVars: DispatchRequest;
  } | null>(null);

  // Rota-atlama uyarısı — backend "ROUTE_SKIP" döndüğünde set edilir; operatör
  // onaylayınca allowRouteSkip ile retry. (ITEM_MISMATCH ile aynı warn-then-confirm.)
  const [routeSkip, setRouteSkip] = useState<{
    details: RouteSkipDetails;
    originalVars: DispatchRequest;
  } | null>(null);

  // Okutma-anı kumaş uyuşmazlığı — top eklenirken WO hedef kumaşı (targetItem)
  // ile topun kumaşı farklıysa, listeye eklemeden ÖNCE onay diyaloğu göster.
  // Yalnızca kumaşa (Item) bakar; en / metraj / kalite önemsiz. Operatör onaylarsa
  // top eklenir ve sevkte allowItemOverride ile gider (ikinci kez sorulmaz).
  const [pendingMismatch, setPendingMismatch] = useState<{
    roll: Roll;
    expectedLabel: string;
    rollItemLabel: string;
  } | null>(null);

  // ── Mutations ──
  // OFFLINE-AWARE: mutationFn `setMutationDefaults`'ta tanımlı; persist sonrası
  // app restart'ında resolve. Backend idempotent: aynı stepId + rollIds +
  // subcontractorId payload ile 2. çağrı cached openDispatch döner.
  //
  // UX şartı: offline'da operatör irsaliyeyi ELLE yazıp şoföre verir. Online
  // dönünce backend gerçek dispatchNo'yu verir.
  //
  // FORM RESET STRATEGY: onMutate yerine onSuccess'te temizleme. Item mismatch
  // gibi backend rejection durumunda form ayakta kalmalı ki operatör override
  // veya düzeltebilsin.
  const dispatchMutation = useMutation<
    Awaited<ReturnType<typeof subcontractorService.dispatch>>,
    Error & { details?: Record<string, unknown> },
    DispatchRequest
  >({
    mutationKey: STATION_MUT.FASON_SEVK_DISPATCH,
    onMutate: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Sevk kaydedildi',
        text2: onlineManager.isOnline()
          ? undefined
          : 'Çevrimdışı — irsaliyeyi ELLE yaz, sync olunca gerçek no gelecek',
      });
    },
    onSuccess: () => {
      // Form sıfırla — operatör yeni iş emri seçerek baştan başlar
      setWorkOrderId('');
      setWorkOrderLabel('');
      setStepId('');
      setSubcontractorId('');
      setSubcontractorLabel('');
      setPlannedSubId(null);
      setScannedRolls([]);
      setBarcodeInput('');
      setPlateNumber('');
      setDriverName('');
      setNotes('');
      setInstruction('');
      setDetailsCollapsed(true);
      AsyncStorage.removeItem(DRAFT_KEY);
      // Listeleri tazele (yeni dispatch, WO statüsü). ['rolls'] de invalide edilir:
      // sevk edilen toplar artık STOCK değil → Top Seç picker cache'i bayat kalmasın.
      qc.invalidateQueries({ queryKey: ['dispatches'] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['rolls'] });
    },
    onError: (err, vars) => {
      // Backend ITEM_MISMATCH özel durumu — modal göster, retry with override
      const details = err.details as
        | ItemMismatchDetails
        | RouteSkipDetails
        | undefined;
      if (details?.code === 'ITEM_MISMATCH') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setItemMismatch({ details, originalVars: vars });
        return;
      }
      if (details?.code === 'ROUTE_SKIP') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setRouteSkip({ details, originalVars: vars });
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Sevk başarısız', text2: err.message });
    },
  });

  // Item mismatch onaylanırsa aynı payload + override flag ile retry
  const handleItemMismatchOverride = () => {
    if (!itemMismatch) return;
    const retryVars: DispatchRequest = {
      ...itemMismatch.originalVars,
      allowItemOverride: true,
    };
    setItemMismatch(null);
    dispatchMutation.mutate(retryVars);
  };

  // Rota-atlama onaylanırsa aynı payload + allowRouteSkip ile retry
  const handleRouteSkipOverride = () => {
    if (!routeSkip) return;
    const retryVars: DispatchRequest = {
      ...routeSkip.originalVars,
      allowRouteSkip: true,
    };
    setRouteSkip(null);
    dispatchMutation.mutate(retryVars);
  };

  // Geçmişe git — eski "Son Sevkler" modalı yerine tam sayfa.
  const openHistory = useCallback(() => nav.navigate('FasonSevkGecmisi'), [nav]);

  // ── Barkod ekleme ──
  // 'added'     → listeye eklendi
  // 'duplicate' → zaten listede (picker açık kalsın, başka top seçilebilir)
  // 'mismatch'  → kumaş uyuşmazlığı, onay diyaloğu açıldı (picker kapanmalı)
  type AddResult = 'added' | 'duplicate' | 'mismatch';
  const addRollToList = (r: Roll, opts?: { overrideItem?: boolean }): AddResult => {
    if (scannedRolls.some((s) => s.barcode === r.barcode)) {
      Toast.show({ type: 'info', text1: 'Bu top zaten listede' });
      return 'duplicate';
    }
    // Kumaş (Item) kontrolü — SADECE kumaşa bakar; en/metraj/kalite önemsiz.
    // İş emrinin hedef kumaşı varsa ve topun kumaşı farklıysa, eklemeden önce
    // operatöre "yanlış kumaş?" onayı sor. overrideItem=true ise (operatör zaten
    // onayladı) kontrolü atla.
    const rollItemId = r.item?.id ?? r.itemId ?? null;
    if (
      !opts?.overrideItem &&
      selectedWo?.targetItemId &&
      rollItemId &&
      rollItemId !== selectedWo.targetItemId
    ) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setPendingMismatch({
        roll: r,
        expectedLabel: selectedWo.targetItem?.name ?? '—',
        rollItemLabel: r.item?.name ?? '—',
      });
      return 'mismatch';
    }
    setScannedRolls((prev) => [
      {
        id: r.id,
        barcode: r.barcode,
        itemId: rollItemId,
        itemName: r.item?.name ?? '—',
        colorName: r.color?.name ?? null,
        currentQty: r.currentQty,
        width: r.width ?? null,
        qualityGrade: r.qualityGrade,
        status: r.status,
      },
      ...prev,
    ]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    return 'added';
  };

  const handleAddBarcodeFromInput = () => addBarcodeFromString(barcodeInput);

  // K-A5 fix: aynı barkodun EŞZAMANLI iki çözümlenmesi (hızlı çift okutma) iki
  // resolve'un da bayat listeye karşı dedup geçmesiyle çift satır ekleyebiliyordu.
  const resolvingBarcodesRef = useRef<Set<string>>(new Set());

  const addBarcodeFromString = async (raw: string) => {
    const barcode = raw.trim();
    if (!barcode) return;

    if (scannedRolls.some((r) => r.barcode === barcode)) {
      Toast.show({ type: 'info', text1: 'Bu top zaten listede' });
      setBarcodeInput('');
      return;
    }
    if (resolvingBarcodesRef.current.has(barcode)) return; // aynı kod zaten çözümleniyor

    // Yanlış tip: refakat kartı (RK-) top alanına okutulduysa anında net hata.
    if (looksLikeCardBarcode(barcode)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Toast.show({
        type: 'error',
        text1: 'Bu bir refakat kartı',
        text2: 'Buraya top (rulo) barkodu okutun.',
      });
      setBarcodeInput('');
      return;
    }

    setScanning(true);
    resolvingBarcodesRef.current.add(barcode);
    try {
      const res = await rollService.getByBarcode(barcode);
      const r = res.data;
      if (!r) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: barcode });
        return;
      }
      addRollToList(r);
      setBarcodeInput('');
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'Top sorgulanamadı',
        text2: (err as Error).message,
      });
    } finally {
      setScanning(false);
      resolvingBarcodesRef.current.delete(barcode);
    }
  };

  const handleRemoveRoll = useCallback((id: string) => {
    setScannedRolls((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // Sevk listesindeki toplam metraj — her render'da reduce çalışmasın.
  // currentQty backend'den string (Prisma Decimal) gelebilir; Number()'a sarmadan
  // `0 + "5.5"` string concat yapar, sonuç string olur ve `.toFixed` undefined.
  const scannedRollsTotal = useMemo(
    () => scannedRolls.reduce((s, r) => s + Number(r.currentQty ?? 0), 0),
    [scannedRolls],
  );

  // ── Sevk gönderme ──
  const canDispatch =
    !!workOrderId && !!stepId && !!subcontractorId && scannedRolls.length > 0;

  const handleDispatch = () => {
    if (!canDispatch) {
      Toast.show({ type: 'error', text1: 'Eksik alan', text2: 'Tüm seçimleri yapın' });
      return;
    }
    // Operatör okutma anında "yine de ekle" diyerek onayladığı yanlış-kumaş toplar
    // için backend'e override geç — aksi halde sevkte ikinci kez "Ürün Uyuşmazlığı"
    // modalı çıkar. Mismatch yoksa flag gönderme (undefined).
    const hasItemMismatch =
      !!selectedWo?.targetItemId &&
      scannedRolls.some((r) => r.itemId && r.itemId !== selectedWo.targetItemId);
    dispatchMutation.mutate({
      workOrderId,
      stepId,
      subcontractorId,
      rollIds: scannedRolls.map((r) => r.id),
      plateNumber: plateNumber.trim() || undefined,
      driverName: driverName.trim() || undefined,
      notes: notes.trim() || undefined,
      instruction: instruction.trim() || undefined,
      allowItemOverride: hasItemMismatch || undefined,
    });
  };

  // İş emri seçimini ve ona bağlı (adım/firma) seçimleri temizler — o iş
  // emrinden çıkış. Detay paneli kapanır, kart okutma çubuğu geri gelir.
  const clearWorkOrder = () => {
    setWorkOrderId('');
    setWorkOrderLabel('');
    setStepId('');
    setSubcontractorId('');
    setSubcontractorLabel('');
    setPlannedSubId(null);
    setScannedRolls([]);
    setPlateNumber('');
    setDriverName('');
    setNotes('');
    setInstruction('');
    AsyncStorage.removeItem(DRAFT_KEY);
    snapTo(SHEET_COLLAPSED_H);
  };
  // Katlanmış "Sevk Bilgileri" başlığında gösterilecek özet (doluysa).
  const shippingSummary = [
    plateNumber.trim() || null,
    driverName.trim() || null,
    notes.trim() ? 'not' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Detay paneli başlık bloğu — durum sağa yaslı (başlık satırı); en + bu
  // siparişteki toplam metraj sağa yaslı (batch satırı). Toplam metraj = WO hedef
  // metrajı; yoksa bağlı sipariş satırlarının toplamı. Telefon sheet'i + tablet
  // sütunu ortak kullanır.
  const orderTotalMeters = selectedWo
    ? selectedWo.targetQuantity ??
      (selectedWo.orderLinks ?? []).reduce(
        (sum, l) => sum + Number(l.orderLine?.quantity ?? 0),
        0,
      )
    : null;
  // Bu WO'dan fason firmaya zaten gönderilen (iptal edilmemiş sevkler toplamı).
  // "Toplar" ilerleme çubuğu KALAN hedefi gösterir: WO hedefi − gönderilen.
  const dispatchedSoFar = Number(selectedWo?.dispatchedTotalQty ?? 0);
  const remainingTarget =
    orderTotalMeters != null ? Math.max(0, orderTotalMeters - dispatchedSoFar) : null;
  const metaRight = [
    selectedWo?.width != null ? `En ${selectedWo.width} cm` : null,
    orderTotalMeters && orderTotalMeters > 0 ? `${Math.round(orderTotalMeters)} m` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  const detailTitleBlock = (
    <View style={{ flex: 1 }}>
      <View style={styles.titleRow}>
        <Text
          variant="titleMedium"
          style={[styles.recentsTitle, styles.titleFlex]}
          numberOfLines={1}
        >
          İş Emri Detayları
        </Text>
        {selectedWo && (
          <View style={styles.statusChip}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: WORK_ORDER_STATUS_COLOR[selectedWo.status] ?? '#64748b' },
              ]}
            />
            <Text
              style={[
                styles.statusChipText,
                { color: WORK_ORDER_STATUS_COLOR[selectedWo.status] ?? '#64748b' },
              ]}
            >
              {trLabel(WORK_ORDER_STATUS_LABEL, selectedWo.status)}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.metaRow}>
        <Text variant="bodySmall" style={styles.recentsCount} numberOfLines={1}>
          {selectedWo ? `İş Emri ${selectedWo.workOrderNumber}` : 'İş emri seçildikçe burada görünür'}
        </Text>
        {selectedWo && metaRight.length > 0 && (
          <Text variant="bodySmall" style={styles.metaRight} numberOfLines={1}>
            {metaRight}
          </Text>
        )}
      </View>
    </View>
  );

  const detailContent = (
    <ScrollView style={styles.recentsList} contentContainerStyle={styles.detailScrollContent}>
      {selectedWo ? (
        <WorkOrderDetailPanel wo={selectedWo} hideStatusWidth />
      ) : (
        <View style={styles.empty}>
          <Icon source="clipboard-text-outline" size={56} color="#cbd5e1" />
          <Text style={styles.emptyText}>İş emri seçilmedi</Text>
          <Text style={styles.emptyHint}>
            Sol taraftan bir iş emri seçtikten sonra detaylar burada görünecek
          </Text>
        </View>
      )}
    </ScrollView>
  );

  return (
    <ScreenChrome
      title="Fason Sevk"
      headerExtras={
        <View style={styles.headerExtrasRow}>
          <SyncStatusChip />
          {/* Geçmiş — hem telefon hem tablette header'dan erişilebilir. */}
          <Appbar.Action
            icon="history"
            color="#fff"
            onPress={openHistory}
            accessibilityLabel="Fason sevk geçmişi"
          />
        </View>
      }
    >
      <View style={[styles.body, isPhone && styles.bodyPhone]}>
        {/* ── SOL: Yeni Sevk ── */}
        <KeyboardAwareScrollView
          style={styles.formCol}
          contentContainerStyle={[styles.formContent, isPhone && styles.formContentPhone]}
          bottomOffset={16}
        >
          {/* ① İş Emri & Fason */}
          <Surface style={styles.card} elevation={1}>
            <View style={styles.fieldHead}>
              <Text style={styles.label}>
                İş Emri <Text style={styles.required}>*</Text>
              </Text>
              {workOrderId ? (
                <Button
                  compact
                  mode="contained-tonal"
                  icon="close-circle-outline"
                  buttonColor="#fee2e2"
                  textColor="#dc2626"
                  onPress={clearWorkOrder}
                >
                  Vazgeç
                </Button>
              ) : null}
            </View>
            {!workOrderId && (
              <ScannerEntryBar
                value={cardInput}
                onChangeText={setCardInput}
                placeholder="Refakat kartı / İş Emri (örn IE1407260001)"
                onResolve={() => handleCardScan(cardInput)}
                resolving={resolvingCard}
                onScan={() => setCardScannerOpen(true)}
                onList={() => setPickerOpen('wo')}
                tone="blue"
              />
            )}

            {/* Fason Adımı + Fason Firma — yan yana (WO seçilince) */}
            {workOrderId && (
              <>
                <View style={styles.fieldsRow}>
                  {/* Fason Adımı */}
                  <View style={styles.col}>
                    <Text style={[styles.label, styles.labelSpaced]}>
                      Fason Adımı <Text style={styles.required}>*</Text>
                    </Text>
                    {externalSteps.length === 0 ? (
                      <Text style={styles.warningText}>Sevke uygun adım yok.</Text>
                    ) : externalSteps.length === 1 ? (
                      // Tek adım: otomatik seçili bilgi kartı
                      <View style={styles.lockedInfo}>
                        <View style={styles.lockedIconBox}>
                          <Text style={styles.lockedIcon}>🏭</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.lockedLabel} numberOfLines={1}>
                            {externalSteps[0].station?.name ?? '—'}
                          </Text>
                          <Text style={styles.lockedSublabel} numberOfLines={1}>
                            #{externalSteps[0].stepSequence} ·{' '}
                            {trLabel(STEP_STATUS_LABEL, externalSteps[0].status)}
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <TouchableRipple
                        onPress={() => setPickerOpen('step')}
                        style={styles.picker}
                        borderless
                      >
                        <View style={styles.pickerInner}>
                          <Text
                            style={[styles.pickerText, !stepId && styles.pickerPlaceholder]}
                            numberOfLines={1}
                          >
                            {externalSteps.find((s) => s.id === stepId)?.station?.name ??
                              `${externalSteps.length} adım — seç`}
                          </Text>
                          <IconButton icon="chevron-down" size={24} />
                        </View>
                      </TouchableRipple>
                    )}
                  </View>

                  {/* Fason Firma */}
                  <View style={styles.col}>
                    <Text style={[styles.label, styles.labelSpaced]} numberOfLines={1}>
                      Fason Firma <Text style={styles.required}>*</Text>
                      {requiredCategoryName ? (
                        <Text style={styles.helperText}> ({requiredCategoryName})</Text>
                      ) : null}
                    </Text>
                    <TouchableRipple
                      onPress={() => stepId && setPickerOpen('subcontractor')}
                      style={[styles.picker, !stepId && styles.pickerDisabled]}
                      borderless
                      disabled={!stepId}
                    >
                      <View style={styles.pickerInner}>
                        <Text
                          style={[styles.pickerText, !subcontractorId && styles.pickerPlaceholder]}
                          numberOfLines={1}
                        >
                          {subcontractorLabel || (stepId ? 'Firma seç...' : 'Önce adım seç')}
                        </Text>
                        <IconButton icon="chevron-down" size={24} />
                      </View>
                    </TouchableRipple>
                  </View>
                </View>
                {isOverride && (
                  <View style={styles.overrideWarning}>
                    <Text style={styles.overrideWarningText}>
                      ⚠️ Bu sevk plandan farklı bir firmaya yapılıyor. Sebep raporlanacak.
                    </Text>
                  </View>
                )}
              </>
            )}
          </Surface>

          {/* ② Toplar — asıl iş: okutma + sevk listesi */}
          {workOrderId && stepId && (
            <Surface style={styles.card} elevation={1}>
              <Text style={styles.sectionTitle}>
                Toplar{scannedRolls.length > 0 ? ` (${scannedRolls.length})` : ''}
              </Text>
              {remainingTarget != null && remainingTarget > 0 ? (
                <DispatchProgressBar
                  current={scannedRollsTotal}
                  target={remainingTarget}
                />
              ) : orderTotalMeters != null && orderTotalMeters > 0 && dispatchedSoFar > 0 ? (
                <Text style={{ fontSize: 12, fontWeight: '600', color: palette.slate[500], paddingVertical: 6 }}>
                  Sevk hedefi doldu · {Math.round(dispatchedSoFar)} mt gönderildi
                </Text>
              ) : null}
              <ScannerEntryBar
                value={barcodeInput}
                onChangeText={setBarcodeInput}
                placeholder="Barkod gir veya okut..."
                inputLeftIcon="barcode-scan"
                resolving={scanning}
                onScan={() => setRollScannerOpen(true)}
                onList={() => setRollPickerOpen(true)}
                tone="blue"
                extra={
                  <Button
                    mode="contained"
                    icon={scanning ? undefined : 'plus'}
                    onPress={handleAddBarcodeFromInput}
                    disabled={scanning || !barcodeInput.trim()}
                    style={styles.addBtn}
                    contentStyle={styles.addBtnContent}
                  >
                    {scanning ? <ActivityIndicator size="small" color="#fff" /> : 'Ekle'}
                  </Button>
                }
              />
              {scannedRolls.length > 0 && (
                <View style={styles.rollList}>
                  <Text style={styles.rollListHeader}>
                    Sevk listesi ({scannedRolls.length} top,{' '}
                    {scannedRollsTotal.toFixed(1)} mt)
                  </Text>
                  {scannedRolls.map((r) => (
                    <ScannedRollRow key={r.id} roll={r} onRemove={handleRemoveRoll} />
                  ))}
                </View>
              )}
            </Surface>
          )}

          {/* ③ Sevk Bilgileri (opsiyonel) — katlanır: plaka / sürücü / not */}
          {workOrderId && (
            <Surface style={styles.card} elevation={1}>
              <TouchableRipple
                onPress={() => setShippingOpen((v) => !v)}
                borderless
                style={styles.sectionToggle}
              >
                <View style={styles.sectionToggleInner}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionTitle}>Sevk Bilgileri (opsiyonel)</Text>
                    {!shippingOpen && (
                      <Text style={styles.sectionSub} numberOfLines={1}>
                        {shippingSummary || 'Plaka · Sürücü · Not'}
                      </Text>
                    )}
                  </View>
                  <Icon
                    source={shippingOpen ? 'chevron-up' : 'chevron-down'}
                    size={22}
                    color="#64748b"
                  />
                </View>
              </TouchableRipple>
              {shippingOpen && (
                <View style={styles.sectionBody}>
                  <View style={styles.row}>
                    <View style={styles.col}>
                      <Text style={styles.label}>Plaka</Text>
                      <TextInput
                        mode="outlined"
                        value={plateNumber}
                        onChangeText={setPlateNumber}
                        placeholder="34 ABC 123"
                        autoCapitalize="characters"
                        style={styles.input}
                      />
                    </View>
                    <View style={styles.col}>
                      <Text style={styles.label}>Sürücü</Text>
                      <TextInput
                        mode="outlined"
                        value={driverName}
                        onChangeText={setDriverName}
                        placeholder="Sürücü adı"
                        style={styles.input}
                      />
                    </View>
                  </View>
                  <Text style={[styles.label, styles.labelSpaced]}>Not</Text>
                  <TextInput
                    mode="outlined"
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Sevk notu..."
                    dense
                    style={styles.input}
                  />
                </View>
              )}
            </Surface>
          )}

          {/* ④ Fason Talimatı (opsiyonel) — yalnızca Electron ayarından açıldıysa
              görünür (default kapalı). Kapalıyken talimat adımın notundan gelir. Boş
              bırakılırsa yine adımın notu kullanılır. Sevk fişinde / çeki listesinde
              "İstenen Renk"in yanında görünür; sonradan Electron'dan düzenlenebilir. */}
          {workOrderId && fasonNoteMobileEntry && (
            <Surface style={styles.card} elevation={1}>
              <View style={styles.sectionBody}>
                <Text style={styles.sectionTitle}>
                  {fasonNoteLabel(selectedStep?.station?.name)} (opsiyonel)
                </Text>
                <TextInput
                  mode="outlined"
                  value={instruction}
                  onChangeText={setInstruction}
                  placeholder="Boş bırakılırsa adımdaki talimat kullanılır..."
                  multiline
                  numberOfLines={3}
                  style={[styles.input, styles.labelSpaced]}
                />
              </View>
            </Surface>
          )}

          {/* Flag kapalıyken: bu partiyle gidecek fason talimatı (adımdan)
              salt-okunur görünür — operatör hangi talimatla gönderdiğini bilsin. */}
          {workOrderId && !fasonNoteMobileEntry && selectedStep?.notes ? (
            <Surface style={styles.card} elevation={1}>
              <View style={styles.sectionBody}>
                <Text style={styles.sectionTitle}>
                  {fasonNoteLabel(selectedStep?.station?.name)} (adımdan)
                </Text>
                <Text style={styles.instructionText}>{selectedStep.notes}</Text>
              </View>
            </Surface>
          ) : null}

          <Button
            mode="contained"
            icon="truck-delivery"
            onPress={handleDispatch}
            disabled={!canDispatch}
            style={styles.submitBtn}
            contentStyle={styles.submitBtnContent}
            labelStyle={styles.submitBtnLabel}
          >
            {scannedRolls.length > 0
              ? `${scannedRolls.length} Top Sevk Et`
              : 'Sevk Et'}
          </Button>
        </KeyboardAwareScrollView>

        {/* ── SAĞ (tablet) / ALT (telefon): İş Emri Detayları ──
            Telefonda 3 konumlu sürüklenebilir alt panel; tablette sabit sütun. */}
        {isPhone ? (
          <Animated.View style={[styles.sheet, sheetStyle]}>
            <GestureDetector gesture={sheetPan}>
              <View style={styles.sheetHandleArea}>
                <View style={styles.grabber} />
                <View style={styles.recentsHeader}>
                  {detailTitleBlock}
                  <IconButton
                    icon={detailsCollapsed ? 'chevron-up' : 'chevron-down'}
                    size={22}
                    onPress={() => snapTo(detailsCollapsed ? SHEET_MIDDLE_H : SHEET_COLLAPSED_H)}
                    style={{ margin: 0 }}
                    accessibilityLabel={detailsCollapsed ? 'Detayları aç' : 'Detayları gizle'}
                  />
                </View>
              </View>
            </GestureDetector>
            <View style={styles.sheetBody}>{detailContent}</View>
          </Animated.View>
        ) : (
          <View style={styles.recentsCol}>
            <View style={styles.recentsHeader}>
              {detailTitleBlock}
              {!detailsCollapsed && (
                <Button
                  mode="contained-tonal"
                  icon="history"
                  compact
                  onPress={openHistory}
                >
                  Son Sevkler
                </Button>
              )}
            </View>
            {detailContent}
          </View>
        )}
      </View>

      {/* ── Picker Modal'lar ── */}
      <PickerModal
        visible={pickerOpen === 'wo'}
        title="İş Emri Seç"
        options={woOptions}
        selectedValue={workOrderId}
        loading={woQuery.isLoading}
        emptyText={
          woSearch
            ? `'${woSearch}' için sonuç bulunamadı`
            : 'Sevke uygun iş emri yok'
        }
        numColumns={1}
        paginated
        searchValue={woSearch}
        onSearchSubmit={(q) => setWoSearch(q)}
        onEndReached={() => {
          if (woQuery.hasNextPage && !woQuery.isFetchingNextPage) {
            woQuery.fetchNextPage();
          }
        }}
        loadingMore={woQuery.isFetchingNextPage}
        fetching={woQuery.isFetching}
        sortOptions={[
          { value: 'createdAt', label: 'Son Eklenen' },
          { value: 'plannedEndDate', label: 'Termini Yakın' },
        ]}
        selectedSort={woSort}
        onSortChange={(v) => setWoSort(v as WoSort)}
        onRefresh={() => woQuery.refetch()}
        refreshing={woQuery.isFetching}
        refreshError={woQuery.isError}
        refreshErrorMessage={(woQuery.error as Error | undefined)?.message}
        onDismiss={() => setPickerOpen(null)}
        onSelect={(value) => {
          const wo = woOptions.find((o) => o.value === value);
          setWorkOrderId(value);
          setWorkOrderLabel(
            wo ? `${wo.label}${wo.badge ? ` · ${wo.badge.text}` : ''}` : ''
          );
          setStepId('');
          setSubcontractorId('');
          setSubcontractorLabel('');
          setPlannedSubId(null);
          snapTo(SHEET_MIDDLE_H);
        }}
      />
      <PickerModal
        visible={pickerOpen === 'step'}
        title="Fason Adımı Seç"
        options={stepOptions}
        selectedValue={stepId}
        emptyText="Sevke uygun fason adımı yok"
        onDismiss={() => setPickerOpen(null)}
        onSelect={(value) => {
          setStepId(value);
          setSubcontractorId('');
          setSubcontractorLabel('');
        }}
      />
      <PickerModal
        visible={pickerOpen === 'subcontractor'}
        title={
          requiredCategoryName
            ? `Fason Firma — ${requiredCategoryName}`
            : 'Fason Firma Seç'
        }
        options={subcontractorOptions}
        selectedValue={subcontractorId}
        loading={subcontractorsQuery.isLoading}
        emptyText={
          subcontractorsQuery.error
            ? `Hata: ${(subcontractorsQuery.error as Error).message}`
            : requiredCategoryName
              ? `"${requiredCategoryName}" kategorisinde kayıtlı fason firma yok.`
              : 'Sistemde kayıtlı fason firma yok. Yöneticinize haber verin.'
        }
        onDismiss={() => setPickerOpen(null)}
        onSelect={(value) => {
          const s = subcontractorOptions.find((o) => o.value === value);
          setSubcontractorId(value);
          setSubcontractorLabel(s ? `${s.sublabel} — ${s.label}` : '');
        }}
      />

      <RollPickerModal
        visible={rollPickerOpen}
        stepId={stepId}
        excludeIds={scannedRolls.map((r) => r.id)}
        onDismiss={() => setRollPickerOpen(false)}
        onSelect={(r) => {
          // 'duplicate' dışında picker'ı kapat — 'mismatch'te onay diyaloğu
          // picker'ın üstünde açık kalmasın diye de kapatmak gerekir.
          if (addRollToList(r) !== 'duplicate') setRollPickerOpen(false);
        }}
      />

      {/* ── Refakat kartı kamera tarama: WO'yu otomatik seçer ── */}
      <BarcodeScannerModal
        visible={cardScannerOpen}
        onDismiss={() => setCardScannerOpen(false)}
        onScan={(data) => {
          // İşlemeyi modal TAM kapandıktan sonraya ertele (onModalHide) —
          // toast modal-içi yerine kök toast'ta kalıcı görünsün.
          pendingCardScanRef.current = data;
          setCardScannerOpen(false);
        }}
        onModalHide={() => {
          const d = pendingCardScanRef.current;
          pendingCardScanRef.current = null;
          if (d) void handleCardScan(d);
        }}
        title="Refakat Kartı Okut"
      />

      {/* ── Top barkodu kamera tarama: sürekli mod — kullanıcı kapatana dek açık kalır ── */}
      <BarcodeScannerModal
        visible={rollScannerOpen}
        onDismiss={() => setRollScannerOpen(false)}
        continuous
        onScan={(data) => void addBarcodeFromString(data)}
        title="Top Barkodunu Okut"
      />

      {/* Item mismatch onay modal'ı — WO ürünü ile rulo ürünü uyuşmuyor.
          Operatör "Yine de sevk et" derse allowItemOverride:true ile retry. */}
      <ConfirmDialog
        visible={itemMismatch !== null}
        kind="destructive"
        title="Ürün Uyuşmazlığı"
        description={
          itemMismatch ? (
            <View>
              <Text style={{ fontSize: 14, color: '#475569', lineHeight: 20 }}>
                İş emri{' '}
                <Text style={{ fontWeight: '700' }}>
                  {itemMismatch.details.expectedItemLabel}
                </Text>{' '}
                için, ama seçilen {itemMismatch.details.mismatchedRolls.length} top farklı ürün:
              </Text>
              <View style={{ marginTop: 10, gap: 4 }}>
                {itemMismatch.details.mismatchedRolls.map((r) => (
                  <Text
                    key={r.id}
                    style={{ fontSize: 13, color: '#0f172a' }}
                  >
                    • {r.barcode ?? '(barkodsuz)'} — {r.itemLabel}
                  </Text>
                ))}
              </View>
              <Text style={{ marginTop: 12, fontSize: 13, color: '#b91c1c', fontWeight: '600' }}>
                Devam edersen audit log'a "Ürün uyuşmazlığı override" olarak yazılır.
              </Text>
            </View>
          ) : (
            ''
          )
        }
        confirmLabel="Yine de Sevk Et"
        cancelLabel="Vazgeç"
        onDismiss={() => setItemMismatch(null)}
        onConfirm={handleItemMismatchOverride}
      />

      {/* Rota-atlama uyarısı — hedef fason adımından önce bekleyen bir fason adımı
          var (ör. zımpara atlanıp doğrudan boyahaneye). Operatör "Yine de Gönder"
          derse allowRouteSkip ile sevk eder. */}
      <ConfirmDialog
        visible={routeSkip !== null}
        kind="simple"
        title="Rota Sırası Atlanıyor"
        description={
          routeSkip ? (
            <View>
              <Text style={{ fontSize: 14, color: '#475569', lineHeight: 20 }}>
                Bu sevk rota sırasını atlıyor — önce{' '}
                <Text style={{ fontWeight: '700' }}>
                  {routeSkip.details.skippedStep.stationName}
                </Text>{' '}
                fason adımı bekliyor. Mal o adıma uğramadan gönderilecek.
              </Text>
              <Text style={{ marginTop: 12, fontSize: 13, color: '#b45309', fontWeight: '600' }}>
                Devam edersen audit log'a "rota atlama override" olarak yazılır.
              </Text>
            </View>
          ) : (
            ''
          )
        }
        confirmLabel="Yine de Gönder"
        cancelLabel="Vazgeç"
        onDismiss={() => setRouteSkip(null)}
        onConfirm={handleRouteSkipOverride}
      />

      {/* Okutma-anı kumaş uyuşmazlığı — top eklenirken WO hedef kumaşı ile
          topun kumaşı farklı. Operatör "Yine de Ekle" derse top listeye eklenir
          (overrideItem) ve sevkte allowItemOverride ile gider. */}
      <ConfirmDialog
        visible={pendingMismatch !== null}
        kind="destructive"
        title="Yanlış kumaş?"
        description={
          pendingMismatch ? (
            <View>
              <Text style={{ fontSize: 14, color: '#475569', lineHeight: 20 }}>
                İş emri{' '}
                <Text style={{ fontWeight: '700' }}>{pendingMismatch.expectedLabel}</Text>{' '}
                kumaşı istiyor, ama bu top{' '}
                <Text style={{ fontWeight: '700' }}>{pendingMismatch.rollItemLabel}</Text>:
              </Text>
              <Text style={{ marginTop: 8, fontSize: 13, color: '#0f172a' }}>
                {pendingMismatch.roll.barcode ?? '(barkodsuz)'}
              </Text>
              <Text
                style={{ marginTop: 12, fontSize: 13, color: '#b91c1c', fontWeight: '600' }}
              >
                Yanlış kumaş okutmuş olabilirsin. Yine de eklersen sevkte "ürün
                uyuşmazlığı" olarak işaretlenir.
              </Text>
            </View>
          ) : (
            ''
          )
        }
        confirmLabel="Yine de Ekle"
        cancelLabel="Vazgeç"
        onDismiss={() => setPendingMismatch(null)}
        onConfirm={() => {
          if (pendingMismatch) {
            addRollToList(pendingMismatch.roll, { overrideItem: true });
          }
          setPendingMismatch(null);
        }}
      />
    </ScreenChrome>
  );
}


// ── Top seçim modalı (kamera placeholder) ──
const ROLL_PICKER_PAGE_SIZE = 30;

function RollPickerModal({
  visible,
  stepId,
  excludeIds,
  onDismiss,
  onSelect,
}: {
  visible: boolean;
  stepId: string;
  excludeIds: string[];
  onDismiss: () => void;
  onSelect: (r: Roll) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const device = useDeviceType();
  const isPhone = device === 'phone';
  const [search, setSearch] = useState('');
  // 300ms debounce: her tuş darbesinde HTTP isteği yerine kullanıcı yazmayı
  // bitirdikten 300ms sonra tek request.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // CURSOR (keyset) + infinite scroll — Roll yüksek hacimli tablo (CLAUDE.md
  // kuralı). Offset+COUNT(*) yerine: withTotal yok → her açılışta COUNT maliyeti
  // yok, sabit hız (binlerce/yüzbinlerce ham topta bile). [status, createdAt]
  // indeksi LIMIT'i seek ile karşılar.
  //
  // Filtre = backend sevk kuralının (subcontractor.service dispatch) AYNISI:
  //   serbest stok (currentStepId null & STOCK)  VEYA
  //   bu adımdaki top (currentStepId === stepId & STOCK|IN_PRODUCTION).
  // dispatchableForStepId bu OR'u backend'de kurar — böylece BAŞKA adımda/iş
  // emrinde üretimdeki toplar (sevke uygun olmayan) listede görünmez; operatör
  // yalnızca bu fason sevkine fiilen ekleyebileceği topları görür.
  const rollsQuery = useInfiniteQuery({
    queryKey: ['rolls', 'fason-picker', stepId, debouncedSearch],
    queryFn: ({ pageParam }) =>
      rollService.getAllCursor({
        limit: ROLL_PICKER_PAGE_SIZE,
        cursor: pageParam,
        search: debouncedSearch.trim() || undefined,
        filters: { dispatchableForStepId: stepId },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.nextCursor : undefined,
    enabled: visible && !!stepId,
  });

  // Modal her açılışında taze veri çek — başka cihaz ya da bir önceki sevk
  // listeyi değiştirmiş olabilir (sevk edilen toplar artık STOCK değil).
  // openedAt o açılış anını damgalar; o ana ait taze sonuç gelene dek eski cache
  // satırları YERİNE skeleton gösterilir → operatör bayat/sevk-edilmiş topu seçemez.
  const [openedAt, setOpenedAt] = useState(0);
  useEffect(() => {
    if (visible) {
      setOpenedAt(Date.now());
      rollsQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const allRolls = rollsQuery.data?.pages.flatMap((p) => p.data) ?? [];
  const rolls = allRolls.filter((r) => !excludeIds.includes(r.id));

  // Bu açılışa ait taze sonuç henüz gelmediyse skeleton (bayat satır gösterme).
  const freshForThisOpen = rollsQuery.dataUpdatedAt >= openedAt;
  const showSkeleton =
    rollsQuery.isLoading || (visible && !freshForThisOpen && !rollsQuery.isError);

  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <View
        style={[
          pickerStyles.sheet,
          isPhone && pickerStyles.sheetPhone,
          {
            width: isPhone ? winW * 0.95 : winW * 0.85,
            height: winH * 0.85,
          },
        ]}
      >
        <View style={[pickerStyles.header, isPhone && pickerStyles.headerPhone]}>
          <View style={{ flex: 1 }}>
            <Text
              variant={isPhone ? 'titleMedium' : 'titleLarge'}
              style={pickerStyles.title}
            >
              Top Seç
            </Text>
            {!isPhone && (
              <Text variant="bodySmall" style={pickerStyles.subtitle}>
                Test için listeden seç · ileride kamera ile okutulacak
              </Text>
            )}
          </View>
          <IconButton
            icon="close"
            size={isPhone ? 22 : 28}
            onPress={onDismiss}
            accessibilityLabel="Kapat"
            style={{ margin: 0 }}
          />
        </View>

        <TextInput
          mode="outlined"
          value={search}
          onChangeText={setSearch}
          placeholder="Barkod / ürün ara..."
          left={<TextInput.Icon icon="magnify" />}
          style={[pickerStyles.search, isPhone && pickerStyles.searchPhone]}
          dense={isPhone}
        />

        <View style={pickerStyles.listBox}>
          {showSkeleton ? (
            <SkeletonList count={6} />
          ) : rollsQuery.isError ? (
            <View style={pickerStyles.empty}>
              <Text style={pickerStyles.emptyText}>Liste yüklenemedi</Text>
              <Text style={pickerStyles.emptyHint}>
                {(rollsQuery.error as Error).message}
              </Text>
            </View>
          ) : rolls.length === 0 ? (
            <View style={pickerStyles.empty}>
              <Text style={pickerStyles.emptyText}>Top bulunamadı</Text>
            </View>
          ) : (
            <FlashList
              data={rolls}
              keyExtractor={(r) => r.id}
              onEndReachedThreshold={0.6}
              onEndReached={() => {
                if (rollsQuery.hasNextPage && !rollsQuery.isFetchingNextPage) {
                  rollsQuery.fetchNextPage();
                }
              }}
              ListFooterComponent={
                rollsQuery.isFetchingNextPage ? (
                  <ActivityIndicator style={{ marginVertical: 12 }} />
                ) : null
              }
              renderItem={({ item }) => (
                <TouchableRipple
                  borderless
                  rippleColor="rgba(79, 70, 229, 0.15)"
                  onPress={() => onSelect(item)}
                  style={pickerStyles.row}
                >
                  <View
                    style={[pickerStyles.rowInner, isPhone && pickerStyles.rowInnerPhone]}
                  >
                    <View style={{ flex: 1, gap: isPhone ? 2 : 4 }}>
                      <View style={pickerStyles.rowTop}>
                        <Text
                          style={[
                            pickerStyles.rowBarcode,
                            isPhone && pickerStyles.rowBarcodePhone,
                          ]}
                          numberOfLines={1}
                        >
                          {item.barcode ?? '—'}
                        </Text>
                        <Chip
                          compact
                          style={pickerStyles.rowStatus}
                          textStyle={
                            isPhone ? pickerStyles.rowStatusTextPhone : undefined
                          }
                        >
                          {trLabel(ROLL_STATUS_LABEL, item.status)}
                        </Chip>
                      </View>
                      <Text
                        style={[
                          pickerStyles.rowName,
                          isPhone && pickerStyles.rowNamePhone,
                        ]}
                        numberOfLines={1}
                      >
                        {item.item?.name ?? '—'}
                        {item.color?.name ? ` · ${item.color.name}` : ''}
                      </Text>
                      <View
                        style={[
                          pickerStyles.rowBadgeRow,
                          isPhone && pickerStyles.rowBadgeRowPhone,
                        ]}
                      >
                        <View
                          style={[
                            pickerStyles.rowBadge,
                            isPhone && pickerStyles.rowBadgePhone,
                          ]}
                        >
                          <Icon
                            source="arrow-expand-vertical"
                            size={isPhone ? 11 : 13}
                            color="#0f172a"
                          />
                          <Text
                            style={[
                              pickerStyles.rowBadgeText,
                              isPhone && pickerStyles.rowBadgeTextPhone,
                            ]}
                          >
                            {item.currentQty} mt
                          </Text>
                        </View>
                        {item.width != null && (
                          <View
                            style={[
                              pickerStyles.rowBadge,
                              isPhone && pickerStyles.rowBadgePhone,
                            ]}
                          >
                            <Icon
                              source="arrow-expand-horizontal"
                              size={isPhone ? 11 : 13}
                              color="#0f172a"
                            />
                            <Text
                              style={[
                                pickerStyles.rowBadgeText,
                                isPhone && pickerStyles.rowBadgeTextPhone,
                              ]}
                            >
                              {item.width} cm
                            </Text>
                          </View>
                        )}
                        <View
                          style={[
                            pickerStyles.rowBadge,
                            isPhone && pickerStyles.rowBadgePhone,
                          ]}
                        >
                          <Icon
                            source="star-circle"
                            size={isPhone ? 11 : 13}
                            color="#0f172a"
                          />
                          <Text
                            style={[
                              pickerStyles.rowBadgeText,
                              isPhone && pickerStyles.rowBadgeTextPhone,
                            ]}
                          >
                            {item.qualityGrade}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <Icon
                      source="chevron-right"
                      size={isPhone ? 18 : 24}
                      color="#94a3b8"
                    />
                  </View>
                </TouchableRipple>
              )}
            />
          )}
        </View>
      </View>
    </AppModal>
  );
}

const pickerStyles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  sheetPhone: {
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 4,
    borderRadius: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginBottom: 8,
  },
  headerPhone: {
    paddingVertical: 2,
    marginBottom: 6,
  },
  title: { fontWeight: '700', color: '#0f172a' },
  subtitle: { color: '#64748b', marginTop: 2 },
  search: { backgroundColor: '#fff', marginBottom: 8 },
  searchPhone: { marginBottom: 6 },
  listBox: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 4 },
  emptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#cbd5e1' },
  row: { borderRadius: 10, marginVertical: 3 },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 10,
  },
  rowInnerPhone: {
    gap: 4,
    padding: 6,
    borderRadius: 6,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBarcode: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  rowBarcodePhone: {
    fontSize: 10,
    paddingHorizontal: 3,
    paddingVertical: 1,
    flexShrink: 1,
  },
  rowStatus: { backgroundColor: '#e0e7ff' },
  rowStatusTextPhone: { fontSize: 10, lineHeight: 14, marginVertical: 0 },
  rowName: { fontSize: 13, color: '#475569', marginTop: 4 },
  rowNamePhone: { fontSize: 11, marginTop: 0 },
  rowBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  rowBadgeRowPhone: { gap: 2, marginTop: 2 },
  rowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  rowBadgePhone: {
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  rowBadgeText: { fontSize: 12, color: '#0f172a', fontWeight: '600' },
  rowBadgeTextPhone: { fontSize: 10 },
});

const styles = StyleSheet.create({
  body: { flex: 1, flexDirection: 'row' },
  bodyPhone: { flexDirection: 'column' },
  headerExtrasRow: { flexDirection: 'row', alignItems: 'center' },

  // Sol — Form
  formCol: { flex: 1.4, backgroundColor: '#f8fafc' },
  formContent: { padding: 12, gap: 10, paddingBottom: 24 },
  card: { padding: 12, borderRadius: 10, backgroundColor: '#fff', gap: 4 },

  label: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 4 },
  labelSpaced: { marginTop: 10 },
  required: { color: '#dc2626' },
  helperText: {
    fontSize: 11,
    color: '#64748b',
    marginTop: -2,
    marginBottom: 4,
  },
  warningText: {
    color: '#dc2626',
    fontSize: 12,
    backgroundColor: '#fef2f2',
    padding: 8,
    borderRadius: 6,
  },

  pickerDisabled: { backgroundColor: '#f1f5f9', opacity: 0.6 },

  overrideWarning: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginTop: 6,
  },
  overrideWarningText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '600',
  },

  // Tek fason adımı için bilgi kartı (kilitli görünüm)
  lockedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f9ff',
    borderColor: '#bae6fd',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
    // Fason Firma picker'ı (pickerInner) ile aynı sabit yükseklik → iki input eşit.
    height: 52,
  },
  lockedIconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#e0f2fe',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockedIcon: { fontSize: 16 },
  lockedLabel: { fontSize: 13, fontWeight: '700', color: '#0c4a6e' },
  lockedSublabel: { fontSize: 11, color: '#0369a1', marginTop: 1 },

  picker: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    minHeight: 44,
    overflow: 'hidden',
  },
  pickerLocked: { backgroundColor: '#f1f5f9' },
  // WO seçim: input + kamera + liste (tek satır), seçilince Surface'e dönüşür
  woRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  woPicker: { flex: 1 },
  woCameraBtn: { margin: 0 },
  woInput: { backgroundColor: '#fff' },
  woSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#0d9488',
  },
  woSelectedLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#064e3b',
    fontFamily: 'monospace',
  },
  pickerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 4,
    // Fason Adımı (lockedInfo / picker) ile aynı sabit yükseklik → iki input eşit.
    height: 52,
  },
  pickerText: { fontSize: 14, color: '#0f172a', flex: 1 },
  pickerPlaceholder: { color: '#94a3b8' },

  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  rowSpaced: { marginTop: 8 },
  // İş Emri etiketi + "Değiştir" — aynı satır.
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  // Fason Adımı | Fason Firma — yan yana, üstten hizalı (yükseklikleri farklı olabilir).
  fieldsRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  // Kart başlığı (Toplar / Sevk Bilgileri).
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  sectionToggle: { borderRadius: 8 },
  sectionToggleInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionSub: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  sectionBody: { marginTop: 4 },
  instructionText: { fontSize: 14, color: '#0f172a', marginTop: 4, lineHeight: 20 },
  col: { flex: 1 },
  input: { backgroundColor: '#fff' },
  addBtn: { borderRadius: 8 },
  addBtnContent: { height: 48, paddingHorizontal: 10 },
  cameraBtn: { margin: 0, height: 48, width: 48, borderRadius: 8 },
  // Kamera-only mod: tek büyük CTA + yan liste icon. flex:1 ile satırı kaplar,
  // 56dp yükseklik fabrika ortamında dokunma rahatlığı.
  scanCtaBtn: { flex: 1, borderRadius: 10 },
  scanCtaBtnContent: { height: 56 },
  scanCtaBtnLabel: { fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  // Liste IconButton, CTA ile aynı yükseklik + aynı köşe yuvarlatma; iki
  // kamera-only bloğunda da paylaşılır.
  scanListBtn: { margin: 0, height: 56, width: 56, borderRadius: 10 },

  rollList: { marginTop: 8, gap: 4 },
  rollListHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  rollItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  rollItemTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rollBarcode: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  rollStatusChip: { backgroundColor: '#e0e7ff' },
  rollItemName: { fontSize: 12, color: '#475569', marginTop: 1 },
  rollItemMeta: { fontSize: 11, color: '#64748b', marginTop: 1 },
  rollBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 3 },
  rollBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  rollBadgeText: { fontSize: 11, color: '#0f172a', fontWeight: '600' },

  submitBtn: { borderRadius: 10, marginTop: 4 },
  submitBtnContent: { height: 52 },
  submitBtnLabel: { fontSize: 16, fontWeight: '700' },

  // Sağ — Geçmiş
  recentsCol: {
    flex: 1,
    backgroundColor: '#fff',
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
  },
  // Telefon: alttan sürüklenen panel (absolute overlay). Yükseklik animasyonlu
  // (sheetStyle). Sayfanın geri kalanı da beyaz olduğundan üst kenara kalın
  // lacivert çizgi çekilir — paneli net ayırır (gölge tek başına yetmiyordu).
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 4,
    borderTopColor: '#1e3a8a',
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 20,
  },
  sheetHandleArea: { paddingTop: 6 },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#cbd5e1',
    marginBottom: 2,
  },
  sheetBody: { flex: 1 },
  formContentPhone: { paddingBottom: SHEET_COLLAPSED_H + 24 },
  recentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  recentsTitle: { fontWeight: '700', color: '#0f172a' },
  recentsCount: { color: '#64748b', flexShrink: 1 },
  titleFlex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 2,
  },
  metaRight: { color: '#475569', fontWeight: '600' },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusChipText: { fontSize: 11, fontWeight: '700' },
  recentsList: { flex: 1, padding: 10 },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 6 },
  emptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#cbd5e1', textAlign: 'center', maxWidth: 240 },
  detailScrollContent: { padding: 10, gap: 8, paddingBottom: 24 },
});

// ── Yükleme ilerleme çubuğu ──
// WO'nun hedef metraji ile o ana kadar okutulmuş topların toplamını karşılaştırır.
// Renk: indigo (ilerleme) → emerald (%80+) → amber (hedef aşıldı).
// fillW Reanimated shared value: her top eklendiğinde/çıkarıldığında yay animasyonlu.
function DispatchProgressBar({ current, target }: { current: number; target: number }) {
  const [trackW, setTrackW] = useState(0);
  const fillW = useSharedValue(0);
  const reduced = useReducedMotion();

  const ratio = target > 0 ? Math.min(current / target, 1) : 0;

  useEffect(() => {
    const dest = ratio * trackW;
    fillW.value = reduced ? dest : withSpring(dest, springs.gentle);
  }, [ratio, trackW, reduced, fillW]);

  const fillAnim = useAnimatedStyle(() => ({ width: fillW.value }));

  const pct = target > 0 ? Math.round((current / target) * 100) : 0;
  const isOver = current > target * 1.001;
  const fillColor = isOver
    ? palette.amber[500]
    : pct >= 80
    ? palette.emerald[500]
    : palette.indigo[600];
  const labelColor = isOver
    ? palette.amber[700]
    : pct >= 80
    ? palette.emerald[700]
    : palette.slate[500];

  return (
    <View style={pbStyles.wrap}>
      <View style={pbStyles.labelRow}>
        <Text style={pbStyles.labelLeft}>
          {current.toFixed(1)} mt yüklendi
        </Text>
        <Text style={[pbStyles.labelRight, { color: labelColor }]}>
          {isOver
            ? `%${pct} · ${(current - target).toFixed(1)} mt fazla`
            : `%${pct} · hedef ${Math.round(target)} mt`}
        </Text>
      </View>
      <View
        style={pbStyles.track}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      >
        <Animated.View style={[pbStyles.fill, { backgroundColor: fillColor }, fillAnim]} />
      </View>
    </View>
  );
}

const pbStyles = StyleSheet.create({
  wrap: { marginTop: 4, marginBottom: 6, gap: 5 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  labelLeft: { fontSize: 12, fontWeight: '700', color: palette.slate[700] },
  labelRight: { fontSize: 11, fontWeight: '600' },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.slate[200],
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 4,
  },
});

// Sevk listesindeki tek top satırı — React.memo ile parent state değişimlerinde
// gereksiz re-render'ları kesiyoruz (yeni top ekleme/silme sırasında mevcut
// satırlar prop referansı korunduğu için skip edilir).
const ScannedRollRow = React.memo(function ScannedRollRow({
  roll,
  onRemove,
}: {
  roll: ScannedRoll;
  onRemove: (id: string) => void;
}) {
  const handleRemove = useCallback(() => onRemove(roll.id), [onRemove, roll.id]);
  return (
    <Surface style={styles.rollItem} elevation={1}>
      <View style={{ flex: 1 }}>
        <View style={styles.rollItemTop}>
          <Text style={styles.rollBarcode}>{roll.barcode ?? '—'}</Text>
          <Chip compact style={styles.rollStatusChip}>
            {trLabel(ROLL_STATUS_LABEL, roll.status)}
          </Chip>
        </View>
        <Text style={styles.rollItemName} numberOfLines={1}>
          {roll.itemName}
          {roll.colorName ? ` · ${roll.colorName}` : ''}
        </Text>
        <View style={styles.rollBadgeRow}>
          <View style={styles.rollBadge}>
            <Icon source="arrow-expand-vertical" size={14} color="#0f172a" />
            <Text style={styles.rollBadgeText}>{roll.currentQty} mt</Text>
          </View>
          {roll.width != null && (
            <View style={styles.rollBadge}>
              <Icon source="arrow-expand-horizontal" size={14} color="#0f172a" />
              <Text style={styles.rollBadgeText}>{roll.width} cm</Text>
            </View>
          )}
          <View style={styles.rollBadge}>
            <Icon source="star-circle" size={14} color="#0f172a" />
            <Text style={styles.rollBadgeText}>{roll.qualityGrade}</Text>
          </View>
        </View>
      </View>
      <IconButton icon="close" onPress={handleRemove} iconColor="#dc2626" />
    </Surface>
  );
});
