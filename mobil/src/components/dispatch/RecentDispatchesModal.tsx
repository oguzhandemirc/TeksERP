import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  useWindowDimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  ActivityIndicator,
} from 'react-native-paper';
import RNModal from 'react-native-modal';
import { FlashList } from '@shopify/flash-list';
import Toast from 'react-native-toast-message';

import type { SubcontractorDispatchListItem } from '../../types/models';
import DispatchRow from './DispatchRow';
import DispatchDetailModal from './DispatchDetailModal';
import RefreshButton from '../RefreshButton';

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
 * - Detay görüntüleme: `DispatchDetailModal` overlay'i (lazy fetch).
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
  const [cancelReason, setCancelReason] = useState('');
  const [detailDispatchId, setDetailDispatchId] = useState<string | null>(null);

  const closeCancelOverlay = () => {
    setCancelTarget(null);
    setCancelReason('');
  };

  // Backdrop / geri tuşu önce overlay'leri kapatır, hepsi kapalıysa modalı.
  const handleBackdropPress = () => {
    if (cancelTarget) closeCancelOverlay();
    else if (detailDispatchId) setDetailDispatchId(null);
    else onDismiss();
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (reason.length < 3) {
      Toast.show({ type: 'error', text1: 'Sebep en az 3 karakter olmalı' });
      return;
    }
    try {
      await onCancelDispatch(cancelTarget.id, reason);
      closeCancelOverlay();
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
      <View style={[styles.sheet, { width: winW * 0.78, height: winH * 0.88 }]}>
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
              renderItem={({ item }) => (
                <DispatchRow
                  dispatch={item}
                  onShowDetail={(id) => setDetailDispatchId(id)}
                  onCancel={() =>
                    setCancelTarget({ id: item.id, no: item.dispatchNo })
                  }
                />
              )}
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>

        {/* Sade altbar — toplam + sayfalama */}
        {(totalPages > 1 || total > 0) && (
          <View style={styles.footer}>
            <Text style={styles.totalText}>{total} kayıt</Text>
            {totalPages > 1 && (
              <View style={styles.pager}>
                <IconButton
                  icon="chevron-left"
                  mode="outlined"
                  size={18}
                  disabled={page <= 1 || fetching}
                  onPress={() => onPageChange(Math.max(1, page - 1))}
                  accessibilityLabel="Önceki sayfa"
                  style={styles.pagerBtn}
                />
                <Text style={styles.pagerText}>
                  {page} / {totalPages}
                </Text>
                <IconButton
                  icon="chevron-right"
                  mode="outlined"
                  size={18}
                  disabled={page >= totalPages || fetching}
                  onPress={() => onPageChange(Math.min(totalPages, page + 1))}
                  accessibilityLabel="Sonraki sayfa"
                  style={styles.pagerBtn}
                />
              </View>
            )}
          </View>
        )}

        {/* Detay overlay (modal içinde — lazy fetch) */}
        <DispatchDetailModal
          dispatchId={detailDispatchId}
          onDismiss={() => setDetailDispatchId(null)}
        />

        {/* İptal onay overlay (Portal/Dialog kullanmaz, RNModal altında kalmaz) */}
        {cancelTarget && (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.overlay}
            pointerEvents="auto"
          >
            <Pressable
              style={styles.overlayBackdrop}
              onPress={closeCancelOverlay}
              accessibilityLabel="Vazgeç"
            />
            <View style={styles.cancelCard}>
              <View style={styles.cancelHeader}>
                <Text variant="titleMedium" style={styles.cancelTitle}>
                  Sevki İptal Et
                </Text>
                <IconButton
                  icon="close"
                  size={20}
                  onPress={closeCancelOverlay}
                  accessibilityLabel="Vazgeç"
                  style={{ margin: 0 }}
                />
              </View>
              <Text style={styles.cancelDesc}>
                <Text style={styles.cancelDispatchNo}>{cancelTarget.no}</Text> numaralı
                sevk iptal edilecek. Toplar STOCK durumuna geri dönecek.
              </Text>
              <TextInput
                mode="outlined"
                label="İptal Sebebi"
                value={cancelReason}
                onChangeText={setCancelReason}
                placeholder="Yanlış fason firma seçildi..."
                multiline
                numberOfLines={2}
                autoFocus
                style={styles.cancelInput}
              />
              <View style={styles.cancelActions}>
                <Button
                  mode="text"
                  onPress={closeCancelOverlay}
                  disabled={isCanceling}
                >
                  Vazgeç
                </Button>
                <Button
                  mode="contained"
                  buttonColor="#dc2626"
                  onPress={handleConfirmCancel}
                  loading={isCanceling}
                  disabled={isCanceling || cancelReason.trim().length < 3}
                >
                  İptal Et
                </Button>
              </View>
            </View>
          </KeyboardAvoidingView>
        )}
      </View>
      <Toast />
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
  pager: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pagerBtn: { margin: 0, width: 32, height: 32 },
  pagerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    minWidth: 44,
    textAlign: 'center',
  },

  // İptal overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  cancelCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    maxWidth: 480,
    gap: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  cancelHeader: { flexDirection: 'row', alignItems: 'center' },
  cancelTitle: { fontWeight: '700', color: '#0f172a', flex: 1 },
  cancelDesc: { fontSize: 13, color: '#475569', lineHeight: 19 },
  cancelDispatchNo: { fontFamily: 'monospace', fontWeight: '700', color: '#0f172a' },
  cancelInput: { backgroundColor: '#fff' },
  cancelActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
});
