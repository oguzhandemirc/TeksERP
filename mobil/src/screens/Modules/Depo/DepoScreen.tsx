import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import {
  Text,
  TextInput,
  IconButton,
  Surface,
  ActivityIndicator,
  TouchableRipple,
  Button,
  Icon,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { SkeletonList } from '../../../components/motion';
import {
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import dayjs from 'dayjs';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import ScreenChrome from '../../../components/ScreenChrome';
import { qualityGradeService } from '../../../services/qualityGrade.service';
import { roleOfCode, gradeColor, type QualityGradeLike } from '../../../utils/qualityRole';
import RefreshButton from '../../../components/RefreshButton';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import DetailSheet, {
  CollapsibleSection,
  MutedText,
  type SummaryItem,
} from '../../../components/DetailSheet';
import RollCancelModal from '../../../components/RollCancelModal';
import { useCancelRejection } from '../../../hooks/useCancelRejection';
import CancelledRollSheet from '../../../components/CancelledRollSheet';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { useKartelaMeasurementEnabled } from '../../../hooks/useFeatureFlags';
import { useIsOnline } from '../../../offline/hooks';
import { STATION_MUT } from '../../../offline/mutations';
import { signalScan } from '../../../services/scanFeedback';
import { rollService, type RollCancelPreview } from '../../../services/roll.service';
import { kartelaService } from '../../../services/kartela.service';
import {
  swatchService,
  type SwatchListItem,
  type KartelaStockGroup,
} from '../../../services/swatch.service';
import type { Roll } from '../../../types/models';
import { ROLL_STATUS_LABEL, trLabel } from '../../../utils/labels';
import { KartelaStockReduceModal } from './KartelaStockReduceModal';
import { useScanClassifier } from '../../../hooks/useScanSeries';

const PAGE_SIZE = 50;

// =============================================================================
// Depo — depodaki ve ardından paketlenmiş tüm envanterin görünümü.
// Read-only liste + barkod scan + filtre + detay.
// =============================================================================

// Depo personeli sekmesi: Tümü (depo+ham+yarı mamul) / Depo (WAREHOUSE serbest) /
// Çuvalda (bir çuvala konmuş, sevk edilmemiş) / Ham / Yarı Mamul / Kartela (Swatch).
// Diğer sekmeler `shipmentScope:'free'` ile çuvaldakileri eler; IN_SACK sekmesi
// tam tersine yalnız çuvaldakileri gösterir.
//
// ⚠️ "Ham" ve "Yarı Mamul" AYNI statüyü (STOCK) paylaşır — ayıran şey giriş
// kaynağıdır (2026-08-27). Eskiden tek sekmeydi ve dışarıdan boyalı gelen mal
// ham kumaşla karışık görünüyordu; masaüstünde de aynı ayrım yapıldı.
// Ayrım SUNUCUDA: `rollScope=RAW_STOCK_PURE` / `SEMI_FINISHED`. Düz `status`
// süzgeci ikisini ayıramaz — negasyon jenerik filtre katmanında YOK.
type ModeFilter =
  | 'ALL' | 'WAREHOUSE' | 'IN_SACK' | 'STOCK' | 'SEMI_FINISHED' | 'SWATCH' | 'KARTELALIK';

const MODE_TABS: { key: ModeFilter; label: string; color: string }[] = [
  { key: 'ALL', label: 'Tümü', color: '#475569' },
  { key: 'WAREHOUSE', label: 'Depo', color: '#d97706' },
  { key: 'IN_SACK', label: 'Çuvalda', color: '#4338ca' },
  { key: 'STOCK', label: 'Ham', color: '#0ea5e9' },
  { key: 'SEMI_FINISHED', label: 'Yarı Mamul', color: '#0891b2' },
  { key: 'SWATCH', label: 'Kartela', color: '#7c3aed' },
  { key: 'KARTELALIK', label: 'Kartelalık', color: '#059669' },
];

/**
 * Onay modalının depo dili. Motor KK1 ile aynı; değişen yalnız SÖZCÜK — depo
 * personeli "iptal" değil "stoktan kaldırma" yapıyor ve aynı ekranda "Kayıt
 * iptal edildi" ile "top raftan düştü" farklı şeyler gibi okunuyor.
 */
const REMOVE_FROM_STOCK_COPY = {
  title: 'Topu stoktan kaldır?',
  blockedTitle: 'Bu top stoktan kaldırılamaz',
  confirm: 'Stoktan Kaldır',
  hint:
    'Yanlış etiketle stoğa girmiş top için kullan. Fire sayılmaz — kayıt iptal edilir, ' +
    'metraj fire istatistiğine YAZILMAZ.',
};

/** Rezerve topun bağlı olduğu sevkiyat aşaması — detay özetindeki "Sevkiyat" satırı. */
const SHIPMENT_SCOPE_LABEL: Record<string, string> = {
  PLANNED: 'Çuval Depo',
  DISPATCHED: 'Sevk Edildi',
  CANCELLED: 'İptal',
};

/**
 * Depo listesinin satır şekli — `Roll`'u GENİŞLETİR, kopyalamaz.
 *
 * Eskiden bağımsız bir interface'ti ve `Roll`'un iptal/etiket teşhis alanlarını
 * (`labelPrintedAt`, `cancelReason`, `canRestore`…) taşımıyordu. Satırdan açılan
 * "Stoktan Kaldır" akışı ortak `RollCancelModal`/`CancelledRollSheet`'e o alanlarla
 * gider; iki şekli ayrı tutmak, aynı topun listede ve modalda farklı şey söylemesi
 * demekti (yalnız cast'le gizlenen, derleyicinin yakalayamadığı bir ayrışma).
 */
interface RollListItem extends Roll {
  /** Liste sorgusundan gelen varyant — `Roll` tipinde yok. */
  variantId: string | null;
  variant?: { id: string; code: string; name: string } | null;
}

export default function DepoScreen() {
  // Barkod türü SUNUCU TABLOSUNDAN — ön ek tablette sabit değil.
  const { classifyOrAsk } = useScanClassifier();

  const device = useDeviceType();
  const isPhone = device === 'phone';
  useLandscapeLock(!isPhone); // tablet yatay
  const [mode, setMode] = useState<ModeFilter>('ALL');
  const [search, setSearch] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [detailRoll, setDetailRoll] = useState<RollListItem | null>(null);
  const [detailSwatch, setDetailSwatch] = useState<SwatchListItem | null>(null);
  const [reduceGroup, setReduceGroup] = useState<KartelaStockGroup | null>(null);
  const handleRollDetailDismiss = useCallback(() => setDetailRoll(null), []);
  const handleSwatchDetailDismiss = useCallback(() => setDetailSwatch(null), []);

  // ── STOKTAN KALDIRMA (top iptali) ────────────────────────────────────────
  // Yanlış etiketle stoğa girmiş top çoğu zaman burada, kâğıt okutulurken fark
  // edilir. Motor KK1'inkiyle AYNI (`DELETE /rolls/:id` + ortak onay modalı);
  // burada yalnız giriş kapısı var.
  const qc = useQueryClient();
  const isOnline = useIsOnline();
  const [cancelTarget, setCancelTarget] = useState<RollListItem | null>(null);
  // Sunucu "sebep zorunlu" reddi (400 CANCEL_REASON_REQUIRED) → modal aynı top için yeniden açılır.
  const cancelRejection = useCancelRejection<RollListItem>();
  /** Okutulan barkod iptalli çıktı → teşhis + geri alma paneli. */
  const [cancelledRoll, setCancelledRoll] = useState<Roll | null>(null);

  const isSwatchMode = mode === 'SWATCH';
  const isKartelalikMode = mode === 'KARTELALIK';

  // Arama backend'de filtreleniyor. Her tuşa basıldığında istek atmamak için
  // 300ms debounce — input anında doldurulur (controlled), ama queryKey sadece
  // kullanıcı yazmayı bıraktığında değişir. (Tambur/FasonSevk ile aynı pattern.)
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  // Min 3 karakter kapısı: 1-2 harflik arama 500k satırda geniş `itemId IN`
  // kümesi + ağır stats taraması üretir, faydası yok. Barkod metni (T...,
  // KRT...) zaten 3+ karakterdir → tam-eşleşme aramasını engellemez. <3 → arama
  // yok sayılır (queryKey'de de '' olduğu için "a"/"ab"/"" aynı sorguya düşer).
  const effectiveSearch = debouncedSearch.length >= 3 ? debouncedSearch : '';

  // Roll listesi — status filtresi mode'a göre belirlenir. SWATCH modunda
  // bu query enabled=false (kartela ayrı endpoint).
  // ALL sekmesi depo karakterli tüm statüleri kapsar: WAREHOUSE (Tambur sonrası),
  // A1_STOCK (2. kalite satılabilir), STOCK (ham + yarı mamul — statü ikisini de
  // taşır, "Tümü"de ayrım GEREKMEZ, ayrı sekmeler zaten var).
  // includeFire=true olmadan backend FIRE kaliteleri sessizce gizler.
  const rollsFilters = useMemo<Record<string, string | string[]>>(() => {
    // Çuvalda sekmesi: bir çuvala konmuş (sackId dolu) + sevk edilmemiş toplar
    // (rollScope=IN_SACK). shipmentScope:'free' BİLİNÇLİ verilmez — o, çuvallanmış
    // topları elerdi (çelişki). status:'ALL' → varsayılan STOCK süzgeci devre dışı.
    if (mode === 'IN_SACK') {
      return { includeFire: 'true', rollScope: 'IN_SACK', status: 'ALL' };
    }
    const f: Record<string, string | string[]> = { includeFire: 'true' };
    if (mode === 'ALL') {
      // Tümü = TÜM envanter (serbest + çuvaldaki). shipmentScope BİLİNÇLİ verilmez →
      // çuvallanmış toplar da listelenir; satırdaki çuval rozetiyle ayrışırlar.
      f.statusIn = ['WAREHOUSE', 'A1_STOCK', 'STOCK'];
    } else {
      // Depo/Ham/Kartelalık = yalnız SERBEST stok. shipmentScope:'free' çuvallanmış
      // (çuvala/sevkiyata okutulmuş) topları eler → çuvaldakiler "Çuvalda" sekmesinde/"Tümü"de.
      f.shipmentScope = 'free';
      if (mode === 'WAREHOUSE') f.status = 'WAREHOUSE';
      // ⚠️ `status:'STOCK'` DEĞİL: o, yarı mamulü de kapsar. İki dar kapsam
      // sunucuda yaşıyor; `status:'ALL'` varsayılan STOCK süzgecini kaldırır.
      else if (mode === 'STOCK') { f.rollScope = 'RAW_STOCK_PURE'; f.status = 'ALL'; }
      else if (mode === 'SEMI_FINISHED') { f.rollScope = 'SEMI_FINISHED'; f.status = 'ALL'; }
      else if (mode === 'KARTELALIK') {
        f.statusIn = ['WAREHOUSE', 'A1_STOCK', 'STOCK'];
        f.markedForKartela = 'true';
      }
    }
    return f;
  }, [mode]);

  // Liste — cursor-mode infinite scroll. mode/search değiştiğinde queryKey
  // değişir → useInfiniteQuery state'i sıfırlar (ilk sayfa).
  const rollsQuery = useInfiniteQuery({
    queryKey: ['rolls', 'depo', mode, effectiveSearch] as const,
    queryFn: ({ pageParam }) =>
      rollService.getAllCursor({
        limit: PAGE_SIZE,
        cursor: pageParam,
        filters: rollsFilters,
        search: effectiveSearch || undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.nextCursor : null,
    enabled: !isSwatchMode,
    staleTime: 30 * 1000,
  });

  // Stats — TÜM filtreye uyan rolların aggregate'i (sayfaya bağlı değil).
  // Liste ile aynı filtre seti, ayrı endpoint.
  // Kalite kataloğu — top rozetleri "bu kalite 2. kalite mi / fire mi" sorusunu
  // sorar ve cevabı KATALOGDADIR (karar ①). ⚠️ Bu ekran kataloğu HİÇ
  // yüklemiyordu; o yüzden soruyu ancak gömülü `=== 'A1'` / `=== 'FIRE'`
  // literalleriyle cevaplayabiliyordu ve kataloğu `2K/HURDA` olan bir fabrikada
  // HİÇBİR top rozet almazdı. Anahtar diğer ekranlarla AYNI ⇒ react-query
  // tekilleştirir, maliyet paylaşılan tek fetch.
  const gradesQuery = useQuery({
    queryKey: ['quality-grades', 'active'],
    queryFn: () => qualityGradeService.list({ pageSize: 100 }),
    staleTime: 10 * 60 * 1000,
  });
  const grades = gradesQuery.data?.data ?? [];

  const rollStatsQuery = useQuery({
    queryKey: ['rolls', 'depo', 'stats', mode, effectiveSearch] as const,
    queryFn: () =>
      rollService.getStats({
        search: effectiveSearch || undefined,
        filters: rollsFilters,
      }),
    enabled: !isSwatchMode,
    staleTime: 30 * 1000,
  });

  // Depo kapsam sayaçları — çuvallanmış (serbest stoktan düşen) malın görünürlüğü.
  const scopeQuery = useQuery({
    queryKey: ['rolls', 'warehouse-scope'] as const,
    queryFn: () => rollService.getWarehouseScope(),
    enabled: !isSwatchMode,
    staleTime: 30 * 1000,
  });
  // Çuvallanmış (pool) + planlı sevkiyat — serbest stoktan düşen ama bina içindeki
  // mal. "Serbest + Çuvalda" toplamı fiziksel depoyla tutsun.
  const committedCount =
    (scopeQuery.data?.data?.pool?.count ?? 0) +
    (scopeQuery.data?.data?.planned?.count ?? 0);

  // Kartela = ADET bazlı: ürün+renk grubu → müsait adet ("depoda kaç tane var").
  // Sahada etiketsiz/okutulmadığından tek-tek liste yerine gruplu stok gösterilir.
  // Düşük kardinalite (ürün×renk kombinasyonu) → cursor/infinite gerekmez.
  const kartelaStockQuery = useQuery({
    queryKey: ['kartela', 'stock', effectiveSearch] as const,
    queryFn: () => swatchService.getStock(effectiveSearch || undefined),
    enabled: isSwatchMode,
    staleTime: 30 * 1000,
  });

  const rolls = useMemo(
    () =>
      (rollsQuery.data?.pages.flatMap((p) => p.data) ?? []) as RollListItem[],
    [rollsQuery.data]
  );
  const kartelaGroups = useMemo(
    () => kartelaStockQuery.data?.data ?? [],
    [kartelaStockQuery.data]
  );
  const kartelaTotal = useMemo(
    () => kartelaGroups.reduce((sum, g) => sum + g.count, 0),
    [kartelaGroups]
  );

  // Stats artık API'den — tüm DB üzerinden hesaplanır, sayfaya bağlı değil.
  const rs = rollStatsQuery.data?.data;
  const rollStats = {
    count: rs?.totalCount ?? 0,
    totalQty: rs?.totalQty ?? 0,
    warehouse: rs?.byStatus?.WAREHOUSE ?? 0,
    stock: rs?.byStatus?.STOCK ?? 0,
    a1Quality: rs?.byQuality?.A1 ?? 0,
    fireQuality: rs?.byQuality?.FIRE ?? 0,
  };

  // Scanner kapanma animasyonu BİTMEDEN detail modal açılırsa RNModal overlay'i
  // tıklamaları yutuyor ve ekran kullanılamaz hale geliyor (BarcodeScannerModal
  // dosyasındaki uyarı). Bu yüzden taranan barkodun sonucunu buraya yazıp,
  // scanner.onModalHide'da detail modal'ı açıyoruz.
  const pendingDetailRef = useRef<
    | { kind: 'roll'; data: RollListItem }
    | { kind: 'cancelled'; data: Roll }
    | { kind: 'swatch'; data: SwatchListItem }
    | null
  >(null);

  const handleBarcodeScanned = async (raw: string) => {
    const barcode = raw.trim();
    if (!barcode) {
      setScannerOpen(false);
      return;
    }
    // Sekme = listeleme bağlamı; barkod okutma = nokta sorgu, sekmeden bağımsız.
    // Tür SUNUCU TABLOSUNDAN çözülür (ön ek tablette sabit değil): kartela →
    // kartela detayı, kalan her şey top yolu. Operatör Tümü sekmesindeyken
    // kartela barkodu okutursa da kartela detayı açılır.
    // ⚠️ Burada sınıflandırma İKİ FARKLI SORGUYU seçiyor, bu yüzden tanınmayan
    // kod yerel tabloyla TAHMİN EDİLMEZ: `classifyOrAsk` bir kez sunucuya sorar
    // (emekliye ayrılmış ön ek bu yoldan çözülür). Sunucu da çözemezse bugünkü
    // varsayılan yol (top sorgusu) sürer ve sonuç yine net bir RET olur.
    const isSwatchBarcode = (await classifyOrAsk(barcode)).kind === 'SWATCH';
    try {
      if (isSwatchBarcode) {
        const res = await swatchService.getByBarcode(barcode);
        const s = res.data;
        if (!s) {
          signalScan('reject');
          Toast.show({ type: 'error', text1: 'Kartela bulunamadı', text2: barcode });
        } else {
          signalScan('accept');
          pendingDetailRef.current = {
            kind: 'swatch',
            data: s as unknown as SwatchListItem,
          };
        }
      } else {
        const res = await rollService.getByBarcode(barcode);
        const r = res.data;
        if (!r) {
          signalScan('reject');
          Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: barcode });
        } else if (r.status === 'CANCELLED') {
          // İptalli barkod düz detay olarak açılırsa ekran yalnız "İptal" yazıp
          // SUSAR — 2026-08-05'te operatörü ikinci bir kayıt açmaya iten sessizlik
          // tam buydu. Teşhis paneli kimin/neden iptal ettiğini söyler ve
          // (kapsamdaysa) geri alma yolunu verir.
          // Sinyal `reject`: top KABUL EDİLMEDİ (depo işine giremez); sözleşmede
          // dördüncü bir "uyarı" sonucu yok, "kabul edilmedi" sınıfının tamamı ret.
          signalScan('reject');
          pendingDetailRef.current = { kind: 'cancelled', data: r };
        } else {
          signalScan('accept');
          pendingDetailRef.current = { kind: 'roll', data: r as RollListItem };
        }
      }
    } catch (err) {
      // Sorgu düştüğünde de sonuç RET'tir: eskiden bu dal tek sessiz yoldu ve
      // operatör "okumadı" sanıp aynı topu tekrar okutuyordu.
      signalScan('reject');
      Toast.show({
        type: 'error',
        text1: 'Sorgulanamadı',
        text2: (err as Error).message,
      });
    }
    setScannerOpen(false);
  };

  const handleScannerHidden = useCallback(() => {
    const pending = pendingDetailRef.current;
    if (!pending) return;
    pendingDetailRef.current = null;
    if (pending.kind === 'roll') setDetailRoll(pending.data);
    else if (pending.kind === 'cancelled') setCancelledRoll(pending.data);
    else setDetailSwatch(pending.data);
  }, []);

  // İptal önizlemesi — hedef seçilince koşar. Ekran ile uç AYNI yüklemi görsün
  // diye karar backend'den gelir (`canCancel`/`requiresConfirm`/`labelPrinted`);
  // istemci kendi kuralını kurarsa buton çizilir, uç 409 verir. staleTime 0:
  // top bu arada bir istasyona okutulmuş olabilir.
  const cancelPreviewQuery = useQuery({
    queryKey: ['rolls', 'cancel-preview', cancelTarget?.id] as const,
    queryFn: () => rollService.getCancelPreview(cancelTarget!.id),
    enabled: !!cancelTarget && isOnline,
    staleTime: 0,
    gcTime: 0,
  });
  const cancelPreview: RollCancelPreview | null = cancelPreviewQuery.data?.data ?? null;

  // ⚠️ mutationKey KK1 ile ORTAK ve adı bilerek değiştirilmedi: anahtar diske
  // persist ediliyor (offline kuyruk) — yeniden adlandırmak, güncelleme anında
  // kuyrukta bekleyen iptalleri sahipsiz bırakırdı. İşlem zaten aynı: aynı uç,
  // aynı payload, aynı guard'lar; ölü mektup etiketi de jenerik ("Top iptali").
  const cancelMutation = useMutation<
    Awaited<ReturnType<typeof rollService.scrap>>,
    Error,
    // ⚠️ `confirmLabelPrinted` AÇIKÇA taşınır — sebep 2026-08-06'da opsiyonel
    // oldu, "sebep varsa onay da vardır" çıkarımı artık geçersiz.
    { id: string; confirmActive: boolean; confirmLabelPrinted?: boolean; reason?: string }
  >({
    mutationKey: STATION_MUT.KK1_SCRAP,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Toast.show({
        type: 'success',
        text1: 'Top stoktan kaldırıldı',
        text2: isOnline ? undefined : 'Çevrimdışı — sync bekliyor',
      });
    },
    onError: (err, vars) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      // Sebep zorunlu reddi toast DEĞİL modal: operatör sebebi orada seçer, aynı top yeniden gönderilir.
      const reopen = cancelRejection.catchRejection(err, vars.id);
      if (reopen) {
        setCancelTarget(reopen);
        return;
      }
      Toast.show({ type: 'error', text1: 'Kaldırılamadı', text2: err.message });
    },
    // Optimistic satır düşürme YOK (KK1'den bilinçli fark): burada liste
    // sunucudan sayfalanıyor ve üstteki sayaçlar ayrı bir aggregate ucundan
    // geliyor. Satırı elle düşürmek sayaçlarla listeyi ayrıştırırdı; tam
    // invalidate ikisini birlikte tazeler.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['rolls', 'depo'] });
      qc.invalidateQueries({ queryKey: ['rolls', 'warehouse-scope'] });
    },
  });

  /**
   * Detay sheet'inden "Stoktan Kaldır" — detay kapanır, onay açılır.
   *
   * Scanner'daki `onModalHide` sırasına gerek YOK: o tuzak RN `Modal`'a özgüdür
   * (kapanan overlay dokunmaları yutuyordu), `AppModal` ise Paper `Portal`
   * kullanır ve `detailRoll` null olunca zaten anında unmount olur — bekleyecek
   * bir kapanış animasyonu, dolayısıyla bir `onHidden` de yoktur.
   */
  const requestCancel = useCallback((roll: RollListItem) => {
    setDetailRoll(null);
    setCancelTarget(roll);
  }, []);

  const confirmCancel = useCallback(
    (reason?: string) => {
      if (!cancelTarget) return;
      // Hard-block'ta hiç gönderme (buton zaten çizilmiyor; ikinci hat).
      if (cancelPreview && !cancelPreview.canCancel) return;
      cancelRejection.arm(cancelTarget);
      cancelMutation.mutate({
        id: cancelTarget.id,
        confirmActive: cancelPreview?.requiresConfirm ?? false,
        // "Kâğıdı söktüm" beyanı: modalın uyarıyı gösterme koşuluyla AYNI
        // önizleme alanından türer (sebep artık opsiyonel — ondan çıkarılamaz).
        confirmLabelPrinted: cancelPreview?.labelPrinted ?? false,
        reason,
      });
      setCancelTarget(null);
    },
    [cancelTarget, cancelPreview, cancelMutation, cancelRejection],
  );

  const listLoading = isSwatchMode ? kartelaStockQuery.isLoading : rollsQuery.isLoading;
  const refresh = useManualRefresh(
    isSwatchMode
      ? [() => kartelaStockQuery.refetch()]
      : [() => rollsQuery.refetch(), () => rollStatsQuery.refetch()],
    isSwatchMode ? 'Kartela envanteri güncellendi' : 'Depo güncellendi',
  );

  const renderStats = () => {
    if (isSwatchMode) {
      return (
        <>
          <StatBox label="Toplam Kartela" value={kartelaTotal} color="#7c3aed" />
          <View style={styles.statDivider} />
          <StatBox label="Çeşit" value={kartelaGroups.length} color="#0f172a" />
        </>
      );
    }
    // Çuvalda sekmesi: hepsi zaten çuvalda → "Serbest/Çuvalda/Ham" status kutuları
    // bu bağlamda yanıltıcı. Yalnız sekmeye göre süzülmüş, tek-anlamlı sayaçlar.
    if (mode === 'IN_SACK') {
      return (
        <>
          <StatBox label="Çuvaldaki Top" value={rollStats.count} color="#4338ca" />
          <View style={styles.statDivider} />
          <StatBox
            label={isPhone ? 'Metre' : 'Toplam Metre'}
            value={`${rollStats.totalQty.toFixed(0)} m`}
            color="#0f172a"
          />
          <View style={styles.statDivider} />
          <StatBox label="A1" value={rollStats.a1Quality} color="#7c3aed" />
          <View style={styles.statDivider} />
          <StatBox label="Fire" value={rollStats.fireQuality} color="#ef4444" />
        </>
      );
    }
    return (
      <>
        <StatBox
          label={isPhone ? 'Toplam Top' : 'Toplam Top'}
          value={rollStats.count}
          color="#0f172a"
        />
        <View style={styles.statDivider} />
        <StatBox
          label={isPhone ? 'Metre' : 'Toplam Metre'}
          value={`${rollStats.totalQty.toFixed(0)} m`}
          color="#0f172a"
        />
        <View style={styles.statDivider} />
        {/* Tümü sekmesi artık çuvaldakileri de listeler → "Serbest" gerçek serbest
            (sackId=null) sayaçtan gelmeli; byStatus.WAREHOUSE çuvaldaki WAREHOUSE'ı da
            sayar ve Çuvalda ile çift-sayım olurdu. Diğer sekmelerde eski davranış. */}
        <StatBox
          label="Serbest"
          value={mode === 'ALL' ? (scopeQuery.data?.data?.free?.count ?? 0) : rollStats.warehouse}
          color="#d97706"
        />
        <View style={styles.statDivider} />
        <StatBox label="Çuvalda" value={committedCount} color="#4338ca" />
        <View style={styles.statDivider} />
        <StatBox label="Ham" value={rollStats.stock} color="#0ea5e9" />
        <View style={styles.statDivider} />
        <StatBox label="A1" value={rollStats.a1Quality} color="#7c3aed" />
        <View style={styles.statDivider} />
        <StatBox label="Fire" value={rollStats.fireQuality} color="#ef4444" />
      </>
    );
  };

  return (
    <ScreenChrome
      title="Depo"
      headerExtras={
        <RefreshButton
          headerStyle
          label="Yenile"
          onPress={refresh.onRefresh}
          refreshing={refresh.refreshing}
          isError={refresh.isError}
          errorMessage={refresh.errorMessage}
          successMessage={refresh.successMessage}
        />
      }
    >
      <View style={styles.container}>
        {/* Üst — istatistik özet (mode'a göre içerik değişir) */}
        {isPhone ? (
          <Surface style={styles.statsCardPhone} elevation={1}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.statsScrollContent}
            >
              {renderStats()}
            </ScrollView>
          </Surface>
        ) : (
          <Surface style={styles.statsCard} elevation={1}>
            {renderStats()}
          </Surface>
        )}

        {/* Üst — kamera + arama */}
        <Surface style={styles.toolbar} elevation={1}>
          <View style={styles.toolbarRow}>
            <TouchableRipple
              borderless
              onPress={() => setScannerOpen(true)}
              style={styles.scanButton}
            >
              <View style={styles.scanButtonInner}>
                <Icon source="qrcode-scan" size={22} color="#fff" />
                <Text style={styles.scanButtonText}>
                  {isPhone ? 'Okut' : isSwatchMode ? 'Kartela Okut' : 'Barkod Okut'}
                </Text>
              </View>
            </TouchableRipple>
            <TextInput
              mode="outlined"
              value={search}
              onChangeText={setSearch}
              placeholder={
                isPhone
                  ? isSwatchMode
                    ? 'Kartela ara'
                    : 'Kumaş ara'
                  : isSwatchMode
                    ? 'Kumaş / renk ara...'
                    : 'Kumaş adı/kodu ara...'
              }
              style={[styles.input, styles.inputRow]}
              dense
              left={<TextInput.Icon icon="magnify" />}
            />
          </View>

          {/* Mode tab'ları */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.statusTabs}
          >
            {MODE_TABS.map((t) => {
              const active = mode === t.key;
              return (
                <TouchableRipple
                  key={t.key}
                  borderless
                  onPress={() => setMode(t.key)}
                  style={[
                    styles.statusChip,
                    active && {
                      backgroundColor: t.color,
                      borderColor: t.color,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusChipText,
                      active && { color: '#fff' },
                    ]}
                  >
                    {t.label}
                  </Text>
                </TouchableRipple>
              );
            })}
          </ScrollView>
        </Surface>

        {/* Liste */}
        <View style={{ flex: 1 }}>
          {listLoading ? (
            <SkeletonList count={8} />
          ) : isSwatchMode ? (
            kartelaGroups.length === 0 ? (
              <View style={styles.empty}>
                <Icon source="card-text-outline" size={56} color="#cbd5e1" />
                <Text style={styles.emptyText}>Kartela stoğu yok</Text>
                <Text style={styles.emptyHint}>
                  {search ? `'${search}' için sonuç yok` : 'Depoda kartela bulunmuyor'}
                </Text>
              </View>
            ) : (
              <FlashList
                data={kartelaGroups}
                keyExtractor={(g) => `${g.itemId}__${g.colorId ?? 'none'}`}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
                  <KartelaGroupRow group={item} onPress={() => setReduceGroup(item)} />
                )}
              />
            )
          ) : rolls.length === 0 ? (
            <View style={styles.empty}>
              <Icon source="package-variant-closed" size={56} color="#cbd5e1" />
              <Text style={styles.emptyText}>Kayıt yok</Text>
              <Text style={styles.emptyHint}>
                {search ? `'${search}' için sonuç yok` : 'Filtreyi değiştirin'}
              </Text>
            </View>
          ) : (
            <FlashList
              data={rolls}
              keyExtractor={(r) => r.id}
              contentContainerStyle={styles.listContent}
              onEndReached={() => {
                if (rollsQuery.hasNextPage && !rollsQuery.isFetchingNextPage) {
                  rollsQuery.fetchNextPage();
                }
              }}
              onEndReachedThreshold={0.4}
              ListFooterComponent={
                rollsQuery.isFetchingNextPage ? (
                  <View style={styles.footerLoader}>
                    <ActivityIndicator size="small" color="#475569" />
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <RollListRow grades={grades} roll={item} onPress={() => setDetailRoll(item)} />
              )}
            />
          )}
        </View>
      </View>

      {/* Kamera barkod tarayıcı */}
      <BarcodeScannerModal
        visible={scannerOpen}
        onDismiss={() => setScannerOpen(false)}
        onScan={handleBarcodeScanned}
        onModalHide={handleScannerHidden}
        title={isSwatchMode ? 'Kartela Barkodu Okut' : 'Top Barkodu Okut'}
      />

      {/* Detay modal — yalnızca seçili top varken mount: hook'lar/query'ler boşa çalışmasın */}
      {detailRoll && (
        <RollDetailModal
          roll={detailRoll}
          onDismiss={handleRollDetailDismiss}
          onRemoveFromStock={requestCancel}
        />
      )}
      {detailSwatch && (
        <SwatchDetailModal swatch={detailSwatch} onDismiss={handleSwatchDetailDismiss} />
      )}

      {/* Stoktan kaldırma onayı — KK1 "Sil" ile ORTAK bileşen (aynı uç, aynı guard'lar) */}
      <RollCancelModal
        roll={cancelTarget}
        preview={cancelPreview}
        previewLoading={cancelPreviewQuery.isLoading}
        previewError={cancelPreviewQuery.isError ? (cancelPreviewQuery.error as Error) : null}
        offline={!isOnline}
        loading={cancelMutation.isPending}
        submitError={cancelRejection.messageFor(cancelTarget?.id)}
        onDismiss={() => {
          setCancelTarget(null);
          cancelRejection.clear();
        }}
        onConfirm={confirmCancel}
        copy={REMOVE_FROM_STOCK_COPY}
      />

      {/* Okutulan barkod iptalli — teşhis + (kapsamdaysa) geri alma */}
      <CancelledRollSheet
        roll={cancelledRoll}
        onDismiss={() => setCancelledRoll(null)}
        onRestored={() => {
          setCancelledRoll(null);
          qc.invalidateQueries({ queryKey: ['rolls', 'depo'] });
          qc.invalidateQueries({ queryKey: ['rolls', 'warehouse-scope'] });
        }}
      />

      {/* Kartela stoğunu elle düşürme — kayıp/hasar/sayım düzeltmesi */}
      <KartelaStockReduceModal
        visible={!!reduceGroup}
        group={reduceGroup}
        onDismiss={() => setReduceGroup(null)}
        onReduced={() => {
          void kartelaStockQuery.refetch();
        }}
      />
    </ScreenChrome>
  );
}

// =============================================================================
function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function RollListRow({
  grades,
  roll,
  onPress,
}: {
  /** Kalite kataloğu — rozet kararı ve rengi buradan (aşağıdaki nota bak).
   *  Prop, context DEĞİL: bu dosyada context emsali yok ve tek ekran için
   *  context makinesi ağır; zincir tek kademe. */
  grades: readonly QualityGradeLike[];
  roll: RollListItem;
  onPress: () => void;
}) {
  return (
    <Surface style={styles.rollCard} elevation={1}>
      <TouchableRipple borderless onPress={onPress} style={{ borderRadius: 10 }}>
        <View style={styles.rollInner}>
          <View style={{ flex: 1 }}>
            <View style={styles.rollHeader}>
              <Text style={styles.rollBarcode} numberOfLines={1}>
                {roll.barcode}
              </Text>
              <View
                style={[
                  styles.statusPill,
                  roll.status === 'WAREHOUSE' && styles.statusPillWarehouse,
                  roll.status === 'A1_STOCK' && styles.statusPillA1Stock,
                ]}
              >
                <Text style={styles.statusPillText}>
                  {trLabel(ROLL_STATUS_LABEL, roll.status)}
                </Text>
              </View>
              {/* ROZET ROLDEN, KODDAN DEĞİL (karar ①). Bugünkü davranış birebir:
                  yalnız 2. kalite ve fire rozet alır — ROLSÜZ bir kademe (ör.
                  dört kademeli katalogun dördüncüsü) eskiden de rozetsizdi.
                  Rozet METNİ fabrikanın KENDİ kodudur; rengi katalogtan gelir,
                  yoksa bugünkü sabit renklere düşer. */}
              {(() => {
                const role = roleOfCode(grades, roll.qualityGrade);
                if (role !== 'SECOND' && role !== 'SCRAP') return null;
                const katalogRengi = gradeColor(grades, roll.qualityGrade);
                return (
                  <View
                    style={[
                      styles.statusPill,
                      role === 'SCRAP' ? styles.statusPillFire : styles.statusPillA1,
                      katalogRengi ? { backgroundColor: katalogRengi } : null,
                    ]}
                  >
                    <Text style={styles.statusPillText}>{roll.qualityGrade}</Text>
                  </View>
                );
              })()}
              {roll.markedForKartela && (
                <View style={[styles.statusPill, styles.statusPillKartela]}>
                  <Text style={styles.statusPillKartelaText}>Kartelalık</Text>
                </View>
              )}
              {/* Çuvaldaki top — hangi çuvalda olduğunu göster (yalnız IN_SACK
                  sekmesinde dolu gelir; diğer sekmeler shipmentScope:free ile eler). */}
              {roll.sackId && (
                <View style={[styles.statusPill, styles.statusPillSack]}>
                  <Text style={styles.statusPillSackText}>
                    {roll.sack?.sackNo ?? 'Çuvalda'}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.rollMeta}>
              {roll.color?.hex && (
                <View
                  style={[styles.rollSwatch, { backgroundColor: roll.color.hex }]}
                />
              )}
              <Text
                style={[styles.rollMetaText, styles.rollMetaName]}
                numberOfLines={1}
              >
                {roll.item?.name ?? '—'}
                {roll.color?.name ? ` · ${roll.color.name}` : ''}
              </Text>
              <Text style={styles.rollMetaSep}>·</Text>
              <Text style={styles.rollMetaText}>{roll.qualityGrade}</Text>
              {roll.width != null && (
                <>
                  <Text style={styles.rollMetaSep}>·</Text>
                  <Text style={styles.rollMetaText}>{roll.width} cm</Text>
                </>
              )}
              <Text style={styles.rollMetaSep}>·</Text>
              <Text style={styles.rollMetaText}>
                {Number(roll.currentQty ?? 0).toFixed(1)} m
              </Text>
            </View>
          </View>
          <Icon source="chevron-right" size={22} color="#94a3b8" />
        </View>
      </TouchableRipple>
    </Surface>
  );
}

// Kartela stok satırı — ADET bazlı (ürün+renk → kaç adet). Dokununca elle
// düşürme sheet'i açılır (tek-tek kartela detayına inilmez — fungible adet).
function KartelaGroupRow({
  group,
  onPress,
}: {
  group: KartelaStockGroup;
  onPress: () => void;
}) {
  return (
    <Surface style={styles.rollCard} elevation={1}>
      <TouchableRipple borderless onPress={onPress} style={{ borderRadius: 10 }}>
        <View style={styles.rollInner}>
          {group.colorHex ? (
            <View style={[styles.rollSwatch, { backgroundColor: group.colorHex }]} />
          ) : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.kartelaItem} numberOfLines={1}>
              {group.itemName}
            </Text>
            <Text style={styles.kartelaColor} numberOfLines={1}>
              {group.colorName ?? 'Renksiz'}
              {group.itemCode ? ` · ${group.itemCode}` : ''}
            </Text>
          </View>
          <View style={styles.kartelaCountBox}>
            <Text style={styles.kartelaCountValue}>{group.count}</Text>
            <Text style={styles.kartelaCountUnit}>adet</Text>
          </View>
          <Icon source="chevron-right" size={22} color="#94a3b8" />
        </View>
      </TouchableRipple>
    </Surface>
  );
}

function SwatchDetailModal({
  swatch,
  onDismiss,
}: {
  swatch: SwatchListItem;
  onDismiss: () => void;
}) {
  const measureEnabled = useKartelaMeasurementEnabled();
  const summary: SummaryItem[] = [
    { icon: 'barcode', label: 'Barkod', value: swatch.barcode, monospaceValue: true },
    // Ölçüler yalnız flag açıkken ve dolu ise (kartela esasen ADET sayılır).
    ...(measureEnabled && swatch.length != null
      ? [{ icon: 'ruler', label: 'Uzunluk', value: `${Number(swatch.length).toFixed(0)} cm` } as SummaryItem]
      : []),
    ...(measureEnabled && swatch.width != null
      ? [{ icon: 'arrow-expand-horizontal', label: 'En', value: `${Number(swatch.width).toFixed(0)} cm` } as SummaryItem]
      : []),
    ...(measureEnabled && swatch.weightKg != null
      ? [{ icon: 'scale-balance', label: 'Ağırlık', value: `${Number(swatch.weightKg).toFixed(2)} kg` } as SummaryItem]
      : []),
    ...(swatch.parentRoll?.barcode
      ? [{ icon: 'package-variant', label: 'Kaynak Top', value: swatch.parentRoll.barcode, monospaceValue: true } as SummaryItem]
      : []),
    ...(swatch.purpose
      ? [{ icon: 'information-outline', label: 'Amaç', value: swatch.purpose } as SummaryItem]
      : []),
    {
      icon: 'clock-outline',
      label: 'Üretildi',
      value: dayjs(swatch.createdAt).format('DD.MM.YYYY HH:mm'),
    },
  ];

  return (
    <DetailSheet
      visible={!!swatch}
      onDismiss={onDismiss}
      icon="card-text"
      title={swatch.cardNumber}
      subtitle={
        (swatch.item?.name ?? '—') +
        (swatch.color?.name ? ` · ${swatch.color.name}` : '')
      }
      widthRatio={0.9}
      summary={summary}
    />
  );
}

function RollDetailModal({
  roll,
  onDismiss,
  onRemoveFromStock,
}: {
  roll: RollListItem | null;
  onDismiss: () => void;
  onRemoveFromStock?: (roll: RollListItem) => void;
}) {
  const qc = useQueryClient();
  const historyQuery = useQuery({
    queryKey: ['roll-history', roll?.id],
    queryFn: () => (roll ? rollService.getHistory(roll.id) : Promise.resolve(null)),
    enabled: !!roll,
    staleTime: 30 * 1000,
  });

  /**
   * KARTELALIK İŞARETİNİ KALDIR (2026-08-19 saha vakası).
   *
   * Tambur'daki kartelalık anahtarı açık unutulunca üç top (F0118/F0119/F0120)
   * yanlışlıkla işaretlendi ve etikete KARTELALIK bastı. Tekrar yazdırmak
   * DÜZELTMEZ — etiket doğruyu basıyor, hata bayrağın kendisinde. Sahada tek
   * çare topu yeniden kesmekti. Uç (`POST /kartela/rolls/:id/mark`) ve servis
   * sarmalayıcısı zaten vardı; eksik olan yalnız bu düğmeydi.
   */
  // Online-only (kuyruğa GİRMEZ): sunucu idempotent (atomik claim + no-op cevabı) ama
  // onay kuyrukta gelmez — modal `onSuccess`te kapanıyor ve liste + `kartela` sayaçları
  // birlikte tazeleniyor; optimistic düşürme ikisini ayrıştırırdı (cancelMutation emsali).
  const unmarkKartela = useMutation({
    mutationFn: (rollId: string) => kartelaService.setRollMarked(rollId, false),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Kartelalık işareti kaldırıldı' });
      // Liste + kartela stoğu bayat kalmasın (top kartela havuzundan düşer).
      void qc.invalidateQueries({ queryKey: ['rolls'] });
      void qc.invalidateQueries({ queryKey: ['kartela'] });
      onDismiss();
    },
    onError: (err: Error) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'İşaret kaldırılamadı', text2: err.message });
    },
  });

  if (!roll) return null;

  const events = (historyQuery.data?.data?.events ?? []) as Array<{
    kind: string;
    title: string;
    at: string;
    stationName: string | null;
    operatorName: string | null;
    details?: Record<string, unknown>;
  }>;

  const summary: SummaryItem[] = [
    { icon: 'ruler', label: 'Mevcut Metraj', value: `${Number(roll.currentQty ?? 0).toFixed(1)} m` },
    ...(roll.weightKg != null
      ? [{ icon: 'scale-balance', label: 'Ağırlık', value: `${Number(roll.weightKg).toFixed(2)} kg` } as SummaryItem]
      : []),
    ...(roll.width != null
      ? [{ icon: 'arrow-expand-horizontal', label: 'En', value: `${roll.width} cm` } as SummaryItem]
      : []),
    { icon: 'star-circle', label: 'Kalite', value: roll.qualityGrade },
    { icon: 'circle', label: 'Durum', value: trLabel(ROLL_STATUS_LABEL, roll.status) },
    // Çuvala/sevkiyata bağlı top — serbest stok DEĞİL. Yalnız shipmentId'ye değil
    // sackId'ye de bak: çuvala konmuş ama sevkiyatı olmayan top da "Çuvalda"dır.
    ...(roll.shipmentId || roll.sackId
      ? [
          {
            icon: 'package-variant-closed',
            label: 'Konum',
            value:
              'Çuvalda' +
              (roll.sack ? ` · ${roll.sack.sackNo}` : '') +
              ' · ' +
              (roll.shipment
                ? SHIPMENT_SCOPE_LABEL[roll.shipment.status] ?? roll.shipment.status
                : 'Sevk bekliyor'),
          } as SummaryItem,
        ]
      : []),
    ...(roll.markedForKartela
      ? [{ icon: 'tag-multiple', label: 'Kartela', value: 'Kartelalık işaretli' } as SummaryItem]
      : []),
    ...(roll.lastLabelSnapshot?.customerName
      ? [
          {
            icon: 'tag',
            label: 'Son Etiket',
            value:
              roll.lastLabelSnapshot.customerName +
              (roll.lastLabelSnapshot.orderNumber
                ? ` · ${roll.lastLabelSnapshot.orderNumber}`
                : ''),
          } as SummaryItem,
        ]
      : []),
  ];

  // İkinci sütun — kumaşın rengi + özellikleri. Ham toplarda renk atanmamış ve
  // özellik yoktur → ilgili satırı HİÇ ekleme ("Atanmamış/Belirtilmemiş" gibi
  // anlamsız placeholder gösterme). İkisi de yoksa aside sütunu hiç çıkmaz →
  // DetailSheet tek sütuna döner.
  const props = roll.properties ?? [];
  const summaryAside: SummaryItem[] = [];
  if (roll.color) {
    summaryAside.push({
      icon: 'palette',
      label: 'Renk',
      value: (
        <View style={modalStyles.colorValue}>
          <View
            style={[
              modalStyles.colorSwatch,
              { backgroundColor: roll.color.hex ?? '#e2e8f0' },
            ]}
          />
          <Text style={modalStyles.colorName} numberOfLines={1}>
            {roll.color.name}
          </Text>
        </View>
      ),
    });
  }
  if (props.length > 0) {
    summaryAside.push({
      icon: 'tag-multiple',
      label: 'Özellikler',
      value: (
        <View style={modalStyles.propChips}>
          {props.map((p) => (
            <View key={p.propertyId} style={modalStyles.propChip}>
              <Text style={modalStyles.propChipText}>
                {/* Değer de basılır — Electron rozeti ile aynı kural (VAL-04). */}
                {p.value
                  ? `${p.property?.name ?? '—'}: ${p.value.name}`
                  : (p.property?.name ?? '—')}
              </Text>
            </View>
          ))}
        </View>
      ),
    });
  }
  const hasAside = summaryAside.length > 0;

  return (
    <DetailSheet
      visible={!!roll}
      onDismiss={onDismiss}
      icon="package-variant"
      title={roll.barcode ?? '—'}
      subtitle={
        (roll.item?.name ?? '—') +
        (roll.color?.name ? ` · ${roll.color.name}` : '')
      }
      widthRatio={0.9}
      summary={summary}
      summaryAside={hasAside ? summaryAside : undefined}
      summaryTitle={hasAside ? 'Top Bilgisi' : undefined}
      asideTitle={hasAside ? 'Kumaş & Renk' : undefined}
      actions={
        onRemoveFromStock || roll.markedForKartela ? (
          <View style={detailActionStyles.row}>
            {/* Kartelalık işareti YALNIZ işaretli topta çizilir — burada gizlemek
                doğru: koşul topun kendi alanında, backend'e sormaya gerek yok
                (aşağıdaki "Stoktan Kaldır" ile bilinçli asimetri). */}
            {roll.markedForKartela && (
              <Button
                mode="outlined"
                icon="tag-off-outline"
                textColor="#b45309"
                loading={unmarkKartela.isPending}
                disabled={unmarkKartela.isPending}
                onPress={() => unmarkKartela.mutate(roll.id)}
                style={[detailActionStyles.btn, detailActionStyles.kartelaBtn]}
                contentStyle={detailActionStyles.btnContent}
              >
                Kartelalık İşaretini Kaldır
              </Button>
            )}
            {onRemoveFromStock && (
              // Buton statüye göre GİZLENMEZ: hangi topların kaldırılabileceği
              // (statü beyaz listesi, açık fason sevki, çuval/sevkiyat bağı) yalnız
              // backend'in bildiği bir sorudur. Burada gizlemek, operatöre sebepsiz
              // eksik bir ekran gösterirdi; onay modalı hem sorar hem — kaldırılamıyorsa —
              // somut Türkçe sebebi basar.
              <Button
                mode="contained"
                icon="trash-can-outline"
                buttonColor="#dc2626"
                textColor="#fff"
                onPress={() => onRemoveFromStock(roll)}
                style={detailActionStyles.btn}
                contentStyle={detailActionStyles.btnContent}
              >
                Stoktan Kaldır
              </Button>
            )}
          </View>
        ) : undefined
      }
    >
      {/* Geçmiş — açılır/kapanır section, varsayılan KAPALI */}
      <CollapsibleSection title={`Yaşam Döngüsü (${events.length})`}>
        {historyQuery.isLoading ? (
          <ActivityIndicator size="small" color="#475569" />
        ) : events.length === 0 ? (
          <MutedText>Kayıt yok</MutedText>
        ) : (
          events.map((e, idx) => (
            <Surface key={`${e.at}-${idx}`} style={modalStyles.eventCard} elevation={0}>
              <View style={modalStyles.eventHeader}>
                <Text style={modalStyles.eventTitle} numberOfLines={1}>
                  {e.title}
                </Text>
                <Text style={modalStyles.eventTime}>
                  {dayjs(e.at).format('DD.MM HH:mm')}
                </Text>
              </View>
              {(e.stationName || e.operatorName) && (
                <Text style={modalStyles.eventMeta}>
                  {e.stationName ? `🏭 ${e.stationName}` : ''}
                  {e.stationName && e.operatorName ? ' · ' : ''}
                  {e.operatorName ? `👤 ${e.operatorName}` : ''}
                </Text>
              )}
            </Surface>
          ))
        )}
      </CollapsibleSection>
    </DetailSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 12, gap: 10 },

  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  statsCardPhone: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 8,
  },
  statsScrollContent: { alignItems: 'center', paddingHorizontal: 10, gap: 0 },
  statBox: { flex: 1, alignItems: 'center', minWidth: 80, paddingHorizontal: 6 },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 10, color: '#64748b', marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: '#e2e8f0' },

  toolbar: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  toolbarRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { backgroundColor: '#fff' },
  inputRow: { flex: 1 },

  scanButton: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    minHeight: 48,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  scanButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scanButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  statusTabs: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
  },
  statusChipText: { fontSize: 13, fontWeight: '700', color: '#475569' },

  listContent: { padding: 4 },
  footerLoader: { paddingVertical: 16, alignItems: 'center' },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  emptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#cbd5e1', textAlign: 'center' },

  rollCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginVertical: 3,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rollInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
  },
  rollHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rollBarcode: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  statusPillWarehouse: { backgroundColor: '#fed7aa' },
  statusPillReady: { backgroundColor: '#bbf7d0' },
  statusPillA1: { backgroundColor: '#ddd6fe' },
  statusPillA1Stock: { backgroundColor: '#fde68a' },
  statusPillFire: { backgroundColor: '#fecaca' },
  statusPillSwatch: { backgroundColor: '#ddd6fe' },
  statusPillKartela: { backgroundColor: '#7c3aed' },
  statusPillSack: { backgroundColor: '#4338ca' },
  statusPillText: { fontSize: 10, fontWeight: '700', color: '#0f172a' },
  statusPillKartelaText: { fontSize: 10, fontWeight: '700', color: '#ffffff' },
  statusPillSackText: { fontSize: 10, fontWeight: '700', color: '#ffffff' },
  rollItem: { fontSize: 12, color: '#475569', marginTop: 4 },
  rollMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  rollMetaText: { fontSize: 11, color: '#0f172a', fontWeight: '600' },
  rollMetaName: { flexShrink: 1, color: '#475569' },
  rollSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  rollMetaSep: { fontSize: 11, color: '#cbd5e1' },

  // Kartela stok satırı (ADET bazlı)
  kartelaItem: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  kartelaColor: { fontSize: 12, color: '#64748b', marginTop: 2 },
  kartelaCountBox: { alignItems: 'flex-end', minWidth: 52, paddingRight: 2 },
  kartelaCountValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#7c3aed',
    fontVariant: ['tabular-nums'],
  },
  kartelaCountUnit: { fontSize: 10, color: '#94a3b8' },
});

// Detay sheet'inin sabit alt aksiyon çubuğu — 56dp dokunma hedefi (UI kuralı).
const detailActionStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, flex: 1 },
  btn: { flex: 1, borderRadius: 10 },
  btnContent: { minHeight: 56 },
  kartelaBtn: { borderColor: '#f59e0b', borderWidth: 2 },
});

// RollDetailModal'a özel event card stilleri — DetailSheet children içinde
// kullanılan history listesi için.
const modalStyles = StyleSheet.create({
  eventCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 4,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: '#0f172a' },
  eventTime: { fontSize: 11, color: '#94a3b8' },
  eventMeta: { fontSize: 11, color: '#64748b' },

  // Renk değeri — küçük örnek dairesi + ad
  colorValue: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  colorSwatch: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  colorName: { flex: 1, fontSize: 13, fontWeight: '700', color: '#0f172a' },

  // Özellik chip'leri — sarmalı liste
  propChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  propChip: {
    backgroundColor: '#e0e7ff',
    borderColor: '#c7d2fe',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  propChipText: { fontSize: 11, fontWeight: '700', color: '#3730a3' },
});
