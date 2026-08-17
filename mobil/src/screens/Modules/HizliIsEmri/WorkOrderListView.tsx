import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TextInput, TouchableRipple, ActivityIndicator, Icon } from 'react-native-paper';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { workOrderService } from '../../../services/workOrder.service';
import type { WorkOrder } from '../../../types/models';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import {
  WORK_ORDER_STATUS_LABEL,
  WORK_ORDER_STATUS_COLOR,
  WORK_ORDER_TYPE_LABEL,
  trLabel,
} from '../../../utils/labels';
import { colors, spacing, radius } from '../../../theme';

const PAGE_SIZE = 20;

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Tümü' },
  { value: 'PLANNED', label: 'Planlandı' },
  { value: 'IN_PROGRESS', label: 'Devam' },
  { value: 'COMPLETED', label: 'Tamamlandı' },
  { value: 'CANCELLED', label: 'İptal' },
];

interface Props {
  onOpen: (workOrderId: string) => void;
  /** Listeyi tazelemek için dışarıdan artan sayaç (oluşturma/iptal sonrası). */
  refreshKey?: number;
}

export default function WorkOrderListView({ onOpen, refreshKey = 0 }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const debounced = useDebouncedValue(search.trim(), 350);
  const effectiveSearch = debounced.length >= 2 ? debounced : '';

  const q = useInfiniteQuery({
    queryKey: ['work-orders', 'hizli-list', status, effectiveSearch, refreshKey],
    queryFn: ({ pageParam }) =>
      workOrderService.getAllCursor(
        {
          limit: PAGE_SIZE,
          cursor: pageParam,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          search: effectiveSearch || undefined,
          filters: status ? { status } : undefined,
          withTotal: !pageParam,
        },
        { withOrderDetail: true },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : undefined),
    placeholderData: keepPreviousData,
  });

  const items = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const total = q.data?.pages[0]?.pagination.totalEstimate;

  // Tazeleme sonrası BAŞA sar. `keepPreviousData` yüzünden liste anahtar
  // değişince unmount OLMAZ (eski veriyle çizili kalır) — yani kaydırma konumu
  // korunur ve yeni açılan iş emri en üstte doğsa bile operatör onu görmez.
  const listRef = useRef<FlashListRef<WorkOrder>>(null);
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [refreshKey]);

  const renderItem = ({ item }: { item: WorkOrder }) => {
    const statusColor = WORK_ORDER_STATUS_COLOR[item.status] ?? colors.textMuted;
    const itemName = item.targetItem?.name ?? item.orderLinks?.[0]?.orderLine?.item?.name ?? '—';
    const colorName = item.targetColor?.name ?? null;
    const shownBatches = item.batches ?? [];
    const extraBatches = (item._count?.batches ?? shownBatches.length) - shownBatches.length;
    const batchLine = shownBatches.length
      ? `Parti: ${shownBatches.map((b) => b.batchNumber).join(' · ')}${extraBatches > 0 ? `  +${extraBatches}` : ''}`
      : '';
    return (
      <TouchableRipple onPress={() => onOpen(item.id)} style={styles.row} borderless rippleColor="rgba(79,70,229,0.10)">
        <View style={styles.rowInner}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <View style={{ flex: 1 }}>
            <View style={styles.rowTop}>
              <Text style={styles.batch} numberOfLines={1}>
                {item.workOrderNumber}
              </Text>
              <View style={[styles.statusChip, { backgroundColor: statusColor }]}>
                <Text style={styles.statusChipText}>{trLabel(WORK_ORDER_STATUS_LABEL, item.status)}</Text>
              </View>
            </View>
            <Text style={styles.rowSub} numberOfLines={1}>
              {itemName}
              {colorName ? ` · ${colorName}` : ''}
              {item.width != null ? ` · ${item.width}cm` : ''}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {trLabel(WORK_ORDER_TYPE_LABEL, item.type)}
              {item.createdAt ? ` · ${dayjs(item.createdAt).format('DD.MM.YYYY')}` : ''}
            </Text>
            {/* Parti no (2026-08-17 saha talebi): arama kutusu "Parti no ara"
                diyordu ama satırda parti hiç yazmıyordu — operatör aradığı
                numarayı sonuçta göremiyordu. */}
            {batchLine ? (
              <Text style={styles.rowBatches} numberOfLines={1}>
                {batchLine}
              </Text>
            ) : null}
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
          placeholder="Parti no ara (min 2)"
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
              rippleColor="rgba(79,70,229,0.12)"
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{f.label}</Text>
            </TouchableRipple>
          );
        })}
      </ScrollView>

      {total != null ? <Text style={styles.totalLine}>~{total} iş emri</Text> : null}

      {q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Icon source="clipboard-text-outline" size={48} color={colors.textMuted} />
          <Text style={styles.empty}>İş emri bulunamadı</Text>
        </View>
      ) : (
        <FlashList
          ref={listRef}
          data={items}
          keyExtractor={(w) => w.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
          }}
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
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterChipActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  filterTextActive: { color: colors.brand, fontWeight: '700' },
  totalLine: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs, color: colors.textMuted, fontSize: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm, padding: spacing.xxl },
  empty: { color: colors.textMuted, fontSize: 15 },
  listContent: { padding: spacing.md, paddingTop: 0 },
  row: { borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: spacing.sm },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  statusDot: { width: 8, height: 40, borderRadius: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  batch: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text },
  statusChip: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusChipText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  rowSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  rowBatches: { fontSize: 13, fontWeight: '700', color: colors.brand, marginTop: 2 },
  footerLoader: { paddingVertical: spacing.lg, alignItems: 'center' },
});
