import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Surface,
  Text,
  Button,
  TextInput,
  ActivityIndicator,
  TouchableRipple,
  Divider,
  Chip,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import ScreenChrome from '../../../components/ScreenChrome';
// paper `Menu` YERİNE — Fabric "Maximum update depth exceeded" ailesi. Bkz. AppMenu.tsx.
import AppMenu from '../../../components/AppMenu';
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { useTruncationWarning } from '../../../hooks/useTruncationWarning';
import { packingService, type ShipmentListItem } from '../../../services/packing.service';
import { customerService } from '../../../services/customer.service';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import type { MainStackParamList } from '../../../navigation/types';
import { foldSearchText } from '../../../utils/searchFold';

// =============================================================================
// Sevkiyat Geçmişi — DISPATCHED sevkiyatlar. FlashList + cursor sonsuz kaydırma
// (perf: hiç "hepsini" çekmez/render etmez). Tıkla → SevkiyatDetay (push).
// Filtreler: müşteri (server) · arama/dönem/şube (yüklenen sayfalarda).
// =============================================================================

type Period = 'all' | 'today' | 'week';

export default function SevkiyatGecmisiScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [customerFilter, setCustomerFilter] = useState<string | null>(null);
  const [customerLabel, setCustomerLabel] = useState('Tüm müşteriler');
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [custMenuOpen, setCustMenuOpen] = useState(false);

  // Cursor sonsuz kaydırma — server filtre: DISPATCHED + (seçilirse) customerId.
  const listQ = useInfiniteQuery({
    queryKey: ['shipments', 'DISPATCHED', 'cursor', customerFilter] as const,
    queryFn: ({ pageParam }) =>
      packingService.listShipmentsCursor({
        status: 'DISPATCHED',
        customerId: customerFilter ?? undefined,
        cursor: pageParam,
        limit: 20,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : null),
    staleTime: 30_000,
  });
  const all = useMemo(() => listQ.data?.pages.flatMap((p) => p.data) ?? [], [listQ.data]);

  const custQ = useQuery({
    queryKey: ['customers', 'picker'],
    queryFn: () => customerService.getAll({ page: 1, pageSize: 200 }),
    staleTime: 60_000,
  });
  const customers = custQ.data?.data ?? [];
  useTruncationWarning(custQ.data?.pagination, 'Müşteri');

  const refresh = useManualRefresh(() => listQ.refetch(), 'Geçmiş güncellendi');

  // Şube chip'leri — yüklenen (accumulated) sonuçtaki ayrık şubeler.
  const branches = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of all) if (s.branch) m.set(s.branch.id, s.branch.name);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [all]);

  // Client filtreler (yüklenen sayfalar üzerinde): arama + dönem + şube.
  const filtered = useMemo(() => {
    const q = foldSearchText(search);
    const cutoff =
      period === 'today'
        ? dayjs().startOf('day').valueOf()
        : period === 'week'
          ? dayjs().subtract(7, 'day').valueOf()
          : 0;
    return all.filter((s) => {
      if (branchFilter && s.branch?.id !== branchFilter) return false;
      if (cutoff) {
        const t = s.dispatchedAt ? dayjs(s.dispatchedAt).valueOf() : 0;
        if (t < cutoff) return false;
      }
      if (!q) return true;
      return (
        foldSearchText(s.shipmentNo).includes(q) ||
        foldSearchText(s.customer.name).includes(q)
      );
    });
  }, [all, search, period, branchFilter]);

  const renderItem = ({ item: s }: { item: ShipmentListItem }) => (
    <TouchableRipple
      onPress={() =>
        nav.navigate('SevkiyatDetay', { shipmentId: s.id, shipmentNo: s.shipmentNo })
      }
      style={styles.card}
    >
      <Surface style={styles.cardInner} elevation={1}>
        <View style={styles.cardHead}>
          <Text style={styles.rowMono}>{s.shipmentNo}</Text>
          <Text style={styles.meta}>
            {s.dispatchedAt ? dayjs(s.dispatchedAt).format('DD.MM HH:mm') : ''}
          </Text>
        </View>
        <Text style={styles.rowMain}>
          {s.customer.name}
          {s.branch ? ` · ${s.branch.name}` : ''}
        </Text>
        <Text style={styles.meta}>
          {s._count.rolls} top · {s._count.sacks} çuval
          {s.plateNumber ? ` · ${s.plateNumber}` : ''} ›
        </Text>
      </Surface>
    </TouchableRipple>
  );

  return (
    <ScreenChrome
      title="Sevkiyat Geçmişi"
      subtitle="Sevk edilmiş sevkiyatlar"
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
      <View style={styles.filters}>
        <TextInput
          mode="outlined"
          dense
          placeholder="İrsaliye no / müşteri ara..."
          value={search}
          onChangeText={setSearch}
          left={<TextInput.Icon icon="magnify" />}
        />
        <AppMenu
          visible={custMenuOpen}
          onDismiss={() => setCustMenuOpen(false)}
          anchor={
            <Button
              mode="outlined"
              icon="account"
              onPress={() => setCustMenuOpen(true)}
              contentStyle={styles.custBtnContent}
            >
              {customerLabel}
            </Button>
          }
        >
          <AppMenu.Item
            title="Tüm müşteriler"
            onPress={() => {
              setCustomerFilter(null);
              setCustomerLabel('Tüm müşteriler');
              setBranchFilter(null);
              setCustMenuOpen(false);
            }}
          />
          {customers.map((c) => (
            <AppMenu.Item
              key={c.id}
              title={c.name}
              onPress={() => {
                setCustomerFilter(c.id);
                setCustomerLabel(c.name);
                setBranchFilter(null);
                setCustMenuOpen(false);
              }}
            />
          ))}
        </AppMenu>
        {customerFilter && branches.length > 1 && (
          <View style={styles.branchRow}>
            <Chip compact selected={!branchFilter} onPress={() => setBranchFilter(null)}>
              Tüm şubeler
            </Chip>
            {branches.map((b) => (
              <Chip
                key={b.id}
                compact
                selected={branchFilter === b.id}
                onPress={() => setBranchFilter(b.id)}
              >
                {b.name}
              </Chip>
            ))}
          </View>
        )}
        <View style={styles.periodRow}>
          {(['all', 'today', 'week'] as Period[]).map((p) => (
            <Button
              key={p}
              compact
              mode={period === p ? 'contained' : 'outlined'}
              onPress={() => setPeriod(p)}
              style={styles.periodBtn}
            >
              {p === 'all' ? 'Tümü' : p === 'today' ? 'Bugün' : '7 gün'}
            </Button>
          ))}
        </View>
      </View>
      <Divider />
      <View style={{ flex: 1 }}>
        <FlashList
          data={filtered}
          keyExtractor={(s) => s.id}
          renderItem={renderItem}
          contentContainerStyle={styles.body}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (listQ.hasNextPage && !listQ.isFetchingNextPage) listQ.fetchNextPage();
          }}
          ListEmptyComponent={
            listQ.isLoading ? (
              <ActivityIndicator style={{ marginTop: 24 }} />
            ) : (
              <Text style={styles.emptySub}>Kayıt yok.</Text>
            )
          }
          ListFooterComponent={
            listQ.isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: 16 }} />
            ) : null
          }
        />
      </View>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  filters: { padding: 12, gap: 8, backgroundColor: '#fff' },
  custBtnContent: { justifyContent: 'flex-start' },
  branchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  periodRow: { flexDirection: 'row', gap: 8 },
  periodBtn: { flex: 1 },
  body: { padding: 12, paddingBottom: 32 },
  card: { borderRadius: 12, marginBottom: 8 },
  cardInner: { borderRadius: 12, padding: 12, backgroundColor: '#fff' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowMain: { fontSize: 14, fontWeight: '600', color: '#0f172a', marginTop: 2 },
  rowMono: { fontSize: 14, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  meta: { fontSize: 12, color: '#64748b' },
  emptySub: { fontSize: 13, color: '#94a3b8', marginTop: 16, textAlign: 'center' },
});
