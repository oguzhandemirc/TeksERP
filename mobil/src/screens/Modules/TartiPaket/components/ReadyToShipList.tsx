import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Surface, Text, Button, ActivityIndicator, Divider } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import {
  packingService,
  type ReadyOrder,
  type ReadyLine,
} from '../../../../services/packing.service';

// =============================================================================
// Sevke Hazır (Mod A) — operatör buradan bir siparişi seçip o müşteriye çuval açar.
// Depoda etiketli + çuvalda olmayan topu olan açık siparişler; termine göre sıralı.
// =============================================================================

interface Props {
  /** Çuvala Başla → o müşteri+şube için çuval aç/odaklan (parent yönetir). */
  onStart: (customerId: string, branchId: string | null) => void;
  busyCustomerId?: string | null;
}

function fmt(n: number): string {
  return Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
}

/** Termine kalan gün — null güvenli. */
function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

export default function ReadyToShipList({ onStart, busyCustomerId }: Props) {
  const q = useQuery({
    queryKey: ['shipping', 'ready'],
    queryFn: () => packingService.getReady(),
    staleTime: 15_000,
  });
  const orders = q.data?.data ?? [];

  if (q.isLoading) {
    return <ActivityIndicator style={{ marginVertical: 16 }} />;
  }
  if (orders.length === 0) return null; // boşsa yer kaplamasın; açık çuvallar görünür kalır

  return (
    <View style={styles.wrap}>
      <Text variant="titleMedium" style={styles.heading}>
        Sevke Hazır ({orders.length})
      </Text>
      {orders.map((o) => (
        <ReadyCard
          key={o.order.id}
          data={o}
          busy={busyCustomerId === o.order.customer.id}
          onStart={() => onStart(o.order.customer.id, o.order.branch?.id ?? null)}
        />
      ))}
    </View>
  );
}

function ReadyCard({
  data,
  busy,
  onStart,
}: {
  data: ReadyOrder;
  busy: boolean;
  onStart: () => void;
}) {
  const { order, lines } = data;
  const dl = daysLeft(order.deadline);
  const urgent = dl != null && dl <= 2;
  return (
    <Surface style={styles.card} elevation={1}>
      <View style={styles.cardHead}>
        <Text style={styles.customer}>{order.customer.name}</Text>
        {dl != null && (
          <Text style={[styles.deadline, urgent && styles.deadlineUrgent]}>
            {dl < 0 ? `${-dl} gün geçti` : `${dl} gün`}
          </Text>
        )}
      </View>
      <Text style={styles.orderNo}>
        {order.orderNumber}
        {order.branch ? ` · ${order.branch.name}` : ''}
      </Text>
      <Divider style={{ marginVertical: 6 }} />
      {lines.map((l) => (
        <ReadyLineRow key={l.lineId} l={l} />
      ))}
      <Button
        mode="contained"
        icon="package-variant-closed"
        onPress={onStart}
        loading={busy}
        disabled={busy}
        style={styles.startBtn}
      >
        Çuvala Başla
      </Button>
    </Surface>
  );
}

function ReadyLineRow({ l }: { l: ReadyLine }) {
  const name = l.customerItemName ?? l.item.name;
  const color = l.customerColorName ?? l.color?.name ?? null;
  return (
    <View style={styles.lineRow}>
      <Text style={styles.lineSpec} numberOfLines={1}>
        {name}
        {color ? ` · ${color}` : ''}
        {l.width ? ` · ${fmt(l.width)}cm` : ''}
      </Text>
      <Text style={styles.lineQty}>
        {l.readyCount} top hazır · kalan {fmt(l.openQty)}m
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 12 },
  heading: { fontWeight: '700', color: '#0f172a' },
  card: { borderRadius: 12, padding: 12, backgroundColor: '#fff' },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  customer: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  deadline: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  deadlineUrgent: { color: '#dc2626' },
  orderNo: { fontSize: 13, color: '#475569', marginTop: 2 },
  lineRow: { marginBottom: 4 },
  lineSpec: { fontSize: 13, color: '#0f172a' },
  lineQty: { fontSize: 12, color: '#059669', fontWeight: '600' },
  startBtn: { marginTop: 8 },
});
