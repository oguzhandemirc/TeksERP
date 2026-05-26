import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, IconButton, Surface } from 'react-native-paper';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';

import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import {
  shippingQueueService,
  type ShippingQueueJob,
} from '../../../services/shippingQueue.service';
import { rollService } from '../../../services/roll.service';
import { useShippingSessionStore } from '../../../store/shippingSession.store';
import { useAuthStore } from '../../../store/authStore';
import QueueListView from './components/QueueListView';
import RequirementsPanel from './components/RequirementsPanel';
import SacksPanel from './components/SacksPanel';

// =============================================================================
// Tartı / Sevkiyat — sipariş seviyesinde akış
// =============================================================================
// 1) Kuyruk listesi → operatör sipariş alır
// 2) Çalışma: sol panel sipariş ihtiyaçları, sağ panel çuval/havuz yönetimi
// 3) Tamamla → sipariş DONE, sevkiyat ekibinin çuvalları çıkarması beklenir
// =============================================================================

export default function TartiPaketScreen() {
  const qc = useQueryClient();
  const device = useDeviceType();
  const isPhone = device === 'phone';
  const activeQueueId = useShippingSessionStore((s) => s.activeQueueId);
  const startSession = useShippingSessionStore((s) => s.startSession);
  const endSession = useShippingSessionStore((s) => s.endSession);
  const addToPool = useShippingSessionStore((s) => s.addToPool);
  const pool = useShippingSessionStore((s) => s.pool);
  const currentUserId = useAuthStore((s) => s.user?.userId ?? null);

  const [scannerOpen, setScannerOpen] = useState(false);

  // Aktif Zustand session yoksa, backend'de bu operatöre atanmış TAKEN bir iş
  // varsa otomatik resume et (uygulama yeniden açılırken işin kaybolmaması için).
  const resumeJob = (job: ShippingQueueJob) => {
    startSession({
      queueId: job.id,
      orderId: job.order.id,
      customerId: job.order.customer.id,
    });
  };

  // Aktif iş yokken → kuyruk listesi
  const queueQ = useQuery({
    queryKey: ['shipping-queue', 'list'],
    queryFn: () => shippingQueueService.list(),
    enabled: !activeQueueId,
  });
  const queueJobs: ShippingQueueJob[] = queueQ.data?.data ?? [];

  // Aktif iş → gerekli detay
  const activeQ = useQuery({
    queryKey: ['shipping-queue', 'requirements', activeQueueId],
    queryFn: () => shippingQueueService.getRequirements(activeQueueId!),
    enabled: !!activeQueueId,
    refetchOnMount: 'always',
    staleTime: 0,
  });
  const activeJob: ShippingQueueJob | null = activeQ.data?.data ?? null;

  // Take iş
  const takeMut = useMutation({
    mutationFn: (id: string) => shippingQueueService.takeById(id),
    onSuccess: (res) => {
      const job = res.data;
      startSession({
        queueId: job.id,
        orderId: job.order.id,
        customerId: job.order.customer.id,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Sipariş alındı',
        text2: job.order.orderNumber,
      });
    },
    onError: (err: { response?: { status?: number } }) => {
      if (err?.response?.status === 409) {
        Toast.show({
          type: 'error',
          text1: 'Sipariş başkası tarafından alındı',
        });
        void qc.invalidateQueries({ queryKey: ['shipping-queue', 'list'] });
      } else {
        Toast.show({ type: 'error', text1: 'Alınamadı' });
      }
    },
  });

  // Release (geri bırak) — complete ile aynı sıralama: önce kuyruğu tazele,
  // sonra session'ı kapat. Aksi halde stale cache auto-resume'u tetikler.
  const releaseMut = useMutation({
    mutationFn: (id: string) => shippingQueueService.release(id),
    onSuccess: async () => {
      Toast.show({ type: 'success', text1: 'Sipariş kuyruğa bırakıldı' });
      await qc.refetchQueries({ queryKey: ['shipping-queue', 'list'] });
      qc.removeQueries({ queryKey: ['shipping-queue', 'requirements'] });
      endSession();
    },
  });

  // Complete (tamamla → sevkiyata gönder işareti)
  const completeMut = useMutation({
    mutationFn: (id: string) => shippingQueueService.complete(id),
    onSuccess: async (res) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Sevkiyata hazır!',
        text2: res.message,
      });
      // Önce kuyruk + ilgili cache'leri tazele — auto-resume effect'i
      // eski TAKEN kaydı görüp aynı işe geri dönmesin.
      await qc.refetchQueries({ queryKey: ['shipping-queue', 'list'] });
      qc.removeQueries({ queryKey: ['shipping-queue', 'requirements'] });
      qc.removeQueries({ queryKey: ['sacks'] });
      endSession();
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      Toast.show({
        type: 'error',
        text1: 'Tamamlanamadı',
        text2: err?.response?.data?.message ?? 'Önce çuvallara top ekleyin.',
      });
    },
  });

  // Barkod tara → top doğrula → pool'a ekle
  const handleScan = async (barcode: string) => {
    setScannerOpen(false);
    if (!activeJob) return;

    try {
      const res = await rollService.getByBarcode(barcode.trim());
      const roll = res.data;

      // Validasyonlar
      if (roll.status !== 'WAREHOUSE') {
        Toast.show({
          type: 'error',
          text1: 'Top depoda değil',
          text2: `Durum: ${roll.status}`,
        });
        return;
      }

      // Açık kumaş (barkodsuz) tartı/pakete gelmez — depoya geçen Roll'lar
      // tamamı barkodlu olmalı. Defansif kontrol.
      if (!roll.barcode) {
        Toast.show({
          type: 'error',
          text1: 'Top için barkod yok',
          text2: 'Açık kumaş Roll tartılamaz',
        });
        return;
      }

      // Item, siparişin satırlarından birinde olmalı (en az bir satırda)
      const matchingLine = activeJob.order.lines.find(
        (l) => l.itemId === roll.itemId,
      );
      if (!matchingLine) {
        Toast.show({
          type: 'error',
          text1: 'Bu ürün siparişte yok',
          text2: roll.item?.name ?? '',
        });
        return;
      }

      // Halihazırda pool'da mı?
      const inPool = pool.some((r) => r.rollId === roll.id);
      if (inPool) {
        Toast.show({ type: 'info', text1: 'Top zaten havuzda' });
        return;
      }

      addToPool({
        rollId: roll.id,
        barcode: roll.barcode,
        itemId: roll.itemId,
        itemCode: roll.item?.code ?? '',
        itemName: roll.item?.name ?? '',
        colorName: roll.color?.name ?? null,
        colorHex: roll.color?.hex ?? null,
        currentQty: roll.currentQty,
        weightKg: roll.weightKg ?? null,
        width: roll.width ?? null,
        qualityGrade: roll.qualityGrade,
      });

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Havuza eklendi',
        text2: roll.barcode,
      });
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: 'Top bulunamadı',
        text2: barcode,
      });
    }
  };

  // Active job snapshot — başlığa
  const subtitle = activeJob
    ? `${activeJob.order.orderNumber} · ${activeJob.order.customer.name}`
    : `${queueJobs.length} sipariş bekliyor`;

  // Active session başlığı dönerken queue silinmiş olabilir — defansif end
  useEffect(() => {
    if (activeQueueId && activeQ.isFetched && !activeJob) {
      endSession();
    }
  }, [activeQueueId, activeQ.isFetched, activeJob, endSession]);

  // Uygulama yeniden açıldığında, bu operatöre atanmış TAKEN iş varsa
  // otomatik resume — kullanıcı işin kaybolduğunu sanmasın. Refetch sırasında
  // çalışma — stale cache ile az önce tamamlanan işe geri dönmesin.
  useEffect(() => {
    if (
      activeQueueId ||
      !currentUserId ||
      queueQ.isLoading ||
      queueQ.isFetching
    )
      return;
    const myTaken = queueJobs.find(
      (j) => j.status === 'TAKEN' && j.assignedOperator?.id === currentUserId,
    );
    if (myTaken) {
      resumeJob(myTaken);
    }
    // resumeJob sabit referans değil, dependency'e koymadık — sadece queueJobs değişince çalışmalı
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueJobs, activeQueueId, currentUserId, queueQ.isLoading, queueQ.isFetching]);

  const canComplete = useMemo(() => {
    if (!activeJob) return false;
    return activeJob.order.totalAllocatedQty > 0;
  }, [activeJob]);

  return (
    <ScreenChrome title="Tartı / Sevkiyat" subtitle={subtitle}>
      <View style={S.root}>
        {!activeJob ? (
          <View style={S.queueWrapper}>
            <View style={S.queueHeader}>
              <Text variant="titleLarge" style={S.queueTitle}>
                Sevkiyat Kuyruğu
              </Text>
              <RefreshButton
                onPress={() =>
                  void qc.invalidateQueries({ queryKey: ['shipping-queue', 'list'] })
                }
                refreshing={queueQ.isFetching}
              />
            </View>
            <QueueListView
              jobs={queueJobs}
              loading={queueQ.isLoading}
              refreshing={queueQ.isFetching}
              currentUserId={currentUserId}
              onRefresh={() =>
                void qc.invalidateQueries({ queryKey: ['shipping-queue', 'list'] })
              }
              onTake={(id) => takeMut.mutate(id)}
              onResume={resumeJob}
              taking={takeMut.isPending}
            />
          </View>
        ) : (
          <View style={S.workspace}>
            {/* Üst toolbar — sipariş başlığı + tamamla butonu */}
            <Surface style={S.workspaceHeader} elevation={1}>
              <IconButton
                icon="arrow-left"
                size={24}
                onPress={() =>
                  activeQueueId && releaseMut.mutate(activeQueueId)
                }
                disabled={releaseMut.isPending}
                accessibilityLabel="Kuyruğa Bırak"
              />
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium" style={S.workspaceTitle}>
                  {activeJob.order.orderNumber}
                </Text>
                <Text style={S.workspaceSubtitle}>
                  {activeJob.order.customer.name}
                  {activeJob.order.branch
                    ? ` · ${activeJob.order.branch.name}`
                    : ''}
                </Text>
              </View>
              <Button
                mode="contained"
                icon="check-bold"
                disabled={!canComplete || completeMut.isPending}
                loading={completeMut.isPending}
                onPress={() =>
                  activeQueueId && completeMut.mutate(activeQueueId)
                }
                style={S.completeBtn}
                labelStyle={S.completeBtnLabel}
                buttonColor="#10b981"
                textColor="#ffffff"
              >
                Sevkiyata Gönder
              </Button>
            </Surface>

            {/* İhtiyaçlar + çuvallar — telefonda dikey, tablette iki sütun */}
            {isPhone ? (
              <ScrollView style={S.phoneScroll} contentContainerStyle={S.phoneScrollContent}>
                <View style={S.phoneSection}>
                  <RequirementsPanel job={activeJob} />
                </View>
                <View style={S.phoneSection}>
                  <SacksPanel
                    job={activeJob}
                    onOpenScanner={() => setScannerOpen(true)}
                  />
                </View>
              </ScrollView>
            ) : (
              <View style={S.twoColumn}>
                <View style={S.leftCol}>
                  <RequirementsPanel job={activeJob} />
                </View>
                <View style={S.rightCol}>
                  <SacksPanel
                    job={activeJob}
                    onOpenScanner={() => setScannerOpen(true)}
                  />
                </View>
              </View>
            )}
          </View>
        )}

        <BarcodeScannerModal
          visible={scannerOpen}
          onDismiss={() => setScannerOpen(false)}
          onScan={handleScan}
          title="Top barkodunu okut"
        />
      </View>
    </ScreenChrome>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  queueWrapper: { flex: 1 },
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  queueTitle: { fontWeight: '700', color: '#0f172a' },

  workspace: { flex: 1 },
  workspaceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingRight: 16,
    backgroundColor: '#fff',
    gap: 8,
  },
  workspaceTitle: {
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#0f172a',
  },
  workspaceSubtitle: { color: '#64748b', fontSize: 13 },
  completeBtn: { backgroundColor: '#10b981' },
  completeBtnLabel: { color: '#ffffff', fontWeight: '700' },

  twoColumn: { flex: 1, flexDirection: 'row' },
  leftCol: { width: 380 },
  rightCol: { flex: 1 },
  phoneScroll: { flex: 1 },
  phoneScrollContent: { paddingBottom: 16 },
  phoneSection: { minHeight: 280 },
});
