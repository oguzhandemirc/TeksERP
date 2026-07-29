import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon, ActivityIndicator, TextInput } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import AppModal from '../../../components/AppModal';
import { orderService, type AvailableOrderLine } from '../../../services/order.service';
import { colors, spacing, radius } from '../../../theme';

interface Props {
  /** Okutulan topların ürünü — sipariş kalemleri buna göre filtrelenir. */
  itemId: string | null;
  value: string[];
  onChange: (lineIds: string[]) => void;
  /** Bir kalem işaretlenince (seçilince) çağrılır — renk/en otomatik doldurma için. */
  onLinePicked?: (line: AvailableOrderLine) => void;
  /** Modal açık durumu dışarıdan kontrol edilsin (alt bar butonundan açmak için).
   *  Verilmezse bileşen kendi iç state'ini kullanır. */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

// "İş emrini siparişe bağla" — itemId'ye uyan açık kalemleri çoklu seçtirir.
// Seçim varsa quickStart ORDER_PRODUCTION olur; seçilen kalemden renk/en
// otomatik doldurulur (onLinePicked).
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

  // Arama (yalnız sipariş-önce/broad mod) — debounce.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // TOP-ÖNCE (itemId set): okutulan ürünün açık kalemleri — tek sayfa, filtreli.
  const filtered = useQuery({
    queryKey: ['available-order-lines', itemId],
    queryFn: () =>
      orderService.getAvailableOrderLines({ itemId: itemId as string, withInProduction: true }),
    enabled: open && !!itemId,
    staleTime: 0,
  });

  // SİPARİŞ-ÖNCE (itemId yok): tüm açık kalemler — aramalı + infinite scroll (cursor).
  const broad = useInfiniteQuery({
    queryKey: ['available-order-lines-cursor', search],
    queryFn: ({ pageParam }) =>
      orderService.getAvailableOrderLinesCursor({ search, cursor: pageParam, limit: 20 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : undefined),
    enabled: open && !itemId,
    placeholderData: keepPreviousData,
  });

  const lines: AvailableOrderLine[] = itemId
    ? filtered.data?.data ?? []
    : broad.data?.pages.flatMap((p) => p.data) ?? [];
  const loading = itemId ? filtered.isLoading : broad.isLoading;
  const selectedLines = useMemo(
    () => lines.filter((l) => value.includes(l.lineId)),
    [lines, value],
  );

  const toggle = (lineId: string) => {
    if (value.includes(lineId)) {
      onChange(value.filter((id) => id !== lineId));
      return;
    }
    const line = lines.find((l) => l.lineId === lineId);
    // Anchor: tek WO = tek kumaş. İlk seçili kalemin (veya okutulan topun) ürünü
    // dışında ürün eklenemez. (Backend de tek-item zorlar; bu erken uyarı.)
    const anchor = selectedLines[0]?.itemId ?? itemId ?? null;
    if (line && anchor && line.itemId !== anchor) {
      Toast.show({
        type: 'info',
        text1: 'Aynı ürünün kalemlerini seçin',
        text2: 'Tek iş emri tek kumaş içindir.',
      });
      return;
    }
    onChange([...value, lineId]);
    // Renk/en üst forma taşınır + (sipariş-önce) ürün kilitlenir (onLinePicked).
    if (line) onLinePicked?.(line);
  };

  const renderRow = ({ item }: { item: AvailableOrderLine }) => {
    const checked = value.includes(item.lineId);
    // Net açık = açık − üretimdeki (backend withInProduction). Yoksa ham açık.
    const netOpen = Math.round(Number(item.netOpenQty ?? item.openQty));
    const inProd = Math.round(Number(item.inProduction ?? 0));
    return (
      <TouchableRipple onPress={() => toggle(item.lineId)} style={styles.row} borderless>
        <View style={styles.rowInner}>
          <Icon
            source={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={24}
            color={checked ? colors.brand : colors.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.orderNumber} · {item.customerName}
            </Text>
            {/* Bizdeki ad — iç picker; müşteri override'ı yalnız ilk girildiği
                siparişte dolu olduğundan basılırsa aynı kumaş iki adla görünür. */}
            <Text style={styles.rowSub} numberOfLines={1}>
              {item.itemName}
              {item.colorName ? ` · ${item.colorName}` : ''}
              {item.width != null ? ` · ${item.width}cm` : ''}
              {inProd > 0 ? ` · ${inProd}m üretimde` : ''}
            </Text>
          </View>
          <Text style={styles.openQty}>Açık: {netOpen}m</Text>
        </View>
      </TouchableRipple>
    );
  };

  return (
    <View>
      <Text style={styles.label}>Sipariş Bağla (opsiyonel)</Text>
      <TouchableRipple
        onPress={() => setOpen(true)}
        style={styles.trigger}
        borderless
        rippleColor="rgba(79,70,229,0.12)"
      >
        <View style={styles.triggerInner}>
          <Icon source="link-variant" size={18} color={colors.brand} />
          <Text style={styles.triggerText}>
            {value.length > 0 ? `${value.length} sipariş kalemi bağlı` : 'Sipariş seç'}
          </Text>
        </View>
      </TouchableRipple>

      {selectedLines.length > 0 ? (
        <View style={styles.chips}>
          {selectedLines.map((l) => (
            <TouchableRipple key={l.lineId} onPress={() => toggle(l.lineId)} style={styles.chip} borderless>
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

      <AppModal visible={open} onDismiss={() => setOpen(false)} position="bottom" contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Sipariş Kalemi Seç</Text>
          <TouchableRipple onPress={() => setOpen(false)} borderless style={styles.doneBtn}>
            <Text style={styles.doneText}>Tamam ({value.length})</Text>
          </TouchableRipple>
        </View>
        {!itemId ? (
          <TextInput
            mode="outlined"
            dense
            placeholder="Sipariş no / müşteri / ürün ara"
            value={searchInput}
            onChangeText={setSearchInput}
            left={<TextInput.Icon icon="magnify" />}
            style={styles.search}
          />
        ) : null}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : lines.length === 0 ? (
          <Text style={styles.empty}>
            {itemId ? 'Bu ürüne uyan açık sipariş kalemi yok.' : 'Açık sipariş kalemi bulunamadı.'}
          </Text>
        ) : (
          <View style={{ height: 360 }}>
            <FlashList
              data={lines}
              keyExtractor={(l) => l.lineId}
              renderItem={renderRow}
              onEndReachedThreshold={0.6}
              onEndReached={() => {
                if (!itemId && broad.hasNextPage && !broad.isFetchingNextPage) broad.fetchNextPage();
              }}
              ListFooterComponent={
                !itemId && broad.isFetchingNextPage ? (
                  <View style={styles.footer}>
                    <ActivityIndicator color={colors.brand} />
                  </View>
                ) : null
              }
            />
          </View>
        )}
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 2 },
  trigger: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  triggerDisabled: { opacity: 0.5 },
  triggerInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  triggerText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { backgroundColor: colors.brandSoft, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipText: { color: colors.brand, fontWeight: '700', fontSize: 12, maxWidth: 140 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  doneBtn: { backgroundColor: colors.brand, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: 8 },
  doneText: { color: '#fff', fontWeight: '700' },
  search: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  footer: { paddingVertical: spacing.md, alignItems: 'center' },
  center: { padding: spacing.xxl, alignItems: 'center' },
  empty: { textAlign: 'center', color: colors.textMuted, padding: spacing.xl },
  row: { borderRadius: radius.sm },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, paddingHorizontal: spacing.sm },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  openQty: { fontSize: 12, fontWeight: '700', color: colors.success },
});
