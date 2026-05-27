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
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  Pressable,
  KeyboardAvoidingView,
  Platform,
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
import RefreshButton from '../../../components/RefreshButton';
import RemoteListSheet from '../../../components/RemoteListSheet';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import Pager from '../../../components/Pager';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import { ReceiptRow, ReceiptDetailModal } from '../../../components/receipt';
import { subcontractorService } from '../../../services/subcontractor.service';
import { travelerCardService } from '../../../services/travelerCard.service';
import { STATION_MUT } from '../../../offline/mutations';
import { useIsOnline, usePendingStationOps } from '../../../offline/hooks';
import type {
  PendingReturnGroup,
  ReceiveRequest,
  ReceiveNewRollInput,
  TravelerCardLookup,
  Color,
  FabricProperty,
  ReceiptCancelPreview,
} from '../../../types/models';

const RECEIPTS_PAGE_SIZE = 12;
const SUBMIT_ARM_TIMEOUT_MS = 3000;

interface RollRow {
  rollId: string;
  /** Açık kumaş Roll'lar (boyahane öncesi) için NULL; ama fasona giden hep barkodlu. */
  barcode: string | null;
  itemName: string;
  colorName?: string | null;
  dispatchedQty: number;
  width: number | null;
  qualityGrade: string;
  checked: boolean;
  notes: string;
  noteOpen: boolean;
}

// İptal Edilebilirler = receipts whose all bornRolls are safe (still cancellable).
// Geçmiş Kabuller = settled receipts (at least one bornRoll has moved on / been
// processed). İki sekme ayırması operatörün kafa karışıklığını engeller —
// "iptal edebilir miyim?" sorusu artık tab seçimiyle yanıtlanır.
type RightTab = 'pending' | 'cancellable' | 'history';

export default function FasonKabulScreen() {
  const device = useDeviceType();
  const isPhone = device === 'phone';
  const manualBarcodeEntry = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  const qc = useQueryClient();

  // ── Form state ──
  const [selectedGroup, setSelectedGroup] = useState<PendingReturnGroup | null>(null);
  const [rows, setRows] = useState<RollRow[]>([]);
  const [manifestNo, setManifestNo] = useState('');
  const [notes, setNotes] = useState('');
  /**
   * Receipt seviyesinde uygulanan renk + özellik (Refactor 9 — Boyahane akışı).
   * Adımın `requiredCategory.appliesColor === true` olduğunda backend default
   * olarak WO.targetColor / targetProperties'i kullanır; operatör override
   * etmek isterse buradan değiştirir. NULL gönderilirse backend default'a düşer.
   */
  const [appliedColor, setAppliedColor] = useState<Color | null>(null);
  const [appliedProperties, setAppliedProperties] = useState<FabricProperty[]>([]);

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
  interface NewRollRow {
    key: string;
    qty: string; // string state — TextInput; submit'te number'a çevir
    notes: string;
    noteOpen: boolean;
    prefilled: boolean; // sevkten otomatik gelen, henüz dokunulmamış
  }
  let nrCounter = 0;
  const makeNewRollRow = (qty = '', prefilled = false): NewRollRow => ({
    key: `nr-${Date.now()}-${nrCounter++}`,
    qty,
    notes: '',
    noteOpen: false,
    prefilled,
  });
  const [newRolls, setNewRolls] = useState<NewRollRow[]>([]);

  // Kabul iptal modalı
  const [cancelTargetReceiptId, setCancelTargetReceiptId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

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
  const [receiptsPage, setReceiptsPage] = useState(1);
  const [detailReceiptId, setDetailReceiptId] = useState<string | null>(null);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Telefon dikeyde Geçmiş Kabuller alt panelde değil, header butonundan
  // açılan ayrı bir modal'da gösterilir.
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

  // ── Submit two-stage ──
  const [submitArmed, setSubmitArmed] = useState(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!submitArmed) return;
    armTimerRef.current = setTimeout(() => setSubmitArmed(false), SUBMIT_ARM_TIMEOUT_MS);
    return () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    };
  }, [submitArmed]);

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
  const cancellableReceiptsQuery = useQuery({
    queryKey: ['receipts', 'cancellable', receiptsPage],
    queryFn: () =>
      subcontractorService.listReceipts({
        page: receiptsPage,
        pageSize: RECEIPTS_PAGE_SIZE,
        cancellable: 'yes',
      }),
    placeholderData: (prev) => prev,
    enabled: rightTab === 'cancellable' || historyModalOpen,
    staleTime: 30 * 1000,
  });

  // TÜM KABULLER (cancellable filtresi yok) — iptal edilmemiş tüm receipts.
  // Backend zaten cancelledAt:null koşulu uyguluyor; cancellable filtresi olmadan
  // hem hala-iptal-edilebilir hem settled olanlar tek listede dönüyor.
  // UI'da iptal butonu YOK — sadece detay görüntüleme (iptal aksiyonu ayrı tab).
  const receiptsQuery = useQuery({
    queryKey: ['receipts', 'all', receiptsPage],
    queryFn: () =>
      subcontractorService.listReceipts({
        page: receiptsPage,
        pageSize: RECEIPTS_PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
    // Tablet'te tab history iken, telefonda Geçmiş modal açıkken aktif
    enabled: rightTab === 'history' || historyModalOpen,
    staleTime: 30 * 1000,
  });

  // Modal açılışında otomatik refresh — operatör manuel refresh basmasın.
  useRefetchOnOpen(pendingQuery.refetch, listModalOpen);
  useRefetchOnOpen(receiptsQuery.refetch, historyModalOpen);

  // ── Mutations ──
  // OFFLINE-AWARE: mutationFn `setMutationDefaults`'ta tanımlı; persist sonrası
  // app restart'ında resolve. Backend idempotent: bir step bir kez receive olur
  // (subcontractor.service.ts:receive() başında step-based check + cached
  // SubcontractorReceipt dönüşü). onMutate'te form anında temizlenir + toast
  // (offline ise "sync bekliyor"). Form rollback kompleks olduğu için
  // yapılmadı — operatör offline hatasında yeniden seçim/giriş yapar.
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
      // Server confirm — query'leri tazele (kalan dönüşler, kabul geçmişi vs.)
      qc.invalidateQueries({ queryKey: ['pending-returns'] });
      qc.invalidateQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['rolls'] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
    },
    onError: (err) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Kabul başarısız', text2: err.message });
      setSubmitArmed(false);
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
      Toast.show({ type: 'success', text1: 'Mal kabul iptal edildi' });
      setCancelTargetReceiptId(null);
      setCancelReason('');
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
    setSelectedGroup(null);
    setRows([]);
    setManifestNo('');
    setNotes('');
    setNewRolls([]);
    setSubmitArmed(false);
    setHighlightedWorkOrderId(null);
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
    if (touchesValue) setSubmitArmed(false);
  };
  const addNewRoll = () => {
    setNewRolls((prev) => [...prev, makeNewRollRow()]);
    setSubmitArmed(false);
  };
  const removeNewRoll = (key: string) => {
    setNewRolls((prev) => prev.filter((r) => r.key !== key));
    setSubmitArmed(false);
  };

  const selectGroup = (g: PendingReturnGroup) => {
    setSelectedGroup(g);
    setRows(
      g.rolls.map((r) => ({
        rollId: r.id,
        barcode: r.barcode,
        itemName: r.item?.name ?? '—',
        colorName: r.color?.name ?? null,
        dispatchedQty: r.currentQty,
        width: r.width ?? null,
        qualityGrade: r.qualityGrade,
        checked: true,
        notes: '',
        noteOpen: false,
      }))
    );
    // applied color/properties default → WO.targetColor / targetProperties
    setAppliedColor(g.workOrder.targetColor ?? null);
    setAppliedProperties(g.workOrder.targetProperties ?? []);
    // Açık kumaş pre-fill: sevkten her top için 1 satır + metre = sevk metresi.
    // Aynen geldiyse operatör hiç dokunmadan submit eder. Sapma varsa düzeltir.
    setNewRolls(
      g.rolls.length > 0
        ? g.rolls.map((r) =>
            makeNewRollRow(r.currentQty > 0 ? String(r.currentQty) : '', true)
          )
        : [makeNewRollRow()]
    );
    setSubmitArmed(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const appliesColor = !!selectedGroup?.step.requiredCategory?.appliesColor;

  const handleResolveCard = async (overrideBarcode?: string) => {
    const barcode = (overrideBarcode ?? cardBarcode).trim();
    if (!barcode) return;
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

      // Refactor 5 — backend WO için bekleyen kabul yoksa net mesajla 400 atar
      // ("Mevcut konum: Kurşun + KK2 (4 rulo)..."). Banner'da göster.
      let matching: PendingReturnGroup[];
      try {
        const pr = await subcontractorService.pendingReturns(card.workOrderId);
        matching = pr.data ?? [];
      } catch (err) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Toast.show({
          type: 'error',
          text1: 'Yanlış istasyon',
          text2: (err as Error).message,
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

  const updateRow = (rollId: string, patch: Partial<RollRow>) => {
    setRows((prev) => prev.map((r) => (r.rollId === rollId ? { ...r, ...patch } : r)));
    setSubmitArmed(false); // herhangi bir değişiklik silahlamayı sıfırlar
  };
  const toggleAllRows = () => {
    const someUnchecked = rows.some((r) => !r.checked);
    setRows((prev) => prev.map((r) => ({ ...r, checked: someUnchecked })));
    setSubmitArmed(false);
  };

  const checkedCount = rows.filter((r) => r.checked).length;
  const missingCount = rows.length - checkedCount;

  const parsedNewRolls = useMemo<ReceiveNewRollInput[]>(() => {
    const out: ReceiveNewRollInput[] = [];
    for (const r of newRolls) {
      const qty = parseFloat(r.qty.replace(',', '.'));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      out.push({
        qty,
        notes: r.notes.trim() || null,
      });
    }
    return out;
  }, [newRolls]);
  const hasValidNewRolls = parsedNewRolls.length > 0;

  // Sevk edilen (checked) ile dönen (yeni açık kumaş) metraj farkı —
  // operatör dalgın geçmesin diye gözüne sokulur ve onay arm edilir.
  const sentTotal = useMemo(
    () =>
      rows
        .filter((r) => r.checked)
        .reduce((s, r) => s + Number(r.dispatchedQty ?? 0), 0),
    [rows],
  );
  const returnedTotal = useMemo(
    () => parsedNewRolls.reduce((s, r) => s + r.qty, 0),
    [parsedNewRolls],
  );
  const qtyDiff = returnedTotal - sentTotal;
  const hasQtyMismatch = Math.abs(qtyDiff) > 0.01;

  const canSubmit =
    !!selectedGroup &&
    checkedCount > 0 &&
    hasValidNewRolls;
  // NOT: receiveMutation.isPending bilerek dahil edilmedi — offline'da paused
  // mutation hook'un isPending'i true kalır ve sıradaki kabul aksiyonunu
  // engelleyebilir. Optimistic onMutate zaten form'u temizliyor.
  const hasMissing = missingCount > 0;

  const buildPayload = (): ReceiveRequest | null => {
    if (!selectedGroup) return null;
    const subId = selectedGroup.lastDispatch?.subcontractorId;
    if (!subId) {
      Toast.show({
        type: 'error',
        text1: 'Fason firma bulunamadı',
        text2: 'Bu adımın aktif sevki yok.',
      });
      return null;
    }
    return {
      workOrderId: selectedGroup.workOrder.id,
      stepId: selectedGroup.step.id,
      subcontractorId: subId,
      manifestNo: manifestNo.trim() || null,
      notes: notes.trim() || undefined,
      // Refactor 9 — "renk veren" kategori için receipt seviyesi renk/özellik
      ...(appliesColor
        ? {
            appliedColorId: appliedColor?.id ?? null,
            appliedPropertyIds: appliedProperties.map((p) => p.id),
          }
        : {}),
      returns: rows
        .filter((r) => r.checked)
        .map((r) => ({ rollId: r.rollId, notes: r.notes.trim() || null })),
      newRolls: parsedNewRolls,
    };
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
    if (!canSubmit) return;
    if ((hasMissing || hasQtyMismatch) && !submitArmed) {
      // Two-stage: ilk tıklama silahlar, ikinci tıklama gönderir.
      // hasQtyMismatch operatöre fark'ı zorla göstertir.
      setSubmitArmed(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    }
    const payload = buildPayload();
    if (!payload) return;
    receiveMutation.mutate(payload);
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

  // ── Render ──
  return (
    <ScreenChrome
      title="Fason Kabul"
      // Telefon: tüm aksiyonlar (Liste / Kamera / Geçmiş) ekran altındaki sabit
      // bar'da → header'da sadece başlık + profil kalır.
      headerExtras={<SyncStatusChip />}
    >
      <View style={[styles.body, isPhone && styles.bodyPhone]}>
        {/* ════════ SOL: form ════════ */}
        <View style={[styles.formCol, isPhone && styles.formColPhone]}>
          {!selectedGroup ? (
            <View style={styles.emptyState}>
              <Icon source="package-down" size={64} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>Sevk seçilmedi</Text>
              <Text style={styles.emptyHint}>
                Sağdan bekleyen bir sevke tıklayın veya refakat kartını okutun
              </Text>
            </View>
          ) : (
            <>
              {/* Sticky header band */}
              <Surface style={styles.headerBand} elevation={2}>
                <View style={styles.headerCellMain}>
                  <Text style={styles.headerBatch} numberOfLines={1}>
                    {selectedGroup.workOrder.batchNumber}
                  </Text>
                  <Text style={styles.headerSub} numberOfLines={1}>
                    Adım {selectedGroup.step.stepSequence} ·{' '}
                    {selectedGroup.step.station.name}
                  </Text>
                </View>
                <View style={styles.headerDivider} />
                <View style={styles.headerCell}>
                  <Icon source="factory" size={14} color="#475569" />
                  <Text style={styles.headerCompany} numberOfLines={1}>
                    {selectedGroup.lastDispatch?.subcontractor?.name ?? '—'}
                  </Text>
                </View>
                <IconButton
                  icon="close"
                  size={20}
                  onPress={resetForm}
                  accessibilityLabel="Sıfırla"
                  style={{ margin: 0 }}
                />
              </Surface>

              {/* Mini bilgi şeridi */}
              <View style={styles.warning}>
                <Icon source="information-outline" size={14} color="#92400e" />
                <Text style={styles.warningText}>
                  Yeni barkod basılmaz, ölçüm sonraki istasyonda yapılır
                </Text>
              </View>

              {/* "Renk veren" kategori (Boyahane vb.) — uygulanacak renk/özellikler */}
              {appliesColor && (
                <View style={styles.appliesColorCard}>
                  <View style={styles.appliesColorHeader}>
                    <Icon source="palette" size={16} color="#7c3aed" />
                    <Text style={styles.appliesColorTitle}>
                      Uygulanacak Renk + Özellikler
                    </Text>
                    <Text style={styles.appliesColorHint}>
                      WO planlamasından
                    </Text>
                  </View>
                  <View style={styles.appliesColorBody}>
                    {appliedColor ? (
                      <View style={styles.appliesColorChip}>
                        <View
                          style={[
                            styles.colorSwatch,
                            { backgroundColor: appliedColor.hex ?? '#a78bfa' },
                          ]}
                        />
                        <Text style={styles.appliesColorChipText}>
                          {appliedColor.name}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.appliesColorEmpty}>
                        WO'da renk belirtilmemiş — kabul sonrası rulolar
                        renksiz kalır
                      </Text>
                    )}
                    {appliedProperties.length > 0 && (
                      <View style={styles.appliesPropertyRow}>
                        {appliedProperties.map((p) => (
                          <View key={p.id} style={styles.appliesPropertyChip}>
                            <Text style={styles.appliesPropertyChipText}>
                              {p.name}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* Toplar — ScrollView'in büyük kısmı */}
              <ScrollView
                style={styles.rollsScroll}
                contentContainerStyle={styles.rollsContent}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
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
                          icon={row.noteOpen ? 'chevron-up' : 'note-plus-outline'}
                          size={22}
                          iconColor={row.notes ? '#0369a1' : '#64748b'}
                          onPress={() =>
                            updateRow(row.rollId, { noteOpen: !row.noteOpen })
                          }
                          accessibilityLabel="Topa not ekle"
                          style={{ margin: 0 }}
                        />
                      </View>
                    </TouchableRipple>
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

                {/* ── Dönen Açık Kumaş ── */}
                <View style={styles.newRollSection}>
                  <View style={styles.newRollHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.newRollTitle}>Dönen Açık Kumaş</Text>
                      <Text style={styles.newRollHint}>
                        İrsaliyede yazılı her parça için metraj gir. KK2/Kurşun ekranı
                        ve stok bu kayıtlardan beslenir.
                      </Text>
                    </View>
                    <Button
                      mode="contained-tonal"
                      icon="plus"
                      onPress={addNewRoll}
                      compact
                    >
                      Parça Ekle
                    </Button>
                  </View>
                  {hasQtyMismatch && (
                    <Surface style={styles.diffBanner} elevation={0}>
                      <Text style={styles.diffBannerTitle}>
                        {qtyDiff > 0 ? 'FAZLA DÖNEN' : 'EKSİK DÖNEN'}:{' '}
                        {qtyDiff > 0 ? '+' : ''}
                        {qtyDiff.toFixed(1)} m
                      </Text>
                      <Text style={styles.diffBannerBody}>
                        Sevk: {sentTotal.toFixed(1)} m  ·  Dönen:{' '}
                        {returnedTotal.toFixed(1)} m
                      </Text>
                    </Surface>
                  )}
                  {newRolls.length === 0 ? (
                    <Surface style={styles.newRollEmpty} elevation={0}>
                      <Text style={styles.newRollEmptyText}>
                        En az bir açık kumaş parçası gerekli — "Parça Ekle"
                      </Text>
                    </Surface>
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
                            {r.prefilled && (
                              <View style={styles.prefilledBadge}>
                                <Text style={styles.prefilledBadgeText}>SEVKTEN</Text>
                              </View>
                            )}
                            <IconButton
                              icon={
                                r.noteOpen
                                  ? 'chevron-up'
                                  : r.notes
                                    ? 'note-text'
                                    : 'note-plus-outline'
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
              </ScrollView>

              {/* Sticky footer */}
              <Surface style={styles.footer} elevation={4}>
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
                <Button
                  mode="contained"
                  icon={
                    submitArmed
                      ? 'alert-decagram'
                      : hasMissing || hasQtyMismatch
                        ? 'alert-circle-outline'
                        : 'package-check'
                  }
                  onPress={handleSubmitClick}
                  disabled={!canSubmit}
                  style={styles.submitBtn}
                  contentStyle={styles.submitBtnContent}
                  labelStyle={styles.submitBtnLabel}
                  buttonColor={
                    submitArmed
                      ? '#dc2626'
                      : hasMissing || hasQtyMismatch
                        ? '#d97706'
                        : '#059669'
                  }
                >
                  {submitArmed
                    ? hasMissing
                      ? `Eksik kabulü ONAYLA — tekrar bas (${checkedCount}/${rows.length})`
                      : `Fark'lı kabulü ONAYLA — tekrar bas (${qtyDiff > 0 ? '+' : ''}${qtyDiff.toFixed(1)} m)`
                    : hasMissing
                      ? `Mal Kabulü Yap · ${missingCount} EKSİK`
                      : hasQtyMismatch
                        ? `Mal Kabulü Yap · FARK ${qtyDiff > 0 ? '+' : ''}${qtyDiff.toFixed(1)} m`
                        : `Mal Kabulü Yap (${checkedCount} top → ${newRolls.length} parça)`}
                </Button>
              </Surface>
            </>
          )}
        </View>

        {/* ════════ SAĞ: bekleyen + geçmiş (tablet) / sadece manuel input (telefon + kamera arızalı) ════════
            Telefon dikey + kamera-only modda kart okuma, liste ve geçmiş aksiyonları
            header butonlarına taşındı → rightCol komple gizli. Manuel mode aktifse
            sadece input bandı görünür, header butonları input ile birlikte çalışır. */}
        {!(isPhone && !manualBarcodeEntry) && (
        <View style={[styles.rightCol, isPhone && styles.rightColPhone]}>
          <>
          {/* Kart input + kamera — sticky top, her tab'da görünür.
              Telefonda Liste/Kamera alt sabit bar'da; bar burada sadece
              manuel input render eder (compactCta + manualMode pattern). */}
          <View style={styles.cardInputWrap}>
            <ScannerEntryBar
              value={cardBarcode}
              onChangeText={setCardBarcode}
              placeholder="Refakat kartı barkodu okut/yaz..."
              onResolve={() => handleResolveCard()}
              resolving={resolvingCard}
              onScan={() => setScannerOpen(true)}
              onList={isPhone ? undefined : () => setListModalOpen(true)}
              tone="green"
              compactCta={isPhone}
            />
          </View>

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
            <View style={styles.tabRefreshWrap}>
              <RefreshButton
                onPress={() => {
                  if (rightTab === 'pending') pendingQuery.refetch();
                  else if (rightTab === 'cancellable') cancellableReceiptsQuery.refetch();
                  else receiptsQuery.refetch();
                }}
                refreshing={
                  rightTab === 'pending'
                    ? pendingQuery.isFetching
                    : rightTab === 'cancellable'
                      ? cancellableReceiptsQuery.isFetching
                      : receiptsQuery.isFetching
                }
                isError={
                  rightTab === 'pending'
                    ? pendingQuery.isError
                    : rightTab === 'cancellable'
                      ? cancellableReceiptsQuery.isError
                      : receiptsQuery.isError
                }
                errorMessage={
                  rightTab === 'pending'
                    ? (pendingQuery.error as Error | undefined)?.message
                    : rightTab === 'cancellable'
                      ? (cancellableReceiptsQuery.error as Error | undefined)?.message
                      : (receiptsQuery.error as Error | undefined)?.message
                }
              />
            </View>
          </View>

          {/* Tab içeriği */}
          {rightTab === 'pending' && (
            <PendingPane
              loading={pendingQuery.isLoading}
              groups={sortedGroups}
              selectedStepId={selectedGroup?.step.id ?? null}
              highlightedWorkOrderId={highlightedWorkOrderId}
              onSelect={selectGroup}
            />
          )}
          {rightTab === 'cancellable' && (
            <HistoryPane
              loading={cancellableReceiptsQuery.isLoading}
              fetching={cancellableReceiptsQuery.isFetching}
              error={cancellableReceiptsQuery.isError ? (cancellableReceiptsQuery.error as Error) : null}
              receipts={cancellableReceiptsQuery.data?.data ?? []}
              page={cancellableReceiptsQuery.data?.pagination?.page ?? 1}
              totalPages={cancellableReceiptsQuery.data?.pagination?.totalPages ?? 1}
              total={cancellableReceiptsQuery.data?.pagination?.total ?? 0}
              onShowDetail={setDetailReceiptId}
              onCancel={(id) => {
                setCancelTargetReceiptId(id);
                setCancelReason('');
              }}
              onPageChange={setReceiptsPage}
              onRefresh={() => cancellableReceiptsQuery.refetch()}
            />
          )}
          {rightTab === 'history' && (
            <HistoryPane
              loading={receiptsQuery.isLoading}
              fetching={receiptsQuery.isFetching}
              error={receiptsQuery.isError ? (receiptsQuery.error as Error) : null}
              receipts={receiptsQuery.data?.data ?? []}
              page={receiptsQuery.data?.pagination?.page ?? 1}
              totalPages={receiptsQuery.data?.pagination?.totalPages ?? 1}
              total={receiptsQuery.data?.pagination?.total ?? 0}
              onShowDetail={setDetailReceiptId}
              /* onCancel verilmedi → ReceiptRow iptal butonunu gizler.
                 Geçmiş kabuller artık iptal edilemez (born roll'lar işleme girdi). */
              onPageChange={setReceiptsPage}
              onRefresh={() => receiptsQuery.refetch()}
            />
          )}
          </>
          )}
          </>
        </View>
        )}

        {/* Telefon dikey — ekran altında sabit aksiyon barı: liste (sol) + kamera (sağ).
            position:absolute body'nin içinde bottom:0 — modal'lar üstte kalır. */}
        {isPhone && (
          <View style={styles.bottomBar}>
            <TouchableRipple
              onPress={() => setListModalOpen(true)}
              style={[styles.bottomBarBtn, styles.bottomBarBtnSide]}
              rippleColor="rgba(15, 23, 42, 0.1)"
              accessibilityLabel="Bekleyen sevkler"
            >
              <View style={styles.bottomBarBtnInner}>
                <Icon source="format-list-bulleted" size={26} color="#0f172a" />
                <Text style={styles.bottomBarBtnText}>Liste</Text>
              </View>
            </TouchableRipple>
            <View style={styles.bottomBarDivider} />
            <TouchableRipple
              onPress={() => setScannerOpen(true)}
              style={[styles.bottomBarBtn, styles.bottomBarBtnPrimary]}
              rippleColor="rgba(30, 64, 175, 0.12)"
              accessibilityLabel="Kamera ile refakat kartı tara"
            >
              <View style={styles.bottomBarBtnInner}>
                <Icon source="camera" size={26} color="#1e40af" />
                <Text style={[styles.bottomBarBtnText, { color: '#1e40af' }]}>
                  Kamera
                </Text>
              </View>
            </TouchableRipple>
            <View style={styles.bottomBarDivider} />
            <TouchableRipple
              onPress={() => setHistoryModalOpen(true)}
              style={[styles.bottomBarBtn, styles.bottomBarBtnSide]}
              rippleColor="rgba(5, 150, 105, 0.12)"
              accessibilityLabel="Geçmiş kabuller"
            >
              <View style={styles.bottomBarBtnInner}>
                <Icon source="history" size={26} color="#059669" />
                <Text style={[styles.bottomBarBtnText, { color: '#059669' }]}>
                  Geçmiş
                </Text>
              </View>
            </TouchableRipple>
          </View>
        )}
      </View>

      {/* Detay modal — tablet'te sağ panelden veya telefon history modal
          KAPALIYKEN üst seviyede mount. Telefon history modal AÇIKKEN detay
          history'nin RNModal portal'ı içine `overlay` prop'uyla render
          edilir (RNModal-içinde-RNModal çakışmasını önler). */}
      {!historyModalOpen && (
        <ReceiptDetailModal
          receiptId={detailReceiptId}
          onDismiss={() => setDetailReceiptId(null)}
        />
      )}

      {/* Bekleyen sevk listesi — hızlı seçim için */}
      <CameraScanModal
        visible={listModalOpen}
        loading={pendingQuery.isLoading}
        fetching={pendingQuery.isFetching}
        isError={pendingQuery.isError}
        errorMessage={(pendingQuery.error as Error | undefined)?.message}
        groups={allGroups}
        onDismiss={() => setListModalOpen(false)}
        onSelect={(g) => {
          setListModalOpen(false);
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
        onTabChange={(t) => {
          setModalSubTab(t);
          setReceiptsPage(1); // tab değiştiğinde sayfa sıfırla
        }}
        loading={
          modalSubTab === 'cancellable'
            ? cancellableReceiptsQuery.isLoading
            : receiptsQuery.isLoading
        }
        fetching={
          modalSubTab === 'cancellable'
            ? cancellableReceiptsQuery.isFetching
            : receiptsQuery.isFetching
        }
        error={
          modalSubTab === 'cancellable'
            ? cancellableReceiptsQuery.isError
              ? (cancellableReceiptsQuery.error as Error)
              : null
            : receiptsQuery.isError
              ? (receiptsQuery.error as Error)
              : null
        }
        receipts={
          modalSubTab === 'cancellable'
            ? (cancellableReceiptsQuery.data?.data ?? [])
            : (receiptsQuery.data?.data ?? [])
        }
        page={
          modalSubTab === 'cancellable'
            ? (cancellableReceiptsQuery.data?.pagination?.page ?? 1)
            : (receiptsQuery.data?.pagination?.page ?? 1)
        }
        totalPages={
          modalSubTab === 'cancellable'
            ? (cancellableReceiptsQuery.data?.pagination?.totalPages ?? 1)
            : (receiptsQuery.data?.pagination?.totalPages ?? 1)
        }
        total={
          modalSubTab === 'cancellable'
            ? (cancellableReceiptsQuery.data?.pagination?.total ?? 0)
            : (receiptsQuery.data?.pagination?.total ?? 0)
        }
        onShowDetail={setDetailReceiptId}
        onCancel={
          modalSubTab === 'cancellable'
            ? (id) => {
                setCancelTargetReceiptId(id);
                setCancelReason('');
              }
            : undefined
        }
        onPageChange={setReceiptsPage}
        onRefresh={() =>
          modalSubTab === 'cancellable'
            ? cancellableReceiptsQuery.refetch()
            : receiptsQuery.refetch()
        }
        overlay={
          <>
            <ReceiptDetailModal
              receiptId={detailReceiptId}
              onDismiss={() => setDetailReceiptId(null)}
            />
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
          </>
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

// Çevrimdışı / sync bekleyen istasyon işlemi rozeti (KursunQc/Tambur/KK1 ile aynı).
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
  const canSubmit =
    !submitting &&
    reason.trim().length >= 3 &&
    !previewLoading &&
    !previewError &&
    (preview ? preview.allSafe : true);

  if (!visible) return null;

  // RNModal SARMAZ — HistoryReceiptsModal overlay'i içine render edilebilsin
  // diye absolute fill overlay pattern (ReceiptDetailModal ile aynı yapı).
  // İki RNModal aynı anda mount edilince ikincisinin invisible overlay'i
  // ilkinin tıklamalarını yutuyordu (FasonKabul telefon dikey bug'ı).
  return (
    <KeyboardAvoidingView
      style={cancelStyles.overlay}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      pointerEvents="auto"
    >
      <Pressable
        style={cancelStyles.backdrop}
        onPress={submitting ? undefined : onDismiss}
        accessibilityLabel="Kapat"
      />
      <View
        style={[
          cancelStyles.sheet,
          { width: winW * 0.9, maxHeight: winH * 0.85 },
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
      </View>
    </KeyboardAvoidingView>
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
  onDismiss,
  onSelect,
  onRefresh,
}: {
  visible: boolean;
  loading: boolean;
  fetching: boolean;
  isError: boolean;
  errorMessage?: string;
  groups: PendingReturnGroup[];
  onDismiss: () => void;
  onSelect: (g: PendingReturnGroup) => void;
  onRefresh: () => void;
}) {
  return (
    <RemoteListSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Bekleyen Sevkler"
      icon="format-list-bulleted"
      loading={loading}
      fetching={fetching}
      isError={isError}
      errorMessage={errorMessage}
      onRefresh={onRefresh}
      items={groups}
      keyExtractor={(g) => g.step.id}
      renderItem={(item) => (
        <PendingDispatchRow group={item} onPress={() => onSelect(item)} />
      )}
      emptyIcon="package-variant"
      emptyText="Fasonda bekleyen sevk yok"
      hint={{ text: 'Refakat kartı yoksa aşağıdan dönecek sevki seçerek devam edin.' }}
    />
  );
}

function PendingDispatchRow({
  group,
  onPress,
}: {
  group: PendingReturnGroup;
  onPress: () => void;
}) {
  return (
    <Surface style={cameraStyles.row} elevation={1}>
      <TouchableRipple borderless onPress={onPress} style={cameraStyles.rowTouch}>
        <View style={cameraStyles.rowInner}>
          <View style={{ flex: 1 }}>
            <Text style={cameraStyles.rowBatch}>{group.workOrder.batchNumber}</Text>
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
  page,
  totalPages,
  total,
  onShowDetail,
  onCancel,
  onPageChange,
  onRefresh,
  overlay,
  tab,
  onTabChange,
}: {
  visible: boolean;
  onDismiss: () => void;
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  receipts: import('../../../types/models').SubcontractorReceiptListItem[];
  page: number;
  totalPages: number;
  total: number;
  onShowDetail: (id: string) => void;
  /** Yalnız 'cancellable' tab'da görünür — settled tab'da undefined. */
  onCancel?: (id: string) => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  /** Sheet'in üstüne render edilen overlay (detay modal) — aynı RNModal
   *  portal'ında olduğu için detay listeyi örtüp listeye geri dönüyor. */
  overlay?: React.ReactNode;
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
      loading={loading}
      fetching={fetching}
      isError={!!error}
      errorMessage={error?.message}
      onRefresh={onRefresh}
      items={receipts}
      keyExtractor={(r) => r.id}
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
      footer={
        <Pager
          page={page}
          totalPages={totalPages}
          total={total}
          fetching={fetching}
          onPageChange={onPageChange}
        />
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
  groups,
  selectedStepId,
  highlightedWorkOrderId,
  onSelect,
}: {
  loading: boolean;
  groups: PendingReturnGroup[];
  selectedStepId: string | null;
  highlightedWorkOrderId: string | null;
  onSelect: (g: PendingReturnGroup) => void;
}) {
  if (loading) {
    return (
      <View style={styles.paneEmpty}>
        <ActivityIndicator size="large" color="#d97706" />
      </View>
    );
  }
  if (groups.length === 0) {
    return (
      <View style={styles.paneEmpty}>
        <Icon source="package-variant" size={48} color="#cbd5e1" />
        <Text style={styles.paneEmptyText}>Fasonda bekleyen sevk yok</Text>
      </View>
    );
  }
  return (
    <FlashList
      data={groups}
      keyExtractor={(g) => g.step.id}
      contentContainerStyle={{ padding: 8 }}
      renderItem={({ item }) => (
        <PendingCard
          group={item}
          selected={item.step.id === selectedStepId}
          highlighted={
            !!highlightedWorkOrderId && item.workOrder.id === highlightedWorkOrderId
          }
          onPress={() => onSelect(item)}
        />
      )}
    />
  );
}

function PendingCard({
  group,
  selected,
  highlighted,
  onPress,
}: {
  group: PendingReturnGroup;
  selected: boolean;
  highlighted: boolean;
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
            {selected && (
              <View style={[styles.pendingFlag, { backgroundColor: '#059669' }]}>
                <Icon source="check" size={10} color="#fff" />
                <Text style={styles.pendingFlagText}>SEÇİLİ</Text>
              </View>
            )}
          </View>
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
  fetching,
  error,
  receipts,
  page,
  totalPages,
  total,
  onShowDetail,
  onCancel,
  onPageChange,
  onRefresh,
}: {
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  receipts: import('../../../types/models').SubcontractorReceiptListItem[];
  page: number;
  totalPages: number;
  total: number;
  onShowDetail: (id: string) => void;
  /** Verilirse her satırda İptal Et butonu görünür. Settled tab'ında verilmez
      → ReceiptRow iptal butonunu otomatik gizler. */
  onCancel?: (id: string) => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.paneEmpty}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
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
        renderItem={({ item }) => (
          <ReceiptRow
            receipt={item}
            onShowDetail={onShowDetail}
            onCancel={onCancel}
          />
        )}
      />
      <Pager
        page={page}
        totalPages={totalPages}
        total={total}
        fetching={fetching}
        onPageChange={onPageChange}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  body: { flex: 1, flexDirection: 'row', backgroundColor: '#f8fafc' },
  bodyPhone: { flexDirection: 'column' },

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
  bottomBarBtn: { justifyContent: 'center', alignItems: 'center' },
  // 30 / 40 / 30 oranı — orta (kamera) ana eylem olarak vurgulanır.
  bottomBarBtnSide: { flex: 3 },
  bottomBarBtnPrimary: { flex: 4 },
  bottomBarBtnInner: { alignItems: 'center', gap: 2 },
  bottomBarBtnText: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  bottomBarDivider: { width: 1, backgroundColor: '#e2e8f0' },

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
  headerCellMain: { flex: 1.5, justifyContent: 'center' },
  headerBatch: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  headerSub: { fontSize: 11, color: '#cbd5e1', marginTop: 2 },
  headerDivider: { width: 1, height: 28, backgroundColor: '#334155' },
  headerCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerCompany: { fontSize: 12, color: '#e2e8f0', fontWeight: '600' },

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

  // Refactor 9 — Boyahane / "renk veren" kategori uygulama bilgisi
  appliesColorCard: {
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#faf5ff',
    borderWidth: 1,
    borderColor: '#c4b5fd',
    gap: 8,
  },
  appliesColorHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  appliesColorTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6d28d9',
    flex: 1,
  },
  appliesColorHint: {
    fontSize: 10,
    color: '#7c3aed',
    fontStyle: 'italic',
  },
  appliesColorBody: { gap: 6 },
  appliesColorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd6fe',
  },
  colorSwatch: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  appliesColorChipText: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  appliesColorEmpty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' },
  appliesPropertyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
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
  newRollEmpty: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  newRollEmptyText: { fontSize: 12, color: '#92400e', fontWeight: '600' },
  diffBanner: {
    backgroundColor: '#fef3c7',
    borderColor: '#d97706',
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  diffBannerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#92400e',
    letterSpacing: 0.3,
  },
  diffBannerBody: {
    fontSize: 12,
    color: '#92400e',
    marginTop: 2,
    fontWeight: '600',
  },
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
  prefilledBadge: {
    backgroundColor: '#e0e7ff',
    borderColor: '#6366f1',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  prefilledBadgeText: {
    color: '#3730a3',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
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
  footerInputs: { flexDirection: 'row', gap: 8 },
  footerInput: { backgroundColor: '#fff' },
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
  tabRefreshWrap: {
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
  },

  // Pane (tab içeriği)
  paneFlex: { flex: 1 },
  paneEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 6,
  },
  paneEmptyText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
  paneEmptyHint: { fontSize: 12, color: '#cbd5e1', textAlign: 'center' },

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
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  rowQty: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  rowDate: { fontSize: 11, color: '#94a3b8' },
});
