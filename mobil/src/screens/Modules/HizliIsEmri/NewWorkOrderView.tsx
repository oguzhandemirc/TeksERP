import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  Text,
  Button,
  TouchableRipple,
  Icon,
  IconButton,
  TextInput,
  Surface,
  ActivityIndicator,
  Switch,
} from 'react-native-paper';
import { useMutation, useQuery, useQueryClient, onlineManager } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import RollPickerModal from '../../../components/RollPickerModal';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import AppModal from '../../../components/AppModal';
import WorkOrderHeaderFields, {
  EMPTY_HEADER_FIELDS,
  type WoHeaderFieldValues,
} from './WorkOrderHeaderFields';
import OrderLinkPicker from './OrderLinkPicker';
import RouteStepsModal from './RouteStepsModal';

import { printFasonCeki } from '../../../services/fasonCekiPrint';
import { printTravelerCardForWorkOrder } from '../../../services/travelerCardPrint';
import { rollService } from '../../../services/roll.service';
import { routeService } from '../../../services/route.service';
import { productRecipeService } from '../../../services/productRecipe.service';
import { subcontractorService } from '../../../services/subcontractor.service';
import { workOrderService, type QuickStartRequest } from '../../../services/workOrder.service';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { ROLL_STATUS_LABEL, trLabel } from '../../../utils/labels';
import type { Roll } from '../../../types/models';
import { colors, spacing, radius } from '../../../theme';

interface ScannedRoll {
  id: string;
  barcode: string;
  itemId: string;
  itemName: string;
  qty: number;
}

const toPositiveNum = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const errMessage = (err: unknown): string => {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Bilinmeyen hata';
};

interface NewWorkOrderViewProps {
  /** "Listeden Seç" modalı dışarıdan (header simge butonu) açılabilsin. */
  rollListOpen?: boolean;
  onRollListOpenChange?: (v: boolean) => void;
}

export default function NewWorkOrderView({ rollListOpen, onRollListOpenChange }: NewWorkOrderViewProps) {
  const qc = useQueryClient();
  const manualMode = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  const lastRouteTemplateId = useDeviceSettingsStore((s) => s.lastRouteTemplateId);
  const setLastRouteTemplateId = useDeviceSettingsStore((s) => s.setLastRouteTemplateId);
  const lastWoTemplateId = useDeviceSettingsStore((s) => s.lastWoTemplateId);
  const setLastWoTemplateId = useDeviceSettingsStore((s) => s.setLastWoTemplateId);
  const [printing, setPrinting] = useState(false);

  const [scanned, setScanned] = useState<ScannedRoll[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [listOpenInternal, setListOpenInternal] = useState(false);
  const listOpen = rollListOpen ?? listOpenInternal;
  const setListOpen = (v: boolean) => {
    if (onRollListOpenChange) onRollListOpenChange(v);
    else setListOpenInternal(v);
  };
  const [manualBarcode, setManualBarcode] = useState('');
  const resolvingRef = useRef(false);
  // addRolls async tarama closure'ında güncel listeyi okumak için ayna ref.
  const scannedRef = useRef<ScannedRoll[]>([]);
  useEffect(() => {
    scannedRef.current = scanned;
  }, [scanned]);

  const [routeTemplateId, setRouteTemplateId] = useState<string | null>(null);
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const [routeStepsOpen, setRouteStepsOpen] = useState(false);
  // İş Emri Şablonu = ProductRecipe. Seçilince renk/en/kat/rota/özellik doldurur.
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [appliedTemplate, setAppliedTemplate] = useState<{
    name: string;
    colorName: string | null;
    colorHex: string | null;
    width: number | null;
    foldType: string | null;
    properties: { id: string; name: string }[];
  } | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateDetailOpen, setTemplateDetailOpen] = useState(false);
  const [header, setHeader] = useState<WoHeaderFieldValues>(EMPTY_HEADER_FIELDS);
  const [orderLineIds, setOrderLineIds] = useState<string[]>([]);
  // Sipariş-önce: seçilen sipariş kaleminden kilitlenen ürün (top okutulmadan da
  // WO ürününü/anchor'ı belirler). Top-önce'de de set edilir (E4: toplar silinse de
  // sipariş bağlıyken ürün kilidi kalsın).
  const [orderDerivedItemId, setOrderDerivedItemId] = useState<string | null>(null);
  // addRolls useCallback([]) closure'ı güncel order-derived ürünü ref'ten okur.
  const orderDerivedItemIdRef = useRef<string | null>(null);
  useEffect(() => {
    orderDerivedItemIdRef.current = orderDerivedItemId;
  }, [orderDerivedItemId]);
  const [targetPropertyIds, setTargetPropertyIds] = useState<string[]>([]);
  // İstasyon başına not (route step sequence → not) → stepPlanning.
  const [stepNotes, setStepNotes] = useState<Record<number, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Özet satırı için: Detaylar kartındaki renk seçici, çözdüğü hedef renk adını buraya bildirir.
  const [colorLabel, setColorLabel] = useState<string | null>(null);
  // Sipariş kalemi seçici modalı — hem Detaylar kartından hem alt bardan açılır.
  const [orderPickerOpen, setOrderPickerOpen] = useState(false);
  // Sipariş kaleminden gelen renk adı — kilitli renk alanı + özette doğrudan göster
  // (public-dışı/müşteri-özel renkte picker'da olmayabilir).
  const [orderColorName, setOrderColorName] = useState<string | null>(null);
  // Rota fason adımlarında operatör firma override'ı (sequence → firma id).
  // Boş → route'un kayıtlı fasonu, o da yoksa favori kullanılır (selectedFirmBySeq).
  const [stepSubcontractors, setStepSubcontractors] = useState<Record<number, string>>({});

  const [result, setResult] = useState<{
    batchNumber: string;
    attached: number;
    errors: string[];
    woId: string;
    dispatch: { id: string; dispatchNo: string } | null;
  } | null>(null);
  // "Fasona Gönder" — ilk rota adımı fason ise WO ile birlikte sevki de yap (default açık).
  const [dispatchFirstStep, setDispatchFirstStep] = useState(true);
  const [printingCeki, setPrintingCeki] = useState(false);

  const lockedItemId = orderDerivedItemId ?? scanned[0]?.itemId ?? null;
  const lockedItemName = scanned[0]?.itemName ?? null;
  const totalQty = useMemo(() => scanned.reduce((s, r) => s + r.qty, 0), [scanned]);

  // ── Master data ──────────────────────────────────────────────────────────
  const routesQuery = useQuery({
    queryKey: ['routes', 'wo-picker'],
    queryFn: () => routeService.getAll({ page: 1, pageSize: 200, sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 10 * 60 * 1000,
  });
  // Şablon picker'ı okutulan ürüne göre filtrelenir (uyumsuz şablon çıkmasın).
  const templatesQuery = useQuery({
    queryKey: ['product-recipes', 'wo-picker', lockedItemId],
    queryFn: () =>
      productRecipeService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: 'name',
        sortOrder: 'asc',
        filters: lockedItemId ? { itemId: lockedItemId } : undefined,
      }),
    staleTime: 5 * 60 * 1000,
    enabled: templatePickerOpen || !!templateId,
  });

  const routeOptions: PickerOption[] = useMemo(
    () =>
      (routesQuery.data?.data ?? []).map((r) => ({
        value: r.id,
        label: r.name,
        sublabel: r.code ?? undefined,
        badge: r.isFavorite ? { text: '★', color: colors.warning } : undefined,
      })),
    [routesQuery.data],
  );
  const templateOptions: PickerOption[] = useMemo(
    () =>
      (templatesQuery.data?.data ?? []).map((r) => ({
        value: r.id,
        label: r.name,
        sublabel: r.code,
      })),
    [templatesQuery.data],
  );

  const routeLabel = routeOptions.find((o) => o.value === routeTemplateId)?.label ?? null;
  // Seçili rotanın tam objesi (adımlar dahil — route listesi defaultInclude ile steps döner).
  const selectedRoute = useMemo(
    () => (routesQuery.data?.data ?? []).find((r) => r.id === routeTemplateId) ?? null,
    [routesQuery.data, routeTemplateId],
  );

  const needsColor = !!header.targetColorId;
  const needsProps = targetPropertyIds.length > 0;
  const hasColorOrProps = needsColor || needsProps;
  // Rotanın fason kategorileri (firma ataması + sorgu için) ve uygulama yetenekleri.
  // appliesColor/Property: backend hedef renk/özellik için bu bayraklı bir adım arar —
  // sadece kategori atanmış olması yetmez (örn. "Zımpara" kategorisi rengi uygulamaz).
  const { fasonCategoryIds, canApplyColor, canApplyProps } = useMemo(() => {
    const ids = new Set<string>();
    let color = false;
    let props = false;
    for (const s of selectedRoute?.steps ?? []) {
      const cat = s.station?.defaultCategory;
      if (!cat) continue;
      ids.add(cat.id);
      if (cat.appliesColor) color = true;
      if (cat.appliesProperty) props = true;
    }
    return { fasonCategoryIds: [...ids], canApplyColor: color, canApplyProps: props };
  }, [selectedRoute]);
  // Rota, seçilen hedeflerin TÜMÜNÜ uygulayabiliyor mu? (renk varsa renk veren adım,
  // özellik varsa özellik veren adım gerekir). Eksikse hangi tip eksik bunu da söyle.
  const routeCanApply = (!needsColor || canApplyColor) && (!needsProps || canApplyProps);
  const applyMissing =
    needsColor && !canApplyColor && needsProps && !canApplyProps
      ? 'renk ve özellik'
      : needsColor && !canApplyColor
        ? 'renk veren (boyahane)'
        : needsProps && !canApplyProps
          ? 'özellik veren'
          : null;

  // Favori fason firmaları (kategori bazında eşleşir) — Gelişmiş renk uygulamasında adımın
  // plannedSubcontractorId'sini otomatik doldurur. Best-effort: yüklenmezse firma boş kalır
  // (kategori atandığı için renk/özellik yine uygulanır).
  const subcontractorsQuery = useQuery({
    queryKey: ['subcontractors', 'wo-favorites'],
    queryFn: () =>
      subcontractorService.listSubcontractors({
        page: 1,
        pageSize: 500,
        sortBy: 'name',
        sortOrder: 'asc',
        filters: { isActive: 'true' },
      }),
    enabled: fasonCategoryIds.length > 0,
    staleTime: 10 * 60 * 1000,
  });
  const favoriteFirmFor = useCallback(
    (categoryId: string): string | undefined => {
      const subs = subcontractorsQuery.data?.data ?? [];
      const inCat = subs.filter((s) => s.categories?.some((c) => c.categoryId === categoryId));
      if (inCat.length === 0) return undefined;
      return (inCat.find((s) => s.isFavorite) ?? inCat[0]).id;
    },
    [subcontractorsQuery.data],
  );

  // Fason firma seçenekleri (kategori bazında) + id→ad haritası — rota adımları modalı için.
  const firmOptionsByCategory = useMemo(() => {
    const subs = subcontractorsQuery.data?.data ?? [];
    const out: Record<string, { id: string; name: string; isFavorite?: boolean }[]> = {};
    for (const catId of fasonCategoryIds) {
      out[catId] = subs
        .filter((s) => s.categories?.some((c) => c.categoryId === catId))
        .map((s) => ({ id: s.id, name: s.name, isFavorite: s.isFavorite }));
    }
    return out;
  }, [subcontractorsQuery.data, fasonCategoryIds]);
  const firmNameById = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of subcontractorsQuery.data?.data ?? []) out[s.id] = s.name;
    return out;
  }, [subcontractorsQuery.data]);
  // Her fason adımı için etkin firma: operatör override'ı ?? rota kaydı ?? favori.
  const selectedFirmBySeq = useMemo(() => {
    const out: Record<number, string | null> = {};
    for (const s of selectedRoute?.steps ?? []) {
      const cat = s.station?.defaultCategory;
      if (!cat) continue;
      out[s.sequence] =
        stepSubcontractors[s.sequence] ?? s.plannedSubcontractorId ?? favoriteFirmFor(cat.id) ?? null;
    }
    return out;
  }, [selectedRoute, stepSubcontractors, favoriteFirmFor]);

  // İlk rota adımı fason (boyahane) mı + firması çözülebiliyor mu? → "Fasona Gönder"
  // toggle'ı yalnız fason ilk adımda görünür; firma yoksa sevk yapılamaz (uyarı).
  const firstStepDispatch = useMemo(() => {
    const steps = selectedRoute?.steps ?? [];
    if (steps.length === 0) return { isFason: false, firmId: null as string | null };
    const first = [...steps].sort((a, b) => a.sequence - b.sequence)[0];
    const isFason = !!first.station?.defaultCategory;
    const firmId = isFason ? (selectedFirmBySeq[first.sequence] ?? null) : null;
    return { isFason, firmId };
  }, [selectedRoute, selectedFirmBySeq]);

  // Rota hızlı çipleri: son kullanılan + favoriler (max 4, tekilleştirilmiş).
  const routeChips = useMemo(() => {
    const all = routesQuery.data?.data ?? [];
    const out: { id: string; name: string; isLast: boolean; isFav: boolean }[] = [];
    const last = lastRouteTemplateId ? all.find((r) => r.id === lastRouteTemplateId) : null;
    if (last) out.push({ id: last.id, name: last.name, isLast: true, isFav: !!last.isFavorite });
    for (const r of all) {
      if (r.isFavorite && r.id !== last?.id) out.push({ id: r.id, name: r.name, isLast: false, isFav: true });
    }
    return out.slice(0, 4);
  }, [routesQuery.data, lastRouteTemplateId]);

  // Açılışta son rotayı otomatik seç (saha genelde aynı rota). Bir kez.
  const didPreselectRef = useRef(false);
  useEffect(() => {
    if (didPreselectRef.current || !routesQuery.data) return;
    didPreselectRef.current = true;
    if (
      !routeTemplateId &&
      lastRouteTemplateId &&
      (routesQuery.data.data ?? []).some((r) => r.id === lastRouteTemplateId)
    ) {
      setRouteTemplateId(lastRouteTemplateId);
    }
  }, [routesQuery.data, lastRouteTemplateId, routeTemplateId]);

  const chooseRoute = (id: string | null) => {
    setRouteTemplateId(id);
    setStepNotes({}); // rota değişti → eski sequence notları geçersiz
    setStepSubcontractors({}); // rota değişti → eski firma override'ları geçersiz
    setSubmitError(null);
  };

  // ── Top ekleme (tarama + liste ortak) ──────────────────────────────────────
  const reject = (text2: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    Toast.show({ type: 'error', text1: 'Top eklenmedi', text2 });
  };

  const addRolls = useCallback((incoming: Roll[]) => {
    const prev = scannedRef.current;
    const have = new Set(prev.map((s) => s.barcode));
    // Sipariş-önce: ürün siparişten kilitli → okutulan toplar ona uymak zorunda.
    let lock = orderDerivedItemIdRef.current ?? prev[0]?.itemId ?? null;
    const additions: ScannedRoll[] = [];
    const rejects: string[] = [];

    for (const roll of incoming) {
      if (!roll.barcode) {
        rejects.push('Barkodsuz top eklenemez');
        continue;
      }
      if (have.has(roll.barcode)) continue; // mükerrer → sessiz
      if (roll.status !== 'STOCK') {
        rejects.push(`${roll.barcode} stokta değil (${trLabel(ROLL_STATUS_LABEL, roll.status)})`);
        continue;
      }
      if (lock && roll.itemId !== lock) {
        rejects.push(`${roll.barcode} farklı ürün`);
        continue;
      }
      if (!lock) lock = roll.itemId;
      have.add(roll.barcode);
      additions.push({
        id: roll.id,
        barcode: roll.barcode,
        itemId: roll.itemId,
        itemName: roll.item?.name ?? 'Ürün',
        qty: Number(roll.currentQty) || 0,
      });
    }

    if (additions.length > 0) {
      // Fonksiyonel updater + tekrar dedup (ref gecikmesine karşı emniyet).
      setScanned((cur) => {
        const seen = new Set(cur.map((s) => s.barcode));
        const fresh = additions.filter((a) => !seen.has(a.barcode));
        return fresh.length ? [...cur, ...fresh] : cur;
      });
      setSubmitError(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Toast.show({
        type: 'success',
        text1: additions.length === 1 ? 'Eklendi' : `${additions.length} top eklendi`,
        text2: additions.length === 1 ? additions[0].barcode : undefined,
        visibilityTime: 900,
      });
    }
    if (rejects.length > 0) {
      reject(rejects.length === 1 ? rejects[0] : `${rejects.length} top eklenmedi: ${rejects[0]}`);
    }
  }, []);

  // K-A4 fix: çözümleme sürerken gelen okuma SESSİZCE düşüyordu (yavaş ağda
  // operatör art arda okutur, kamera ✓ verir, top listeye girmez). Paketleme'deki
  // FIFO kuyruğun aynısı: meşgulken kuyruğa al, bitince sıradakini işle.
  const pendingScanQueueRef = useRef<string[]>([]);

  const handleScan = useCallback(
    async (raw: string) => {
      const barcode = raw.trim();
      if (!barcode) return;
      if (scannedRef.current.some((s) => s.barcode === barcode)) return; // bilinen mükerrer → sessiz, ağ çağrısı yok
      if (resolvingRef.current) {
        if (!pendingScanQueueRef.current.includes(barcode)) {
          pendingScanQueueRef.current.push(barcode);
        }
        return;
      }
      resolvingRef.current = true;
      Haptics.selectionAsync().catch(() => {}); // yakalama anında hafif tık (kabul/ret sonra)
      try {
        const res = await rollService.getByBarcode(barcode);
        const roll = res.data;
        if (!roll) {
          reject(`${barcode} bulunamadı`);
          return;
        }
        addRolls([roll]);
      } catch {
        reject(`${barcode} okunamadı`);
      } finally {
        resolvingRef.current = false;
        const next = pendingScanQueueRef.current.shift();
        if (next) void handleScan(next);
      }
    },
    [addRolls],
  );

  const removeRoll = (barcode: string) => setScanned((prev) => prev.filter((s) => s.barcode !== barcode));
  const clearScanned = () => setScanned([]);

  // ── İş Emri Şablonu uygula / temizle ───────────────────────────────────────
  const applyTemplate = async (id: string | null) => {
    setTemplateId(id);
    setSubmitError(null);
    if (!id) {
      clearTemplate();
      return;
    }
    try {
      const res = await productRecipeService.getById(id);
      const r = res.data;
      if (!r) return;
      if (r.routeId) {
        setRouteTemplateId(r.routeId);
        setStepNotes({}); // rota değişti → eski sequence notları geçersiz
        setStepSubcontractors({}); // rota değişti → eski firma override'ları geçersiz
      }
      setHeader((h) => ({
        ...h,
        targetColorId: r.colorId ?? null,
        width: r.width != null ? String(r.width) : '',
        // Şablon kat tipi belirtmiyorsa mevcut seçimi koru — kat tipi boş kalamaz.
        foldType: r.foldType ?? h.foldType,
      }));
      const propRows = r.properties ?? [];
      setTargetPropertyIds(propRows.map((p) => p.propertyId));
      setAppliedTemplate({
        name: r.name,
        colorName: r.color?.name ?? null,
        colorHex: r.color?.hex ?? null,
        width: r.width ?? null,
        foldType: r.foldType ?? null,
        properties: propRows.map((p) => ({ id: p.propertyId, name: p.property?.name ?? p.propertyId })),
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Şablon yüklenemedi', text2: errMessage(e) });
    }
  };

  // Şablonu temizle: yalnız şablonun doldurduğu ürün-spec alanlarını geri al.
  // Rota dokunulmaz (zorunlu + çip/picker ile ayrı yönetiliyor).
  const clearTemplate = () => {
    setTemplateId(null);
    setAppliedTemplate(null);
    setTargetPropertyIds([]);
    // Kat tipi varsayılana döner (boş bırakılamaz).
    setHeader((h) => ({ ...h, targetColorId: null, width: '', foldType: EMPTY_HEADER_FIELDS.foldType }));
    setSubmitError(null);
  };

  // ── Oluştur ────────────────────────────────────────────────────────────────
  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: (payload: QuickStartRequest) => workOrderService.quickStart(payload),
    onSuccess: (res) => {
      const data = res.data;
      if (!data) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Son kullanılan rota + şablonu cihaza yaz (sonraki açılışta hazır gelsin).
      void setLastRouteTemplateId(routeTemplateId);
      void setLastWoTemplateId(templateId);
      setResult({
        batchNumber: data.workOrder.batchNumber,
        attached: data.attached,
        errors: data.errors,
        woId: data.workOrder.id,
        dispatch: data.dispatch ?? null,
      });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['rolls'] });
    },
    onError: (err: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const msg = errMessage(err);
      setSubmitError(msg);
      Toast.show({ type: 'error', text1: 'İş emri başlatılamadı', text2: msg });
    },
  });

  const canSubmit = scanned.length > 0 && !!routeTemplateId && !!header.foldType && !mutation.isPending;

  const submit = () => {
    setSubmitError(null);
    if (!onlineManager.isOnline()) {
      const msg = 'İş emri başlatmak için bağlantı gerekli.';
      setSubmitError(msg);
      Toast.show({ type: 'error', text1: 'Çevrimdışı', text2: msg });
      return;
    }
    if (scanned.length === 0) {
      setSubmitError('En az bir top okutun veya listeden seçin.');
      return;
    }
    if (!routeTemplateId) {
      setSubmitError('Bir rota şablonu seçmelisiniz.');
      return;
    }
    if (!header.foldType) {
      setSubmitError('Kat tipi seçmelisiniz (2-KAT veya 4-KAT).');
      return;
    }
    const apply = hasColorOrProps;
    if (apply && !routeCanApply) {
      setSubmitError(
        `Seçili rota ${applyMissing} uygulayacak bir fason adımı içermiyor. Uygun bir rota seçin.`,
      );
      return;
    }

    // stepPlanning'i sequence bazında birleştir: istasyon notları + her fason adımının
    // kategori & planlanan firması. Backend create() bunları rota adımına sequence ile uygular.
    const planBySeq = new Map<
      number,
      { notes?: string; requiredCategoryId?: string; plannedSubcontractorId?: string }
    >();
    for (const [seq, v] of Object.entries(stepNotes)) {
      const t = v.trim();
      if (t) planBySeq.set(Number(seq), { ...(planBySeq.get(Number(seq)) ?? {}), notes: t });
    }
    // Fason adımları (defaultCategory'li) → kategori + firma (override ?? rota kaydı ?? favori).
    // apply'dan bağımsız: fason adımı renk uygulamasa da bir firmaya gönderilir.
    for (const s of selectedRoute?.steps ?? []) {
      const cat = s.station?.defaultCategory;
      if (!cat) continue;
      const firm = selectedFirmBySeq[s.sequence] ?? undefined;
      planBySeq.set(s.sequence, {
        ...(planBySeq.get(s.sequence) ?? {}),
        requiredCategoryId: cat.id,
        ...(firm ? { plannedSubcontractorId: firm } : {}),
      });
    }
    const stepPlanning = [...planBySeq.entries()].map(([sequence, v]) => ({ sequence, ...v }));

    const payload: QuickStartRequest = {
      rollBarcodes: scanned.map((s) => s.barcode),
      routeTemplateId,
      targetColorId: apply ? header.targetColorId : null,
      width: toPositiveNum(header.width),
      targetQuantity: toPositiveNum(header.targetQuantity),
      targetWeight: toPositiveNum(header.targetWeight),
      foldType: header.foldType,
      // Boş → backend Electron ile aynı algoritmayı (P-YYMMDD-NNN) üretir; doluysa override.
      batchNumber: header.batchNumber.trim() || undefined,
      orderLineIds: orderLineIds.length ? orderLineIds : undefined,
      targetPropertyIds: apply && targetPropertyIds.length ? targetPropertyIds : undefined,
      stepPlanning: stepPlanning.length ? stepPlanning : undefined,
      // Sipariş-önce: ürün siparişten kilitli → explicit gönder (backend toplarla
      // eşleştiğini doğrular). Sipariş yoksa verilmez → backend toplardan türetir.
      targetItemId: orderLineIds.length ? lockedItemId : undefined,
      // İlk adım fason + firma çözülmüş + toggle açıksa: WO ile birlikte fason sevkini
      // de yap (çeki listesi dahil). Aksi halde gönderilmez (eski "planla" davranışı).
      dispatchFirstStep:
        dispatchFirstStep && firstStepDispatch.isFason && !!firstStepDispatch.firmId,
    };
    mutation.mutate(payload);
  };

  const resetAll = () => {
    setScanned([]);
    // Son rotayı koru (saha kolaylığı); şablon ve diğer alanları temizle.
    setRouteTemplateId(lastRouteTemplateId);
    clearTemplate();
    setHeader(EMPTY_HEADER_FIELDS);
    setOrderLineIds([]);
    setOrderDerivedItemId(null);
    setStepNotes({});
    setStepSubcontractors({});
    setOrderColorName(null);
    setColorLabel(null);
    setSubmitError(null);
    setDispatchFirstStep(true);
    setResult(null);
  };

  // Refakat kartı — backend'in TEK KAYNAK HTML'ini basar (kullanıcı iptali sessiz).
  const printResult = async () => {
    if (!result) return;
    setPrinting(true);
    try {
      await printTravelerCardForWorkOrder(result.woId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (!/cancel|dismiss/i.test(msg)) {
        Toast.show({ type: 'error', text1: 'Çıktı alınamadı', text2: msg });
      }
    } finally {
      setPrinting(false);
    }
  };

  // Fason çeki listesi — backend'in TEK KAYNAK HTML'ini basar (kullanıcı iptali sessiz).
  const handlePrintCeki = async () => {
    if (!result?.dispatch) return;
    setPrintingCeki(true);
    try {
      await printFasonCeki(result.dispatch.id);
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Çeki listesi alınamadı',
        text2: e instanceof Error ? e.message : '',
      });
    } finally {
      setPrintingCeki(false);
    }
  };

  // ── Başarı ekranı ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <View style={styles.successWrap}>
        <Surface style={styles.successCard} elevation={2}>
          <View style={styles.successIcon}>
            <Icon source="check-circle" size={56} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>İş Emri Başlatıldı</Text>
          <Text style={styles.successBatch}>{result.batchNumber}</Text>
          <Text style={styles.successMeta}>{result.attached} top bağlandı</Text>
          {result.errors.length > 0 ? (
            <Text style={styles.successWarn}>{result.errors.length} top bağlanamadı</Text>
          ) : null}
          {result.dispatch ? (
            <Text style={styles.successDispatch}>
              Fasona sevk edildi · İrsaliye {result.dispatch.dispatchNo}
            </Text>
          ) : null}
          <Button
            mode="contained"
            icon="printer"
            onPress={printResult}
            loading={printing}
            disabled={printing}
            style={styles.successBtn}
            contentStyle={styles.btnContent}
          >
            Çıktı Al (Refakat Kartı)
          </Button>
          {/* Fason çeki listesi — yalnız sevk yapıldıysa; otomatik açılmaz, isteğe bağlı. */}
          {result.dispatch ? (
            <Button
              mode="contained-tonal"
              icon="file-document-outline"
              onPress={handlePrintCeki}
              loading={printingCeki}
              disabled={printingCeki}
              style={styles.successBtn}
              contentStyle={styles.btnContent}
            >
              Fason Çeki Listesi
            </Button>
          ) : null}
          <Button mode="outlined" icon="plus" onPress={resetAll} style={styles.successBtn} contentStyle={styles.btnContent}>
            Yeni İş Emri
          </Button>
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        {/* Toplar kartı */}
        <Surface style={styles.card} elevation={1}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Stok Topları</Text>
            {scanned.length > 0 ? (
              <TouchableRipple onPress={clearScanned} borderless style={styles.clearAll}>
                <Text style={styles.clearAllText}>Temizle</Text>
              </TouchableRipple>
            ) : null}
          </View>

          {manualMode ? (
            <View style={styles.manualRow}>
              <TextInput
                mode="outlined"
                dense
                placeholder="Barkod elle gir"
                value={manualBarcode}
                onChangeText={setManualBarcode}
                onSubmitEditing={() => {
                  void handleScan(manualBarcode);
                  setManualBarcode('');
                }}
                returnKeyType="done"
                autoCapitalize="characters"
                style={styles.manualInput}
              />
            </View>
          ) : null}

          {lockedItemName ? (
            <View style={styles.itemLock}>
              <Icon source="cube-outline" size={16} color={colors.brand} />
              <Text style={styles.itemLockText} numberOfLines={1}>
                {lockedItemName}
              </Text>
            </View>
          ) : null}

          {scanned.length === 0 ? (
            <Text style={styles.emptyScan}>
              Henüz top eklenmedi. Aynı üründen topları okutun ya da listeden seçin.
            </Text>
          ) : (
            <View style={styles.rollList}>
              {scanned.map((s, i) => (
                <View key={s.barcode} style={styles.rollRow}>
                  <Text style={styles.rollIdx}>{i + 1}</Text>
                  <Text style={styles.rollBarcode} numberOfLines={1}>
                    {s.barcode}
                  </Text>
                  <Text style={styles.rollQty}>{Math.round(s.qty)}m</Text>
                  <TouchableRipple onPress={() => removeRoll(s.barcode)} borderless style={styles.rollRemove}>
                    <Icon source="close" size={20} color={colors.danger} />
                  </TouchableRipple>
                </View>
              ))}
              <View style={styles.totalBar}>
                <Text style={styles.totalText}>
                  {scanned.length} top · {Math.round(totalQty)} m
                </Text>
              </View>
            </View>
          )}
        </Surface>

        {/* Ön-ayar kartı: Şablon + Rota + Parti Kodu (her iki modda) */}
        <Surface style={styles.card} elevation={1}>
          <Text style={styles.cardTitle}>Hızlı Başlangıç</Text>

          {/* İş Emri Şablonu */}
          <Text style={styles.label}>İş Emri Şablonu (renk/en/kat/rotayı doldurur)</Text>
          <View style={styles.rowGap}>
            <TouchableRipple
              onPress={() => setTemplatePickerOpen(true)}
              style={styles.selectFieldFlex}
              borderless
              rippleColor="rgba(79,70,229,0.12)"
            >
              <Text style={[styles.selectText, !appliedTemplate && styles.placeholder]} numberOfLines={1}>
                {appliedTemplate?.name ?? 'Şablon seç (opsiyonel)'}
              </Text>
            </TouchableRipple>
            {appliedTemplate ? (
              <TouchableRipple onPress={clearTemplate} style={styles.clearBtn} borderless>
                <Text style={styles.clearText}>Temizle</Text>
              </TouchableRipple>
            ) : null}
          </View>
          {/* Şablon özeti — dokununca tüm detay (özellik isimleri dahil) modalı açılır. */}
          {appliedTemplate ? (
            <TouchableRipple
              onPress={() => setTemplateDetailOpen(true)}
              style={styles.summaryChip}
              borderless
              rippleColor="rgba(79,70,229,0.12)"
            >
              <View style={styles.summaryInner}>
                <Icon source="information-outline" size={16} color={colors.brand} />
                <Text style={styles.summaryText} numberOfLines={2}>
                  {[
                    appliedTemplate.colorName ?? 'Renksiz / Ham',
                    appliedTemplate.width != null ? `${appliedTemplate.width} cm` : null,
                    appliedTemplate.foldType,
                    appliedTemplate.properties.length > 0 ? `${appliedTemplate.properties.length} özellik` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <Text style={styles.summaryDetailHint}>Detay</Text>
                <Icon source="chevron-right" size={16} color={colors.brand} />
              </View>
            </TouchableRipple>
          ) : null}

          {/* Rota seçili renk/özelliği uygulayamıyorsa uyarı göster */}
          {hasColorOrProps && applyMissing ? (
            <View style={styles.applyWarn}>
              <Icon source="alert" size={15} color={colors.warningDark} />
              <Text style={styles.applyWarnText}>
                Bu rotada {applyMissing} uygulayacak bir fason adımı yok. Uygun adımı içeren bir rota seçin.
              </Text>
            </View>
          ) : null}

          {/* Rota — her iki modda zorunlu */}
          <Text style={styles.label}>
            Rota Şablonu <Text style={styles.req}>*</Text>
          </Text>
          {routeChips.length > 0 ? (
            <View style={styles.chipsWrap}>
              {routeChips.map((c) => {
                const active = routeTemplateId === c.id;
                return (
                  <TouchableRipple
                    key={c.id}
                    onPress={() => chooseRoute(c.id)}
                    style={[styles.routeChip, active && styles.routeChipActive]}
                    borderless
                    rippleColor="rgba(79,70,229,0.12)"
                  >
                    <Text style={[styles.routeChipText, active && styles.routeChipTextActive]} numberOfLines={1}>
                      {c.isLast ? 'Son · ' : c.isFav ? '★ ' : ''}
                      {c.name}
                    </Text>
                  </TouchableRipple>
                );
              })}
            </View>
          ) : null}
          <View style={styles.rowGap}>
            <TouchableRipple
              onPress={() => setRoutePickerOpen(true)}
              style={styles.selectFieldFlex}
              borderless
              rippleColor="rgba(79,70,229,0.12)"
            >
              <Text style={[styles.selectText, !routeLabel && styles.placeholder]} numberOfLines={1}>
                {routeLabel ?? 'Rota seç'}
              </Text>
            </TouchableRipple>
            <IconButton
              icon="information-outline"
              size={24}
              mode="contained-tonal"
              disabled={!selectedRoute}
              onPress={() => setRouteStepsOpen(true)}
              accessibilityLabel="Rota adımlarını gör"
              style={styles.infoBtn}
            />
          </View>

          {/* İş Emri No — boş = otomatik (backend IE+GGAAYY+NNNN üretir). */}
          <Text style={styles.label}>İş Emri No</Text>
          <TextInput
            mode="outlined"
            dense
            value={header.batchNumber}
            onChangeText={(t) => setHeader((h) => ({ ...h, batchNumber: t }))}
            placeholder="Otomatik (İE-GGAAYY-NNNN) — değiştirmek için yazın"
            autoCapitalize="characters"
            style={styles.input}
          />
        </Surface>

        {/* Detay kartı */}
        <Surface style={styles.card} elevation={1}>
          <Text style={styles.cardTitle}>Detaylar</Text>
          <WorkOrderHeaderFields
            value={header}
            onChange={(p) => setHeader((h) => ({ ...h, ...p }))}
            onColorLabelResolved={setColorLabel}
            lockColorWidth={orderLineIds.length > 0}
            colorLabelOverride={orderLineIds.length > 0 ? orderColorName : null}
          />
          <OrderLinkPicker
            itemId={lockedItemId}
            value={orderLineIds}
            onChange={(ids) => {
              setOrderLineIds(ids);
              if (ids.length === 0) {
                setOrderColorName(null);
                // Sipariş kaldırıldı → ürün kilidi serbest (top varsa scanned'e düşer).
                setOrderDerivedItemId(null);
              }
            }}
            open={orderPickerOpen}
            onOpenChange={setOrderPickerOpen}
            onLinePicked={(line) => {
              // Ürünü siparişten kilitle (sipariş-önce'nin çekirdeği; E4).
              setOrderDerivedItemId(line.itemId);
              setHeader((h) => ({
                ...h,
                targetColorId: line.colorId,
                width: line.width != null ? String(line.width) : '',
              }));
              // Renk adını doğrudan order kaleminden al (gerçek colorId varsa).
              setOrderColorName(line.colorId ? (line.colorName ?? line.customerColorName ?? null) : null);
            }}
          />

          {/* Fasona Gönder — yalnız ilk rota adımı fason (boyahane) ise görünür.
              Açıkken WO ile birlikte fason sevki de yapılır + çeki listesi oluşur. */}
          {firstStepDispatch.isFason ? (
            <View style={styles.dispatchToggle}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dispatchToggleTitle}>Fasona Gönder</Text>
                <Text style={styles.dispatchToggleHint}>
                  {firstStepDispatch.firmId
                    ? 'İş emri açılınca mal fasona sevk edilir, çeki listesi oluşur. Kapatırsan yalnız planlanır.'
                    : 'Fason firma seçili değil — sevk yapılamaz, yalnız planlanır.'}
                </Text>
              </View>
              <Switch
                value={dispatchFirstStep && !!firstStepDispatch.firmId}
                onValueChange={setDispatchFirstStep}
                disabled={!firstStepDispatch.firmId}
              />
            </View>
          ) : null}
        </Surface>

        <View style={{ height: 200 }} />
      </KeyboardAwareScrollView>

      {/* Sticky başlat alanı */}
      <View style={styles.footer}>
        {submitError ? (
          <View style={styles.errorBanner}>
            <Icon source="alert-circle" size={18} color={colors.dangerDark} />
            <Text style={styles.errorBannerText}>{submitError}</Text>
          </View>
        ) : null}
        <View style={styles.footerSummary}>
          <Text style={styles.footerSummaryText} numberOfLines={2}>
            {[
              scanned.length > 0 ? `${scanned.length} top · ${Math.round(totalQty)} m` : 'Top eklenmedi',
              routeLabel ?? 'Rota seçin',
              colorLabel ?? 'Renksiz / Ham',
              header.width.trim() ? `${header.width.trim()} cm` : null,
              header.foldType ?? 'Kat tipi seçin',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <View style={styles.bottomBar}>
          {/* Okut */}
          <View style={styles.bottomBarCellSide}>
            <TouchableRipple
              onPress={() => setScannerOpen(true)}
              style={styles.bottomBarBtn}
              rippleColor="rgba(79,70,229,0.12)"
              accessibilityLabel="Top okut"
            >
              <View style={styles.bottomBarBtnInner}>
                <Icon source="barcode-scan" size={22} color={colors.brand} />
                <Text style={[styles.bottomBarBtnText, styles.bottomBarBtnTextSide]} numberOfLines={2}>
                  Okut
                </Text>
              </View>
            </TouchableRipple>
          </View>

          {/* İş Emrini Başlat — ana eylem (hero) */}
          <View style={styles.bottomBarCellPrimary}>
            <TouchableRipple
              onPress={submit}
              disabled={!canSubmit}
              style={[
                styles.bottomBarBtn,
                styles.bottomBarBtnPrimaryFill,
                !canSubmit && styles.bottomBarBtnDisabled,
              ]}
              rippleColor="rgba(255,255,255,0.25)"
              accessibilityLabel="İş emrini başlat"
            >
              <View style={styles.bottomBarBtnInner}>
                {mutation.isPending ? (
                  <ActivityIndicator size={20} color="#fff" />
                ) : (
                  <Icon source="rocket-launch" size={24} color="#fff" />
                )}
                <Text style={[styles.bottomBarBtnText, styles.bottomBarBtnTextPrimary]} numberOfLines={2}>
                  İş Emrini Başlat{scanned.length > 0 ? ` (${scanned.length})` : ''}
                </Text>
              </View>
            </TouchableRipple>
          </View>

          {/* Sipariş Bağla */}
          <View style={styles.bottomBarCellSide}>
            <TouchableRipple
              onPress={() => setOrderPickerOpen(true)}
              disabled={mutation.isPending}
              style={[styles.bottomBarBtn, mutation.isPending && styles.bottomBarBtnDisabled]}
              rippleColor="rgba(79,70,229,0.12)"
              accessibilityLabel="Sipariş bağla"
            >
              <View style={styles.bottomBarBtnInner}>
                <Icon source="link-variant" size={22} color={colors.brand} />
                <Text style={[styles.bottomBarBtnText, styles.bottomBarBtnTextSide]} numberOfLines={2}>
                  {orderLineIds.length > 0 ? `Sipariş (${orderLineIds.length})` : 'Sipariş Bağla'}
                </Text>
              </View>
            </TouchableRipple>
          </View>
        </View>
      </View>

      {/* Sürekli tarayıcı — kendi kabul/ret titreşimimiz var, yakalama haptiği kapalı. */}
      <BarcodeScannerModal
        visible={scannerOpen}
        onDismiss={() => setScannerOpen(false)}
        onScan={(b) => void handleScan(b)}
        title="Stok Topu Okut"
        continuous
        captureHaptic={false}
        barcodeTypes={['qr', 'code128']}
      />

      {/* Listeden çoklu top seç */}
      <RollPickerModal
        visible={listOpen}
        onDismiss={() => setListOpen(false)}
        multiSelect
        confirmLabel="Ekle"
        onConfirm={(rolls) => {
          addRolls(rolls);
          setListOpen(false);
        }}
        filters={{
          rollScope: 'RAW_STOCK',
          rollKind: 'WOUND_ROLL',
          ...(lockedItemId ? { itemId: lockedItemId } : {}),
        }}
        excludeIds={scanned.map((s) => s.id)}
        title="Stok Topu Seç"
        subtitle={lockedItemName ? `${lockedItemName} — serbest stok` : 'Serbest stok topları'}
        emptyText="Uygun serbest stok topu yok"
      />

      {/* Rota picker */}
      <PickerModal
        visible={routePickerOpen}
        title="Rota Şablonu Seç"
        options={routeOptions}
        selectedValue={routeTemplateId}
        loading={routesQuery.isLoading}
        onSelect={chooseRoute}
        onDismiss={() => setRoutePickerOpen(false)}
        onRefresh={() => routesQuery.refetch()}
        emptyText="Rota şablonu yok"
      />

      {/* İş Emri Şablonu picker */}
      <PickerModal
        visible={templatePickerOpen}
        title="İş Emri Şablonu Seç"
        options={templateOptions}
        selectedValue={templateId}
        loading={templatesQuery.isLoading}
        onSelect={(v) => void applyTemplate(v)}
        onDismiss={() => setTemplatePickerOpen(false)}
        onRefresh={() => templatesQuery.refetch()}
        emptyText={lockedItemName ? 'Bu ürüne uygun şablon yok' : 'Şablon yok'}
      />

      {/* İş Emri Şablonu detayı — renk/en/kat + özellik isimleri */}
      <AppModal
        visible={templateDetailOpen}
        onDismiss={() => setTemplateDetailOpen(false)}
        position="bottom"
        contentStyle={styles.detailSheet}
      >
        <View style={styles.detailHeader}>
          <Text style={styles.detailTitle} numberOfLines={1}>
            {appliedTemplate?.name ?? 'İş Emri Şablonu'}
          </Text>
          <TouchableRipple onPress={() => setTemplateDetailOpen(false)} borderless style={styles.detailCloseBtn}>
            <Icon source="close" size={24} color={colors.textSecondary} />
          </TouchableRipple>
        </View>
        <ScrollView contentContainerStyle={styles.detailBody}>
          <View style={styles.detailRow}>
            <Text style={styles.detailKey}>Renk</Text>
            <View style={styles.detailValRow}>
              {appliedTemplate?.colorHex ? (
                <View style={[styles.swatch, { backgroundColor: appliedTemplate.colorHex }]} />
              ) : null}
              <Text style={styles.detailVal}>{appliedTemplate?.colorName ?? 'Renksiz / Ham'}</Text>
            </View>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailKey}>En</Text>
            <Text style={styles.detailVal}>
              {appliedTemplate?.width != null ? `${appliedTemplate.width} cm` : '—'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailKey}>Kat Tipi</Text>
            <Text style={styles.detailVal}>{appliedTemplate?.foldType ?? '—'}</Text>
          </View>
          <Text style={styles.detailSection}>
            Üretim Özellikleri ({appliedTemplate?.properties.length ?? 0})
          </Text>
          {appliedTemplate && appliedTemplate.properties.length > 0 ? (
            appliedTemplate.properties.map((p) => (
              <View key={p.id} style={styles.propRow}>
                <Icon source="check-circle" size={16} color={colors.success} />
                <Text style={styles.propName}>{p.name}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.detailMuted}>Bu şablonda üretim özelliği yok.</Text>
          )}
          <View style={{ height: spacing.lg }} />
        </ScrollView>
      </AppModal>

      {/* Rota adımları — info ile açılır; istasyon notu + fason firma girilir */}
      <RouteStepsModal
        visible={routeStepsOpen}
        onDismiss={() => setRouteStepsOpen(false)}
        route={selectedRoute}
        editable
        notes={stepNotes}
        onChangeNote={(seq, text) => setStepNotes((prev) => ({ ...prev, [seq]: text }))}
        selectedFirmBySeq={selectedFirmBySeq}
        firmOptionsByCategory={firmOptionsByCategory}
        firmNameById={firmNameById}
        onChangeSubcontractor={(seq, firmId) =>
          setStepSubcontractors((prev) => ({ ...prev, [seq]: firmId }))
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  scroll: { padding: spacing.md, gap: spacing.md },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  clearAll: { paddingHorizontal: spacing.sm, paddingVertical: 8 },
  clearAllText: { color: colors.danger, fontWeight: '700', fontSize: 13 },

  manualRow: { marginTop: spacing.sm },
  manualInput: { backgroundColor: colors.surface },

  itemLock: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, backgroundColor: colors.brandSoft, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 8, alignSelf: 'flex-start' },
  itemLockText: { color: colors.brand, fontWeight: '700', fontSize: 13 },

  emptyScan: { color: colors.textMuted, fontSize: 13, marginTop: spacing.md, lineHeight: 18 },
  rollList: { marginTop: spacing.sm, gap: 4 },
  rollRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  rollIdx: { width: 22, textAlign: 'center', color: colors.textMuted, fontWeight: '700', fontSize: 13 },
  rollBarcode: { flex: 1, fontFamily: 'monospace', fontSize: 13, color: colors.text },
  rollQty: { fontWeight: '700', color: colors.textSecondary, fontSize: 13 },
  rollRemove: { padding: 8, borderRadius: radius.full },
  totalBar: { marginTop: spacing.sm, backgroundColor: colors.brandSoft, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
  totalText: { fontWeight: '800', color: colors.brand, fontSize: 15 },

  label: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 2 },
  req: { color: colors.danger },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selectField: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 16, backgroundColor: colors.surface },
  selectFieldFlex: { flex: 1, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 16, backgroundColor: colors.surface },
  selectText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  input: { backgroundColor: colors.surface },
  placeholder: { color: colors.textMuted, fontWeight: '400' },
  clearBtn: { paddingHorizontal: spacing.sm, paddingVertical: 12 },
  clearText: { color: colors.danger, fontWeight: '700', fontSize: 13 },

  summaryChip: { marginTop: spacing.sm, backgroundColor: colors.brandSoft, borderRadius: radius.sm },
  summaryInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 10 },
  summaryText: { flex: 1, color: colors.brand, fontWeight: '700', fontSize: 12, lineHeight: 16 },
  summaryDetailHint: { color: colors.brand, fontWeight: '800', fontSize: 12 },
  infoBtn: { margin: 0, backgroundColor: colors.brandSoft },
  applyWarn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 8 },
  applyWarnText: { flex: 1, color: colors.warningDark, fontSize: 12, fontWeight: '600', lineHeight: 16 },
  detailSheet: { backgroundColor: colors.appBg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '80%', width: '100%', overflow: 'hidden' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  detailCloseBtn: { padding: spacing.xs, borderRadius: radius.full },
  detailBody: { padding: spacing.lg },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailKey: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  detailVal: { color: colors.text, fontWeight: '700', fontSize: 14 },
  detailValRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, borderColor: colors.border },
  detailSection: { fontSize: 13, fontWeight: '800', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: spacing.lg, marginBottom: spacing.sm },
  propRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  propName: { fontSize: 14, fontWeight: '600', color: colors.text },
  detailMuted: { color: colors.textMuted, fontSize: 13, paddingVertical: spacing.sm },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2, marginBottom: 2 },
  routeChip: { paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.full, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, maxWidth: 200 },
  routeChipActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft, borderWidth: 2 },
  routeChipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  routeChipTextActive: { color: colors.brand },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.dangerContainer, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10 },
  errorBannerText: { flex: 1, color: colors.dangerText, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  footerSummary: { alignItems: 'center' },
  footerSummaryText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },

  // Alt aksiyon barı — Fason Kabul standardı: yan · ana (hero) · yan.
  bottomBar: { flexDirection: 'row', gap: spacing.sm },
  bottomBarCellSide: { flex: 3 },
  bottomBarCellPrimary: { flex: 4 },
  bottomBarBtn: {
    minHeight: 60,
    paddingVertical: 6,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  bottomBarBtnPrimaryFill: { backgroundColor: colors.brand, borderColor: colors.brand },
  bottomBarBtnDisabled: { opacity: 0.45 },
  bottomBarBtnInner: { alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  bottomBarBtnText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  bottomBarBtnTextSide: { color: colors.brand },
  bottomBarBtnTextPrimary: { color: '#fff' },

  successWrap: { flex: 1, backgroundColor: colors.appBg, justifyContent: 'center', padding: spacing.lg },
  successCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xxl, alignItems: 'center', gap: spacing.sm },
  successIcon: { marginBottom: spacing.xs },
  successTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  successBatch: { fontSize: 24, fontWeight: '800', color: colors.brand, marginTop: 2 },
  successMeta: { fontSize: 14, color: colors.textSecondary },
  successWarn: { fontSize: 13, color: colors.warningDark, fontWeight: '700' },
  successDispatch: { fontSize: 13, color: colors.brand, fontWeight: '700', marginTop: 2 },
  successBtn: { borderRadius: radius.md, alignSelf: 'stretch', marginTop: spacing.sm },
  btnContent: { height: 50 },
  // Fasona Gönder toggle satırı (Detaylar kartı).
  dispatchToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dispatchToggleTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  dispatchToggleHint: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
