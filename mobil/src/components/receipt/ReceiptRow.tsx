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

import type { SubcontractorReceiptListItem } from '../../types/models';

interface Props {
  receipt: SubcontractorReceiptListItem;
  onShowDetail: (id: string) => void;
  /** Verilirse iptal butonu görünür. cancelledAt dolu ise zaten gösterilmez. */
  onCancel?: (id: string) => void;
}

/**
 * Mal kabul listesindeki tek satır — kompakt.
 * Tüm satıra basınca detay açılır; sağdaki ikon buton aynısı için kısayol.
 *
 * Refactor 3 — Per-action undo: cancelledAt boş ve onCancel verilmişse iptal
 * butonu sağda görünür. cancelledAt doluysa satır gri + cancelReason tooltip.
 */
export default function ReceiptRow({ receipt, onShowDetail, onCancel }: Props) {
  const itemCount = receipt._count?.items ?? receipt.items?.length ?? 0;
  const isCancelled = !!receipt.cancelledAt;

  return (
    <Surface style={[styles.item, isCancelled && styles.itemCancelled]} elevation={1}>
      <TouchableRipple
        borderless
        rippleColor="rgba(16, 185, 129, 0.12)"
        onPress={() => onShowDetail(receipt.id)}
        style={styles.touch}
      >
        <View style={styles.row}>
          {/* Sol: receipt no + zaman */}
          <View style={styles.col1}>
            <Text style={[styles.no, isCancelled && styles.noCancelled]} numberOfLines={1}>
              {receipt.receiptNo}
            </Text>
            <Text style={styles.time}>
              {dayjs(receipt.receivedAt).format('DD.MM HH:mm')}
            </Text>
            {isCancelled && (
              <Text style={styles.cancelTag} numberOfLines={1}>
                İPTAL
              </Text>
            )}
          </View>

          {/* Orta: firma + meta */}
          <View style={styles.col2}>
            <View style={styles.companyRow}>
              <Icon source="factory" size={13} color="#475569" />
              <Text style={styles.company} numberOfLines={1}>
                {receipt.subcontractor?.name ?? '—'}
              </Text>
              {receipt.manifestNo && (
                <View style={styles.manifestTag}>
                  <Icon source="file-document-outline" size={11} color="#0369a1" />
                  <Text style={styles.manifestTagText} numberOfLines={1}>
                    {receipt.manifestNo}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>
                {receipt.workOrder?.batchNumber ?? '—'}
              </Text>
              <Text style={styles.metaSep}>·</Text>
              <Text style={styles.metaText}>
                {itemCount} top
                {typeof receipt.totalQty === 'number' && receipt.totalQty > 0
                  ? ` · ${receipt.totalQty.toFixed(1)} mt`
                  : ''}
              </Text>
              {receipt.step?.station?.name && (
                <>
                  <Text style={styles.metaSep}>·</Text>
                  <Text style={styles.metaText} numberOfLines={1}>
                    {receipt.step.station.name}
                  </Text>
                </>
              )}
            </View>
          </View>

          {/* Sağ: detay + (opsiyonel) iptal */}
          <View style={styles.actions}>
            <IconButton
              icon="information-outline"
              mode="contained-tonal"
              size={18}
              containerColor="#dcfce7"
              iconColor="#059669"
              onPress={() => onShowDetail(receipt.id)}
              accessibilityLabel="Detay göster"
              style={styles.actionBtn}
            />
            {onCancel && !isCancelled && (
              <IconButton
                icon="undo-variant"
                mode="contained-tonal"
                size={18}
                containerColor="#fef2f2"
                iconColor="#dc2626"
                onPress={() => onCancel(receipt.id)}
                accessibilityLabel="Kabulü iptal et"
                style={styles.actionBtn}
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
  itemCancelled: { backgroundColor: '#fef2f2', opacity: 0.7 },
  touch: { borderRadius: 8 },
  noCancelled: {
    backgroundColor: '#fee2e2',
    color: '#7f1d1d',
    textDecorationLine: 'line-through',
  },
  cancelTag: {
    fontSize: 9,
    fontWeight: '700',
    color: '#b91c1c',
    backgroundColor: '#fecaca',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    alignSelf: 'flex-start',
    marginTop: 1,
  },
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
    backgroundColor: '#dcfce7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  time: { fontSize: 10, color: '#94a3b8', marginLeft: 1 },
  col2: { flex: 1, gap: 2 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  company: { fontSize: 12, color: '#0f172a', fontWeight: '600', flex: 1 },
  manifestTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    maxWidth: 120,
  },
  manifestTagText: { fontSize: 10, color: '#0369a1', fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: '#64748b', fontWeight: '500' },
  metaSep: { fontSize: 11, color: '#cbd5e1' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionBtn: { margin: 0, width: 32, height: 32 },
});
