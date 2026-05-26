import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Icon } from 'react-native-paper';
import dayjs from 'dayjs';

import type { SubcontractorDispatch } from '../../types/models';

/**
 * Bir sevkin tüm detayları — toplar, plaka/sürücü, planlanan vs sevk firması,
 * iptal bilgisi. Liste satırı genişletildiğinde gösterilir.
 */
export default function DispatchDetailPanel({
  dispatch,
}: {
  dispatch: SubcontractorDispatch;
}) {
  const cancelled = !!dispatch.cancelledAt;
  const planned = dispatch.plannedSubcontractor;
  const isOverride =
    !!planned && planned.id !== dispatch.subcontractor?.id;

  const dispatcher =
    dispatch.dispatchedBy?.fullName ??
    dispatch.dispatchedBy?.username ??
    'Bilinmiyor';

  const stepName = dispatch.step?.station?.name ?? '—';
  const stepSeq = dispatch.step?.stepSequence ?? null;

  // WO bağlı sipariş(ler) → benzersiz müşteri listesi
  const woCustomers = Array.from(
    new Map(
      (dispatch.workOrder?.orderLinks ?? [])
        .map((l) => l.orderLine?.order?.customer)
        .filter((c): c is { id: string; code: string; name: string } => !!c)
        .map((c) => [c.id, c])
    ).values()
  );

  return (
    <View style={styles.container}>
      {/* Sevkiyat bilgileri */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Sevkiyat</Text>

        <View style={styles.row}>
          <Icon source="briefcase-outline" size={14} color="#64748b" />
          <Text style={styles.rowLabel}>İş Emri</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {dispatch.workOrder?.batchNumber ?? '—'}
          </Text>
        </View>

        {woCustomers.length > 0 && (
          <View style={styles.row}>
            <Icon source="account-tie" size={14} color="#4f46e5" />
            <Text style={styles.rowLabel}>Müşteri</Text>
            <Text style={[styles.rowValue, { color: '#4f46e5', fontWeight: '700' }]} numberOfLines={2}>
              {woCustomers.map((c) => c.name).join(', ')}
            </Text>
          </View>
        )}

        {dispatch.workOrder?.type === 'STOCK_PRODUCTION' && woCustomers.length === 0 && (
          <View style={styles.row}>
            <Icon source="package-variant" size={14} color="#64748b" />
            <Text style={styles.rowLabel}>Tip</Text>
            <Text style={styles.rowValue}>Stoğa üretim (siparişe bağlı değil)</Text>
          </View>
        )}

        <View style={styles.row}>
          <Icon source="factory" size={14} color="#64748b" />
          <Text style={styles.rowLabel}>Adım</Text>
          <Text style={styles.rowValue}>
            {stepSeq != null ? `#${stepSeq} · ` : ''}
            {stepName}
          </Text>
        </View>

        <View style={styles.row}>
          <Icon source="domain" size={14} color="#64748b" />
          <Text style={styles.rowLabel}>Firma</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {dispatch.subcontractor?.name ?? '—'}
          </Text>
        </View>

        {isOverride && (
          <View style={[styles.row, styles.overrideRow]}>
            <Icon source="alert" size={14} color="#92400e" />
            <Text style={[styles.rowLabel, { color: '#92400e' }]}>Planlı</Text>
            <Text
              style={[styles.rowValue, { color: '#92400e' }]}
              numberOfLines={1}
            >
              {planned?.name ?? '—'} (override)
            </Text>
          </View>
        )}

        {(dispatch.plateNumber || dispatch.driverName) && (
          <View style={styles.metaRow}>
            {dispatch.plateNumber && (
              <View style={styles.badge}>
                <Icon source="truck" size={13} color="#0f172a" />
                <Text style={styles.badgeText}>{dispatch.plateNumber}</Text>
              </View>
            )}
            {dispatch.driverName && (
              <View style={styles.badge}>
                <Icon source="account" size={13} color="#0f172a" />
                <Text style={styles.badgeText}>{dispatch.driverName}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.row}>
          <Icon source="clock-outline" size={14} color="#64748b" />
          <Text style={styles.rowLabel}>Sevkeden</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {dispatcher} · {dayjs(dispatch.dispatchedAt).format('DD.MM.YYYY HH:mm')}
          </Text>
        </View>

        {dispatch.notes && (
          <View style={styles.notesBox}>
            <Text style={styles.notesText}>{dispatch.notes}</Text>
          </View>
        )}
      </View>

      {/* Sevk edilen toplar */}
      {(dispatch.items ?? []).length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            Toplar ({dispatch.items?.length}) · {dispatch.totalQty.toFixed(1)} mt
          </Text>
          {(dispatch.items ?? []).map((item) => {
            const r = item.roll;
            const itemLabel = r?.color
              ? `${r.item?.name ?? '—'} · ${r.color.name}`
              : (r?.item?.name ?? '—');
            return (
              <View key={item.id} style={styles.rollItem}>
                <View style={styles.rollItemHeader}>
                  <Text style={styles.rollBarcode}>{r?.barcode ?? '—'}</Text>
                  <Text style={styles.rollName} numberOfLines={1}>
                    {itemLabel}
                  </Text>
                </View>
                <View style={styles.rollBadgeRow}>
                  <View style={styles.badge}>
                    <Icon source="arrow-expand-vertical" size={12} color="#0f172a" />
                    <Text style={styles.badgeText}>{item.dispatchedQty} mt</Text>
                  </View>
                  {r?.width != null && (
                    <View style={styles.badge}>
                      <Icon
                        source="arrow-expand-horizontal"
                        size={12}
                        color="#0f172a"
                      />
                      <Text style={styles.badgeText}>{r.width} cm</Text>
                    </View>
                  )}
                  {r?.qualityGrade && (
                    <View style={styles.badge}>
                      <Icon source="star-circle" size={12} color="#0f172a" />
                      <Text style={styles.badgeText}>{r.qualityGrade}</Text>
                    </View>
                  )}
                  {item.dispatchedWeight != null && (
                    <View style={styles.badge}>
                      <Icon source="weight" size={12} color="#0f172a" />
                      <Text style={styles.badgeText}>
                        {item.dispatchedWeight} kg
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* İptal bilgisi */}
      {cancelled && (
        <View style={[styles.card, styles.cancelCard]}>
          <View style={styles.row}>
            <Icon source="close-circle" size={14} color="#dc2626" />
            <Text style={[styles.rowLabel, { color: '#dc2626' }]}>İptal</Text>
            <Text style={[styles.rowValue, { color: '#7f1d1d' }]} numberOfLines={1}>
              {dispatch.cancelledBy?.fullName ??
                dispatch.cancelledBy?.username ??
                '—'}
              {' · '}
              {dayjs(dispatch.cancelledAt).format('DD.MM.YYYY HH:mm')}
            </Text>
          </View>
          {dispatch.cancelReason && (
            <View style={styles.notesBox}>
              <Text style={[styles.notesText, { color: '#7f1d1d' }]}>
                {dispatch.cancelReason}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  card: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  cancelCard: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  overrideRow: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
  },
  rowLabel: { fontSize: 11, color: '#64748b', fontWeight: '600', minWidth: 56 },
  rowValue: { fontSize: 12, color: '#0f172a', flex: 1, fontWeight: '500' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 2 },
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
  notesBox: {
    backgroundColor: '#fff',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#cbd5e1',
  },
  notesText: { fontSize: 12, color: '#475569', fontStyle: 'italic' },
  rollItem: {
    backgroundColor: '#fff',
    borderRadius: 6,
    padding: 8,
    gap: 4,
  },
  rollItemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rollBarcode: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#0f172a',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  rollName: { fontSize: 12, color: '#475569', flex: 1 },
  rollBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  ownerText: { fontSize: 11, color: '#92400e', fontWeight: '700' },
});
