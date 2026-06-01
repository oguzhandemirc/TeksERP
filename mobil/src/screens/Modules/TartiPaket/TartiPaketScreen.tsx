import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  Text,
  Button,
  ActivityIndicator,
  TouchableRipple,
  Divider,
  Appbar,
} from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import ScreenChrome from '../../../components/ScreenChrome';
import { packingService, type OpenOrder } from '../../../services/packing.service';
import { usePermissions } from '../../../hooks/usePermission';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import type { MainStackParamList } from '../../../navigation/types';

// =============================================================================
// Tartı / Paket — sipariş SEÇİM ekranı (push: Paketleme). Tek müşteri+şube seç,
// depo karşılaması satırda. "Sonraki adım" → Paketleme (geç oluştur). Zaten
// sevkiyatta olan sipariş "Sürdür" → Paketleme (shipmentId). Geçmiş ayrı sayfa.
// =============================================================================

const groupKey = (customerId: string, branchId: string | null) => `${customerId}|${branchId ?? ''}`;

// Bizdeki ad + (karşıdaki ad) — alias farklıysa parantezde. Personel topu bizdeki adla bulur.
const dualName = (ourName: string, custName?: string | null) =>
  custName && custName.trim() && custName !== ourName ? `${ourName} (${custName})` : ourName;

export default function TartiPaketScreen() {
  usePortraitLock();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { has } = usePermissions();
  const canShip = has('mobile:sevkiyat');

  const [selected, setSelected] = useState<string[]>([]);
  const [selGroup, setSelGroup] = useState<string | null>(null);

  const openOrdersQ = useQuery({
    queryKey: ['open-orders'],
    queryFn: () => packingService.listOpenOrders(),
    staleTime: 10_000,
  });
  const openOrders = openOrdersQ.data?.data ?? [];

  const preparingQ = useQuery({
    queryKey: ['shipments', 'PREPARING'],
    queryFn: () => packingService.listShipments({ status: 'PREPARING' }),
    staleTime: 10_000,
  });
  const preparing = preparingQ.data?.data ?? [];

  const readyQ = useQuery({
    queryKey: ['shipments', 'READY'],
    queryFn: () => packingService.listShipments({ status: 'READY' }),
    enabled: canShip,
    staleTime: 10_000,
  });
  const readyCount = readyQ.data?.data?.length ?? 0;

  // ── Sipariş seçimi ──
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
    const orderIds = selected;
    setSelected([]);
    setSelGroup(null);
    nav.navigate('Paketleme', { orderIds });
  };

  const inSelGroup = (o: OpenOrder) =>
    selGroup === groupKey(o.order.customer.id, o.order.branch?.id ?? null);
  // Termine göre sırala; seçim aktifken eşleşen müşteri+şube grubunu üste topla.
  const displayOrders = useMemo(() => {
    const base = [...openOrders].sort((a, b) => {
      const ad = a.order.deadline ? new Date(a.order.deadline).getTime() : Infinity;
      const bd = b.order.deadline ? new Date(b.order.deadline).getTime() : Infinity;
      return ad - bd;
    });
    if (!selGroup) return base;
    return [...base.filter((o) => inSelGroup(o)), ...base.filter((o) => !inSelGroup(o))];
  }, [openOrders, selGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderOrderCard = (o: OpenOrder) => {
    const active = o.order.activeShipment;
    // Zaten aktif sevkiyatta → seçilemez, "Sürdür" (Paketleme'ye git).
    if (active) {
      return (
        <TouchableRipple
          key={o.order.id}
          onPress={() => nav.navigate('Paketleme', { shipmentId: active.id })}
          style={[styles.orderCard, styles.orderCardResume]}
        >
          <View>
            <View style={styles.cardHead}>
              <Text style={styles.rollBarcode}>{o.order.orderNumber}</Text>
              <Text style={styles.resumeTag}>Sevkiyatta · Sürdür →</Text>
            </View>
            <Text style={styles.covMeta}>
              {o.order.customer.name}
              {o.order.branch ? ` · ${o.order.branch.name}` : ''} · {active.shipmentNo}
            </Text>
          </View>
        </TouchableRipple>
      );
    }
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
      title="Tartı / Paket"
      subtitle="Sipariş seç → okut → çuvalla"
      headerExtras={
        <Appbar.Action
          icon="history"
          color="#fff"
          onPress={() => nav.navigate('SevkiyatGecmisi')}
          accessibilityLabel="Sevkiyat geçmişi"
        />
      }
    >
      <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
        {canShip && readyCount > 0 && (
          <TouchableRipple onPress={() => nav.navigate('Sevkiyat')} style={styles.bridge}>
            <View style={styles.bridgeInner}>
              <Text style={styles.bridgeText}>{readyCount} sevkiyat kapıda (kamyon bekliyor)</Text>
              <Text style={styles.bridgeCta}>Sevkiyat →</Text>
            </View>
          </TouchableRipple>
        )}

        {/* Devam eden sevkiyatlar */}
        {preparing.length > 0 && (
          <>
            <Text variant="titleSmall" style={styles.section}>
              Devam Eden ({preparing.length})
            </Text>
            {preparing.map((sh) => (
              <TouchableRipple
                key={sh.id}
                onPress={() => nav.navigate('Paketleme', { shipmentId: sh.id })}
                style={styles.resumeCard}
              >
                <View style={styles.bridgeInner}>
                  <View>
                    <Text style={styles.rollBarcode}>{sh.shipmentNo}</Text>
                    <Text style={styles.covMeta}>
                      {sh.customer.name}
                      {sh.branch ? ` · ${sh.branch.name}` : ''} · {sh._count.rolls} top · {sh._count.sacks} çuval
                    </Text>
                  </View>
                  <Text style={styles.bridgeCta}>Sürdür →</Text>
                </View>
              </TouchableRipple>
            ))}
            <Divider style={{ marginVertical: 12 }} />
          </>
        )}

        <Text variant="titleSmall" style={styles.section}>
          Açık Siparişler
        </Text>
        <Text style={styles.hint}>Tek müşteri + şube seç. Depo karşılaması satırda görünür.</Text>

        {openOrdersQ.isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : displayOrders.length === 0 ? (
          <Text style={styles.emptySub}>Açık sipariş yok.</Text>
        ) : selGroup ? (
          <>
            {displayOrders.filter((o) => inSelGroup(o)).map(renderOrderCard)}
            {displayOrders.some((o) => !inSelGroup(o)) && (
              <View style={styles.otherSep}>
                <Divider style={{ flex: 1 }} />
                <Text style={styles.otherSepText}>Diğer (farklı müşteri/şube)</Text>
                <Divider style={{ flex: 1 }} />
              </View>
            )}
            {displayOrders.filter((o) => !inSelGroup(o)).map(renderOrderCard)}
          </>
        ) : (
          displayOrders.map(renderOrderCard)
        )}
      </ScrollView>

      {selected.length > 0 && (
        <View style={styles.footer}>
          <Button mode="contained" icon="arrow-right" contentStyle={{ height: 52 }} onPress={startPacking}>
            Sonraki adım ({selected.length} sipariş)
          </Button>
        </View>
      )}
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 32 },
  bridge: { borderRadius: 10, backgroundColor: '#1e40af', marginBottom: 10 },
  bridgeInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  bridgeText: { color: '#fff', fontWeight: '600' },
  bridgeCta: { color: '#bfdbfe', fontWeight: '700' },
  resumeCard: { borderRadius: 10, backgroundColor: '#f1f5f9', marginBottom: 8 },
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
  orderCardResume: { borderColor: '#1e40af', backgroundColor: '#eff6ff' },
  orderCardDim: { opacity: 0.45 },
  resumeTag: { fontSize: 12, fontWeight: '700', color: '#1e40af' },
  otherSep: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 },
  otherSepText: { fontSize: 11, color: '#94a3b8' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  footer: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0', backgroundColor: '#fff' },
});
