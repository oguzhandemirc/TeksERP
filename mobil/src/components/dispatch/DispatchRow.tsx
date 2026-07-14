import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Text,
  Surface,
  IconButton,
  Icon,
  TouchableRipple,
  ActivityIndicator,
  Button,
} from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import type {
  SubcontractorDispatch,
  SubcontractorDispatchListItem,
} from '../../types/models';
import { subcontractorService } from '../../services/subcontractor.service';
import DispatchDetailPanel from './DispatchDetailPanel';

interface Props {
  dispatch: SubcontractorDispatchListItem;
  expanded: boolean;
  /** Stable handler — id parent'a iletilir, satır referansı sabit kalsın diye. */
  onToggleExpand: (id: string) => void;
  onCancel: (item: SubcontractorDispatchListItem) => void;
}

/**
 * Sevkiyat geçmişi listesindeki tek satır — kompakt.
 * Satırın koduna/üstüne tıklanınca aşağıda detay paneli inline açılır
 * (önceki modal overlay yerine — küçük ekranda taşma sorunu yoktu).
 */
function DispatchRow({
  dispatch,
  expanded,
  onToggleExpand,
  onCancel,
}: Props) {
  const cancelled = !!dispatch.cancelledAt;

  // Genişletme sırasında full dispatch lazy çekilir; aynı id 5 dk cache'lenir.
  const detailQuery = useQuery({
    queryKey: ['dispatch', dispatch.id],
    queryFn: () => subcontractorService.getDispatch(dispatch.id),
    enabled: expanded,
    staleTime: 5 * 60 * 1000,
  });
  const fullDispatch = detailQuery.data?.data as
    | SubcontractorDispatch
    | undefined;

  const handleToggle = useCallback(
    () => onToggleExpand(dispatch.id),
    [dispatch.id, onToggleExpand],
  );
  const handleCancel = useCallback(
    () => onCancel(dispatch),
    [dispatch, onCancel],
  );
  const handleRetry = useCallback(() => {
    void detailQuery.refetch();
  }, [detailQuery]);

  return (
    <Surface
      style={[styles.item, cancelled && styles.itemCancelled]}
      elevation={1}
    >
      <TouchableRipple
        borderless
        rippleColor="rgba(79, 70, 229, 0.12)"
        onPress={handleToggle}
        accessibilityLabel={expanded ? 'Detayı gizle' : 'Detayı aç'}
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
                {dispatch.workOrder?.workOrderNumber ?? '—'}
              </Text>
              <Text style={styles.metaSep}>·</Text>
              <Text style={styles.metaText}>
                {dispatch._count?.items ?? 0} top
              </Text>
              <Text style={styles.metaSep}>·</Text>
              <Text style={styles.metaQty}>{dispatch.totalQty.toFixed(1)} mt</Text>
            </View>
          </View>

          {/* Sağ: chevron + iptal */}
          <View style={styles.actions}>
            <Icon
              source={expanded ? 'chevron-up' : 'chevron-down'}
              size={20}
              color="#64748b"
            />
            {!cancelled && (
              <IconButton
                icon="close"
                mode="outlined"
                size={18}
                iconColor="#dc2626"
                onPress={handleCancel}
                accessibilityLabel="Sevki iptal et"
                style={[styles.actionBtn, { borderColor: '#fecaca' }]}
              />
            )}
          </View>
        </View>
      </TouchableRipple>

      {expanded && (
        <View style={styles.expandedBox}>
          {detailQuery.isLoading || !fullDispatch ? (
            detailQuery.isError ? (
              <View style={styles.expandedEmpty}>
                <Text style={styles.expandedEmptyText}>Detay yüklenemedi</Text>
                <Text style={styles.expandedEmptyHint}>
                  {(detailQuery.error as Error).message}
                </Text>
                <Button
                  mode="outlined"
                  compact
                  onPress={handleRetry}
                  style={{ marginTop: 8 }}
                >
                  Tekrar dene
                </Button>
              </View>
            ) : (
              <View style={styles.expandedLoading}>
                <ActivityIndicator size="small" color="#4f46e5" />
              </View>
            )
          ) : (
            <DispatchDetailPanel dispatch={fullDispatch} />
          )}
        </View>
      )}
    </Surface>
  );
}

export default React.memo(DispatchRow);

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
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionBtn: { margin: 0, width: 32, height: 32 },

  expandedBox: {
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  expandedLoading: { paddingVertical: 20, alignItems: 'center' },
  expandedEmpty: { padding: 12, alignItems: 'center', gap: 4 },
  expandedEmptyText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  expandedEmptyHint: { fontSize: 11, color: '#94a3b8', textAlign: 'center' },
});
