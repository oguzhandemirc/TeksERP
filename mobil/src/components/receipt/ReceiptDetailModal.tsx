import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, IconButton, ActivityIndicator, Button, Surface, Icon } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { subcontractorService } from '../../services/subcontractor.service';
import type { SubcontractorReceipt } from '../../types/models';

interface Props {
  receiptId: string | null;
  onDismiss: () => void;
}

/**
 * Mal kabul detayını lazy çeken iç-modal (overlay).
 * RecentReceiptsModal içinde absolute overlay olarak render edilir.
 */
export default function ReceiptDetailModal({ receiptId, onDismiss }: Props) {
  const detailQuery = useQuery({
    queryKey: ['receipt', receiptId],
    queryFn: () => subcontractorService.getReceipt(receiptId as string),
    enabled: !!receiptId,
    staleTime: 5 * 60 * 1000,
  });

  if (!receiptId) return null;

  const receipt = detailQuery.data?.data as SubcontractorReceipt | undefined;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Kapat" />
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="titleMedium" style={styles.title}>
              Mal Kabul Detayı
            </Text>
            {receipt?.receiptNo && (
              <Text style={styles.subtitle}>{receipt.receiptNo}</Text>
            )}
          </View>
          <IconButton
            icon="close"
            size={24}
            onPress={onDismiss}
            accessibilityLabel="Kapat"
            style={{ margin: 0 }}
          />
        </View>

        <View style={styles.body}>
          {detailQuery.isLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator size="large" color="#059669" />
              <Text style={styles.emptyText}>Detaylar yükleniyor...</Text>
            </View>
          ) : detailQuery.isError ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Detay yüklenemedi</Text>
              <Text style={styles.emptyHint}>{(detailQuery.error as Error).message}</Text>
              <Button
                mode="outlined"
                onPress={() => detailQuery.refetch()}
                style={{ marginTop: 12 }}
              >
                Tekrar dene
              </Button>
            </View>
          ) : receipt ? (
            <ScrollView contentContainerStyle={styles.scroll}>
              {/* Üst özet */}
              <Surface style={styles.summary} elevation={0}>
                <View style={styles.summaryRow}>
                  <Icon source="factory" size={16} color="#475569" />
                  <Text style={styles.summaryLabel}>Fason:</Text>
                  <Text style={styles.summaryValue}>
                    {receipt.subcontractor?.name ?? '—'}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Icon source="clipboard-text-outline" size={16} color="#475569" />
                  <Text style={styles.summaryLabel}>İş Emri:</Text>
                  <Text style={styles.summaryValue}>
                    {receipt.workOrder?.batchNumber ?? '—'}
                  </Text>
                </View>
                {receipt.step?.station && (
                  <View style={styles.summaryRow}>
                    <Icon source="map-marker-path" size={16} color="#475569" />
                    <Text style={styles.summaryLabel}>İstasyon:</Text>
                    <Text style={styles.summaryValue}>
                      Adım {receipt.step.stepSequence} · {receipt.step.station.name}
                    </Text>
                  </View>
                )}
                {receipt.manifestNo && (
                  <View style={styles.summaryRow}>
                    <Icon source="file-document-outline" size={16} color="#475569" />
                    <Text style={styles.summaryLabel}>İrsaliye No:</Text>
                    <Text style={styles.summaryValue}>{receipt.manifestNo}</Text>
                  </View>
                )}
                <View style={styles.summaryRow}>
                  <Icon source="clock-outline" size={16} color="#475569" />
                  <Text style={styles.summaryLabel}>Kabul Zamanı:</Text>
                  <Text style={styles.summaryValue}>
                    {dayjs(receipt.receivedAt).format('DD.MM.YYYY HH:mm')}
                  </Text>
                </View>
                {receipt.receivedBy?.fullName && (
                  <View style={styles.summaryRow}>
                    <Icon source="account" size={16} color="#475569" />
                    <Text style={styles.summaryLabel}>Kabul Eden:</Text>
                    <Text style={styles.summaryValue}>{receipt.receivedBy.fullName}</Text>
                  </View>
                )}
                {receipt.notes && (
                  <View style={[styles.summaryRow, styles.notesRow]}>
                    <Icon source="note-text-outline" size={16} color="#475569" />
                    <Text style={[styles.summaryValue, { flex: 1 }]} numberOfLines={4}>
                      {receipt.notes}
                    </Text>
                  </View>
                )}
              </Surface>

              {/* Toplar */}
              <Text style={styles.sectionTitle}>
                Kabul Edilen Toplar ({receipt.items?.length ?? 0})
              </Text>
              {(receipt.items ?? []).map((item, idx) => (
                <Surface key={item.id} style={styles.rollItem} elevation={1}>
                  <View style={styles.rollIndex}>
                    <Text style={styles.rollIndexText}>{idx + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rollBarcode}>
                      {item.newRoll?.barcode ?? '—'}
                    </Text>
                    <Text style={styles.rollItemName} numberOfLines={1}>
                      {item.newRoll?.item?.name ?? '—'}
                      {item.newRoll?.color?.name ? ` · ${item.newRoll.color.name}` : ''}
                    </Text>
                    {item.notes && (
                      <Text style={styles.rollNote} numberOfLines={2}>
                        ✏ {item.notes}
                      </Text>
                    )}
                  </View>
                </Surface>
              ))}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    width: '100%',
    maxWidth: 720,
    flex: 1,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: { fontWeight: '700', color: '#0f172a' },
  subtitle: { fontFamily: 'monospace', fontSize: 12, color: '#64748b', marginTop: 2 },
  body: { flex: 1 },
  scroll: { padding: 12, gap: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 6 },
  emptyText: { fontSize: 15, color: '#475569', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#94a3b8', textAlign: 'center' },

  summary: {
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 10,
    gap: 6,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notesRow: { alignItems: 'flex-start' },
  summaryLabel: { fontSize: 12, color: '#64748b', fontWeight: '600', minWidth: 90 },
  summaryValue: { fontSize: 13, color: '#0f172a', fontWeight: '600' },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginTop: 8 },

  rollItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    gap: 10,
  },
  rollIndex: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#dcfce7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rollIndexText: { fontSize: 12, fontWeight: '700', color: '#059669' },
  rollBarcode: { fontFamily: 'monospace', fontSize: 13, fontWeight: '700', color: '#0f172a' },
  rollItemName: { fontSize: 12, color: '#475569', marginTop: 2 },
  rollNote: {
    fontSize: 12,
    color: '#0369a1',
    marginTop: 4,
    fontStyle: 'italic',
  },
});
