import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { isMeasuredUnit } from '../../../lib/item-unit';
import { Text, TextInput, TouchableRipple, ActivityIndicator, Icon } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { orderService } from '../../../services/order.service';
import type { Order } from '../../../types/models';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { ORDER_STATUS_LABEL, ORDER_STATUS_COLOR, trLabel } from '../../../utils/labels';
import { queryProblem, QUERY_PROBLEM_TEXT } from '../../../utils/queryState';
import { colors, spacing, radius } from '../../../theme';

// =============================================================================
// Sipariş listesi — cursor + infinite scroll (mobil sayfalama standardı).
// Hızlı İş Emri'nin `WorkOrderListView`'ü ile aynı iskelet: arama · durum
// çipleri · yaklaşık toplam · FlashList.
//
// Satır TEK metraj rakamı basar (istenen) ve altında "sevk / açık" kırılımı
// verir. Kaynak `defaultInclude` ile gelen `lines` — ayrı bir istek YOK.
// =============================================================================

const PAGE_SIZE = 20;

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Tümü' },
  { value: 'APPROVED', label: 'Açık' },
  { value: 'PARTIAL_SHIPPED', label: 'Kısmi Sevk' },
  { value: 'COMPLETED', label: 'Tamamlandı' },
  { value: 'CANCELLED', label: 'İptal' },
];

/** Prisma Decimal JSON'da string gelebilir — tek yerde sayıya çevir. */
export function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function orderTotals(o: Order): { requested: number; shipped: number; open: number } {
  const lines = o.lines ?? [];
  // Yalnız METRE satırları: kg/adet satırın karşılaması ölçülmez (shippedQty 0),
  // paydaya girse "açık" hep şişer ve kg + m toplanamaz.
  const requested = lines.filter((l) => isMeasuredUnit(l.unit)).reduce((s, l) => s + num(l.quantity), 0);
  // Sipariş başlığındaki denormalize toplam tek yazma noktalıdır
  // (recomputeOrderFulfillment); satırları toplamak yerine onu tercih et.
  const shipped = o.shippedQty != null ? num(o.shippedQty) : lines.reduce((s, l) => s + num(l.shippedQty), 0);
  return { requested, shipped, open: Math.max(0, requested - shipped) };
}

interface Props {
  onOpen: (order: Order) => void;
  /** Oluşturma sonrası listeyi tazelemek için artan sayaç. */
  refreshKey?: number;
}

export default function OrderListView({ onOpen, refreshKey = 0 }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const debounced = useDebouncedValue(search.trim(), 350);
  // 2 karakterden kısa aramada sunucuya gitme — her harfte tam tablo taraması.
  const effectiveSearch = debounced.length >= 2 ? debounced : '';

  const q = useInfiniteQuery({
    queryKey: ['orders', 'mobile-list', status, effectiveSearch, refreshKey],
    queryFn: ({ pageParam }) =>
      orderService.listCursor({
        limit: PAGE_SIZE,
        cursor: pageParam,
        search: effectiveSearch || undefined,
        status: status || undefined,
        withTotal: !pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : undefined),
    placeholderData: keepPreviousData,
  });

  const items = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const total = q.data?.pages[0]?.pagination.totalEstimate;
  // Elde veri VARSA sorunu gösterme — bayat liste, boş ekrandan iyidir.
  const problem = items.length === 0 ? queryProblem(q) : null;

  const renderItem = ({ item }: { item: Order }) => {
    const statusColor = ORDER_STATUS_COLOR[item.status] ?? colors.textMuted;
    const { requested, shipped, open } = orderTotals(item);
    const lineCount = item.lines?.length ?? 0;
    const firstLine = item.lines?.[0];
    const specText = firstLine
      ? `${firstLine.item?.name ?? '—'}${firstLine.color?.name ? ` · ${firstLine.color.name}` : ''}` +
        (lineCount > 1 ? ` (+${lineCount - 1})` : '')
      : 'Kalem yok';

    return (
      <TouchableRipple
        onPress={() => onOpen(item)}
        style={styles.row}
        borderless
        rippleColor="rgba(13,148,136,0.10)"
      >
        <View style={styles.rowInner}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <View style={styles.rowCol}>
            <View style={styles.rowTop}>
              <Text style={styles.orderNo} numberOfLines={1}>
                {item.orderNumber}
              </Text>
              <View style={[styles.statusChip, { backgroundColor: statusColor }]}>
                <Text style={styles.statusChipText}>{trLabel(ORDER_STATUS_LABEL, item.status)}</Text>
              </View>
            </View>
            <Text style={styles.customer} numberOfLines={1}>
              {item.customer?.name ?? '—'}
              {item.branch?.name ? ` · ${item.branch.name}` : ''}
            </Text>
            <Text style={styles.spec} numberOfLines={1}>
              {specText}
            </Text>
            <View style={styles.qtyRow}>
              <Text style={styles.qtyMain}>{requested.toLocaleString('tr-TR')} m</Text>
              {shipped > 0 && (
                <Text style={styles.qtySub}>
                  sevk {shipped.toLocaleString('tr-TR')} · açık {open.toLocaleString('tr-TR')}
                </Text>
              )}
              {item.deadline ? (
                <Text style={styles.deadline}>termin {dayjs(item.deadline).format('DD.MM.YY')}</Text>
              ) : null}
            </View>
          </View>
          <Icon source="chevron-right" size={22} color={colors.textMuted} />
        </View>
      </TouchableRipple>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.searchRow}>
        <TextInput
          mode="outlined"
          dense
          placeholder="Sipariş no / müşteri / kumaş (min 2)"
          value={search}
          onChangeText={setSearch}
          left={<TextInput.Icon icon="magnify" />}
          right={search ? <TextInput.Icon icon="close" onPress={() => setSearch('')} /> : undefined}
          style={styles.searchInput}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {STATUS_FILTERS.map((f) => {
          const active = status === f.value;
          return (
            <TouchableRipple
              key={f.value || 'all'}
              onPress={() => setStatus(f.value)}
              style={[styles.filterChip, active && styles.filterChipActive]}
              borderless
              rippleColor="rgba(13,148,136,0.12)"
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{f.label}</Text>
            </TouchableRipple>
          );
        })}
      </ScrollView>

      {total != null ? <Text style={styles.totalLine}>~{total} sipariş</Text> : null}

      {q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : problem ? (
        // "Boş liste" ile "listeyi alamadım" AYRI cümlelerdir. ⚠️ `isError` TEK
        // BAŞINA YETMEZ: cihaz çevrimdışıyken React Query sorguyu duraklatır
        // (isPaused), hata VERMEZ — o hâlde bu dal atlanır ve ekran "hiç sipariş
        // yok" yalanını söylerdi (2026-08-05 saha vakası). Bkz. utils/queryState.
        <View style={styles.center}>
          <Icon source="wifi-off" size={44} color={colors.dangerText} />
          <Text style={styles.errorTitle}>
            {problem === 'offline' ? 'Çevrimdışısınız' : 'Liste alınamadı'}
          </Text>
          <Text style={styles.errorText}>{QUERY_PROBLEM_TEXT[problem]}</Text>
          <TouchableRipple onPress={() => void q.refetch()} style={styles.retryBtn} borderless>
            <Text style={styles.retryText}>Tekrar dene</Text>
          </TouchableRipple>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Icon source="clipboard-text-outline" size={48} color={colors.textMuted} />
          <Text style={styles.empty}>
            {effectiveSearch || status ? 'Bu filtreye uyan sipariş yok' : 'Henüz sipariş yok'}
          </Text>
        </View>
      ) : (
        <FlashList
          data={items}
          keyExtractor={(o) => o.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
          }}
          refreshing={q.isRefetching && !q.isFetchingNextPage}
          onRefresh={() => void q.refetch()}
          ListFooterComponent={
            q.isFetchingNextPage ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  searchRow: { padding: spacing.md, paddingBottom: spacing.sm },
  searchInput: { backgroundColor: colors.surface },
  filterScroll: { flexGrow: 0, marginBottom: spacing.sm },
  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, alignItems: 'center' },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipActive: { borderColor: '#0d9488', backgroundColor: '#ccfbf1' },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  filterTextActive: { color: '#0f766e', fontWeight: '700' },
  totalLine: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs, color: colors.textMuted, fontSize: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm, padding: spacing.xxl },
  empty: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
  errorTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  errorText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  retryText: { color: colors.brand, fontWeight: '700' },
  listContent: { padding: spacing.md, paddingTop: 0 },
  row: { borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: spacing.sm },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  statusDot: { width: 8, height: 52, borderRadius: 4 },
  rowCol: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  orderNo: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '800', color: colors.text },
  statusChip: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusChipText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  customer: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
  spec: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  qtyRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.sm, marginTop: 4 },
  qtyMain: { fontSize: 15, fontWeight: '800', color: '#0f766e' },
  qtySub: { fontSize: 12, color: colors.textMuted },
  deadline: { fontSize: 12, color: colors.textMuted },
  footerLoader: { paddingVertical: spacing.lg, alignItems: 'center' },
});
