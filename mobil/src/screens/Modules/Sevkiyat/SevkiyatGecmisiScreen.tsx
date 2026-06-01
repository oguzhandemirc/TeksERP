import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  Surface,
  Text,
  Button,
  TextInput,
  ActivityIndicator,
  TouchableRipple,
  Divider,
  Menu,
  Chip,
} from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import ScreenChrome from '../../../components/ScreenChrome';
import { packingService } from '../../../services/packing.service';
import { customerService } from '../../../services/customer.service';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import type { MainStackParamList } from '../../../navigation/types';

// =============================================================================
// Sevkiyat Geçmişi — gerçek sayfa (push). Sevk edilmiş (DISPATCHED) sevkiyatlar:
// arama (no/müşteri) + dönem; tıkla → detay (siparişler + toplar + çuval/kg +
// plaka/şoför/tarih). Geri tuşu: detaydaysa listeye, listedeyse önceki sayfaya.
// =============================================================================

type Period = 'all' | 'today' | 'week';

export default function SevkiyatGecmisiScreen() {
  usePortraitLock();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [customerFilter, setCustomerFilter] = useState<string | null>(null);
  const [customerLabel, setCustomerLabel] = useState('Tüm müşteriler');
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [custMenuOpen, setCustMenuOpen] = useState(false);

  // Müşteri seçilince backend filtreler (200-pencere değil, o müşterinin tümü).
  const listQ = useQuery({
    queryKey: ['shipments', 'DISPATCHED', customerFilter],
    queryFn: () =>
      packingService.listShipments({ status: 'DISPATCHED', customerId: customerFilter ?? undefined }),
    staleTime: 30_000,
  });
  const all = listQ.data?.data ?? [];

  const custQ = useQuery({
    queryKey: ['customers', 'picker'],
    queryFn: () => customerService.getAll({ page: 1, pageSize: 200 }),
    staleTime: 60_000,
  });
  const customers = custQ.data?.data ?? [];

  // Şube chip'leri — yüklenen sonuçtaki ayrık şubeler (client-side filtre).
  const branches = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of all) if (s.branch) m.set(s.branch.id, s.branch.name);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
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
        s.shipmentNo.toLocaleLowerCase('tr-TR').includes(q) ||
        s.customer.name.toLocaleLowerCase('tr-TR').includes(q)
      );
    });
  }, [all, search, period, branchFilter]);

  const detailQ = useQuery({
    queryKey: ['shipment', detailId],
    queryFn: () => packingService.getShipment(detailId!),
    enabled: detailId !== null,
    staleTime: 10_000,
  });
  const detail = detailQ.data?.data ?? null;

  // Geri (header oku): detaydaysa önce listeye dön, sonra sayfadan çık.
  const goBack = () => {
    if (detailId) setDetailId(null);
    else nav.goBack();
  };

  return (
    <ScreenChrome
      title={detailId ? detail?.shipmentNo ?? 'Sevkiyat' : 'Sevkiyat Geçmişi'}
      subtitle={detailId ? undefined : 'Sevk edilmiş sevkiyatlar'}
      onBack={goBack}
    >
      {detailId ? (
        // ── DETAY ──
        <ScrollView contentContainerStyle={styles.body}>
          {detailQ.isLoading || !detail ? (
            <ActivityIndicator style={{ marginTop: 24 }} />
          ) : (
            <>
              <Text style={styles.bigCustomer}>
                {detail.customer.name}
                {detail.branch ? ` · ${detail.branch.name}` : ''}
              </Text>
              <Text style={styles.meta}>
                {detail.dispatchedAt ? dayjs(detail.dispatchedAt).format('DD.MM.YYYY HH:mm') : '—'}
                {detail.plateNumber ? ` · ${detail.plateNumber}` : ''}
                {detail.driverName ? ` · ${detail.driverName}` : ''}
                {detail.carrier ? ` · ${detail.carrier}` : ''}
              </Text>
              <Text style={styles.summary}>
                {detail.summary.rollCount} top · {detail.summary.sackCount} çuval ·{' '}
                {detail.summary.totalKg.toLocaleString('tr-TR')} kg
              </Text>

              <Text style={styles.section}>Siparişler</Text>
              {detail.orders.map((o) => (
                <View key={o.id} style={styles.row}>
                  <Text style={styles.rowMain}>{o.orderNumber}</Text>
                  <Text style={styles.meta}>
                    {Math.round(o.lines.reduce((s, l) => s + l.thisShipment, 0))}m
                  </Text>
                </View>
              ))}

              <Text style={styles.section}>Giden Toplar ({detail.rolls.length})</Text>
              {detail.rolls.map((r) => (
                <View key={r.id} style={styles.row}>
                  <Text style={styles.rowMono}>{r.barcode ?? '—'}</Text>
                  <Text style={styles.meta}>
                    {r.item.name}
                    {r.color ? ` · ${r.color.name}` : ''} · {Math.round(r.currentQty)}m
                  </Text>
                </View>
              ))}

              <Text style={styles.section}>Çuvallar ({detail.sacks.length})</Text>
              {detail.sacks.map((s) => (
                <View key={s.id} style={styles.row}>
                  <Text style={styles.rowMono}>Çuval {s.seq}</Text>
                  <Text style={styles.meta}>{(s.weightKg ?? 0).toLocaleString('tr-TR')} kg</Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      ) : (
        // ── LİSTE ──
        <View style={{ flex: 1 }}>
          <View style={styles.filters}>
            <TextInput
              mode="outlined"
              dense
              placeholder="İrsaliye no / müşteri ara..."
              value={search}
              onChangeText={setSearch}
              left={<TextInput.Icon icon="magnify" />}
            />
            <Menu
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
              <Menu.Item
                title="Tüm müşteriler"
                onPress={() => {
                  setCustomerFilter(null);
                  setCustomerLabel('Tüm müşteriler');
                  setBranchFilter(null);
                  setCustMenuOpen(false);
                }}
              />
              {customers.map((c) => (
                <Menu.Item
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
            </Menu>
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
          <ScrollView contentContainerStyle={styles.body}>
            {listQ.isLoading ? (
              <ActivityIndicator style={{ marginTop: 24 }} />
            ) : filtered.length === 0 ? (
              <Text style={styles.emptySub}>Kayıt yok.</Text>
            ) : (
              filtered.map((s) => (
                <TouchableRipple key={s.id} onPress={() => setDetailId(s.id)} style={styles.card}>
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
                      {s.plateNumber ? ` · ${s.plateNumber}` : ''}
                    </Text>
                  </Surface>
                </TouchableRipple>
              ))
            )}
          </ScrollView>
        </View>
      )}
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
  bigCustomer: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  section: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginTop: 14, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  rowMain: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  rowMono: { fontSize: 14, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  meta: { fontSize: 12, color: '#64748b' },
  summary: { fontSize: 13, color: '#334155', marginTop: 2 },
  emptySub: { fontSize: 13, color: '#94a3b8', marginTop: 16, textAlign: 'center' },
});
