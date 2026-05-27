import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import RNModal from 'react-native-modal';
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
  useMutation,
  useQueryClient,
  onlineManager,
} from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';

import ScreenChrome from '../../../components/ScreenChrome';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import WorkOrderDetailPanel from '../../../components/workOrder/WorkOrderDetailPanel';
import { RecentDispatchesModal } from '../../../components/dispatch';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { workOrderService } from '../../../services/workOrder.service';
import { rollService } from '../../../services/roll.service';
import { travelerCardService } from '../../../services/travelerCard.service';
import {
  subcontractorService,
  DispatchRequest,
  type ItemMismatchDetails,
} from '../../../services/subcontractor.service';
import { STATION_MUT } from '../../../offline/mutations';
import { useIsOnline, usePendingStationOps } from '../../../offline/hooks';
import type { Roll, WorkOrderStep } from '../../../types/models';
import {
  WORK_ORDER_STATUS_LABEL,
  WORK_ORDER_STATUS_COLOR,
  STEP_STATUS_LABEL,
  ROLL_STATUS_LABEL,
  trLabel,
} from '../../../utils/labels';

const PAGE_SIZE = 10;

interface ScannedRoll {
  id: string;
  /** Açık kumaş Roll'lar barkodsuz olabilir; fasona giden hep barkodlu. Defansif. */
  barcode: string | null;
  itemName: string;
  colorName?: string | null;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  status: string;
}

export default function FasonSevkScreen() {
  const qc = useQueryClient();
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
  const [recentDispatchesOpen, setRecentDispatchesOpen] = useState(false);
  const [dispatchesPage, setDispatchesPage] = useState(1);

  const [plateNumber, setPlateNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [notes, setNotes] = useState('');

  // ── WO picker server-side state ──
  const WO_PAGE_SIZE = 30;
  type WoSort = 'createdAt' | 'plannedEndDate';
  const [woPage, setWoPage] = useState(1);
  const [woSearch, setWoSearch] = useState('');
  const [woSort, setWoSort] = useState<WoSort>('createdAt');

  // Picker açılınca state'i sıfırla + güncel veri için cache'i bypass eden refetch.
  // (Aynı queryKey'e dönülürse react-query cache döner; refetch zorunlu.)
  useEffect(() => {
    if (pickerOpen === 'wo') {
      setWoPage(1);
      setWoSearch('');
      setWoSort('createdAt');
      qc.invalidateQueries({ queryKey: ['work-orders', 'fason-sevk'] });
    }
  }, [pickerOpen]);

  // ── İş emirleri (PLANNED + IN_PROGRESS) — server-side paginated ──
  // withOrderDetail=true: picker satırı için tarih + termin + ürün + hedef.
  // Detay (müşteri, renk, dispatch progress) seçim sonrası `getById` ile gelir.
  const woQuery = useQuery({
    queryKey: ['work-orders', 'fason-sevk', woPage, woSearch, woSort],
    queryFn: () =>
      workOrderService.getAll(
        {
          page: woPage,
          pageSize: WO_PAGE_SIZE,
          sortBy: woSort,
          sortOrder: woSort === 'plannedEndDate' ? 'asc' : 'desc',
          filters: { status: 'PLANNED,IN_PROGRESS' },
          search: woSearch || undefined,
        },
        { withOrderDetail: true, excludeWithOpenDispatch: true }
      ),
    placeholderData: (prev) => prev,
  });

  // Sadece açık fason (EXTERNAL + PENDING/ACTIVE) adımı olan WO'ları göster.
  const externalOpenWOs = useMemo(() => {
    const list = woQuery.data?.data ?? [];
    return list.filter((w) =>
      (w.steps ?? []).some(
        (s) =>
          s.station?.type === 'EXTERNAL' &&
          s.status !== 'COMPLETED' &&
          s.status !== 'SKIPPED' &&
          s.status !== 'CANCELLED',
      ),
    );
  }, [woQuery.data]);

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
        label: w.batchNumber,
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
    return steps.filter(
      (s) =>
        s.station?.type === 'EXTERNAL' &&
        s.status !== 'COMPLETED' &&
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
      // Picker'la aynı kural: açık sevki varsa kart okutmaya izin verme.
      // Operatör önce eski sevki iptal etmek veya mal kabul yapmak zorunda.
      if (card.hasOpenDispatch) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Toast.show({
          type: 'error',
          text1: 'Açık fason sevki var',
          text2: 'Önce eski sevki iptal edin veya mal kabul yapın.',
        });
        return;
      }
      // Picker filtresiyle aynı: en az 1 açık EXTERNAL adım olmalı.
      const hasOpenExternal = (wo.steps ?? []).some(
        (s) =>
          s.station?.type === 'EXTERNAL' &&
          s.status !== 'COMPLETED' &&
          s.status !== 'SKIPPED' &&
          s.status !== 'CANCELLED',
      );
      if (!hasOpenExternal) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Toast.show({
          type: 'error',
          text1: 'Sevke uygun fason adımı yok',
          text2: wo.batchNumber,
        });
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setWorkOrderId(wo.id);
      setWorkOrderLabel(`${wo.batchNumber} · ${trLabel(WORK_ORDER_STATUS_LABEL, wo.status)}`);
      setStepId('');
      setSubcontractorId('');
      setSubcontractorLabel('');
      setPlannedSubId(null);
      setCardInput('');
      setDetailsCollapsed(false);
      Toast.show({
        type: 'success',
        text1: 'İş emri seçildi',
        text2: wo.batchNumber,
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

  // ── Geçmiş sevkler — paginated ──
  const dispatchesQuery = useQuery({
    queryKey: ['dispatches', 'recent', dispatchesPage],
    queryFn: () =>
      subcontractorService.listDispatches({
        page: dispatchesPage,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });

  // Son Sevkler modal'ı her açılışta taze veri çek.
  useRefetchOnOpen(dispatchesQuery.refetch, recentDispatchesOpen);

  // Item mismatch modal state — backend "ITEM_MISMATCH" döndüğünde set edilir,
  // kullanıcı onayla → retry with allowItemOverride. Vars saklanır ki retry
  // aynı payload + override flag ile yapılabilsin.
  const [itemMismatch, setItemMismatch] = useState<{
    details: ItemMismatchDetails;
    originalVars: DispatchRequest;
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
      setDetailsCollapsed(true);
      // Listeleri tazele (yeni dispatch, WO statüsü)
      qc.invalidateQueries({ queryKey: ['dispatches'] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
    },
    onError: (err, vars) => {
      // Backend ITEM_MISMATCH özel durumu — modal göster, retry with override
      const details = err.details as ItemMismatchDetails | undefined;
      if (details?.code === 'ITEM_MISMATCH') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setItemMismatch({ details, originalVars: vars });
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

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      subcontractorService.cancelDispatch(id, { reason }),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Sevk iptal edildi',
        text2: res.data?.dispatchNo,
      });
      qc.invalidateQueries({ queryKey: ['dispatches'] });
    },
    onError: (err: Error) => {
      Toast.show({ type: 'error', text1: 'İptal başarısız', text2: err.message });
    },
  });

  // RecentDispatchesModal'a giden array referansını sabitle: query.data undefined
  // iken `?? []` her render'da yeni dizi yaratıyordu → modal'a yeni prop → FlashList
  // gereksiz re-process. useMemo yalnızca query.data değişimde yeni referans verir.
  const recentDispatches = useMemo(
    () => dispatchesQuery.data?.data ?? [],
    [dispatchesQuery.data],
  );
  const handleRecentDispatchesDismiss = useCallback(
    () => setRecentDispatchesOpen(false),
    [],
  );
  const handleRecentDispatchesRefresh = useCallback(
    () => {
      void dispatchesQuery.refetch();
    },
    [dispatchesQuery],
  );
  const handleCancelDispatchMutation = useCallback(
    async (id: string, reason: string) => {
      await cancelMutation.mutateAsync({ id, reason });
    },
    [cancelMutation],
  );

  // ── Barkod ekleme ──
  const addRollToList = (r: Roll): boolean => {
    if (scannedRolls.some((s) => s.barcode === r.barcode)) {
      Toast.show({ type: 'info', text1: 'Bu top zaten listede' });
      return false;
    }
    setScannedRolls((prev) => [
      {
        id: r.id,
        barcode: r.barcode,
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
    return true;
  };

  const handleAddBarcodeFromInput = () => addBarcodeFromString(barcodeInput);

  const addBarcodeFromString = async (raw: string) => {
    const barcode = raw.trim();
    if (!barcode) return;

    if (scannedRolls.some((r) => r.barcode === barcode)) {
      Toast.show({ type: 'info', text1: 'Bu top zaten listede' });
      setBarcodeInput('');
      return;
    }

    setScanning(true);
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
    dispatchMutation.mutate({
      workOrderId,
      stepId,
      subcontractorId,
      rollIds: scannedRolls.map((r) => r.id),
      plateNumber: plateNumber.trim() || undefined,
      driverName: driverName.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <ScreenChrome
      title="Fason Sevk"
      headerExtras={
        <View style={styles.headerExtrasRow}>
          <SyncStatusChip />
          {isPhone ? (
            <Appbar.Action
              icon="history"
              color="#fff"
              onPress={() => setRecentDispatchesOpen(true)}
              accessibilityLabel="Son sevkler"
            />
          ) : null}
        </View>
      }
    >
      <View style={[styles.body, isPhone && styles.bodyPhone]}>
        {/* ── SOL: Yeni Sevk ── */}
        <ScrollView style={styles.formCol} contentContainerStyle={styles.formContent}>
          <Surface style={styles.card} elevation={1}>
            {/* İş Emri — manuel kart girişi + kamera + liste */}
            <Text style={styles.label}>
              İş Emri <Text style={styles.required}>*</Text>
            </Text>
            {workOrderId ? (
              <Surface style={styles.woSelected} elevation={0}>
                <Icon source="card-account-details-outline" size={20} color="#0d9488" />
                <Text style={styles.woSelectedLabel} numberOfLines={1}>
                  {workOrderLabel}
                </Text>
                <IconButton
                  icon="close"
                  size={20}
                  onPress={() => {
                    setWorkOrderId('');
                    setWorkOrderLabel('');
                    setStepId('');
                    setSubcontractorId('');
                    setSubcontractorLabel('');
                    setPlannedSubId(null);
                    setDetailsCollapsed(true);
                  }}
                  accessibilityLabel="İş emrini kaldır"
                  style={{ margin: 0 }}
                />
              </Surface>
            ) : (
              <ScannerEntryBar
                value={cardInput}
                onChangeText={setCardInput}
                placeholder="Refakat kartı (RK-2605-001 ya da tam barkod)"
                onResolve={() => handleCardScan(cardInput)}
                resolving={resolvingCard}
                onScan={() => setCardScannerOpen(true)}
                onList={() => setPickerOpen('wo')}
                tone="blue"
              />
            )}

            {/* Hangi fason istasyonu */}
            {workOrderId && (
              <>
                <Text style={[styles.label, styles.labelSpaced]}>
                  Fason Adımı <Text style={styles.required}>*</Text>
                </Text>
                {externalSteps.length === 0 ? (
                  <Text style={styles.warningText}>
                    Bu iş emrinde sevke uygun fason adımı yok.
                  </Text>
                ) : externalSteps.length === 1 ? (
                  // Tek fason adımı varsa: bilgi kartı (otomatik seçili, tıklanmaya gerek yok)
                  <View style={styles.lockedInfo}>
                    <View style={styles.lockedIconBox}>
                      <Text style={styles.lockedIcon}>🏭</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lockedLabel}>
                        {externalSteps[0].station?.name ?? '—'}
                      </Text>
                      <Text style={styles.lockedSublabel}>
                        #{externalSteps[0].stepSequence} ·{' '}
                        {trLabel(STEP_STATUS_LABEL, externalSteps[0].status)}
                      </Text>
                    </View>
                  </View>
                ) : (
                  // Birden fazla fason adımı varsa: picker
                  <TouchableRipple
                    onPress={() => setPickerOpen('step')}
                    style={styles.picker}
                    borderless
                  >
                    <View style={styles.pickerInner}>
                      <Text
                        style={[styles.pickerText, !stepId && styles.pickerPlaceholder]}
                      >
                        {externalSteps.find((s) => s.id === stepId)?.station?.name ??
                          `${externalSteps.length} fason adımından birini seçiniz...`}
                      </Text>
                      <IconButton icon="chevron-down" size={24} />
                    </View>
                  </TouchableRipple>
                )}
              </>
            )}

            {/* Fason Firma */}
            <Text style={[styles.label, styles.labelSpaced]}>
              Fason Firma <Text style={styles.required}>*</Text>
              {requiredCategoryName && (
                <Text style={styles.helperText}>  ({requiredCategoryName})</Text>
              )}
            </Text>
            <TouchableRipple
              onPress={() => stepId && setPickerOpen('subcontractor')}
              style={[styles.picker, !stepId && styles.pickerDisabled]}
              borderless
              disabled={!stepId}
            >
              <View style={styles.pickerInner}>
                <Text
                  style={[
                    styles.pickerText,
                    !subcontractorId && styles.pickerPlaceholder,
                  ]}
                >
                  {subcontractorLabel ||
                    (stepId ? 'Fason firma seçiniz...' : 'Önce fason adımı seçin')}
                </Text>
                <IconButton icon="chevron-down" size={24} />
              </View>
            </TouchableRipple>
            {isOverride && (
              <View style={styles.overrideWarning}>
                <Text style={styles.overrideWarningText}>
                  ⚠️ Bu sevk plandan farklı bir firmaya yapılıyor. Sebep raporlanacak.
                </Text>
              </View>
            )}

            {/* Barkod ekleme */}
            <Text style={[styles.label, styles.labelSpaced]}>Top Barkodu</Text>
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

            {/* Eklenen toplar */}
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

            {/* Opsiyoneller */}
            <View style={[styles.row, styles.rowSpaced]}>
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

            <Text style={[styles.label, styles.labelSpaced]}>Not (opsiyonel)</Text>
            <TextInput
              mode="outlined"
              value={notes}
              onChangeText={setNotes}
              placeholder="Sevk notu..."
              dense
              style={styles.input}
            />
          </Surface>

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
        </ScrollView>

        {/* ── SAĞ: Seçili İş Emri Detayları ── */}
        <View
          style={[
            styles.recentsCol,
            isPhone && styles.recentsColPhone,
            isPhone && detailsCollapsed && styles.recentsColCollapsed,
          ]}
        >
          <View style={styles.recentsHeader}>
            <View style={{ flex: 1 }}>
              <Text variant="titleMedium" style={styles.recentsTitle}>
                İş Emri Detayları
              </Text>
              <Text variant="bodySmall" style={styles.recentsCount}>
                {selectedWo
                  ? `Batch ${selectedWo.batchNumber}`
                  : 'İş emri seçildikçe burada görünür'}
              </Text>
            </View>
            {isPhone && (
              <IconButton
                icon={detailsCollapsed ? 'chevron-up' : 'chevron-down'}
                size={22}
                onPress={() => setDetailsCollapsed((v) => !v)}
                style={{ margin: 0 }}
              />
            )}
            {!isPhone && !detailsCollapsed && (
              <Button
                mode="contained-tonal"
                icon="history"
                compact
                onPress={() => setRecentDispatchesOpen(true)}
              >
                Son Sevkler
              </Button>
            )}
          </View>

          {!(isPhone && detailsCollapsed) && (
            <ScrollView
              style={styles.recentsList}
              contentContainerStyle={styles.detailScrollContent}
            >
              {selectedWo ? (
                <WorkOrderDetailPanel wo={selectedWo} />
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
          )}
        </View>
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
        onSearchSubmit={(q) => {
          setWoSearch(q);
          setWoPage(1);
        }}
        page={woQuery.data?.pagination.page ?? woPage}
        totalPages={woQuery.data?.pagination.totalPages ?? 1}
        onPageChange={setWoPage}
        fetching={woQuery.isFetching}
        sortOptions={[
          { value: 'createdAt', label: 'Son Eklenen' },
          { value: 'plannedEndDate', label: 'Termini Yakın' },
        ]}
        selectedSort={woSort}
        onSortChange={(v) => {
          setWoSort(v as WoSort);
          setWoPage(1);
        }}
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
          setDetailsCollapsed(false);
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
        excludeIds={scannedRolls.map((r) => r.id)}
        onDismiss={() => setRollPickerOpen(false)}
        onSelect={(r) => {
          if (addRollToList(r)) setRollPickerOpen(false);
        }}
      />

      {/* ── Refakat kartı kamera tarama: WO'yu otomatik seçer ── */}
      <BarcodeScannerModal
        visible={cardScannerOpen}
        onDismiss={() => setCardScannerOpen(false)}
        onScan={(data) => {
          setCardScannerOpen(false);
          void handleCardScan(data);
        }}
        title="Refakat Kartı Okut"
      />

      {/* ── Top barkodu kamera tarama: okutulan barkod direkt sevk listesine eklenir ── */}
      <BarcodeScannerModal
        visible={rollScannerOpen}
        onDismiss={() => setRollScannerOpen(false)}
        onScan={(data) => {
          setRollScannerOpen(false);
          setBarcodeInput(data);
          void addBarcodeFromString(data);
        }}
        title="Top Barkodunu Okut"
      />

      <RecentDispatchesModal
        visible={recentDispatchesOpen}
        dispatches={recentDispatches}
        loading={dispatchesQuery.isLoading}
        fetching={dispatchesQuery.isFetching}
        error={dispatchesQuery.isError ? (dispatchesQuery.error as Error) : null}
        isCanceling={cancelMutation.isPending}
        page={dispatchesQuery.data?.pagination.page ?? 1}
        totalPages={dispatchesQuery.data?.pagination.totalPages ?? 1}
        total={dispatchesQuery.data?.pagination.total ?? 0}
        onDismiss={handleRecentDispatchesDismiss}
        onRefresh={handleRecentDispatchesRefresh}
        onPageChange={setDispatchesPage}
        onCancelDispatch={handleCancelDispatchMutation}
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
    </ScreenChrome>
  );
}


// Çevrimdışı / sync bekleyen istasyon işlemi rozeti (diğer ekranlarla aynı).
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

// ── Top seçim modalı (kamera placeholder) ──
const ROLL_PICKER_PAGE_SIZE = 30;

function RollPickerModal({
  visible,
  excludeIds,
  onDismiss,
  onSelect,
}: {
  visible: boolean;
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

  const rollsQuery = useQuery({
    queryKey: ['rolls', 'fason-picker', debouncedSearch],
    queryFn: () =>
      rollService.getAll({
        page: 1,
        pageSize: ROLL_PICKER_PAGE_SIZE,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        search: debouncedSearch.trim() || undefined,
        // Sadece sevke uygun statüler — backend validasyonu da bu ikisini kabul ediyor
        // (subcontractor.service.ts:240-250). SCRAP/CANCELLED/SHIPPED/AT_SUBCONTRACTOR
        // vb. picker'da görünmemeli.
        filters: { status: 'STOCK,IN_PRODUCTION' },
      }),
    enabled: visible,
    placeholderData: (prev) => prev,
  });

  const allRolls = rollsQuery.data?.data ?? [];
  const rolls = allRolls.filter((r) => !excludeIds.includes(r.id));

  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.5}
      style={pickerStyles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
    >
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
          {rollsQuery.isLoading ? (
            <View style={pickerStyles.empty}>
              <ActivityIndicator size="large" color="#4f46e5" />
              <Text style={pickerStyles.emptyText}>Yükleniyor...</Text>
            </View>
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
      <Toast />
    </RNModal>
  );
}

const pickerStyles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0, padding: 0 },
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
    minHeight: 44,
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
    minHeight: 44,
  },
  pickerText: { fontSize: 14, color: '#0f172a', flex: 1 },
  pickerPlaceholder: { color: '#94a3b8' },

  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  rowSpaced: { marginTop: 8 },
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
  recentsColPhone: {
    borderLeftWidth: 0,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  // Telefon modunda daraltıldığında — sadece başlık görünür; flex sıfır olur
  // ki üstteki form bölümü kalan alanı kapsasın.
  recentsColCollapsed: { flex: 0, flexGrow: 0 },
  recentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  recentsTitle: { fontWeight: '700', color: '#0f172a' },
  recentsCount: { color: '#64748b', marginTop: 2 },
  recentsList: { flex: 1, padding: 10 },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 6 },
  emptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#cbd5e1', textAlign: 'center', maxWidth: 240 },
  detailScrollContent: { padding: 10, gap: 8, paddingBottom: 24 },
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
