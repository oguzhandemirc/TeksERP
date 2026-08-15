import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Text,
  TextInput,
  TouchableRipple,
  Icon,
  ActivityIndicator,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';

import ScreenChrome from '../../../components/ScreenChrome';
// paper `Menu` YERİNE — Fabric "Maximum update depth exceeded" ailesi. Bkz. AppMenu.tsx.
import AppMenu from '../../../components/AppMenu';
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { SkeletonList } from '../../../components/motion';
import { DispatchRow } from '../../../components/dispatch';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import {
  subcontractorService,
  type DispatchStatusFilter,
} from '../../../services/subcontractor.service';
import type { SubcontractorDispatchListItem } from '../../../types/models';
import { colors, spacing, radius } from '../../../theme';
import type { MainStackParamList } from '../../../navigation/types';

// =============================================================================
// Fason Sevk Geçmişi — eski "Son Sevkler" modalının yerini alan tam sayfa.
// Cursor (keyset) sonsuz kaydırma → hiç "hepsini" çekmez. Tüm filtreler
// SUNUCU-taraflı (durum/firma/arama/dönem) → over-fetch yok, count yok.
// Satıra tıkla → inline detay (DispatchRow lazy fetch). Sağdaki × → iptal.
// =============================================================================

type Period = 'all' | 'today' | 'week';

const STATUS_TABS: { key: DispatchStatusFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'active', label: 'Açık' },
  { key: 'cancelled', label: 'İptal' },
];

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'today', label: 'Bugün' },
  { key: 'week', label: '7 gün' },
];

const PAGE = 30;

export default function FasonSevkGecmisiScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 350);
  const [status, setStatus] = useState<DispatchStatusFilter>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [firmId, setFirmId] = useState<string | null>(null);
  const [firmName, setFirmName] = useState('');
  const [firmPickerOpen, setFirmPickerOpen] = useState(false);

  // Aynı anda tek satır açık — operatör başkasına basınca eski kapanır.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SubcontractorDispatchListItem | null>(null);

  // Dönem → ISO dateFrom (server filtresi, dispatchedAt indeksi üzerinden).
  const dateFrom = useMemo(() => {
    if (period === 'today') return dayjs().startOf('day').toISOString();
    if (period === 'week') return dayjs().subtract(7, 'day').toISOString();
    return undefined;
  }, [period]);

  // ── Firma filtresi seçenekleri (tüm aktif fason firmalar) ──
  const firmsQuery = useQuery({
    queryKey: ['subcontractors', 'history-filter'],
    queryFn: () =>
      subcontractorService.listSubcontractors({
        page: 1,
        pageSize: 500,
        sortBy: 'name',
        sortOrder: 'asc',
        filters: { isActive: 'true' },
      }),
    staleTime: 5 * 60 * 1000,
  });
  const firmOptions = useMemo<PickerOption[]>(
    () => [
      { value: '', label: 'Tüm firmalar' },
      ...(firmsQuery.data?.data ?? []).map((f) => ({
        value: f.id,
        label: f.name,
        sublabel: f.code ?? undefined,
      })),
    ],
    [firmsQuery.data]
  );

  // ── Cursor sonsuz kaydırma — queryKey'e tüm filtreler dahil ──
  const query = useInfiniteQuery({
    queryKey: ['dispatches', 'history', status, firmId, debouncedSearch, period] as const,
    queryFn: ({ pageParam }) =>
      subcontractorService.listDispatchesCursor({
        status,
        subcontractorId: firmId ?? undefined,
        search: debouncedSearch || undefined,
        dateFrom,
        limit: PAGE,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : null),
    staleTime: 20_000,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  const refresh = useManualRefresh(() => query.refetch(), 'Geçmiş güncellendi');

  // ── İptal mutasyonu ──
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      subcontractorService.cancelDispatch(id, { reason }),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Sevk iptal edildi',
        text2: `${res.data?.dispatchNo ?? ''} · toplar STOCK'a döndü`,
      });
      setCancelTarget(null);
      qc.invalidateQueries({ queryKey: ['dispatches'] });
      void query.refetch();
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'İptal başarısız', text2: err.message });
    },
  });

  // Stable handler'lar — DispatchRow memo'lu, referans sabit kalmalı.
  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);
  const handleCancel = useCallback((item: SubcontractorDispatchListItem) => {
    setCancelTarget(item);
  }, []);
  const renderItem = useCallback(
    ({ item }: { item: SubcontractorDispatchListItem }) => (
      <DispatchRow
        dispatch={item}
        expanded={expandedId === item.id}
        onToggleExpand={handleToggleExpand}
        onCancel={handleCancel}
      />
    ),
    [expandedId, handleToggleExpand, handleCancel]
  );

  const activeFilterCount =
    (status !== 'all' ? 1 : 0) +
    (period !== 'all' ? 1 : 0) +
    (firmId ? 1 : 0) +
    (debouncedSearch ? 1 : 0);

  return (
    <ScreenChrome
      title="Sevk Geçmişi"
      onBack={() => nav.goBack()}
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
      {/* ── Filtre çubuğu (mobil: tam-genişlik, büyük dokunma hedefi) ── */}
      <View style={styles.filters}>
        <TextInput
          mode="outlined"
          dense
          placeholder="Sevk no · firma · parti ara..."
          value={search}
          onChangeText={setSearch}
          left={<TextInput.Icon icon="magnify" />}
          right={
            search ? <TextInput.Icon icon="close" onPress={() => setSearch('')} /> : undefined
          }
        />

        {/* Firma seçici — tam genişlik */}
        <TouchableRipple
          style={styles.firmChip}
          onPress={() => setFirmPickerOpen(true)}
          borderless
        >
          <View style={styles.firmChipInner}>
            <Icon source="factory" size={16} color={colors.textSecondary} />
            <Text style={styles.firmChipText} numberOfLines={1}>
              {firmId ? firmName : 'Tüm firmalar'}
            </Text>
            <Icon source="chevron-down" size={18} color={colors.textMuted} />
          </View>
        </TouchableRipple>

        {/* Durum + Dönem — yan yana iki dropdown (yerden tasarruf) */}
        <View style={styles.dropdownRow}>
          <FilterDropdown
            icon="filter-variant"
            tabs={STATUS_TABS}
            value={status}
            onChange={(v) => setStatus(v as DispatchStatusFilter)}
          />
          <FilterDropdown
            icon="calendar-blank-outline"
            tabs={PERIOD_TABS}
            value={period}
            onChange={(v) => setPeriod(v as Period)}
          />
        </View>
      </View>

      {/* ── Liste ── */}
      {query.isLoading ? (
        <View style={styles.body}>
          <SkeletonList count={6} />
        </View>
      ) : query.isError ? (
        <View style={styles.center}>
          <Icon source="alert-circle-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Liste yüklenemedi</Text>
          <Text style={styles.emptyHint}>{(query.error as Error).message}</Text>
          <TouchableRipple style={styles.retryBtn} onPress={() => void query.refetch()} borderless>
            <Text style={styles.retryText}>Tekrar dene</Text>
          </TouchableRipple>
        </View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(d) => d.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          refreshing={refresh.refreshing}
          onRefresh={refresh.onRefresh}
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon source="truck-remove-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>
                {activeFilterCount > 0 ? 'Bu filtreyle sevk yok' : 'Henüz sevk yok'}
              </Text>
              {activeFilterCount > 0 && (
                <Text style={styles.emptyHint}>Filtreleri genişletmeyi deneyin.</Text>
              )}
            </View>
          }
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.brand} />
            ) : null
          }
        />
      )}

      {/* Firma filtre picker */}
      <PickerModal
        visible={firmPickerOpen}
        title="Firma Filtresi"
        options={firmOptions}
        selectedValue={firmId ?? ''}
        onSelect={(v) => {
          setFirmId(v || null);
          setFirmName(firmOptions.find((o) => o.value === v)?.label ?? '');
          setFirmPickerOpen(false);
        }}
        onDismiss={() => setFirmPickerOpen(false)}
      />

      {/* İptal onayı */}
      <ConfirmDialog
        kind="destructive"
        visible={!!cancelTarget}
        title="Sevki İptal Et"
        description={
          cancelTarget
            ? `${cancelTarget.dispatchNo} (${cancelTarget.subcontractor?.name ?? '—'}) iptal edilecek. Sevkteki toplar STOCK durumuna geri dönecek.`
            : ''
        }
        reason={{
          label: 'İptal Sebebi',
          placeholder: 'Yanlış fason firma seçildi...',
          required: true,
          minLength: 3,
        }}
        confirmLabel="İptal Et"
        cancelLabel="Vazgeç"
        confirming={cancelMutation.isPending}
        onDismiss={() => setCancelTarget(null)}
        onConfirm={({ reason }) => {
          if (cancelTarget) cancelMutation.mutate({ id: cancelTarget.id, reason: reason ?? '' });
        }}
      />
    </ScreenChrome>
  );
}

// ---------------------------------------------------------------------------
// FilterDropdown — kompakt dropdown (AppMenu). İki tanesi yan yana dizilir;
// segmented control'e göre yer kazandırır. Seçili değer + chevron gösterir.
// ---------------------------------------------------------------------------
function FilterDropdown<T extends string>({
  icon,
  tabs,
  value,
  onChange,
}: {
  icon: string;
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = tabs.find((t) => t.key === value) ?? tabs[0];
  return (
    <View style={styles.dropdownWrap}>
      <AppMenu
        visible={open}
        onDismiss={() => setOpen(false)}
        anchor={
          <TouchableRipple style={styles.dropdown} onPress={() => setOpen(true)} borderless>
            <View style={styles.dropdownInner}>
              <Icon source={icon} size={16} color={colors.textSecondary} />
              <Text style={styles.dropdownText} numberOfLines={1}>
                {current.label}
              </Text>
              <Icon source="chevron-down" size={18} color={colors.textMuted} />
            </View>
          </TouchableRipple>
        }
      >
        {tabs.map((t) => (
          <AppMenu.Item
            key={t.key}
            title={t.label}
            onPress={() => {
              onChange(t.key);
              setOpen(false);
            }}
            trailingIcon={value === t.key ? 'check' : undefined}
          />
        ))}
      </AppMenu>
    </View>
  );
}

const styles = StyleSheet.create({
  filters: {
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  firmChip: {
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  firmChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 8,
    height: 44,
  },
  firmChipText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },

  // Yan yana iki dropdown (durum + dönem)
  dropdownRow: { flexDirection: 'row', gap: spacing.sm },
  dropdownWrap: { flex: 1 },
  dropdown: { borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  dropdownInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 8,
    height: 44,
  },
  dropdownText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },

  body: { padding: spacing.md },
  listContent: { padding: spacing.sm, paddingBottom: spacing.xxxl },

  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  emptyHint: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.lg },
  retryBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
  },
  retryText: { fontSize: 13, fontWeight: '700', color: colors.brand },
});
