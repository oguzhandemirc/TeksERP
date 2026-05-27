import React, { useCallback, useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import {
  Text,
  Button,
  IconButton,
  ActivityIndicator,
} from 'react-native-paper';
import RNModal from 'react-native-modal';
import { FlashList } from '@shopify/flash-list';

import type { SubcontractorDispatchListItem } from '../../types/models';
import DispatchRow from './DispatchRow';
import RefreshButton from '../RefreshButton';
import ConfirmDialog from '../ConfirmDialog';
import Pager from '../Pager';

interface Props {
  visible: boolean;
  dispatches: SubcontractorDispatchListItem[];
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  isCanceling: boolean;
  page: number;
  totalPages: number;
  total: number;
  onDismiss: () => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onCancelDispatch: (id: string, reason: string) => Promise<void>;
}

interface CancelTarget {
  id: string;
  no: string;
}

/**
 * Sevk geçmişi modalı.
 *
 * - Detay görüntüleme: satıra tıklayınca aşağıda inline panel açılır
 *   (`DispatchRow` lazy fetch). Önceki ayrı overlay (DispatchDetailModal)
 *   küçük ekranda kenardan taşıyordu — inline yapı taşmayı önler.
 * - İptal akışı: modal **içinde** absolute overlay (RNModal nesting yerine).
 *   Paper Dialog/Portal yaklaşımı RNModal'ın altında kalıyordu; overlay
 *   pattern bu sorunu çözer.
 */
export default function RecentDispatchesModal({
  visible,
  dispatches,
  loading,
  fetching,
  error,
  isCanceling,
  page,
  totalPages,
  total,
  onDismiss,
  onRefresh,
  onPageChange,
  onCancelDispatch,
}: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  // Aynı anda yalnız bir satır açık — operatör başkasına tıklayınca eski kapanır.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Stable handler'lar: DispatchRow memo'lu olduğu için referans sabit kalmalı.
  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);
  const handleCancelDispatch = useCallback(
    (item: SubcontractorDispatchListItem) => {
      setCancelTarget({ id: item.id, no: item.dispatchNo });
    },
    [],
  );
  const renderItem = useCallback(
    ({ item }: { item: SubcontractorDispatchListItem }) => (
      <DispatchRow
        dispatch={item}
        expanded={expandedId === item.id}
        onToggleExpand={handleToggleExpand}
        onCancel={handleCancelDispatch}
      />
    ),
    [expandedId, handleToggleExpand, handleCancelDispatch],
  );

  // Dikey/dar ekranda modal genişliği winW'in büyük çoğunluğu olsun
  // (önceki %78 ekran kenarından taşıyordu). Geniş ekran tabletlerde %78 yeterli.
  const sheetWidth = winW < 700 ? winW * 0.96 : winW * 0.78;

  // Backdrop / geri tuşu: önce expanded row, sonra modal. (Cancel onayı ayrı
  // bir ConfirmDialog modal'ında — kendi backdrop'unu yönetir.)
  const handleBackdropPress = () => {
    if (expandedId) setExpandedId(null);
    else onDismiss();
  };

  const handleConfirmCancel = async (payload: { reason?: string }) => {
    if (!cancelTarget || !payload.reason) return;
    try {
      await onCancelDispatch(cancelTarget.id, payload.reason);
      setCancelTarget(null);
    } catch {
      // Toast parent'taki error handler'da gösterilir
    }
  };

  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={handleBackdropPress}
      onBackButtonPress={handleBackdropPress}
      backdropOpacity={0.5}
      style={styles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
      avoidKeyboard
    >
      <View style={[styles.sheet, { width: sheetWidth, height: winH * 0.88 }]}>
        {/* Sade header */}
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.title}>
            Son Sevkler
          </Text>
          <View style={{ flex: 1 }} />
          {totalPages > 1 && (
            <View style={styles.pageBadge}>
              <Text style={styles.pageBadgeText}>
                {page} / {totalPages}
              </Text>
            </View>
          )}
          <RefreshButton
            onPress={onRefresh}
            refreshing={fetching}
            isError={!!error}
            errorMessage={error?.message}
            containerStyle={styles.headerRefresh}
          />
          <IconButton
            icon="close"
            size={22}
            onPress={onDismiss}
            accessibilityLabel="Kapat"
            style={styles.headerBtn}
          />
        </View>

        {/* Liste */}
        <View style={styles.listBox}>
          {loading ? (
            <View style={styles.empty}>
              <ActivityIndicator size="large" color="#4f46e5" />
            </View>
          ) : error ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Liste yüklenemedi</Text>
              <Text style={styles.emptyHint}>{error.message}</Text>
            </View>
          ) : dispatches.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Henüz sevk yok</Text>
            </View>
          ) : (
            <FlashList
              data={dispatches}
              keyExtractor={(d) => d.id}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>

        {/* Sade altbar — toplam + sayfalama */}
        {(totalPages > 1 || total > 0) && (
          <View style={styles.footer}>
            <Text style={styles.totalText}>{total} kayıt</Text>
            <Pager
              page={page}
              totalPages={totalPages}
              fetching={fetching}
              onPageChange={onPageChange}
            />
          </View>
        )}

      </View>

      {/* İptal onayı — ConfirmDialog ayrı bir RNModal, parent modal'ın üstünde render olur */}
      <ConfirmDialog
        kind="destructive"
        visible={!!cancelTarget}
        onDismiss={() => setCancelTarget(null)}
        title="Sevki İptal Et"
        description={
          <Text style={styles.cancelDesc}>
            <Text style={styles.cancelDispatchNo}>{cancelTarget?.no}</Text> numaralı
            sevk iptal edilecek. Toplar STOCK durumuna geri dönecek.
          </Text>
        }
        confirmLabel="İptal Et"
        confirming={isCanceling}
        reason={{
          label: 'İptal Sebebi',
          placeholder: 'Yanlış fason firma seçildi...',
        }}
        onConfirm={handleConfirmCancel}
      />
    </RNModal>
  );
}

const styles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0, padding: 0 },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 4,
  },
  title: { fontWeight: '700', color: '#0f172a' },
  headerBtn: { margin: 0 },
  headerRefresh: { marginRight: 4 },
  pageBadge: {
    backgroundColor: '#eef2ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 4,
  },
  pageBadgeText: { fontSize: 11, fontWeight: '700', color: '#4f46e5' },

  listBox: { flex: 1 },
  listContent: { padding: 8, paddingBottom: 8 },

  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 6,
  },
  emptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#cbd5e1', textAlign: 'center' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  totalText: { fontSize: 12, color: '#64748b', fontWeight: '600' },

  // ConfirmDialog description'a verilen inline JSX — sevk no monospace vurgu için
  cancelDesc: { fontSize: 13, color: '#475569', lineHeight: 19 },
  cancelDispatchNo: { fontFamily: 'monospace', fontWeight: '700', color: '#0f172a' },
});
