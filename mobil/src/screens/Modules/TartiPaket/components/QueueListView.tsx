import React from 'react';
import { View, StyleSheet, RefreshControl } from 'react-native';
import {
  Text,
  Surface,
  TouchableRipple,
  ActivityIndicator,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import dayjs from 'dayjs';
import type { ShippingQueueJob } from '../../../../services/shippingQueue.service';

interface Props {
  jobs: ShippingQueueJob[];
  loading: boolean;
  refreshing: boolean;
  currentUserId: string | null;
  onRefresh: () => void;
  onTake: (id: string) => void;
  onResume: (job: ShippingQueueJob) => void;
  taking: boolean;
}

export default function QueueListView({
  jobs,
  loading,
  refreshing,
  currentUserId,
  onRefresh,
  onTake,
  onResume,
  taking,
}: Props) {
  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" />
        <Text style={S.muted}>Kuyruk yükleniyor...</Text>
      </View>
    );
  }

  if (jobs.length === 0) {
    return (
      <View style={S.center}>
        <Text variant="titleMedium" style={S.emptyTitle}>
          Kuyrukta sipariş yok
        </Text>
        <Text style={S.muted}>Planlamacı kuyruğa sipariş eklediğinde burada görünecek.</Text>
      </View>
    );
  }

  return (
    <FlashList
      data={jobs}
      keyExtractor={(it) => it.id}
      contentContainerStyle={S.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0f172a" />
      }
      renderItem={({ item }) => (
        <JobCard
          item={item}
          currentUserId={currentUserId}
          onTake={onTake}
          onResume={onResume}
          busy={taking}
        />
      )}
    />
  );
}

function JobCard({
  item,
  currentUserId,
  onTake,
  onResume,
  busy,
}: {
  item: ShippingQueueJob;
  currentUserId: string | null;
  onTake: (id: string) => void;
  onResume: (job: ShippingQueueJob) => void;
  busy: boolean;
}) {
  const { order } = item;
  const isTaken = item.status === 'TAKEN';
  const isMine = isTaken && item.assignedOperator?.id === currentUserId;
  const isOtherTaken = isTaken && !isMine;
  const disabled = busy || isOtherTaken;
  const deadlineDays = order.deadline
    ? dayjs(order.deadline).diff(dayjs(), 'day')
    : null;
  const deadlineTone =
    deadlineDays == null
      ? 'muted'
      : deadlineDays < 0
        ? 'overdue'
        : deadlineDays <= 2
          ? 'warning'
          : 'ok';

  const progressPct =
    order.totalRequestedQty > 0
      ? Math.min(100, Math.round((order.totalAllocatedQty / order.totalRequestedQty) * 100))
      : 0;

  const deadlineLabel = order.deadline
    ? deadlineDays! < 0
      ? `${Math.abs(deadlineDays!)}g gecikme`
      : deadlineDays === 0
        ? 'Bugün'
        : `${deadlineDays}g`
    : '—';

  return (
    <Surface
      style={[
        S.card,
        item.isUrgent && S.cardUrgent,
        isMine && S.cardMine,
        isOtherTaken && S.cardTaken,
      ]}
      elevation={0}
    >
      <TouchableRipple
        onPress={() => {
          if (disabled) return;
          if (isMine) onResume(item);
          else onTake(item.id);
        }}
        disabled={disabled}
        style={S.cardInner}
      >
        <View>
          {/* Satır 1: sipariş + müşteri + badges + termin */}
          <View style={S.headerRow}>
            <Text style={S.orderNumber}>{order.orderNumber}</Text>
            {item.isUrgent && (
              <View style={S.urgentBadge}>
                <Text style={S.urgentBadgeText}>ACİL</Text>
              </View>
            )}
            <Text style={S.customerName} numberOfLines={1}>
              {order.customer.name}
            </Text>
            <View
              style={[S.deadlinePill, S[`deadline_${deadlineTone}` as const]]}
            >
              <Text style={S.deadlinePillText}>{deadlineLabel}</Text>
            </View>
          </View>

          {/* Satır 2: şube + metrikler + progress */}
          <View style={S.metaRow}>
            {order.branch && (
              <Text style={S.metaText} numberOfLines={1}>
                {order.branch.name}
              </Text>
            )}
            <Text style={S.metaText}>
              {order.lines.length} kalem ·{' '}
              {order.totalRequestedQty.toLocaleString('tr-TR')} m
            </Text>
            {isMine && <Text style={S.mineText}>· DEVAM ET ▸</Text>}
            {isOtherTaken && (
              <Text style={S.otherTakenText}>
                · {item.assignedOperator?.fullName} alındı
              </Text>
            )}
            <View style={{ flex: 1 }} />
            <Text style={S.progressText}>
              {order.totalAllocatedQty.toLocaleString('tr-TR')}/
              {order.totalRequestedQty.toLocaleString('tr-TR')} m ({progressPct}%)
            </Text>
          </View>

          {/* Slim progress bar */}
          <View style={S.progressTrack}>
            <View
              style={[
                S.progressFill,
                { width: `${progressPct}%` },
                progressPct === 100 && S.progressDone,
              ]}
            />
          </View>
        </View>
      </TouchableRipple>
    </Surface>
  );
}

const S = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { color: '#0f172a', marginBottom: 8 },
  muted: { color: '#64748b', marginTop: 8, textAlign: 'center' },
  list: { padding: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardUrgent: { borderColor: '#dc2626', backgroundColor: '#fef2f2' },
  cardMine: { borderColor: '#10b981', borderWidth: 2, backgroundColor: '#f0fdf4' },
  cardTaken: { opacity: 0.55 },
  cardInner: { padding: 10, borderRadius: 8 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  orderNumber: {
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#0f172a',
    fontSize: 14,
  },
  urgentBadge: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  urgentBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 13,
  },
  customerName: {
    flex: 1,
    fontWeight: '600',
    color: '#0f172a',
    fontSize: 14,
  },
  deadlinePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  deadlinePillText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 13,
  },
  deadline_overdue: { backgroundColor: '#fee2e2' },
  deadline_warning: { backgroundColor: '#fef3c7' },
  deadline_ok: { backgroundColor: '#dcfce7' },
  deadline_muted: { backgroundColor: '#f1f5f9' },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  metaText: { color: '#64748b', fontSize: 12, fontVariant: ['tabular-nums'] },
  mineText: { color: '#10b981', fontSize: 12, fontWeight: '700' },
  otherTakenText: { color: '#94a3b8', fontSize: 12, fontStyle: 'italic' },

  progressTrack: {
    height: 4,
    backgroundColor: '#e2e8f0',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#3b82f6' },
  progressDone: { backgroundColor: '#10b981' },
  progressText: {
    fontSize: 11,
    color: '#475569',
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
});
