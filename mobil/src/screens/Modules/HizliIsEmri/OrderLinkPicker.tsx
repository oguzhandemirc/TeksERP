import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon, ActivityIndicator, TextInput } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import ResizableSheetModal from '../../../components/ResizableSheetModal';
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import OrderLineFilterSheet, {
  EMPTY_ORDER_LINE_FILTERS,
  activeFilterCount,
  type OrderLineFilters,
} from './OrderLineFilterSheet';
import { orderService, type AvailableOrderLine } from '../../../services/order.service';
import { openQtyText } from '../../../lib/item-unit';
import { colors, spacing, radius } from '../../../theme';

const PAGE_SIZE = 20;
// Arama gecikmesi — operatör yazmayı bırakınca sorgu atılsın. 300ms yazarken
// tetikleniyordu (her hecede bir istek); 800ms "yazmayı bıraktım" sinyalini
// yakalar ama listeyi bekletmiş hissi vermez.
const SEARCH_DEBOUNCE_MS = 800;

interface Props {
  /** Okutulan topların ürünü — sipariş kalemleri buna göre filtrelenir. */
  itemId: string | null;
  value: string[];
  onChange: (lineIds: string[]) => void;
  /** Bir kalem işaretlenince (seçilince) çağrılır — renk/en otomatik doldurma için. */
  onLinePicked?: (line: AvailableOrderLine) => void;
  /** Modal açık durumu dışarıdan kontrol edilsin. Verilmezse iç state kullanılır. */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

// "İş emrini siparişe bağla" — açık kalemleri çoklu seçtirir. Seçim varsa
// quickStart ORDER_PRODUCTION olur; seçilen kalemden renk/en doldurulur.
export default function OrderLinkPicker({
  itemId,
  value,
  onChange,
  onLinePicked,
  open: openProp,
  onOpenChange,
}: Props) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setOpenInternal(v);
  };

  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);
  const [filters, setFilters] = useState<OrderLineFilters>(EMPTY_ORDER_LINE_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterCount = activeFilterCount(filters);

  // Seçilen kalemlerin TAM objesi burada tutulur — listeden türetilemez.
  // Cursor sayfalamada / aramada seçili satır yüklü sayfaların dışına düşebilir;
  // türetilen bir liste kullanılırsa çipler kaybolur ve "tek WO = tek kumaş"
  // çapası (anchor) sessizce boşa düşerdi.
  const [pickedById, setPickedById] = useState<Record<string, AvailableOrderLine>>({});

  // Parent seçimi dışarıdan temizlerse (sipariş bağı kaldırıldı) haritayı eşitle.
  useEffect(() => {
    setPickedById((prev) => {
      const next: Record<string, AvailableOrderLine> = {};
      for (const id of value) if (prev[id]) next[id] = prev[id];
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [value]);

  // Seçili kalemler — sorgudan ÖNCE hesaplanır (spec çapası ondan türüyor).
  const selectedLines = useMemo(
    () => value.map((id) => pickedById[id]).filter(Boolean) as AvailableOrderLine[],
    [value, pickedById],
  );

  // TEK sorgu — itemId varsa o kumaşın kalemleri, yoksa tüm açık kalemler.
  // Arama BACKEND'de (buildTurkishSearch: sipariş no / müşteri / ürün / müşteri
  // ürün adı); istemci tarafı filtre YOK, aksi halde yalnız yüklü sayfada arardı.
  // Kumaş: toplar okutulduysa oradan KİLİTLİ, değilse filtreden gelebilir.
  const effectiveItemId = itemId ?? filters.itemId;
  // İlk kalem seçildiği anda liste O SPEC'e daralır — bir iş emri tek spec
  // (kumaş + renk + en) üretir, uyumsuz kalemler zaten seçilemez. Daraltma
  // BACKEND'de: uyumsuz satırlar hiç indirilmez (istemcide gizleme değil).
  const specAnchorId = selectedLines[0]?.lineId ?? null;
  const q = useInfiniteQuery({
    queryKey: [
      'available-order-lines',
      effectiveItemId ?? null,
      search,
      filters.customerId,
      filters.colorId,
      specAnchorId,
    ],
    queryFn: ({ pageParam }) =>
      orderService.getAvailableOrderLinesCursor({
        itemId: effectiveItemId,
        customerId: filters.customerId,
        colorId: filters.colorId,
        specOfLineId: specAnchorId,
        search,
        cursor: pageParam,
        limit: PAGE_SIZE,
        withTotal: !pageParam,
        withInProduction: !!effectiveItemId || !!specAnchorId,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : undefined),
    enabled: open,
    placeholderData: keepPreviousData,
    // Açık miktar değişken bir veri ama her açılışta sıfırdan çekmek de gereksiz;
    // iş emri açıldığında hook `available-order-lines`'ı invalidate ediyor.
    staleTime: 30_000,
  });

  const lines = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const total = q.data?.pages[0]?.pagination.totalEstimate;
  // Yenile: ilk sayfaya dön + baştan çek (offline/timeout davranışı hook'ta).
  const refresh = useManualRefresh(async () => {
    await q.refetch();
  });

  // Çapa = ilk seçilen kalemin SPEC'i. Bir iş emri TEK spec üretir (kumaş + hedef
  // renk + en); farklı spec'li bir kalemi aynı emre bağlamak, o kalemi asla
  // karşılanamayacak bir üretime yamamak demektir.
  const anchorLine = selectedLines[0] ?? null;
  const anchorSpecLabel = anchorLine
    ? [
        anchorLine.itemName,
        anchorLine.colorName ?? 'Renksiz',
        anchorLine.width != null ? `${Math.round(Number(anchorLine.width))} cm` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  /** Bu kalem seçili çapayla aynı iş emrinde üretilebilir mi — değilse sebebi. */
  const mismatchOf = useCallback(
    (line: AvailableOrderLine): string | null => {
      if (anchorLine) {
        if (line.itemId !== anchorLine.itemId) return 'farklı kumaş';
        if ((line.colorId ?? null) !== (anchorLine.colorId ?? null)) return 'farklı renk';
        if (normWidth(line.width) !== normWidth(anchorLine.width)) return 'farklı en';
        return null;
      }
      // Henüz kalem seçilmedi: yalnız okutulan topların kumaşı kısıtlar.
      if (itemId && line.itemId !== itemId) return 'farklı kumaş';
      return null;
    },
    [anchorLine, itemId],
  );

  // Asıl daraltma backend'de (`specOfLineId`). Bu filtre YALNIZCA geçiş anı içindir:
  // `keepPreviousData` yeni sayfa gelene kadar ÖNCEKİ (geniş) listeyi gösterir ve
  // orada bir an uyumsuz satırlar görünüp tıklanabilir kalırdı.
  const visibleLines = useMemo(
    () => (anchorLine ? lines.filter((l) => !mismatchOf(l)) : lines),
    [lines, anchorLine, mismatchOf],
  );

  const toggle = useCallback(
    (line: AvailableOrderLine) => {
      const id = line.lineId;
      if (value.includes(id)) {
        onChange(value.filter((v) => v !== id));
        setPickedById((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
        return;
      }
      const mismatch = mismatchOf(line);
      if (mismatch) {
        const spec = anchorLine
          ? [anchorLine.colorName ?? 'Renksiz', anchorLine.width != null ? `${anchorLine.width}cm` : null]
              .filter(Boolean)
              .join(' · ')
          : null;
        Toast.show({
          type: 'info',
          text1: `Bu kalem ${mismatch} — eklenemez`,
          text2: spec
            ? `Tek iş emri tek spec üretir. Seçili: ${anchorLine?.itemName} · ${spec}`
            : 'Tek iş emri tek kumaş içindir.',
        });
        return;
      }
      setPickedById((p) => ({ ...p, [id]: line }));
      onChange([...value, id]);
      // Renk/en üst forma taşınır + (sipariş-önce) ürün kilitlenir.
      onLinePicked?.(line);
    },
    [value, onChange, mismatchOf, anchorLine, onLinePicked],
  );

  const renderRow = useCallback(
    ({ item }: { item: AvailableOrderLine }) => {
      const checked = value.includes(item.lineId);
      // Net açık = açık − üretimdeki (backend withInProduction). Yoksa ham açık.
      // KG/ADET satırda null → "ölçülmüyor" (metreye düşülmez).
      const netOpen = openQtyText(item.netOpenQty ?? item.openQty);
      const inProd = Math.round(Number(item.inProduction ?? 0));
      return (
        <TouchableRipple onPress={() => toggle(item)} style={styles.row} borderless>
          <View style={styles.rowInner}>
            <Icon
              source={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={24}
              color={checked ? colors.brand : colors.textMuted}
            />
            <View style={{ flex: 1 }}>
              <View style={styles.rowTitleLine}>
                {/* "P" = bu kaleme zaten canlı bir iş emri açılmış (satır bazlı
                    gerçek bağ; `inProduction` spec-havuz bazlı olduğu için o
                    rozet olarak kullanılamaz). Seçimi ENGELLEMEZ — bir kaleme
                    birden çok WO açmak meşrudur; amaç mükerrer açmayı fark ettirmek. */}
                {item.hasWorkOrder ? (
                  <View style={styles.woBadge}>
                    <Text style={styles.woBadgeText}>P</Text>
                  </View>
                ) : null}
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.orderNumber} · {item.customerName}
                </Text>
              </View>
              {/* Bizdeki ad — iç picker; müşteri override'ı yalnız ilk girildiği
                  siparişte dolu olduğundan basılırsa aynı kumaş iki adla görünür. */}
              <Text style={styles.rowSub} numberOfLines={1}>
                {item.itemName}
                {item.colorName ? ` · ${item.colorName}` : ''}
                {item.width != null ? ` · ${item.width}cm` : ''}
                {inProd > 0 ? ` · ${inProd}m üretimde` : ''}
              </Text>
            </View>
            <Text style={styles.openQty}>Açık: {netOpen}</Text>
          </View>
        </TouchableRipple>
      );
    },
    [value, toggle],
  );

  return (
    <View>
      {/* Tetik — gerçek buton görünümü (≥56dp dokunma hedefi, proje UI kuralı). */}
      <TouchableRipple
        onPress={() => setOpen(true)}
        style={[styles.trigger, value.length > 0 && styles.triggerActive]}
        rippleColor="rgba(79,70,229,0.12)"
        accessibilityLabel="Sipariş bağla"
      >
        <View style={styles.triggerInner}>
          <Icon source="link-variant" size={24} color={colors.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.triggerText} numberOfLines={1}>
              {value.length > 0 ? `${value.length} sipariş kalemi bağlı` : 'Sipariş Bağla'}
            </Text>
            <Text style={styles.triggerHint} numberOfLines={1}>
              {value.length > 0 ? 'Değiştirmek için dokun' : 'Opsiyonel — stok üretimi için gerekmez'}
            </Text>
          </View>
          <Icon source="chevron-right" size={22} color={colors.textMuted} />
        </View>
      </TouchableRipple>

      {selectedLines.length > 0 ? (
        <View style={styles.chips}>
          {selectedLines.map((l) => (
            <TouchableRipple key={l.lineId} onPress={() => toggle(l)} style={styles.chip} borderless>
              <View style={styles.chipInner}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {l.orderNumber}
                </Text>
                <Icon source="close" size={14} color={colors.brand} />
              </View>
            </TouchableRipple>
          ))}
        </View>
      ) : null}

      <ResizableSheetModal
        visible={open}
        onDismiss={() => setOpen(false)}
        header={
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Sipariş Kalemi Seç</Text>
              {total != null ? <Text style={styles.sheetSub}>~{total} açık kalem</Text> : null}
            </View>
            <RefreshButton
              onPress={refresh.onRefresh}
              refreshing={refresh.refreshing}
              isError={!!refresh.errorMessage}
              errorMessage={refresh.errorMessage}
              size={20}
            />
            <TouchableRipple onPress={() => setOpen(false)} borderless style={styles.doneBtn}>
              <Text style={styles.doneText}>Tamam ({value.length})</Text>
            </TouchableRipple>
          </View>
        }
      >
        <View style={styles.sheetBody}>
          <View style={styles.searchRow}>
            <TextInput
              mode="outlined"
              dense
              placeholder="Sipariş no / müşteri / ürün ara"
              value={searchInput}
              onChangeText={setSearchInput}
              left={<TextInput.Icon icon="magnify" />}
              right={
                searchInput ? <TextInput.Icon icon="close" onPress={() => setSearchInput('')} /> : undefined
              }
              style={styles.search}
            />
            <TouchableRipple
              onPress={() => setFilterOpen(true)}
              style={[styles.filterBtn, filterCount > 0 && styles.filterBtnActive]}
              borderless
              rippleColor="rgba(79,70,229,0.12)"
              accessibilityLabel="Detaylı filtre"
            >
              <View style={styles.filterBtnInner}>
                <Icon
                  source="filter-variant"
                  size={22}
                  color={filterCount > 0 ? colors.brand : colors.textSecondary}
                />
                {filterCount > 0 ? (
                  <View style={styles.filterBadge}>
                    <Text style={styles.filterBadgeText}>{filterCount}</Text>
                  </View>
                ) : null}
              </View>
            </TouchableRipple>
          </View>

          {/* Liste neden daraldı — operatör "siparişim kayboldu" sanmasın. */}
          {anchorSpecLabel ? (
            <View style={styles.specBanner}>
              <Icon source="filter-check" size={15} color={colors.brand} />
              <Text style={styles.specBannerText} numberOfLines={2}>
                {anchorSpecLabel} ile birleştirilebilecek kalemler gösteriliyor
              </Text>
            </View>
          ) : null}

          {q.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : visibleLines.length === 0 ? (
            <Text style={styles.empty}>
              {anchorSpecLabel
                ? `Bu spec ile birleştirilebilecek başka açık kalem yok.`
                : search || filterCount > 0
                  ? 'Arama/filtreye uyan açık sipariş kalemi yok.'
                  : itemId
                    ? 'Bu ürüne uyan açık sipariş kalemi yok.'
                    : 'Açık sipariş kalemi bulunamadı.'}
            </Text>
          ) : (
            <FlashList
              data={visibleLines}
              keyExtractor={keyExtractor}
              renderItem={renderRow}
              onEndReachedThreshold={0.6}
              onEndReached={() => {
                if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
              }}
              ListFooterComponent={
                q.isFetchingNextPage ? (
                  <View style={styles.footer}>
                    <ActivityIndicator color={colors.brand} />
                  </View>
                ) : null
              }
            />
          )}
        </View>
      </ResizableSheetModal>

      <OrderLineFilterSheet
        visible={filterOpen}
        onDismiss={() => setFilterOpen(false)}
        value={filters}
        onApply={setFilters}
        itemLocked={!!itemId}
      />
    </View>
  );
}

// Modül seviyesinde kararlı referans — her render'da yeni fn FlashList'i boşuna çalıştırır.
const keyExtractor = (l: AvailableOrderLine) => l.lineId;

/** En karşılaştırması: null ≠ 0 ve "330" === "330.000" olsun. */
const normWidth = (w: number | null | undefined): number | null =>
  w == null ? null : Number(w);

const styles = StyleSheet.create({
  trigger: {
    minHeight: 60,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  triggerActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft, borderWidth: 2 },
  triggerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  triggerText: { fontSize: 16, color: colors.text, fontWeight: '700' },
  triggerHint: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginTop: 1 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { backgroundColor: colors.brandSoft, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipText: { color: colors.brand, fontWeight: '700', fontSize: 12, maxWidth: 140 },

  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  sheetSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  doneBtn: { backgroundColor: colors.brand, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: 8 },
  doneText: { color: '#fff', fontWeight: '700' },

  sheetBody: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  // min-w-0 muadili: uzun placeholder saran flex'i şişirip filtre butonunu itmesin.
  search: { flex: 1, minWidth: 0, backgroundColor: colors.surface },
  filterBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft, borderWidth: 2 },
  filterBtnInner: { alignItems: 'center', justifyContent: 'center' },
  filterBadge: {
    position: 'absolute',
    top: -8,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // "İş emri açılmış" rozeti — kırmızı daire içinde P. Uyarı değil bilgi, ama
  // gözle taranabilmesi için doygun renk (satırda tek renkli öğe odur).
  woBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  woBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800', lineHeight: 14 },
  footer: { paddingVertical: spacing.md, alignItems: 'center' },
  center: { padding: spacing.xxl, alignItems: 'center' },
  empty: { textAlign: 'center', color: colors.textMuted, padding: spacing.xl },
  row: { borderRadius: radius.sm },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12, paddingHorizontal: spacing.sm },
  specBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    marginBottom: spacing.sm,
  },
  specBannerText: { flex: 1, color: colors.brand, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  openQty: { fontSize: 12, fontWeight: '700', color: colors.success },
});
