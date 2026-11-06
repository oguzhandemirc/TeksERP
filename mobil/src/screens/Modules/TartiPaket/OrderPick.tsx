import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Surface, Text, TouchableRipple } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import AppModal from '../../../components/AppModal';
import MultiSelectSheet, { type MultiSelectOption } from '../../../components/MultiSelectSheet';
import { packingService, type OpenOrder } from '../../../services/packing.service';
import { queryProblem, type QueryProblem } from '../../../utils/queryState';
import { palette } from '../../../theme/tokens';

// =============================================================================
// Sipariş seçerek sevk (tablet) — açık siparişler müşteri/şube kapsamında sunucudan;
// seçim boşsa SİPARİŞSİZ sevk (bugünkü davranış). Tahsis sunucuda sevk anında.
// =============================================================================

export function orderOptions(orders: readonly OpenOrder[]): MultiSelectOption[] {
  return orders.map((o) => {
    const open = o.lines.reduce((s, l) => s + l.openQty, 0);
    return {
      id: o.order.id,
      label: o.order.orderNumber,
      sublabel: `${o.lines.length} kalem · açık ${Math.round(open).toLocaleString('tr-TR')} m${o.order.branch ? ` · ${o.order.branch.name}` : ''}`,
    };
  });
}

// Çevrimdışıyken sorgu DURAKLAR (isError false) — yalnız isError'a bakan liste "açık sipariş yok" yalanını söyler.
const ORDERS_PROBLEM: Record<QueryProblem, string> = {
  offline: 'Çevrimdışısınız — açık siparişler alınamıyor. Bağlantı gelince yeniden açın.',
  error: 'Siparişler alınamadı — bağlantıyı kontrol edin.',
};
const PREVIEW_PROBLEM: Record<QueryProblem, string> = {
  offline: 'Çevrimdışısınız — önizleme alınamıyor. Sevk için bağlantı gerekir.',
  error: 'Önizleme alınamadı — yine de sevk edebilirsiniz.',
};

/** Satır metni: seçim yoksa siparişsiz; varsa numaralar. */
export function orderPickText(selected: readonly string[], orders: readonly OpenOrder[]): string {
  if (selected.length === 0) return 'Siparişsiz sevk';
  const names = orders.filter((o) => selected.includes(o.order.id)).map((o) => o.order.orderNumber);
  return `${selected.length} sipariş: ${names.join(', ')}`;
}

export function OrderPickRow({
  customerId,
  branchId,
  value,
  onChange,
}: {
  customerId: string;
  branchId: string | null;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['open-orders', customerId, branchId],
    queryFn: () => packingService.listOpenOrders({ customerId, branchId: branchId ?? undefined }),
    staleTime: 30_000,
  });
  const orders = q.data?.data ?? [];
  const problem = q.data ? null : queryProblem(q);
  return (
    <>
      <TouchableRipple onPress={() => setOpen(true)} style={styles.row} testID="sevk-siparis-sec">
        <View style={styles.rowInner}>
          <Icon source="clipboard-list-outline" size={22} color={palette.slate[700]} />
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Sipariş</Text>
            <Text style={styles.rowValue}>{orderPickText(value, orders)}</Text>
          </View>
          <Icon source="chevron-right" size={22} color={palette.slate[400]} />
        </View>
      </TouchableRipple>
      <MultiSelectSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        title="Sipariş seç"
        options={orderOptions(orders)}
        loading={q.isLoading}
        value={value}
        onChange={onChange}
        emptyText="Bu müşterinin açık siparişi yok — siparişsiz sevk edilir."
        errorText={problem ? ORDERS_PROBLEM[problem] : null}
        searchable={orders.length > 15}
      />
    </>
  );
}

/** "Hemen Sevk Et" onayı: sipariş seçimi + sunucu önizlemesi (karşılanan satırlar, fazla, uyarılar). */
export function ShipConfirmSheet({
  visible,
  onDismiss,
  customerId,
  branchId,
  sackIds,
  title,
  submitting,
  onConfirm,
}: {
  visible: boolean;
  onDismiss: () => void;
  customerId: string;
  branchId: string | null;
  sackIds: string[];
  title: string;
  submitting: boolean;
  onConfirm: (orderIds: string[]) => void;
}) {
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const pq = useQuery({
    queryKey: ['ship-preview', customerId, branchId, sackIds, orderIds],
    queryFn: () => packingService.previewCreateShipment({ sackIds, customerId, branchId, orderIds }),
    enabled: visible && sackIds.length > 0,
  });
  const p = pq.data?.data ?? null;
  const previewProblem = p ? null : queryProblem(pq);
  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <Surface style={styles.sheet} elevation={4}>
        <Text variant="titleMedium" style={styles.title}>{title}</Text>
        {p ? (
          <Text style={styles.kpi}>
            {p.totals.sackCount} çuval · {Math.round(p.totals.totalMeters).toLocaleString('tr-TR')} m
          </Text>
        ) : null}
        <OrderPickRow customerId={customerId} branchId={branchId} value={orderIds} onChange={setOrderIds} />
        {pq.isLoading ? <ActivityIndicator style={styles.loading} /> : null}
        {previewProblem ? (
          <Text style={styles.warn} testID="sevk-onizleme-sorun">
            {PREVIEW_PROBLEM[previewProblem]}
          </Text>
        ) : null}
        <ScrollView style={styles.list}>
          {(p?.lines ?? []).map((l) => (
            <Text key={l.lineId} style={styles.line}>
              {l.orderNumber} · {l.item}
              {l.color ? ` ${l.color}` : ''} — {Math.round(l.allocated)}/{Math.round(l.need)} m
            </Text>
          ))}
          {p && orderIds.length > 0 && p.totals.surplusMeters > 0 ? (
            <Text style={styles.line}>Siparişe düşmeyen: {Math.round(p.totals.surplusMeters)} m</Text>
          ) : null}
          {(p?.warnings ?? []).map((w, i) => (
            <Text key={i} style={styles.warn}>{w}</Text>
          ))}
        </ScrollView>
        <View style={styles.actions}>
          <Button onPress={onDismiss} style={styles.btn} contentStyle={styles.btnContent}>Vazgeç</Button>
          <Button
            mode="contained"
            icon="truck-fast"
            buttonColor={palette.emerald[700]}
            style={styles.btn}
            contentStyle={styles.btnContent}
            loading={submitting}
            disabled={submitting}
            onPress={() => onConfirm(orderIds)}
            testID="sevk-onay"
          >
            Sevk Et
          </Button>
        </View>
      </Surface>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, borderColor: palette.slate[300], borderRadius: 8, marginTop: 12 },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 14, color: palette.slate[500] },
  rowValue: { fontSize: 16, fontWeight: '600' },
  sheet: { padding: 20, borderRadius: 12, maxHeight: '90%' },
  title: { fontWeight: '700' },
  kpi: { fontSize: 22, fontWeight: '700', marginTop: 8 },
  loading: { marginVertical: 12 },
  list: { marginTop: 8, maxHeight: 260 },
  line: { fontSize: 14, color: palette.slate[700], paddingVertical: 4 },
  warn: { fontSize: 14, color: palette.amber[700], paddingVertical: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 16 },
  btn: { minWidth: 140 },
  btnContent: { minHeight: 56 },
});
