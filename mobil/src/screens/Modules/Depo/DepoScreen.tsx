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
  SectionTitle,
  MutedText,
  type SummaryItem,
} from '../../../components/DetailSheet';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { rollService } from '../../../services/roll.service';
import RelabelSheet, { type RelabelRoll } from '../../../components/RelabelSheet';
import { swatchService, type SwatchListItem } from '../../../services/swatch.service';
import { ROLL_STATUS_LABEL, trLabel } from '../../../utils/labels';

const PAGE_SIZE = 50;

// =============================================================================
// Depo — depodaki ve ardından paketlenmiş tüm envanterin görünümü.
// Read-only liste + barkod scan + filtre + detay.
// =============================================================================

// Depo personeli sekmesi: Tümü (depo+ham) / Depo (WAREHOUSE) / Ham (STOCK) /
// Kartela (Swatch). Sevkiyat modülü yeniden yazılınca burada yeni durumlar
// olabilir; ham (STOCK) ve kartela üretim öncesi/yan envanteri kapsar.
type ModeFilter = 'ALL' | 'WAREHOUSE' | 'STOCK' | 'SWATCH';

const MODE_TABS: { key: ModeFilter; label: string; color: string }[] = [
  { key: 'ALL', label: 'Tümü', color: '#475569' },
  { key: 'WAREHOUSE', label: 'Depo', color: '#d97706' },
  { key: 'STOCK', label: 'Ham', color: '#0ea5e9' },
  { key: 'SWATCH', label: 'Kartela', color: '#7c3aed' },
];

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
  createdAt?: string;
  item?: { id: string; code: string; name: string };
  variant?: { id: string; code: string; name: string } | null;
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
  const [relabelRoll, setRelabelRoll] = useState<RelabelRoll | null>(null);
  const handleRollDetailDismiss = useCallback(() => setDetailRoll(null), []);
  const handleSwatchDetailDismiss = useCallback(() => setDetailSwatch(null), []);

  const isSwatchMode = mode === 'SWATCH';

  // Roll listesi — status filtresi mode'a göre belirlenir. SWATCH modunda
  // bu query enabled=false (kartela ayrı endpoint).
  // ALL sekmesi depo karakterli tüm statüleri kapsar: WAREHOUSE (Tambur sonrası),
  // A1_STOCK (2. kalite satılabilir), PRODUCED (Tambur'a girmemiş tamamlanmış),
  // STOCK (ham). includeFire=true olmadan backend FIRE kaliteleri sessizce gizler.
  const rollsFilters = useMemo<Record<string, string | string[]>>(() => {
    const f: Record<string, string | string[]> = { includeFire: 'true' };
    if (mode === 'ALL') f.statusIn = ['WAREHOUSE', 'A1_STOCK', 'PRODUCED', 'STOCK'];
    else if (mode === 'WAREHOUSE') f.status = 'WAREHOUSE';
    else if (mode === 'STOCK') f.status = 'STOCK';
    return f;
  }, [mode]);

  // Liste — cursor-mode infinite scroll. mode/search değiştiğinde queryKey
  // değişir → useInfiniteQuery state'i sıfırlar (ilk sayfa).
  const rollsQuery = useInfiniteQuery({
    queryKey: ['rolls', 'depo', mode, search] as const,
    queryFn: ({ pageParam }) =>
      rollService.getAllCursor({
        limit: PAGE_SIZE,
        cursor: pageParam,
        filters: rollsFilters,
        search: search.trim() || undefined,
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
    queryKey: ['rolls', 'depo', 'stats', mode, search] as const,
    queryFn: () =>
      rollService.getStats({
        search: search.trim() || undefined,
        filters: rollsFilters,
      }),
    enabled: !isSwatchMode,
    staleTime: 30 * 1000,
  });

  // Search artık backend'de — queryKey'de yer alır, değişince ilk sayfaya döner.
  const swatchesQuery = useInfiniteQuery({
    queryKey: ['swatches', 'depo', search] as const,
    queryFn: ({ pageParam }) =>
      swatchService.listCursor({
        limit: PAGE_SIZE,
        cursor: pageParam,
        search: search.trim() || undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.nextCursor : null,
    enabled: isSwatchMode,
    staleTime: 30 * 1000,
  });

  const swatchStatsQuery = useQuery({
    queryKey: ['swatches', 'depo', 'stats', search] as const,
    queryFn: () =>
      swatchService.getStats({ search: search.trim() || undefined }),
    enabled: isSwatchMode,
    staleTime: 30 * 1000,
  });

  const rolls = useMemo(
    () =>
      (rollsQuery.data?.pages.flatMap((p) => p.data) ?? []) as RollListItem[],
    [rollsQuery.data]
  );
  const swatches = useMemo(
    () =>
      (swatchesQuery.data?.pages.flatMap((p) => p.data) ?? []) as SwatchListItem[],
    [swatchesQuery.data]
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

  const ss = swatchStatsQuery.data?.data;
  const swatchStats = {
    count: ss?.count ?? 0,
    totalLength: ss?.totalLength ?? 0,
  };

  // Scanner kapanma animasyonu BİTMEDEN detail modal açılırsa RNModal overlay'i
  // tıklamaları yutuyor ve ekran kullanılamaz hale geliyor (BarcodeScannerModal
  // dosyasındaki uyarı). Bu yüzden taranan barkodun sonucunu buraya yazıp,
  // scanner.onModalHide'da detail modal'ı açıyoruz.
  const pendingDetailRef = useRef<
    | { kind: 'roll'; data: RollListItem }
    | { kind: 'swatch'; data: SwatchListItem }
    | { kind: 'relabel'; data: RelabelRoll }
    | null
  >(null);
  // Tarayıcı amacı: detay görüntüleme mi, yönlendirme mi (aynı scanner paylaşılır).
  const scanPurposeRef = useRef<'detail' | 'relabel'>('detail');

  const handleBarcodeScanned = async (raw: string) => {
    const barcode = raw.trim();
    if (!barcode) {
      setScannerOpen(false);
      return;
    }
    // Sekme = listeleme bağlamı; barkod okutma = nokta sorgu, sekmeden bağımsız.
    // Prefix sabit: SW- → Kartela, TEKS- → Top. Operatör Tümü sekmesindeyken
    // kartela barkodu okutursa da kartela detayı açılır.
    const isSwatchBarcode = /^SW-/i.test(barcode);
    if (scanPurposeRef.current === 'relabel' && isSwatchBarcode) {
      Toast.show({ type: 'error', text1: 'Kartela yönlendirilemez' });
      setScannerOpen(false);
      return;
    }
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
          if (scanPurposeRef.current === 'relabel') {
            pendingDetailRef.current = {
              kind: 'relabel',
              data: {
                id: r.id,
                barcode: r.barcode,
                itemId: r.itemId,
                colorId: r.colorId,
                width: r.width,
                itemName: r.item?.name,
                colorName: r.color?.name ?? null,
              },
            };
          } else {
            pendingDetailRef.current = { kind: 'roll', data: r as RollListItem };
          }
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
    else if (pending.kind === 'relabel') setRelabelRoll(pending.data);
    else setDetailSwatch(pending.data);
  }, []);

  const activeQuery = isSwatchMode ? swatchesQuery : rollsQuery;
  const activeStatsQuery = isSwatchMode ? swatchStatsQuery : rollStatsQuery;
  const refreshing = activeQuery.isFetching || activeStatsQuery.isFetching;
  const handleRefresh = useCallback(() => {
    activeQuery.refetch();
    activeStatsQuery.refetch();
  }, [activeQuery, activeStatsQuery]);

  const subtitle = isSwatchMode
    ? 'Kartela (Swatch) envanteri'
    : mode === 'STOCK'
      ? 'Ham stok — henüz üretime girmemiş toplar'
      : mode === 'WAREHOUSE'
        ? 'Depoda satışa/sevke hazır toplar'
        : 'Depodaki toplar + ham stok';

  const renderStats = () => {
    if (isSwatchMode) {
      return (
        <>
          <StatBox label="Toplam Kartela" value={swatchStats.count} color="#7c3aed" />
          <View style={styles.statDivider} />
          <StatBox
            label="Toplam Uzunluk"
            value={`${swatchStats.totalLength.toFixed(0)} cm`}
            color="#0f172a"
          />
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
        <StatBox label="Depo" value={rollStats.warehouse} color="#d97706" />
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
    <ScreenChrome title="Depo" subtitle={subtitle}>
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
              onPress={() => {
                scanPurposeRef.current = 'detail';
                setScannerOpen(true);
              }}
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
                    ? 'Kart no / kumaş / renk ara...'
                    : 'Kumaş adı/kodu ara...'
              }
              style={[styles.input, styles.inputRow]}
              dense
              left={<TextInput.Icon icon="magnify" />}
            />
            {!isSwatchMode && (
              <IconButton
                icon="swap-horizontal"
                mode="contained-tonal"
                size={22}
                onPress={() => {
                  scanPurposeRef.current = 'relabel';
                  setScannerOpen(true);
                }}
                accessibilityLabel="Yönlendir / etiketi değiştir"
              />
            )}
            <RefreshButton
              onPress={handleRefresh}
              refreshing={refreshing}
              isError={activeQuery.isError || activeStatsQuery.isError}
              errorMessage={
                (activeQuery.error as Error | undefined)?.message ??
                (activeStatsQuery.error as Error | undefined)?.message
              }
            />
          </View>

          {/* Mode tab'ları */}
          <View style={styles.statusTabs}>
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
          </View>
        </Surface>

        {/* Liste */}
        <View style={{ flex: 1 }}>
          {activeQuery.isLoading ? (
            <SkeletonList count={8} />
          ) : isSwatchMode ? (
            swatches.length === 0 ? (
              <View style={styles.empty}>
                <Icon source="card-text-outline" size={56} color="#cbd5e1" />
                <Text style={styles.emptyText}>Kartela bulunamadı</Text>
                <Text style={styles.emptyHint}>
                  {search ? `'${search}' için sonuç yok` : 'Henüz kartela üretilmemiş'}
                </Text>
              </View>
            ) : (
              <FlashList
                data={swatches}
                keyExtractor={(s) => s.id}
                contentContainerStyle={styles.listContent}
                onEndReached={() => {
                  if (
                    swatchesQuery.hasNextPage &&
                    !swatchesQuery.isFetchingNextPage
                  ) {
                    swatchesQuery.fetchNextPage();
                  }
                }}
                onEndReachedThreshold={0.4}
                ListFooterComponent={
                  swatchesQuery.isFetchingNextPage ? (
                    <View style={styles.footerLoader}>
                      <ActivityIndicator size="small" color="#475569" />
                    </View>
                  ) : null
                }
                renderItem={({ item }) => (
                  <SwatchListRow swatch={item} onPress={() => setDetailSwatch(item)} />
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
      <RelabelSheet
        roll={relabelRoll}
        onDismiss={() => setRelabelRoll(null)}
        onDone={handleRefresh}
      />

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
            </View>
            <View style={styles.rollMeta}>
              <Text
                style={[styles.rollMetaText, styles.rollMetaName]}
                numberOfLines={1}
              >
                {roll.item?.name ?? '—'}
                {roll.variant?.name ? ` · ${roll.variant.name}` : ''}
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

function SwatchListRow({
  swatch,
  onPress,
}: {
  swatch: SwatchListItem;
  onPress: () => void;
}) {
  return (
    <Surface style={styles.rollCard} elevation={1}>
      <TouchableRipple borderless onPress={onPress} style={{ borderRadius: 10 }}>
        <View style={styles.rollInner}>
          <View style={{ flex: 1 }}>
            <View style={styles.rollHeader}>
              <Text style={styles.rollBarcode} numberOfLines={1}>
                {swatch.cardNumber}
              </Text>
              <View style={[styles.statusPill, styles.statusPillSwatch]}>
                <Text style={styles.statusPillText}>Kartela</Text>
              </View>
            </View>
            <Text style={styles.rollItem} numberOfLines={1}>
              {swatch.item?.name ?? '—'}
              {swatch.color?.name ? ` · ${swatch.color.name}` : ''}
            </Text>
            <View style={styles.rollMeta}>
              <Text style={styles.rollMetaText}>
                {Number(swatch.length ?? 0).toFixed(0)} cm
              </Text>
              {swatch.width != null && (
                <>
                  <Text style={styles.rollMetaSep}>·</Text>
                  <Text style={styles.rollMetaText}>en {Number(swatch.width).toFixed(0)} cm</Text>
                </>
              )}
              {swatch.weightKg != null && (
                <>
                  <Text style={styles.rollMetaSep}>·</Text>
                  <Text style={styles.rollMetaText}>
                    {Number(swatch.weightKg).toFixed(2)} kg
                  </Text>
                </>
              )}
              <Text style={styles.rollMetaSep}>·</Text>
              <Text style={[styles.rollMetaText, { fontFamily: 'monospace' }]} numberOfLines={1}>
                {swatch.barcode}
              </Text>
            </View>
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
  const summary: SummaryItem[] = [
    { icon: 'barcode', label: 'Barkod', value: swatch.barcode, monospaceValue: true },
    { icon: 'ruler', label: 'Uzunluk', value: `${Number(swatch.length ?? 0).toFixed(0)} cm` },
    ...(swatch.width != null
      ? [{ icon: 'arrow-expand-horizontal', label: 'En', value: `${Number(swatch.width).toFixed(0)} cm` } as SummaryItem]
      : []),
    ...(swatch.weightKg != null
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
  ];

  return (
    <DetailSheet
      visible={!!roll}
      onDismiss={onDismiss}
      icon="package-variant"
      title={roll.barcode}
      subtitle={
        (roll.item?.name ?? '—') +
        (roll.variant?.name ? ` · ${roll.variant.name}` : '')
      }
      widthRatio={0.9}
      summary={summary}
    >
      {/* Geçmiş — DetailSheet children olarak custom section */}
      <SectionTitle>Yaşam Döngüsü ({events.length})</SectionTitle>
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

  statusTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
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
  statusPillText: { fontSize: 10, fontWeight: '700', color: '#0f172a' },
  rollItem: { fontSize: 12, color: '#475569', marginTop: 4 },
  rollMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  rollMetaText: { fontSize: 11, color: '#0f172a', fontWeight: '600' },
  rollMetaName: { flexShrink: 1, color: '#475569' },
  rollMetaSep: { fontSize: 11, color: '#cbd5e1' },
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
});
