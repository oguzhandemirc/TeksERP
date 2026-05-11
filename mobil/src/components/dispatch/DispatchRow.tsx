import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Text,
  Surface,
  IconButton,
  Icon,
  TouchableRipple,
} from 'react-native-paper';
import dayjs from 'dayjs';

import type { SubcontractorDispatchListItem } from '../../types/models';

interface Props {
  dispatch: SubcontractorDispatchListItem;
  onShowDetail: (id: string) => void;
  onCancel: () => void;
}

/**
 * Sevkiyat geçmişi listesindeki tek satır — kompakt.
 * Tüm satıra basınca detay açılır; sağdaki ikon butonlar detay/iptal.
 */
export default function DispatchRow({ dispatch, onShowDetail, onCancel }: Props) {
  const cancelled = !!dispatch.cancelledAt;

  return (
    <Surface
      style={[styles.item, cancelled && styles.itemCancelled]}
      elevation={1}
    >
      <TouchableRipple
        borderless
        rippleColor="rgba(79, 70, 229, 0.12)"
        onPress={() => onShowDetail(dispatch.id)}
        style={styles.touch}
      >
        <View style={styles.row}>
          {/* Sol: dispatch no + time */}
          <View style={styles.col1}>
            <Text style={styles.no} numberOfLines={1}>
              {dispatch.dispatchNo}
            </Text>
            <Text style={styles.time}>
              {dayjs(dispatch.dispatchedAt).format('DD.MM HH:mm')}
            </Text>
          </View>

          {/* Orta: firma + meta tek kolon */}
          <View style={styles.col2}>
            <View style={styles.companyRow}>
              <Icon source="factory" size={13} color="#475569" />
              <Text style={styles.company} numberOfLines={1}>
                {dispatch.subcontractor?.name ?? '—'}
              </Text>
              {cancelled && (
                <View style={styles.cancelTag}>
                  <Icon source="close-circle" size={11} color="#dc2626" />
                  <Text style={styles.cancelTagText}>İptal</Text>
                </View>
              )}
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>
                {dispatch.workOrder?.batchNumber ?? '—'}
              </Text>
              <Text style={styles.metaSep}>·</Text>
              <Text style={styles.metaText}>
                {dispatch._count?.items ?? 0} top
              </Text>
              <Text style={styles.metaSep}>·</Text>
              <Text style={styles.metaQty}>{dispatch.totalQty.toFixed(1)} mt</Text>
            </View>
          </View>

          {/* Sağ: aksiyonlar */}
          <View style={styles.actions}>
            <IconButton
              icon="information-outline"
              mode="contained-tonal"
              size={18}
              containerColor="#eef2ff"
              iconColor="#4f46e5"
              onPress={() => onShowDetail(dispatch.id)}
              accessibilityLabel="Detay göster"
              style={styles.actionBtn}
            />
            {!cancelled && (
              <IconButton
                icon="close"
                mode="outlined"
                size={18}
                iconColor="#dc2626"
                onPress={onCancel}
                accessibilityLabel="Sevki iptal et"
                style={[styles.actionBtn, { borderColor: '#fecaca' }]}
              />
            )}
          </View>
        </View>
      </TouchableRipple>
    </Surface>
  );
}

const styles = StyleSheet.create({
  item: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginVertical: 3,
    overflow: 'hidden',
  },
  itemCancelled: { opacity: 0.7, backgroundColor: '#fef2f2' },
  touch: { borderRadius: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 8,
  },
  col1: { width: 90, gap: 1 },
  no: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#0f172a',
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  time: { fontSize: 10, color: '#94a3b8', marginLeft: 1 },
  col2: { flex: 1, gap: 2 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  company: { fontSize: 12, color: '#0f172a', fontWeight: '600', flex: 1 },
  cancelTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#fee2e2',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  cancelTagText: { fontSize: 10, color: '#dc2626', fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: '#64748b', fontWeight: '500' },
  metaSep: { fontSize: 11, color: '#cbd5e1' },
  metaQty: { fontSize: 11, color: '#0f172a', fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionBtn: { margin: 0, width: 32, height: 32 },
});
