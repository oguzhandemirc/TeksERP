import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import {
  Text,
  TextInput,
  IconButton,
  Surface,
  ActivityIndicator,
  TouchableRipple,
  Icon,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { SkeletonList } from '../../../components/motion';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import DetailSheet, {
  CollapsibleSection,
  MutedText,
  type SummaryItem,
} from '../../../components/DetailSheet';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { useKartelaMeasurementEnabled } from '../../../hooks/useFeatureFlags';
import { rollService } from '../../../services/roll.service';
import {
  swatchService,
  type SwatchListItem,
  type KartelaStockGroup,
} from '../../../services/swatch.service';
import { ROLL_STATUS_LABEL, trLabel } from '../../../utils/labels';
import { KartelaStockReduceModal } from './KartelaStockReduceModal';

const PAGE_SIZE = 50;

// =============================================================================
// Depo — depodaki ve ardından paketlenmiş tüm envanterin görünümü.
// Read-only liste + barkod scan + filtre + detay.
// =============================================================================

// Depo personeli sekmesi: Tümü (depo+ham) / Depo (WAREHOUSE) / Ham (STOCK) /
// Kartela (Swatch). Sevkiyat modülü yeniden yazılınca burada yeni durumlar
// olabilir; ham (STOCK) ve kartela üretim öncesi/yan envanteri kapsar.
type ModeFilter = 'ALL' | 'WAREHOUSE' | 'STOCK' | 'SWATCH' | 'KARTELALIK';

const MODE_TABS: { key: ModeFilter; label: string; color: string }[] = [
  { key: 'ALL', label: 'Tümü', color: '#475569' },
  { key: 'WAREHOUSE', label: 'Depo', color: '#d97706' },
  { key: 'STOCK', label: 'Ham', color: '#0ea5e9' },
  { key: 'SWATCH', label: 'Kartela', color: '#7c3aed' },
  { key: 'KARTELALIK', label: 'Kartelalık', color: '#059669' },
];

/** Rezerve topun bağlı olduğu sevkiyat aşaması — detay özetindeki "Sevkiyat" satırı. */
const SHIPMENT_SCOPE_LABEL: Record<string, string> = {
  PLANNED: 'Çuval Depo',
  AT_DOOR: 'Kapı Önü',
  DISPATCHED: 'Sevk Edildi',
  CANCELLED: 'İptal',
};

interface RollListItem {
  id: string;
  barcode: string;
  itemId: string;
  variantId: string | null;
  initialQty: number;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
  status: string;
  /** Tambur'da kartela için işaretlendi mi — depoda ayırt etmek için rozet. */
  markedForKartela?: boolean;
  /** Topun üstündeki son basılan etiket (null = stok/etiket yok). */
  lastLabelSnapshot?: { customerName: string | null; orderNumber: string | null } | null;
  createdAt?: string;
  item?: { id: string; code: string; name: string };
  variant?: { id: string; code: string; name: string } | null;
  color?: { id: string; code: string; name: string; hex?: string | null } | null;
  properties?: {
    propertyId: string;
    property?: { id: string; code: string; name: string };
  }[];
  /** Sevkiyat rezervasyonu — dolu ise top serbest depoda DEĞİL (çuvalda). */
  shipmentId?: string | null;
  sackId?: string | null;
  shipment?: { id: string; shipmentNo: string; status: string } | null;
  sack?: { id: string; sackNo: string; seq: number } | null;
}

export default function DepoScreen() {
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

  const isSwatchMode = mode === 'SWATCH';
  const isKartelalikMode = mode === 'KARTELALIK';

  // Arama backend'de filtreleniyor. Her tuşa basıldığında istek atmamak için
  // 300ms debounce — input anında doldurulur (controlled), ama queryKey sadece
  // kullanıcı yazmayı bıraktığında değişir. (Tambur/FasonSevk ile aynı pattern.)
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  // Min 3 karakter kapısı: 1-2 harflik arama 500k satırda geniş `itemId IN`
  // kümesi + ağır stats taraması üretir, faydası yok. Barkod metni (TEKS-...,
  // SW-...) zaten 3+ karakterdir → tam-eşleşme aramasını engellemez. <3 → arama
  // yok sayılır (queryKey'de de '' olduğu için "a"/"ab"/"" aynı sorguya düşer).
  const effectiveSearch = debouncedSearch.length >= 3 ? debouncedSearch : '';

  // Roll listesi — status filtresi mode'a göre belirlenir. SWATCH modunda
  // bu query enabled=false (kartela ayrı endpoint).
  // ALL sekmesi depo karakterli tüm statüleri kapsar: WAREHOUSE (Tambur sonrası),
  // A1_STOCK (2. kalite satılabilir), PRODUCED (Tambur'a girmemiş tamamlanmış),
  // STOCK (ham). includeFire=true olmadan backend FIRE kaliteleri sessizce gizler.
  const rollsFilters = useMemo<Record<string, string | string[]>>(() => {
    // shipmentScope:'free' → çuvallanmış (bir sevkiyata okutulmuş) toplar HARİÇ. Çuvallanan
    // top artık "serbest depoda" görünmez; çuval depo/kapı önü ayrı izlenir (Sevk Çıkışı).
    const f: Record<string, string | string[]> = { includeFire: 'true', shipmentScope: 'free' };
    if (mode === 'ALL') f.statusIn = ['WAREHOUSE', 'A1_STOCK', 'PRODUCED', 'STOCK'];
    else if (mode === 'WAREHOUSE') f.status = 'WAREHOUSE';
    else if (mode === 'STOCK') f.status = 'STOCK';
    else if (mode === 'KARTELALIK') {
      f.statusIn = ['WAREHOUSE', 'A1_STOCK', 'PRODUCED', 'STOCK'];
      f.markedForKartela = 'true';
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
  // Çuvallanmış (pool) + planlı + kapıda bekleyen — serbest stoktan düşen ama
  // bina içindeki mal. "Serbest + Çuvalda" toplamı fiziksel depoyla tutsun.
  const committedCount =
    (scopeQuery.data?.data?.pool?.count ?? 0) +
    (scopeQuery.data?.data?.planned?.count ?? 0) +
    (scopeQuery.data?.data?.atDoor?.count ?? 0);

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
    // Prefix sabit: SW- → Kartela, TEKS- → Top. Operatör Tümü sekmesindeyken
    // kartela barkodu okutursa da kartela detayı açılır.
    const isSwatchBarcode = /^SW/i.test(barcode);
    try {
      if (isSwatchBarcode) {
        const res = await swatchService.getByBarcode(barcode);
        const s = res.data;
        if (!s) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Toast.show({ type: 'error', text1: 'Kartela bulunamadı', text2: barcode });
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          pendingDetailRef.current = {
            kind: 'swatch',
            data: s as unknown as SwatchListItem,
          };
        }
      } else {
        const res = await rollService.getByBarcode(barcode);
        const r = res.data;
        if (!r) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: barcode });
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          pendingDetailRef.current = { kind: 'roll', data: r as RollListItem };
        }
      }
    } catch (err) {
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
    else setDetailSwatch(pending.data);
  }, []);

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
        <StatBox label="Serbest" value={rollStats.warehouse} color="#d97706" />
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
                <RollListRow roll={item} onPress={() => setDetailRoll(item)} />
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
        <RollDetailModal roll={detailRoll} onDismiss={handleRollDetailDismiss} />
      )}
      {detailSwatch && (
        <SwatchDetailModal swatch={detailSwatch} onDismiss={handleSwatchDetailDismiss} />
      )}

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
  roll,
  onPress,
}: {
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
                  roll.status === 'PRODUCED' && styles.statusPillReady,
                ]}
              >
                <Text style={styles.statusPillText}>
                  {trLabel(ROLL_STATUS_LABEL, roll.status)}
                </Text>
              </View>
              {roll.qualityGrade === 'A1' && (
                <View style={[styles.statusPill, styles.statusPillA1]}>
                  <Text style={styles.statusPillText}>A1</Text>
                </View>
              )}
              {roll.qualityGrade === 'FIRE' && (
                <View style={[styles.statusPill, styles.statusPillFire]}>
                  <Text style={styles.statusPillText}>Fire</Text>
                </View>
              )}
              {roll.markedForKartela && (
                <View style={[styles.statusPill, styles.statusPillKartela]}>
                  <Text style={styles.statusPillKartelaText}>Kartelalık</Text>
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
}: {
  roll: RollListItem | null;
  onDismiss: () => void;
}) {
  const historyQuery = useQuery({
    queryKey: ['roll-history', roll?.id],
    queryFn: () => (roll ? rollService.getHistory(roll.id) : Promise.resolve(null)),
    enabled: !!roll,
    staleTime: 30 * 1000,
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
    // Çuvala/sevkiyata rezerve top — serbest stok DEĞİL; barkod okutulunca uyar.
    ...(roll.shipmentId
      ? [
          {
            icon: 'package-variant-closed',
            label: 'Sevkiyat',
            value:
              'Çuvalda' +
              (roll.sack ? ` · ${roll.sack.sackNo}` : '') +
              (roll.shipment
                ? ` · ${SHIPMENT_SCOPE_LABEL[roll.shipment.status] ?? roll.shipment.status}`
                : ''),
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
                {p.property?.name ?? '—'}
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
      title={roll.barcode}
      subtitle={
        (roll.item?.name ?? '—') +
        (roll.color?.name ? ` · ${roll.color.name}` : '')
      }
      widthRatio={0.9}
      summary={summary}
      summaryAside={hasAside ? summaryAside : undefined}
      summaryTitle={hasAside ? 'Top Bilgisi' : undefined}
      asideTitle={hasAside ? 'Kumaş & Renk' : undefined}
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
  statusPillText: { fontSize: 10, fontWeight: '700', color: '#0f172a' },
  statusPillKartelaText: { fontSize: 10, fontWeight: '700', color: '#ffffff' },
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
