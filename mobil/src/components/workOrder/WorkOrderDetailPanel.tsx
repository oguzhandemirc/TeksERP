import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Icon, IconButton } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import type { WorkOrder, SubcontractorDispatchListItem } from '../../types/models';
import { subcontractorService } from '../../services/subcontractor.service';
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
export default function WorkOrderDetailPanel({
  wo,
  hideStatusWidth = false,
}: {
  wo: WorkOrder;
  /** Durum + en bilgisi panel dışında (örn. başlıkta) gösteriliyorsa burada gizle. */
  hideStatusWidth?: boolean;
}) {
  const dispatched = wo.dispatchedTotalQty ?? 0;
  const target = wo.targetQuantity ?? null;
  const remaining = target != null ? Math.max(0, target - dispatched) : null;
  const overshoot = target != null && dispatched > target;
  const showWidth = wo.width != null && !hideStatusWidth;

  const externalStations = useMemo(
    () =>
      (wo.steps ?? [])
        .filter((s) => s.station?.type === 'EXTERNAL')
        .map((s) => ({
          id: s.id,
          name: s.station?.name ?? '—',
          status: s.status,
          seq: s.stepSequence,
        })),
    [wo.steps],
  );

  // External step varsa WO'nun sevkleri çek — info butonuna basılınca plaka/sürücü/notlar göstermek için.
  const hasExternal = externalStations.length > 0;
  const dispatchesQuery = useQuery({
    queryKey: ['dispatches', 'wo', wo.id],
    queryFn: () =>
      subcontractorService.listDispatches({ workOrderId: wo.id, pageSize: 100 }),
    enabled: hasExternal,
    staleTime: 30 * 1000,
  });

  // Step ID → o adımın açık (cancelledAt==null) en güncel sevki. Backend artık
  // adım başına tek açık sevke izin verir (subcontractor.service dispatch guard).
  const openDispatchByStep = useMemo(() => {
    const map = new Map<string, SubcontractorDispatchListItem>();
    const all = (dispatchesQuery.data?.data ?? []) as SubcontractorDispatchListItem[];
    // listDispatches dispatchedAt desc sıralı → ilk eşleşme en güncel.
    for (const d of all) {
      if (d.cancelledAt) continue;
      if (!map.has(d.stepId)) map.set(d.stepId, d);
    }
    return map;
  }, [dispatchesQuery.data]);

  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);

  // Sipariş listesi — müşteri grubu YOK. Fason Sevk aşamasında operatörün
  // müşteri adına ihtiyacı yok; o aşamada öncelikli olan BİZİM iç ürün adı
  // (planlanan kumaş). Müşteri-spesifik ürün/renk isimleri (customerItemName,
  // customerColorName) da gizli — sadece üretim/sevk için iç katalog adı.
  const orderLines = useMemo(() => {
    const out: Array<NonNullable<typeof wo.orderLinks>[number]> = [];
    for (const link of wo.orderLinks ?? []) {
      if (link.orderLine) out.push(link);
    }
    return out;
  }, [wo.orderLinks]);

  const isStock = wo.type === 'STOCK_PRODUCTION';

  return (
    <View style={styles.container}>
      {(!hideStatusWidth || isStock) && (
        <View style={styles.headerStrip}>
          {!hideStatusWidth && (
            <>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: WORK_ORDER_STATUS_COLOR[wo.status] ?? '#64748b' },
                ]}
              />
              <Text style={styles.statusText}>
                {trLabel(WORK_ORDER_STATUS_LABEL, wo.status)}
              </Text>
            </>
          )}
          {isStock && (
            <View style={[styles.typeTag, styles.stockTag]}>
              <Icon source="package-variant" size={12} color="#1e40af" />
              <Text style={[styles.typeTagText, { color: '#1e40af' }]}>Stoka</Text>
            </View>
          )}
        </View>
      )}

      {(target != null || dispatched > 0 || showWidth) && (
        <View style={styles.card}>
          {(target != null || showWidth) && (
            <View style={styles.badgeRow}>
              {target != null && (
                <View style={styles.badge}>
                  <Icon source="arrow-expand-vertical" size={13} color="#0f172a" />
                  <Text style={styles.badgeText}>{target} mt hedef</Text>
                </View>
              )}
              {showWidth && (
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

      {/* Üretilen Kumaş — fason sevk aşamasında en kritik bilgi.
          wo.targetItem (bizim katalogtaki iç ürün) + wo.targetColor.
          Müşteri adı/sipariş ürün adı GÖSTERİLMEZ. */}
      {(wo.targetItem || wo.targetColor) && (
        <View style={styles.card}>
          <View style={styles.targetHeader}>
            <Icon source="cube-outline" size={14} color="#4f46e5" />
            <Text style={styles.targetTitle}>Üretilen Kumaş</Text>
          </View>
          {wo.targetItem && (
            <Text style={styles.targetItemName} numberOfLines={2}>
              {wo.targetItem.name}
              {wo.targetItem.code ? ` · ${wo.targetItem.code}` : ''}
            </Text>
          )}
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
        </View>
      )}

      {orderLines.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.linkedOrdersTitle}>
            {orderLines.length} bağlı sipariş
          </Text>
          {orderLines.map((link, i) => {
            const ol = link.orderLine!;
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
              </View>
            );
          })}
        </View>
      )}

      {orderLines.length === 0 && wo.type === 'STOCK_PRODUCTION' && (
        <View style={styles.card}>
          <View style={styles.row}>
            <Icon source="package-variant" size={14} color="#64748b" />
            <Text style={styles.rowText}>Siparişe bağlı değil — stoğa üretim</Text>
          </View>
        </View>
      )}

      {externalStations.length > 0 && (
        <View style={styles.card}>
          {externalStations.map((s) => {
            const dispatch = openDispatchByStep.get(s.id);
            const expanded = expandedStepId === s.id;
            return (
              <View key={s.id}>
                <View style={styles.row}>
                  <Icon source="factory" size={14} color="#64748b" />
                  <Text style={styles.rowText}>
                    #{s.seq} {s.name}
                  </Text>
                  <Text style={styles.stepStatus}>
                    {trLabel(STEP_STATUS_LABEL, s.status)}
                  </Text>
                  {dispatch && (
                    <IconButton
                      icon={expanded ? 'chevron-up' : 'information-outline'}
                      size={16}
                      iconColor="#4f46e5"
                      onPress={() => setExpandedStepId(expanded ? null : s.id)}
                      style={styles.infoBtn}
                      accessibilityLabel="Sevk bilgisi"
                    />
                  )}
                </View>
                {expanded && dispatch && (
                  <View style={styles.dispatchBox}>
                    <View style={styles.dispatchRow}>
                      <Icon source="package-variant" size={12} color="#64748b" />
                      <Text style={styles.dispatchLabel}>Sevk No</Text>
                      <Text style={styles.dispatchValue}>{dispatch.dispatchNo}</Text>
                    </View>
                    <View style={styles.dispatchRow}>
                      <Icon source="calendar" size={12} color="#64748b" />
                      <Text style={styles.dispatchLabel}>Tarih</Text>
                      <Text style={styles.dispatchValue}>
                        {dayjs(dispatch.dispatchedAt).format('DD.MM.YYYY HH:mm')}
                      </Text>
                    </View>
                    <View style={styles.dispatchRow}>
                      <Icon source="car" size={12} color="#64748b" />
                      <Text style={styles.dispatchLabel}>Plaka</Text>
                      <Text style={styles.dispatchValue}>
                        {dispatch.plateNumber ?? '—'}
                      </Text>
                    </View>
                    <View style={styles.dispatchRow}>
                      <Icon source="account" size={12} color="#64748b" />
                      <Text style={styles.dispatchLabel}>Sürücü</Text>
                      <Text style={styles.dispatchValue}>
                        {dispatch.driverName ?? '—'}
                      </Text>
                    </View>
                    {dispatch.notes && (
                      <View style={styles.dispatchRow}>
                        <Icon source="note-text-outline" size={12} color="#64748b" />
                        <Text style={styles.dispatchLabel}>Not</Text>
                        <Text style={[styles.dispatchValue, styles.dispatchNotes]}>
                          {dispatch.notes}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
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
  targetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  targetTitle: { fontSize: 11, fontWeight: '700', color: '#4f46e5', letterSpacing: 0.3 },
  targetItemName: { fontSize: 14, fontWeight: '700', color: '#0f172a', paddingTop: 4 },
  linkedOrdersTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.3,
    paddingBottom: 2,
  },
  orderLine: { gap: 2, paddingVertical: 2 },
  orderLineTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  orderNo: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  orderQty: { fontSize: 11, color: '#475569', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  rowText: { fontSize: 12, color: '#0f172a', flex: 1 },
  stepStatus: { fontSize: 11, color: '#64748b', fontWeight: '600' },
  infoBtn: { margin: 0, padding: 0, width: 24, height: 24 },
  dispatchBox: {
    backgroundColor: '#eef2ff',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginLeft: 22,
    marginTop: 4,
    marginBottom: 4,
    gap: 4,
  },
  dispatchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dispatchLabel: { fontSize: 10, color: '#64748b', fontWeight: '600', minWidth: 50 },
  dispatchValue: { fontSize: 11, color: '#0f172a', fontWeight: '600', flex: 1 },
  dispatchNotes: { fontWeight: '500', fontStyle: 'italic' },
  colorSwatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
});
