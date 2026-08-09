import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, onlineManager } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import { rollService } from '../../../services/roll.service';
import { routeService } from '../../../services/route.service';
import { subcontractorService } from '../../../services/subcontractor.service';
import { workOrderService, type QuickStartRequest } from '../../../services/workOrder.service';
import { fabricPropertyService } from '../../../services/fabricProperty.service';
import { signalScan } from '../../../services/scanFeedback';
import { useScanFeedback } from '../../../hooks/useScanFeedback';
import { useSubcontractorDefault } from '../../../hooks/useSubcontractorDefault';
import type { AvailableOrderLine } from '../../../services/order.service';
import { generateClientUuid } from '../../../offline/barcode';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { ROLL_STATUS_LABEL, trLabel } from '../../../utils/labels';
import type { Roll } from '../../../types/models';
import { colors } from '../../../theme';

export interface ScannedRoll {
  id: string;
  barcode: string;
  itemId: string;
  itemName: string;
  qty: number;
  /** Topun eni — parti homojenliği uyarısı için (bkz. `widthWarning`). */
  width: number | null;
}

/** Okutma geri bildirimi ortak hook'ta (`hooks/useScanFeedback`) — Fason Sevk de
 *  aynı yüzeyi kullanıyor. Tip buradan da dışa verilir ki eski içe aktarmalar
 *  (wizard ekranları) kırılmasın. */
export type { ScanReject } from '../../../hooks/useScanFeedback';

export interface QuickWoResult {
  /**
   * İŞ EMRİ numarası (İE+GGAAYY+NNNN). Eskiden bu alan `batchNumber` adını
   * taşıyordu ama içine `workOrder.workOrderNumber` yazılıyordu — sonuç ekranı
   * "parti" sanılan bir numarayı basıyordu. İkisi AYRI kavramdır (kök CLAUDE.md
   * "İş Emri No ≠ Parti"): operatör kartta/lanede parti arayınca bulamıyordu.
   */
  workOrderNumber: string;
  /** PARTİ numarası (P+GGAAYY+NNNN) — attachRolls'ta doğar. Backend çözemezse null. */
  batchNumber: string | null;
  attached: number;
  errors: string[];
  woId: string;
  dispatch: { id: string; dispatchNo: string } | null;
  /**
   * Sonuç ekranında basılan üretim özeti — kumaş / en / top adedi / metraj.
   *
   * Değerler burada DONDURULUR, sonuç ekranı canlı forma bakmaz: "Yeni İş Emri"
   * (`resetAll`) formu temizlediği anda kart hâlâ ekrandaysa alanlar boşalırdı.
   * Kaynak sırası: backend'in kaydettiği değer > formdaki değer — kâğıda/karta
   * giden şey backend'in yazdığıdır.
   */
  itemName: string | null;
  width: number | null;
  totalQty: number;
}

const toPositiveNum = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const errMessage = (err: unknown): string => {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Bilinmeyen hata';
};

type RouteLike = { steps?: { station?: { defaultCategory?: { id: string; appliesColor?: boolean; appliesProperty?: boolean } | null } | null }[] } | null;

/** Rota hedef renk / özellik uygulayabilir mi + fason kategorileri hangileri. */
function routeApplyCaps(route: RouteLike) {
  const ids = new Set<string>();
  let color = false;
  let props = false;
  for (const s of route?.steps ?? []) {
    const cat = s.station?.defaultCategory;
    if (!cat) continue;
    ids.add(cat.id);
    if (cat.appliesColor) color = true;
    if (cat.appliesProperty) props = true;
  }
  return { fasonCategoryIds: [...ids], canApplyColor: color, canApplyProps: props };
}

/**
 * Hızlı İş Emri sihirbazının tüm durumu ve iş mantığı.
 *
 * Sunum (3 adım) `wizard/` altındaki ince bileşenlerde; burada yalnız veri +
 * kurallar var. İş Emri Şablonu (ProductRecipe) 2026-08-02'de KALDIRILDI —
 * hedef renk/en/özellik artık ya siparişten gelir ya elle seçilir.
 */
export function useQuickWorkOrder() {
  const qc = useQueryClient();
  // KİŞİSEL tercih (2026-08-09) — fason varsayılanı favori mi son seçilen mi.
  // Electron ile AYNI tercih blob'unu okur (kullanıcı iki cihazda aynı davranışı görür).
  const { pickDefault, remember: rememberFirms } = useSubcontractorDefault();
  const lastRouteTemplateId = useDeviceSettingsStore((s) => s.lastRouteTemplateId);
  const setLastRouteTemplateId = useDeviceSettingsStore((s) => s.setLastRouteTemplateId);

  // ── Toplar ────────────────────────────────────────────────────────────────
  const [scanned, setScanned] = useState<ScannedRoll[]>([]);
  /**
   * Okutulan barkod İPTAL EDİLMİŞ çıktı — teşhis paneli bununla açılır
   * (`CancelledRollSheet`). Ret listesine düşürülmez: iptal, diğer retlerden
   * farklı olarak GERİ ALINABİLİR bir durumdur ve operatörün oradan çıkacak bir
   * yolu vardır. Ret satırı olarak göstermek onu yine çıkmaza kilitlerdi.
   */
  const [cancelledScan, setCancelledScan] = useState<Roll | null>(null);
  // İdempotency anahtarı — form-oturumu kimliği. Mount'ta üretilir; timeout sonrası
  // tekrar basış aynı token'ı gönderir → backend cached WO döner (quickStart
  // replay-guard'ı attach/telafi'yi atlar). resetAll'da (yeni WO) yenilenir.
  const [clientToken, setClientToken] = useState(generateClientUuid);
  const resolvingRef = useRef(false);
  // addRolls async tarama closure'ında güncel listeyi okumak için ayna ref.
  const scannedRef = useRef<ScannedRoll[]>([]);
  useEffect(() => {
    scannedRef.current = scanned;
  }, [scanned]);

  // ── Form alanları ─────────────────────────────────────────────────────────
  const [routeTemplateId, setRouteTemplateId] = useState<string | null>(null);
  const [targetColorId, setTargetColorId] = useState<string | null>(null);
  const [width, setWidth] = useState('');
  // Sipariş kaleminden gelen en — operatör değiştirdiyse "siparişten farklı" rozeti
  // basılır. Backend AÇILIŞTA en'i kaleme karşı doğrulamaz (yalnız ürün + renk),
  // bu yüzden override serbesttir; kilit yalnız mal fasona çıktıktan SONRA doğar.
  const [orderWidth, setOrderWidth] = useState<string | null>(null);
  const [foldType, setFoldType] = useState<string | null>('2-KAT');
  // Boş bırakılırsa ve sipariş bağlıysa backend kalemlerin requiredProperties
  // birleşimini kendisi uygular (workorder.service create()) — istemci bu listeyi
  // okuyamaz (AvailableOrderLine taşımaz), o yüzden ön-doldurma YAPILMAZ; arayüz
  // bunun olacağını yazıyla söyler.
  const [targetPropertyIds, setTargetPropertyIds] = useState<string[]>([]);

  const [orderLineIds, setOrderLineIds] = useState<string[]>([]);
  // Sipariş-önce: seçilen sipariş kaleminden kilitlenen ürün (top okutulmadan da
  // WO ürününü/anchor'ı belirler). Top-önce'de de set edilir (E4: toplar silinse de
  // sipariş bağlıyken ürün kilidi kalsın).
  const [orderDerivedItemId, setOrderDerivedItemId] = useState<string | null>(null);
  const orderDerivedItemIdRef = useRef<string | null>(null);
  useEffect(() => {
    orderDerivedItemIdRef.current = orderDerivedItemId;
  }, [orderDerivedItemId]);
  // Sipariş kaleminden gelen renk adı — kilitli renk alanı + özette doğrudan göster
  // (public-dışı/müşteri-özel renkte picker'da olmayabilir).
  const [orderColorName, setOrderColorName] = useState<string | null>(null);

  // İstasyon başına not (route step sequence → not) → stepPlanning.
  const [stepNotes, setStepNotes] = useState<Record<number, string>>({});
  // Rota fason adımlarında operatör firma override'ı (sequence → firma id).
  const [stepSubcontractors, setStepSubcontractors] = useState<Record<number, string>>({});
  // "Fasona Gönder" — ilk rota adımı fason ise WO ile birlikte sevki de yap (default açık).
  const [dispatchFirstStep, setDispatchFirstStep] = useState(true);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [colorLabel, setColorLabel] = useState<string | null>(null);
  const [result, setResult] = useState<QuickWoResult | null>(null);

  const lockedItemId = orderDerivedItemId ?? scanned[0]?.itemId ?? null;
  const lockedItemName = scanned[0]?.itemName ?? null;
  const totalQty = useMemo(() => scanned.reduce((s, r) => s + r.qty, 0), [scanned]);
  const orderLinked = orderLineIds.length > 0;

  /**
   * Farklı ENDE toplar aynı iş emrine girdi mi?
   *
   * Ürün kilitli ama en DEĞİL — 180 ile 220 cm tek partiye karışabiliyordu ve
   * hiçbir yerde yazmıyordu. SAP'nin *batch characteristics* mantığı: parti,
   * önemli olan özelliklerde homojen olmalı. UYARI, engel DEĞİL — fabrika
   * bilerek karıştırıyor olabilir, karar operatörün; sessizlik ise kimsenin
   * kararı değildir.
   */
  const mixedWidths = useMemo(() => {
    const set = new Set<number>();
    for (const s of scanned) if (s.width != null) set.add(s.width);
    return set.size > 1 ? [...set].sort((a, b) => a - b) : [];
  }, [scanned]);
  const widthWarning =
    mixedWidths.length > 1 ? `Farklı en okutuldu: ${mixedWidths.join(' / ')} cm` : null;

  // ── Master data ───────────────────────────────────────────────────────────
  const routesQuery = useQuery({
    queryKey: ['routes', 'wo-picker'],
    queryFn: () => routeService.getAll({ page: 1, pageSize: 200, sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 10 * 60 * 1000,
  });

  const routeOptions = useMemo(
    () =>
      (routesQuery.data?.data ?? []).map((r) => ({
        value: r.id,
        label: r.name,
        sublabel: r.code ?? undefined,
        badge: r.isFavorite ? { text: '★', color: colors.warning } : undefined,
      })),
    [routesQuery.data],
  );

  const routeLabel = routeOptions.find((o) => o.value === routeTemplateId)?.label ?? null;
  const selectedRoute = useMemo(
    () => (routesQuery.data?.data ?? []).find((r) => r.id === routeTemplateId) ?? null,
    [routesQuery.data, routeTemplateId],
  );

  /** Rota adım şeridi ("KK1 → Boyahane → Tambur") — ⓘ açmadan ne olacağı görünsün. */
  const routeStepNames = useMemo(
    () =>
      [...(selectedRoute?.steps ?? [])]
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => s.station?.name ?? '—'),
    [selectedRoute],
  );

  // Rotanın fason kategorileri (firma ataması + sorgu için) ve uygulama yetenekleri.
  // appliesColor/Property: backend hedef renk/özellik için bu bayraklı bir adım arar —
  // sadece kategori atanmış olması yetmez (örn. "Zımpara" kategorisi rengi uygulamaz).
  const { fasonCategoryIds, canApplyColor, canApplyProps } = useMemo(
    () => routeApplyCaps(selectedRoute),
    [selectedRoute],
  );

  // Özellik kataloğu — yalnız rota özellik uygulayabiliyorsa çekilir.
  const propertiesQuery = useQuery({
    queryKey: ['fabric-properties', 'wo-picker'],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: 'name',
        sortOrder: 'asc',
        filters: { isActive: 'true' },
      }),
    enabled: canApplyProps,
    staleTime: 10 * 60 * 1000,
  });
  const propertyNameById = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of propertiesQuery.data?.data ?? []) out[p.id] = p.name;
    return out;
  }, [propertiesQuery.data]);

  // Favori fason firmaları (kategori bazında eşleşir) — adımın plannedSubcontractorId'sini
  // otomatik doldurur. Best-effort: yüklenmezse firma boş kalır (kategori atandığı için
  // renk/özellik yine uygulanır).
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
  const rawFavoriteFirmFor = useCallback(
    (categoryId: string): string | undefined => {
      const subs = subcontractorsQuery.data?.data ?? [];
      const inCat = subs.filter((s) => s.categories?.some((c) => c.categoryId === categoryId));
      if (inCat.length === 0) return undefined;
      return (inCat.find((s) => s.isFavorite) ?? inCat[0]).id;
    },
    [subcontractorsQuery.data],
  );

  /**
   * Kategorinin VARSAYILAN firması — KİŞİSEL tercihe göre (2026-08-09).
   * Tercih "favori" ise bugünkü davranış aynen korunur; "son seçilen" ise o
   * kategoride en son kullanılan firma gelir (geçmiş yoksa favoriye düşer).
   * Electron ile AYNI tercih blob'unu okur.
   */
  const favoriteFirmFor = useCallback(
    (categoryId: string): string | undefined => pickDefault(categoryId, rawFavoriteFirmFor),
    [pickDefault, rawFavoriteFirmFor],
  );

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

  // Rota değişince o rotanın UYGULAYAMADIĞI hedefleri AYNI ANDA düşür — alan
  // gizlenirken değeri arkada kalırsa backend "rotada renk veren adım yok" ile
  // 400 atar ve operatör görünmeyen bir alan yüzünden reddedilir. Temizlik efekt
  // yerine burada: efekt render SONRASI koşar, arada bir kare yanlış uyarı yanar.
  const chooseRoute = useCallback(
    (id: string | null) => {
      setRouteTemplateId(id);
      setStepNotes({}); // rota değişti → eski sequence notları geçersiz
      setStepSubcontractors({}); // rota değişti → eski firma override'ları geçersiz
      setSubmitError(null);

      const route = (routesQuery.data?.data ?? []).find((r) => r.id === id) ?? null;
      const next = routeApplyCaps(route);
      // Siparişten gelen renk düşürülemez (siparişin şartı) → uyarıya bırakılır.
      if (!next.canApplyColor && !orderLinked) setTargetColorId(null);
      if (!next.canApplyProps) setTargetPropertyIds([]);

      // Şablon hedefi (2026-08-06): rota adımlarında kayıtlı renk/özellik varsa
      // hedefi ön-doldur. Renk için SON renk veren adım kazanır (yeniden boyama),
      // özellikler birleşir. Sipariş bağlıyken renge DOKUNULMAZ — orada renk
      // siparişin şartıdır, şablon onu ezemez. Eski backend alanları hiç
      // göndermez → döngü boş geçer, davranış bugünküyle aynı kalır.
      let planColor: string | null = null;
      const planProps = new Set<string>();
      for (const s of [...(route?.steps ?? [])].sort((a, b) => a.sequence - b.sequence)) {
        if (s.plannedColorId) planColor = s.plannedColorId;
        for (const p of s.plannedProperties ?? []) planProps.add(p.propertyId);
      }
      if (planColor && next.canApplyColor && !orderLinked) setTargetColorId(planColor);
      if (planProps.size > 0 && next.canApplyProps) setTargetPropertyIds([...planProps]);
    },
    [routesQuery.data, orderLinked],
  );

  // Sipariş bağlıyken renk düşürülemez; rota onu uygulayamıyorsa operatöre rotayı
  // değiştirmesini söyle. (Özellikler seçimde temizlendiği için burada dal yok;
  // siparişten TÜRETİLEN özellikleri istemci göremez — o durumu backend reddeder
  // ve mesajı olduğu gibi gösteririz.)
  const applyMissing = targetColorId && !canApplyColor ? 'renk veren (boyahane)' : null;

  // ── Okuma geri bildirimi (kabul / mükerrer / ret) ─────────────────────────
  // Üç sonucun da AYRI sinyali var (services/scanFeedback). Mükerrer eskiden
  // tamamen sessizdi: operatör "okumadı" sanıp tekrar okutuyordu. Şerit + merkez
  // bildirim ortak hook'ta (hooks/useScanFeedback) — Fason Sevk'le aynı dil.
  const {
    rejects,
    duplicateBarcode,
    flash,
    pushRejects,
    flashDuplicate,
    dismissReject,
    reset: resetScanFeedback,
  } = useScanFeedback();

  // ── Top ekleme (tarama + liste ortak) ─────────────────────────────────────
  const addRolls = useCallback(
    (incoming: Roll[]) => {
      const prev = scannedRef.current;
      const have = new Set(prev.map((s) => s.barcode));
      // Sipariş-önce: ürün siparişten kilitli → okutulan toplar ona uymak zorunda.
      let lock = orderDerivedItemIdRef.current ?? prev[0]?.itemId ?? null;
      const additions: ScannedRoll[] = [];
      const rejected: { barcode: string; reason: string }[] = [];
      const duplicates: string[] = [];

      for (const roll of incoming) {
        if (!roll.barcode) {
          rejected.push({ barcode: '—', reason: 'Barkodsuz top eklenemez' });
          continue;
        }
        if (have.has(roll.barcode)) {
          duplicates.push(roll.barcode);
          continue;
        }
        // İPTAL EDİLMİŞ TOP = ÇIKMAZ DEĞİL (2026-08-05). Eskiden burası da düz bir
        // "Stokta değil (İptal)" satırı basıyordu. Elinde fiziksel mal olan
        // operatör için bu, sebebini söylemeyen bir duvardır ve doğaçlamaya iter —
        // sahada tam olarak öyle oldu: ikinci kayıt açıldı, ikinci etiket basıldı,
        // topun üstünde iki kimlik kaldı. Teşhis panelini aç: neden iptal edildiğini
        // gösterir ve kapsam uygunsa tek dokunuşla geri aldırır.
        if (roll.status === 'CANCELLED') {
          setCancelledScan(roll);
          continue;
        }
        if (roll.status !== 'STOCK') {
          rejected.push({
            barcode: roll.barcode,
            reason: `Stokta değil (${trLabel(ROLL_STATUS_LABEL, roll.status)})`,
          });
          continue;
        }
        if (lock && roll.itemId !== lock) {
          rejected.push({ barcode: roll.barcode, reason: 'Farklı ürün' });
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
          width: roll.width != null ? Number(roll.width) : null,
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
        signalScan('accept');
        Toast.show({
          type: 'success',
          text1: additions.length === 1 ? 'Eklendi' : `${additions.length} top eklendi`,
          text2: additions.length === 1 ? additions[0].barcode : undefined,
          visibilityTime: 900,
        });
      }
      if (rejected.length > 0) {
        pushRejects(rejected);
        Toast.show({
          type: 'error',
          text1: 'Top eklenmedi',
          text2:
            rejected.length === 1
              ? `${rejected[0].barcode} · ${rejected[0].reason}`
              : `${rejected.length} top eklenmedi: ${rejected[0].reason}`,
        });
      }
      // Mükerrer sinyali yalnız BAŞKA hiçbir şey olmadıysa — kabul/ret sinyalinin
      // üstüne binerse operatör hangi sesi duyduğunu ayırt edemez.
      if (duplicates.length > 0 && additions.length === 0 && rejected.length === 0) {
        flashDuplicate(duplicates[0]);
      }
    },
    [pushRejects, flashDuplicate],
  );

  // K-A4 fix: çözümleme sürerken gelen okuma SESSİZCE düşüyordu (yavaş ağda
  // operatör art arda okutur, kamera ✓ verir, top listeye girmez). Paketleme'deki
  // FIFO kuyruğun aynısı: meşgulken kuyruğa al, bitince sıradakini işle.
  const pendingScanQueueRef = useRef<string[]>([]);

  const handleScan = useCallback(
    async (raw: string) => {
      const barcode = raw.trim();
      if (!barcode) return;
      if (scannedRef.current.some((s) => s.barcode === barcode)) {
        // Bilinen mükerrer: ağ çağrısı YOK ama SESSİZ de değil. Eskiden hiçbir
        // şey olmuyordu ve operatör "okumadı" sanıp tekrar tekrar okutuyordu.
        flashDuplicate(barcode);
        return;
      }
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
          pushRejects([{ barcode, reason: 'Bulunamadı' }]);
          Toast.show({ type: 'error', text1: 'Top eklenmedi', text2: `${barcode} bulunamadı` });
          return;
        }
        addRolls([roll]);
      } catch {
        pushRejects([{ barcode, reason: 'Okunamadı' }]);
        Toast.show({ type: 'error', text1: 'Top eklenmedi', text2: `${barcode} okunamadı` });
      } finally {
        resolvingRef.current = false;
        const next = pendingScanQueueRef.current.shift();
        if (next) void handleScan(next);
      }
    },
    [addRolls, pushRejects, flashDuplicate],
  );

  const removeRoll = useCallback(
    (barcode: string) => setScanned((prev) => prev.filter((s) => s.barcode !== barcode)),
    [],
  );
  const clearScanned = useCallback(() => setScanned([]), []);

  // ── Sipariş bağı ──────────────────────────────────────────────────────────
  // Seçilen kalemlerin AÇIK metrajı (lineId → net açık) — tarayıcıdaki
  // "okutulan / istenen" sayacının kaynağı. Picker seçim kaldırmayı yalnız
  // `changeOrderLines` ile bildirdiği için harita orada budanır.
  const [lineTargets, setLineTargets] = useState<Record<string, number>>({});
  const orderTargetQty = useMemo(() => {
    if (orderLineIds.length === 0) return null;
    let sum = 0;
    let known = false;
    for (const id of orderLineIds) {
      const v = lineTargets[id];
      if (v != null) {
        sum += v;
        known = true;
      }
    }
    return known ? sum : null;
  }, [orderLineIds, lineTargets]);

  /** Bir kalem seçildiğinde ürün/renk/en/özellikleri siparişten doldur. */
  const applyOrderLine = useCallback((line: AvailableOrderLine) => {
    // Net açık = açık − üretimdeki (backend `withInProduction`). Yoksa ham açık —
    // picker satırı da aynı sırayı kullanıyor, iki yüzey ayrışmasın.
    const target = Number(line.netOpenQty ?? line.openQty);
    if (Number.isFinite(target) && target > 0) {
      setLineTargets((cur) => ({ ...cur, [line.lineId]: target }));
    }
    setOrderDerivedItemId(line.itemId);
    setTargetColorId(line.colorId);
    // Renk adını doğrudan order kaleminden al (gerçek colorId varsa).
    // customerColorName fallback'i bilinçli yok — etiketsiz müşteri renk adı
    // bizdeki ad sanılıyordu.
    setOrderColorName(line.colorId ? (line.colorName ?? null) : null);
    const w = line.width != null ? String(line.width) : '';
    setWidth(w);
    setOrderWidth(w || null);
  }, []);

  const changeOrderLines = useCallback((ids: string[]) => {
    setOrderLineIds(ids);
    setLineTargets((cur) => {
      const next: Record<string, number> = {};
      for (const id of ids) if (cur[id] != null) next[id] = cur[id];
      return next;
    });
    if (ids.length === 0) {
      setOrderColorName(null);
      setOrderWidth(null);
      // Sipariş kaldırıldı → ürün kilidi serbest (top varsa scanned'e düşer).
      setOrderDerivedItemId(null);
    }
  }, []);

  // ── Oluştur ───────────────────────────────────────────────────────────────
  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: (payload: QuickStartRequest) => workOrderService.quickStart(payload),
    onSuccess: (res) => {
      const data = res.data;
      if (!data) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Son kullanılan rotayı cihaza yaz (sonraki açılışta hazır gelsin).
      void setLastRouteTemplateId(routeTemplateId);
      // KİŞİSEL HAFIZA (2026-08-09): kategori → en son seçilen fason firma.
      // ⚠️ Tercih KAPALIYKEN de yazılır — anahtarı sonra çeviren kullanıcı boş
      // bir hafızayla karşılaşmasın. Rota bazlı DEĞİL kategori bazlı: aynı
      // boyahane farklı rotalarda kullanılıyor.
      rememberFirms(
        (selectedRoute?.steps ?? []).map((s) => ({
          categoryId: s.station?.defaultCategory?.id,
          firmId: selectedFirmBySeq[s.sequence] ?? undefined,
        })),
      );
      setResult({
        workOrderNumber: data.workOrder.workOrderNumber,
        batchNumber: data.batch?.batchNumber ?? null,
        attached: data.attached,
        errors: data.errors,
        woId: data.workOrder.id,
        dispatch: data.dispatch ?? null,
        itemName: data.workOrder.targetItem?.name ?? lockedItemName,
        width: data.workOrder.width ?? toPositiveNum(width),
        totalQty,
      });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['rolls'] });
      // Picker'ın staleTime'ı var; yeni WO açık miktarı ve "üretimde"yi değiştirir.
      qc.invalidateQueries({ queryKey: ['available-order-lines'] });
    },
    onError: (err: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const msg = errMessage(err);
      setSubmitError(msg);
      Toast.show({ type: 'error', text1: 'İş emri başlatılamadı', text2: msg });
    },
  });

  /** Adım geçiş / başlatma engeli — neden yoksa null. */
  const blockingReason = useMemo(() => {
    if (scanned.length === 0) return 'En az bir top okutun veya listeden seçin.';
    if (!routeTemplateId) return 'Bir rota şablonu seçmelisiniz.';
    if (!foldType) return 'Kat tipi seçmelisiniz (2-KAT veya 4-KAT).';
    if (applyMissing)
      return `Seçili rota ${applyMissing} uygulayacak bir fason adımı içermiyor. Uygun bir rota seçin.`;
    return null;
  }, [scanned.length, routeTemplateId, foldType, applyMissing]);

  const canSubmit = !blockingReason && !mutation.isPending;

  const submit = useCallback(() => {
    setSubmitError(null);
    if (!onlineManager.isOnline()) {
      const msg = 'İş emri başlatmak için bağlantı gerekli.';
      setSubmitError(msg);
      Toast.show({ type: 'error', text1: 'Çevrimdışı', text2: msg });
      return;
    }
    if (blockingReason) {
      setSubmitError(blockingReason);
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
    // Hedeflerden bağımsız: fason adımı renk uygulamasa da bir firmaya gönderilir.
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
      clientToken,
      rollBarcodes: scanned.map((s) => s.barcode),
      routeTemplateId,
      targetColorId: canApplyColor ? targetColorId : null,
      width: toPositiveNum(width),
      foldType,
      orderLineIds: orderLineIds.length ? orderLineIds : undefined,
      targetPropertyIds:
        canApplyProps && targetPropertyIds.length ? targetPropertyIds : undefined,
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
  }, [
    blockingReason,
    clientToken,
    scanned,
    routeTemplateId,
    canApplyColor,
    targetColorId,
    width,
    foldType,
    orderLineIds,
    canApplyProps,
    targetPropertyIds,
    stepNotes,
    selectedRoute,
    selectedFirmBySeq,
    lockedItemId,
    dispatchFirstStep,
    firstStepDispatch,
    mutation,
  ]);

  const resetAll = useCallback(() => {
    setScanned([]);
    resetScanFeedback();
    setLineTargets({});
    // Son rotayı koru (saha kolaylığı); gerisini temizle.
    setRouteTemplateId(lastRouteTemplateId);
    setTargetColorId(null);
    setWidth('');
    setOrderWidth(null);
    setFoldType('2-KAT');
    setTargetPropertyIds([]);
    setOrderLineIds([]);
    setOrderDerivedItemId(null);
    setStepNotes({});
    setStepSubcontractors({});
    setOrderColorName(null);
    setColorLabel(null);
    setSubmitError(null);
    setDispatchFirstStep(true);
    setResult(null);
    setClientToken(generateClientUuid()); // yeni WO oturumu → yeni token
  }, [lastRouteTemplateId, resetScanFeedback]);

  return {
    // toplar
    scanned,
    totalQty,
    lockedItemId,
    lockedItemName,
    addRolls,
    // iptalli okutma teşhisi — panel açılır, geri alınırsa top listeye girer
    cancelledScan,
    dismissCancelledScan: () => setCancelledScan(null),
    handleScan,
    removeRoll,
    clearScanned,
    // okuma geri bildirimi
    rejects,
    dismissReject,
    duplicateBarcode,
    /** Kadrajın ortasındaki bildirim (mükerrer / ret) — tarayıcıya verilir. */
    scanFlash: flash,
    mixedWidths,
    widthWarning,
    // rota
    routeTemplateId,
    routeLabel,
    routeOptions,
    routeChips,
    routesQuery,
    selectedRoute,
    routeStepNames,
    chooseRoute,
    // hedefler
    targetColorId,
    setTargetColorId,
    colorLabel,
    setColorLabel,
    orderColorName,
    width,
    setWidth,
    orderWidth,
    foldType,
    setFoldType,
    targetPropertyIds,
    setTargetPropertyIds,
    propertiesQuery,
    propertyNameById,
    canApplyColor,
    canApplyProps,
    applyMissing,
    // sipariş
    orderLineIds,
    orderLinked,
    orderTargetQty,
    changeOrderLines,
    applyOrderLine,
    // fason
    stepNotes,
    setStepNotes,
    selectedFirmBySeq,
    firmOptionsByCategory,
    firmNameById,
    setStepSubcontractors,
    firstStepDispatch,
    dispatchFirstStep,
    setDispatchFirstStep,
    // gönderim
    submitError,
    setSubmitError,
    blockingReason,
    canSubmit,
    isPending: mutation.isPending,
    submit,
    result,
    resetAll,
  };
}
