import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Icon } from 'react-native-paper';

import type { WorkOrder } from '../../types/models';
import {
  WORK_ORDER_STATUS_LABEL,
  WORK_ORDER_STATUS_COLOR,
  STEP_STATUS_LABEL,
  trLabel,
} from '../../utils/labels';

/**
 * Seçili iş emrinin sevkiyat odaklı özet paneli.
 * Hem fason sevk ekranında, hem de sevk geçmişi modalında kullanılır.
 */
export default function WorkOrderDetailPanel({ wo }: { wo: WorkOrder }) {
  const dispatched = wo.dispatchedTotalQty ?? 0;
  const target = wo.targetQuantity ?? null;
  const remaining = target != null ? Math.max(0, target - dispatched) : null;
  const overshoot = target != null && dispatched > target;

  const externalStations = (wo.steps ?? [])
    .filter((s) => s.station?.type === 'EXTERNAL')
    .map((s) => ({
      id: s.id,
      name: s.station?.name ?? '—',
      status: s.status,
      seq: s.stepSequence,
    }));

  const linesByCustomer = new Map<
    string,
    {
      customer: { id: string; name: string };
      lines: NonNullable<typeof wo.orderLinks>[number][];
    }
  >();
  for (const link of wo.orderLinks ?? []) {
    const c = link.orderLine?.order?.customer;
    if (!c) continue;
    const entry = linesByCustomer.get(c.id) ?? { customer: c, lines: [] };
    entry.lines.push(link);
    linesByCustomer.set(c.id, entry);
  }

  const isService = wo.type === 'SERVICE_PRODUCTION';
  const isStock = wo.type === 'STOCK_PRODUCTION';

  return (
    <View style={styles.container}>
      <View style={styles.headerStrip}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: WORK_ORDER_STATUS_COLOR[wo.status] ?? '#64748b' },
          ]}
        />
        <Text style={styles.statusText}>
          {trLabel(WORK_ORDER_STATUS_LABEL, wo.status)}
        </Text>
        {isService && (
          <View style={[styles.typeTag, styles.serviceTag]}>
            <Icon source="alert-circle" size={12} color="#92400e" />
            <Text style={[styles.typeTagText, { color: '#92400e' }]}>Müşteri Malı</Text>
          </View>
        )}
        {isStock && (
          <View style={[styles.typeTag, styles.stockTag]}>
            <Icon source="package-variant" size={12} color="#1e40af" />
            <Text style={[styles.typeTagText, { color: '#1e40af' }]}>Stoka</Text>
          </View>
        )}
      </View>

      {(target != null || dispatched > 0 || wo.width != null) && (
        <View style={styles.card}>
          {(target != null || wo.width != null) && (
            <View style={styles.badgeRow}>
              {target != null && (
                <View style={styles.badge}>
                  <Icon source="arrow-expand-vertical" size={13} color="#0f172a" />
                  <Text style={styles.badgeText}>{target} mt hedef</Text>
                </View>
              )}
              {wo.width != null && (
                <View style={styles.badge}>
                  <Icon source="arrow-expand-horizontal" size={13} color="#0f172a" />
                  <Text style={styles.badgeText}>{wo.width} cm</Text>
                </View>
              )}
            </View>
          )}
          {(target != null || dispatched > 0) && (
            <View style={styles.metricRow}>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Sevk</Text>
                <Text style={styles.metricValue}>{dispatched.toFixed(1)}</Text>
              </View>
              {target != null && (
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>
                    {overshoot ? 'Aşım' : 'Kalan'}
                  </Text>
                  <Text
                    style={[styles.metricValue, overshoot && { color: '#dc2626' }]}
                  >
                    {overshoot
                      ? `+${(dispatched - target).toFixed(1)}`
                      : (remaining ?? 0).toFixed(1)}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {linesByCustomer.size > 0 &&
        Array.from(linesByCustomer.values()).map(({ customer, lines }) => (
          <View key={customer.id} style={styles.card}>
            <View style={styles.customerHeader}>
              <Icon source="account" size={14} color="#4f46e5" />
              <Text style={styles.customerName} numberOfLines={1}>
                {customer.name}
              </Text>
              <Text style={styles.lineCount}>{lines.length} sipariş</Text>
            </View>
            {lines.map((link, i) => {
              const ol = link.orderLine;
              if (!ol) return null;
              const itemLabel = ol.variant
                ? `${ol.item?.name ?? '—'} · ${ol.variant.name}`
                : (ol.item?.name ?? '—');
              return (
                <View key={`${ol.id}-${i}`} style={styles.orderLine}>
                  <View style={styles.orderLineTop}>
                    <Text style={styles.orderNo}>
                      {ol.order?.orderNumber ?? '—'}
                    </Text>
                    <Text style={styles.orderQty}>
                      {ol.quantity} mt{ol.width != null ? ` · ${ol.width} cm` : ''}
                    </Text>
                  </View>
                  <Text style={styles.orderItem} numberOfLines={2}>
                    {itemLabel}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}

      {linesByCustomer.size === 0 && wo.type === 'STOCK_PRODUCTION' && (
        <View style={styles.card}>
          <View style={styles.row}>
            <Icon source="package-variant" size={14} color="#64748b" />
            <Text style={styles.rowText}>Siparişe bağlı değil — stoğa üretim</Text>
          </View>
        </View>
      )}

      {(wo.targetColor || wo.recipeNo || externalStations.length > 0) && (
        <View style={styles.card}>
          {wo.targetColor && (
            <View style={styles.row}>
              <View
                style={[
                  styles.colorSwatch,
                  { backgroundColor: wo.targetColor.hex ?? '#cbd5e1' },
                ]}
              />
              <Text style={styles.rowText}>{wo.targetColor.name}</Text>
            </View>
          )}
          {wo.recipeNo && (
            <View style={styles.row}>
              <Icon source="flask" size={14} color="#64748b" />
              <Text style={styles.rowText}>Reçete {wo.recipeNo}</Text>
            </View>
          )}
          {externalStations.map((s) => (
            <View key={s.id} style={styles.row}>
              <Icon source="factory" size={14} color="#64748b" />
              <Text style={styles.rowText}>
                #{s.seq} {s.name}
              </Text>
              <Text style={styles.stepStatus}>
                {trLabel(STEP_STATUS_LABEL, s.status)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  headerStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  typeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  serviceTag: { backgroundColor: '#fef3c7' },
  stockTag: { backgroundColor: '#dbeafe' },
  typeTagText: { fontSize: 11, fontWeight: '700' },
  card: {
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 8,
    gap: 6,
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  badgeText: { fontSize: 11, color: '#0f172a', fontWeight: '600' },
  metricRow: { flexDirection: 'row', gap: 6 },
  metricBox: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  metricLabel: { fontSize: 10, color: '#64748b', fontWeight: '600' },
  metricValue: { fontSize: 15, color: '#0f172a', fontWeight: '700' },
  customerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  customerName: { flex: 1, fontSize: 13, fontWeight: '700', color: '#4f46e5' },
  lineCount: { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  orderLine: { gap: 2, paddingVertical: 2 },
  orderLineTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  orderNo: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  orderQty: { fontSize: 11, color: '#475569', fontWeight: '600' },
  orderItem: { fontSize: 12, color: '#475569' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  rowText: { fontSize: 12, color: '#0f172a', flex: 1 },
  stepStatus: { fontSize: 11, color: '#64748b', fontWeight: '600' },
  colorSwatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
});
