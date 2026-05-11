import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, IconButton, ActivityIndicator, Button } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';

import { subcontractorService } from '../../services/subcontractor.service';
import type { SubcontractorDispatch } from '../../types/models';
import DispatchDetailPanel from './DispatchDetailPanel';

interface Props {
  dispatchId: string | null;
  onDismiss: () => void;
}

/**
 * Sevk detayını lazy çeken iç-modal (overlay).
 *
 * `RecentDispatchesModal` içinde absolute overlay olarak render edilir
 * (RNModal nesting yerine — daha güvenilir Android davranışı).
 *
 * `dispatchId` set edildiğinde `getDispatch(id)` ile zenginleştirilmiş veri
 * çekilir; react-query 5 dk cache'ler, aynı id'ye ikinci tıklamada anlık.
 */
export default function DispatchDetailModal({ dispatchId, onDismiss }: Props) {
  const detailQuery = useQuery({
    queryKey: ['dispatch', dispatchId],
    queryFn: () => subcontractorService.getDispatch(dispatchId as string),
    enabled: !!dispatchId,
    staleTime: 5 * 60 * 1000,
  });

  if (!dispatchId) return null;

  const dispatch = detailQuery.data?.data as SubcontractorDispatch | undefined;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable
        style={styles.backdrop}
        onPress={onDismiss}
        accessibilityLabel="Kapat"
      />
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="titleMedium" style={styles.title}>
              Sevk Detayı
            </Text>
            {dispatch?.dispatchNo && (
              <Text style={styles.subtitle}>{dispatch.dispatchNo}</Text>
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
              <ActivityIndicator size="large" color="#4f46e5" />
              <Text style={styles.emptyText}>Detaylar yükleniyor...</Text>
            </View>
          ) : detailQuery.isError ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Detay yüklenemedi</Text>
              <Text style={styles.emptyHint}>
                {(detailQuery.error as Error).message}
              </Text>
              <Button
                mode="outlined"
                onPress={() => detailQuery.refetch()}
                style={{ marginTop: 12 }}
              >
                Tekrar dene
              </Button>
            </View>
          ) : dispatch ? (
            <ScrollView contentContainerStyle={styles.scroll}>
              <DispatchDetailPanel dispatch={dispatch} />
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
  subtitle: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  body: { flex: 1 },
  scroll: { padding: 12, gap: 8 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 6,
  },
  emptyText: { fontSize: 15, color: '#475569', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#94a3b8', textAlign: 'center' },
});
