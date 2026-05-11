import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Surface, Divider, ProgressBar } from 'react-native-paper';
import type { ShippingQueueJob } from '../../../../services/shippingQueue.service';

interface Props {
  job: ShippingQueueJob;
}

export default function RequirementsPanel({ job }: Props) {
  const { order } = job;
  const overallPct =
    order.totalRequestedQty > 0
      ? Math.min(1, order.totalAllocatedQty / order.totalRequestedQty)
      : 0;

  return (
    <View style={S.root}>
      <View style={S.header}>
        <Text variant="titleMedium" style={S.orderNumber}>
          {order.orderNumber}
        </Text>
        <Text variant="bodyMedium" style={S.customer}>
          {order.customer.name}
        </Text>
        {order.branch && (
          <Text style={S.subText}>Şube: {order.branch.name}</Text>
        )}
      </View>

      <View style={S.summaryRow}>
        <View style={S.summaryItem}>
          <Text style={S.summaryLabel}>İhtiyaç</Text>
          <Text style={S.summaryValue}>
            {order.totalRequestedQty.toLocaleString('tr-TR')} m
          </Text>
        </View>
        <View style={S.summaryItem}>
          <Text style={S.summaryLabel}>Bağlanan</Text>
          <Text style={[S.summaryValue, S.summaryOk]}>
            {order.totalAllocatedQty.toLocaleString('tr-TR')} m
          </Text>
        </View>
        <View style={S.summaryItem}>
          <Text style={S.summaryLabel}>Kalan</Text>
          <Text style={[S.summaryValue, order.remainingQty > 0 ? S.summaryWarn : S.summaryOk]}>
            {order.remainingQty.toLocaleString('tr-TR')} m
          </Text>
        </View>
      </View>

      <ProgressBar
        progress={overallPct}
        color={overallPct >= 1 ? '#10b981' : '#3b82f6'}
        style={S.progressBar}
      />

      <Divider style={S.divider} />

      <Text variant="labelLarge" style={S.sectionLabel}>
        SİPARİŞ KALEMLERİ
      </Text>

      <ScrollView style={S.linesScroll} contentContainerStyle={S.linesContent}>
        {order.lines.map((line) => {
          const pct = line.requestedQty > 0 ? line.allocatedQty / line.requestedQty : 0;
          const done = pct >= 1;

          return (
            <Surface key={line.lineId} style={S.lineCard} elevation={0}>
              <View style={S.lineHeaderRow}>
                <Text style={S.itemCode}>{line.itemCode}</Text>
                <Text style={S.itemName} numberOfLines={2}>
                  {line.itemName}
                </Text>
              </View>

              <View style={S.attrRow}>
                {line.color && (
                  <View
                    style={[
                      S.attrBadge,
                      line.color.hex
                        ? { backgroundColor: line.color.hex + '22' }
                        : null,
                    ]}
                  >
                    {line.color.hex && (
                      <View
                        style={[
                          S.colorDot,
                          { backgroundColor: line.color.hex },
                        ]}
                      />
                    )}
                    <Text style={S.attrBadgeText}>{line.color.name}</Text>
                  </View>
                )}
                {line.variant && (
                  <View style={S.attrBadge}>
                    <Text style={S.attrBadgeText}>{line.variant.name}</Text>
                  </View>
                )}
                {line.width != null && (
                  <View style={S.attrBadge}>
                    <Text style={S.attrBadgeText}>{line.width} cm</Text>
                  </View>
                )}
              </View>

              <ProgressBar
                progress={Math.min(1, pct)}
                color={done ? '#10b981' : '#3b82f6'}
                style={S.lineProgress}
              />
              <Text style={S.lineProgressText}>
                {line.allocatedQty.toLocaleString('tr-TR')} /{' '}
                {line.requestedQty.toLocaleString('tr-TR')} m ·{' '}
                {Math.round(pct * 100)}%
              </Text>
              {!done && (
                <Text style={S.lineRemainingText}>
                  Kalan: {line.remainingQty.toLocaleString('tr-TR')} m
                </Text>
              )}
            </Surface>
          );
        })}
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
    borderRightWidth: 1,
    borderRightColor: '#e2e8f0',
    padding: 16,
  },
  header: { marginBottom: 12 },
  orderNumber: { fontFamily: 'monospace', fontWeight: '700', color: '#0f172a' },
  customer: { fontWeight: '600', color: '#0f172a', marginTop: 2 },
  subText: { color: '#64748b', fontSize: 13, marginTop: 2 },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  summaryItem: { flex: 1 },
  summaryLabel: { fontSize: 11, color: '#64748b', textTransform: 'uppercase' },
  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    fontVariant: ['tabular-nums'],
  },
  summaryOk: { color: '#10b981' },
  summaryWarn: { color: '#f59e0b' },
  progressBar: { height: 6, borderRadius: 3, marginTop: 4 },
  divider: { marginVertical: 16 },
  sectionLabel: {
    fontSize: 11,
    color: '#64748b',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  linesScroll: { flex: 1 },
  linesContent: { paddingBottom: 16 },
  lineCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  lineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  itemCode: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#475569',
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: 'hidden',
    lineHeight: 14,
  },
  itemName: { flex: 1, fontWeight: '600', color: '#0f172a' },
  attrRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  attrBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  attrBadgeText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
    lineHeight: 14,
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  lineProgress: { height: 4, borderRadius: 2, marginBottom: 4 },
  lineProgressText: {
    fontSize: 12,
    color: '#475569',
    fontVariant: ['tabular-nums'],
  },
  lineRemainingText: { fontSize: 11, color: '#f59e0b', marginTop: 2 },
});
