import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Text,
  TextInput,
  Button,
  ActivityIndicator,
  TouchableRipple,
  Divider,
  Appbar,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { packingService, type OpenOrder } from '../../../services/packing.service';
import { customerService } from '../../../services/customer.service';
import { usePermissions } from '../../../hooks/usePermission';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import type { MainStackParamList } from '../../../navigation/types';

// =============================================================================
// Tartı / Paket — GİRİŞ ekranı (push: Paketleme). Çuval Depo modeli:
//   • "Sürdür": havuzda çuvalı olan müşteriler (/pool) → Paketleme.
//   • "Müşteriye Çuvalla": doğrudan müşteri seç → Paketleme.
//   • Açık siparişler: tek müşteri+şube seç → türetilen müşteriyle Paketleme.
// Paketleme müşteri workspace'idir (çuval aç/okut/tart); sevkiyat orada kurulur.
// =============================================================================

const groupKey = (customerId: string, branchId: string | null) => `${customerId}|${branchId ?? ''}`;

// "Sürdür" başta en fazla bu kadar; fazlası aç-kapa ile açılır.
const POOL_CAP = 5;

// Bizdeki ad + (karşıdaki ad) — alias farklıysa parantezde.
const dualName = (ourName: string, custName?: string | null) =>
  custName && custName.trim() && custName !== ourName ? `${ourName} (${custName})` : ourName;

export default function TartiPaketScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { has } = usePermissions();
  const canShip = has('mobile:sevkiyat');

  const [selected, setSelected] = useState<string[]>([]);
  const [selGroup, setSelGroup] = useState<string | null>(null);
  const [showAllPool, setShowAllPool] = useState(false);
  const [custPickerOpen, setCustPickerOpen] = useState(false);

  const openOrdersQ = useQuery({
    queryKey: ['open-orders'],
    queryFn: () => packingService.listOpenOrders(),
    staleTime: 10_000,
  });
  const openOrders = openOrdersQ.data?.data ?? [];

  // Çuval havuzu — çuvalı olan müşteriler ("Sürdür"). Müşterisiz grup da olabilir.
  const poolQ = useQuery({
    queryKey: ['pool'],
    queryFn: () => packingService.listPool(),
    staleTime: 10_000,
  });
  const pool = poolQ.data?.data ?? [];

  // Sevk kapısı sayacı (PLANNED/AT_DOOR) — köprü kartı.
  const boardQ = useQuery({
    queryKey: ['sack-store', 'board', 'bridge'],
    queryFn: () => packingService.listSackStoreBoard({ limit: 30 }),
    enabled: canShip,
    staleTime: 10_000,
  });
  const doorCount = boardQ.data?.data.length ?? 0;
  const doorMore = boardQ.data?.pagination.hasMore ?? false;

  // Müşteri picker (Müşteriye Çuvalla) — açılınca lazy.
  const custQ = useQuery({
    queryKey: ['customers', 'picker'],
    queryFn: () => customerService.getAll({ page: 1, pageSize: 300, sortBy: 'name', sortOrder: 'asc' }),
    enabled: custPickerOpen,
    staleTime: 60_000,
  });
  const custOptions: PickerOption[] = (custQ.data?.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
    sublabel: c.code,
  }));

  const headerRefresh = useManualRefresh(
    [() => openOrdersQ.refetch(), () => poolQ.refetch(), () => boardQ.refetch()],
    'Liste güncellendi',
  );

  // ── Sipariş seçimi (tek müşteri + şube) ──
  const toggleOrder = (o: OpenOrder) => {
    const key = groupKey(o.order.customer.id, o.order.branch?.id ?? null);
    if (selected.includes(o.order.id)) {
      const next = selected.filter((id) => id !== o.order.id);
      setSelected(next);
      if (next.length === 0) setSelGroup(null);
      return;
    }
    if (selected.length > 0 && selGroup !== key) {
      Toast.show({ type: 'info', text1: 'Tek müşteri + şube', text2: 'Önce farklı müşteriyi kaldır.' });
      return;
    }
    setSelGroup(key);
    setSelected((s) => [...s, o.order.id]);
  };

  const startPacking = () => {
    const first = openOrders.find((o) => selected.includes(o.order.id));
    if (!first) return;
    const customerId = first.order.customer.id;
    const bId = first.order.branch?.id ?? null;
    setSelected([]);
    setSelGroup(null);
    nav.navigate('Paketleme', { customerId, branchId: bId });
  };

  const inSelGroup = (o: OpenOrder) =>
    selGroup === groupKey(o.order.customer.id, o.order.branch?.id ?? null);
  const displayOrders = useMemo(() => {
    const base = [...openOrders].sort((a, b) => {
      const ad = a.order.deadline ? new Date(a.order.deadline).getTime() : Infinity;
      const bd = b.order.deadline ? new Date(b.order.deadline).getTime() : Infinity;
      return ad - bd;
    });
    if (!selGroup) return base;
    return [...base.filter((o) => inSelGroup(o)), ...base.filter((o) => !inSelGroup(o))];
  }, [openOrders, selGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  const [orderSearch, setOrderSearch] = useState('');
  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLocaleLowerCase('tr');
    if (!q) return displayOrders;
    return displayOrders.filter(
      (o) =>
        o.order.orderNumber.toLocaleLowerCase('tr').includes(q) ||
        o.order.customer.name.toLocaleLowerCase('tr').includes(q) ||
        (o.order.branch?.name ?? '').toLocaleLowerCase('tr').includes(q),
    );
  }, [displayOrders, orderSearch]);

  type OrderRow = { kind: 'order'; o: OpenOrder } | { kind: 'sep' };
  const orderRows = useMemo<OrderRow[]>(() => {
    if (!selGroup) return filteredOrders.map((o) => ({ kind: 'order' as const, o }));
    const inG = filteredOrders.filter((o) => inSelGroup(o));
    const outG = filteredOrders.filter((o) => !inSelGroup(o));
    return [
      ...inG.map((o) => ({ kind: 'order' as const, o })),
      ...(outG.length > 0 ? [{ kind: 'sep' as const }] : []),
      ...outG.map((o) => ({ kind: 'order' as const, o })),
    ];
  }, [filteredOrders, selGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderOrderCard = (o: OpenOrder) => {
    const isSel = selected.includes(o.order.id);
    const key = groupKey(o.order.customer.id, o.order.branch?.id ?? null);
    const disabled = selected.length > 0 && selGroup !== key && !isSel;
    return (
      <TouchableRipple
        key={o.order.id}
        onPress={() => toggleOrder(o)}
        disabled={disabled}
        style={[styles.orderCard, isSel && styles.orderCardSel, disabled && styles.orderCardDim]}
      >
        <View>
          <View style={styles.cardHead}>
            <Text style={styles.rollBarcode}>
              {isSel ? '✓ ' : ''}
              {o.order.orderNumber}
            </Text>
            <Text style={styles.covMeta}>
              {o.order.customer.name}
              {o.order.branch ? ` · ${o.order.branch.name}` : ''}
            </Text>
          </View>
          {o.lines.map((l) => (
            <View key={l.lineId} style={styles.covRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.covSpec} numberOfLines={2}>
                  {dualName(l.item.name, l.customerItemName)}
                  {l.color ? ` · ${dualName(l.color.name, l.customerColorName)}` : ''}
                </Text>
                <Text style={styles.covMeta}>
                  {l.width ? `${l.width}cm · ` : ''}
                  {Math.round(l.openQty)}m
                </Text>
              </View>
              <Text style={[styles.covTag, l.covered ? styles.covOk : styles.covShort]}>
                {l.covered
                  ? 'depo ✓'
                  : `${Math.round(Math.max(0, l.openQty - l.warehouseAvailable))}m eksik`}
              </Text>
            </View>
          ))}
        </View>
      </TouchableRipple>
    );
  };

  return (
    <ScreenChrome
      title="Sevkiyat"
      headerExtras={
        <>
          <RefreshButton
            headerStyle
            onPress={headerRefresh.onRefresh}
            refreshing={headerRefresh.refreshing}
            isError={headerRefresh.isError}
            errorMessage={headerRefresh.errorMessage}
            successMessage={headerRefresh.successMessage}
          />
          <Appbar.Action
            icon="account-plus"
            color="#fff"
            onPress={() => setCustPickerOpen(true)}
            accessibilityLabel="Müşteriye çuvalla — doğrudan müşteri seç"
          />
          <Appbar.Action
            icon="lightning-bolt"
            color="#fff"
            onPress={() => nav.navigate('HizliSiparis')}
            accessibilityLabel="Hızlı sipariş — ham top okut → sipariş"
          />
          <Appbar.Action
            icon="package-variant"
            color="#fff"
            onPress={() => nav.navigate('CuvalDuzelt')}
            accessibilityLabel="Çuval düzeltme — top çıkar / taşı"
          />
          <Appbar.Action
            icon="history"
            color="#fff"
            onPress={() => nav.navigate('SevkiyatGecmisi')}
            accessibilityLabel="Sevkiyat geçmişi"
          />
        </>
      }
    >
      <FlashList
        data={orderRows}
        keyExtractor={(r) => (r.kind === 'order' ? r.o.order.id : 'group-sep')}
        renderItem={({ item }) =>
          item.kind === 'order' ? (
            renderOrderCard(item.o)
          ) : (
            <View style={styles.otherSep}>
              <Divider style={{ flex: 1 }} />
              <Text style={styles.otherSepText}>Diğer (farklı müşteri/şube)</Text>
              <Divider style={{ flex: 1 }} />
            </View>
          )
        }
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            {canShip && doorCount > 0 && (
              <TouchableRipple onPress={() => nav.navigate('Sevkiyat')} style={styles.bridge}>
                <View style={styles.bridgeInner}>
                  <Text style={styles.bridgeText}>
                    {doorCount}
                    {doorMore ? '+' : ''} sevkiyat kapıda (kamyon bekliyor)
                  </Text>
                  <Text style={styles.bridgeCta}>Sevk Çıkışı →</Text>
                </View>
              </TouchableRipple>
            )}

            {/* Çuval havuzunda çuvalı olan müşteriler ("Sürdür") */}
            {pool.length > 0 && (
              <>
                <Text variant="titleSmall" style={styles.section}>
                  Çuval Havuzu ({pool.length})
                </Text>
                {(showAllPool ? pool : pool.slice(0, POOL_CAP)).map((g) => (
                  <TouchableRipple
                    key={g.customer?.id ?? 'no-customer'}
                    onPress={() =>
                      g.customer
                        ? nav.navigate('Paketleme', { customerId: g.customer.id })
                        : Toast.show({
                            type: 'info',
                            text1: 'Müşterisiz çuvallar',
                            text2: 'Sevk Çıkışı’ndan sevkiyata ekleyin.',
                          })
                    }
                    style={styles.resumeCard}
                  >
                    <View style={styles.bridgeInner}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rollBarcode}>{g.customer?.name ?? 'Müşterisiz'}</Text>
                        <Text style={styles.covMeta}>
                          {g.sackCount} çuval · {g.rollCount} top
                          {g.totalKg > 0 ? ` · ${g.totalKg.toLocaleString('tr-TR')} kg` : ''}
                        </Text>
                      </View>
                      <Text style={styles.bridgeCta}>{g.customer ? 'Sürdür →' : 'Sevk Çıkışı →'}</Text>
                    </View>
                  </TouchableRipple>
                ))}
                {pool.length > POOL_CAP && (
                  <TouchableRipple onPress={() => setShowAllPool((v) => !v)} style={styles.morePreparing}>
                    <Text style={styles.morePreparingText}>
                      {showAllPool
                        ? 'Daha az göster ▴'
                        : `+${pool.length - POOL_CAP} müşteri daha göster ▾`}
                    </Text>
                  </TouchableRipple>
                )}
                <Divider style={{ marginVertical: 12 }} />
              </>
            )}

            <Text variant="titleSmall" style={styles.section}>
              Açık Siparişler
            </Text>
            <Text style={styles.hint}>Tek müşteri + şube seç. Depo karşılaması satırda görünür.</Text>
            <TextInput
              mode="outlined"
              dense
              value={orderSearch}
              onChangeText={setOrderSearch}
              placeholder="Müşteri, sipariş no veya şube ara…"
              left={<TextInput.Icon icon="magnify" />}
              right={
                orderSearch ? <TextInput.Icon icon="close" onPress={() => setOrderSearch('')} /> : null
              }
              style={styles.searchBox}
            />
            {openOrdersQ.isLoading && <ActivityIndicator style={{ marginTop: 24 }} />}
          </View>
        }
        ListEmptyComponent={
          openOrdersQ.isLoading ? null : (
            <Text style={styles.emptySub}>
              {orderSearch ? 'Aramayla eşleşen açık sipariş yok.' : 'Açık sipariş yok.'}
            </Text>
          )
        }
      />

      {selected.length > 0 && (
        <View style={styles.footer}>
          <Button mode="contained" icon="arrow-right" contentStyle={{ height: 52 }} onPress={startPacking}>
            Paketlemeye Geç ({selected.length} sipariş)
          </Button>
        </View>
      )}

      {/* Müşteriye Çuvalla — doğrudan müşteri seç → Paketleme */}
      <PickerModal
        visible={custPickerOpen}
        title="Müşteriye Çuvalla"
        options={custOptions}
        loading={custQ.isLoading}
        onSelect={(value) => {
          setCustPickerOpen(false);
          nav.navigate('Paketleme', { customerId: value });
        }}
        onDismiss={() => setCustPickerOpen(false)}
        emptyText="Müşteri bulunamadı"
      />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 32 },
  searchBox: { marginBottom: 10, backgroundColor: '#fff' },
  bridge: { borderRadius: 10, backgroundColor: '#1e40af', marginBottom: 10 },
  bridgeInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  bridgeText: { color: '#fff', fontWeight: '600' },
  bridgeCta: { color: '#bfdbfe', fontWeight: '700' },
  resumeCard: { borderRadius: 10, backgroundColor: '#f1f5f9', marginBottom: 8 },
  morePreparing: { borderRadius: 8, backgroundColor: '#eef2ff', paddingVertical: 9, alignItems: 'center', marginBottom: 8 },
  morePreparingText: { fontSize: 13, color: '#4338ca', fontWeight: '700' },
  section: { fontWeight: '700', color: '#0f172a', marginTop: 8, marginBottom: 4 },
  hint: { fontSize: 12, color: '#94a3b8', marginBottom: 6 },
  covRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 },
  covSpec: { flex: 1, fontSize: 13, color: '#334155' },
  covMeta: { fontSize: 12, color: '#64748b' },
  covTag: { fontSize: 12, fontWeight: '700' },
  covOk: { color: '#059669' },
  covShort: { color: '#b45309' },
  rollBarcode: { fontSize: 14, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  emptySub: { fontSize: 13, color: '#94a3b8', marginVertical: 8 },
  orderCard: { borderRadius: 12, padding: 12, backgroundColor: '#fff', marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  orderCardSel: { borderColor: '#059669', backgroundColor: '#ecfdf5' },
  orderCardDim: { opacity: 0.45 },
  otherSep: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 },
  otherSepText: { fontSize: 11, color: '#94a3b8' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  footer: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0', backgroundColor: '#fff' },
});
