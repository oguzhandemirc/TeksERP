// =============================================================================
// Kurşun Bypass Onayı — Tambur tabletinde refakat kartı okutulduğunda açılır.
//
// Kurşun istasyonlarında tablet YOKTUR: kurşun fiziksel olarak yapılır ama
// dijital izlenmez (hatalar kâğıtta). İş, Kurşun Dağıtım ekranından fiziksel
// bir kurşun istasyonuna atanır; toplar hâlâ Kurşun/KK2 adımında AÇIK durur.
// Tambur operatörü kartı okutunca bu modal önizlemeyi gösterir, onayla:
//   • Kurşun/KK2 adımının açık movement'ları kapanır → adım COMPLETED
//     (SKIPPED DEĞİL — adım atlanmaz, normal şekilde biter),
//   • toplar Tambur adımına geçer,
//   • kalite NULL kalır (kaliteyi Tambur belirler), RollError açılmaz.
//
// Yıkıcı-onay ilkesi: kapsam somut listelenir (her top barkod + metraj) ve
// onaya BİREBİR aynı `rollIds` gider — kapsam bu sırada değiştiyse backend 409
// döner, yarım kapanış olmaz. ONLINE-ONLY: offline kuyruğuna girmez
// (`applyUndo` ile aynı sınıf — sunucu tarafı kapsam parite doğrulaması var).
//
// Desen kaynağı: TamburScreen.tsx içindeki TamburUndoConfirmModal (önizle →
// somut kapsam → onay). Ayrı dosya, çünkü TamburScreen zaten 5900+ satır.
// =============================================================================

import React from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Icon,
  IconButton,
  Text,
} from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import AppModal from '../../../components/AppModal';
import { tamburService } from '../../../services/tambur.service';
import type { TamburBypassPending } from '../../../types/models';

const PURPLE = '#7c3aed'; // moduleAccents.Tambur.tint

/** "1.234,5" değil — sahada okunan sade sayı; tam sayıysa ondalık basılmaz. */
function fmtMeters(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export default function TamburBypassConfirmModal({
  cardBarcode,
  onDismiss,
  onDone,
}: {
  /** null = modal kapalı. Dolu = bu kart için bekleyen kurşun dağıtımı var. */
  cardBarcode: string | null;
  onDismiss: () => void;
  /** Bypass kapandı (ya da zaten kapalıydı) → kart normal sekme olarak açılır. */
  onDone: (cardBarcode: string) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const phone = winW < 600;
  const qc = useQueryClient();

  // Önizleme HER AÇILIŞTA taze çekilir (staleTime/gcTime 0) — kapsam sözleşmesi
  // bayat veriden kurulamaz; başka bir tablet aynı işi kapatmış olabilir.
  const previewQ = useQuery({
    queryKey: ['tambur', 'bypass-preview', cardBarcode],
    queryFn: () => tamburService.getContext(cardBarcode!),
    enabled: !!cardBarcode,
    staleTime: 0,
    gcTime: 0,
  });
  const pending: TamburBypassPending | null =
    previewQ.data?.data?.bypassPending ?? null;

  // Önizleme geldi ama bekleyen iş yok → başkası kapatmış (idempotent durum).
  const alreadyDone = previewQ.isSuccess && !pending;

  const applyMut = useMutation({
    mutationFn: () =>
      tamburService.bypassComplete(
        cardBarcode!,
        (pending?.rolls ?? []).map((r) => r.rollId),
      ),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Bypass tamamlandı',
        text2: 'Kart Tambur\'a alındı',
      });
      void qc.invalidateQueries({ queryKey: ['tambur'] });
      void qc.invalidateQueries({ queryKey: ['rolls'] });
      void qc.invalidateQueries({ queryKey: ['work-orders'] });
      if (cardBarcode) onDone(cardBarcode);
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Bypass tamamlanamadı', text2: e.message });
      // Yarışta kapsam değişmiş olabilir — önizlemeyi tazele, operatör görsün.
      void previewQ.refetch();
    },
  });

  return (
    <AppModal
      visible={cardBarcode !== null}
      onDismiss={() => {
        if (!applyMut.isPending) onDismiss();
      }}
    >
      <View
        style={[
          styles.sheet,
          { width: phone ? winW * 0.94 : Math.min(560, winW * 0.55), maxHeight: winH * 0.85 },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Icon source="transfer-right" size={20} color={PURPLE} />
          </View>
          <Text style={styles.title}>Kurşun Bypass Onayı</Text>
          <IconButton
            icon="close"
            size={22}
            onPress={onDismiss}
            disabled={applyMut.isPending}
            style={{ margin: 0 }}
          />
        </View>

        {previewQ.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={PURPLE} />
          </View>
        ) : previewQ.isError ? (
          <Text style={styles.blockText}>{(previewQ.error as Error).message}</Text>
        ) : pending ? (
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.modeText}>
              Bypass: {pending.rollCount} top Kurşun/KK2&apos;den tamamlanacak,
              Tambur&apos;a alınacak
            </Text>
            <Text style={styles.rowLine}>Atanan istasyon: {pending.stationName}</Text>
            <Text style={styles.rowLine}>Toplam: {fmtMeters(pending.totalMeters)} m</Text>
            {pending.assignedByName ? (
              <Text style={styles.rowLine}>Dağıtan: {pending.assignedByName}</Text>
            ) : null}
            {pending.notes ? (
              <Text style={styles.rowLine}>Dağıtım notu: {pending.notes}</Text>
            ) : null}

            <Text style={styles.infoText}>
              Toplar kalite girilmeden (kalite boş) Tambur&apos;a düşer; hatalar kâğıt
              üzerinde takip edilir.
            </Text>

            <Text style={styles.sectionTitle}>
              Tambur&apos;a alınacak toplar ({pending.rolls.length})
            </Text>
            {pending.rolls.map((r) => (
              <Text key={r.rollId} style={styles.rowLine}>
                • {r.barcode ?? r.receiptNo ?? 'Barkodsuz açık kumaş'} —{' '}
                {fmtMeters(r.currentQty)} m
                {r.colorName ? `  ·  ${r.colorName}` : ''}
              </Text>
            ))}
          </ScrollView>
        ) : alreadyDone ? (
          <View style={styles.body}>
            <Text style={styles.infoText}>
              Bypass zaten tamamlanmış — bu iş emrinde bekleyen kurşun dağıtımı yok.
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            mode="outlined"
            onPress={onDismiss}
            disabled={applyMut.isPending}
            style={styles.actionBtn}
          >
            Vazgeç
          </Button>
          {alreadyDone ? (
            // Onaylanacak iş kalmamış — operatörü çıkmaza sokma, kartı aç.
            <Button
              mode="contained"
              buttonColor={PURPLE}
              onPress={() => {
                if (cardBarcode) onDone(cardBarcode);
              }}
              style={styles.actionBtn}
            >
              Kartı Aç
            </Button>
          ) : (
            <Button
              mode="contained"
              buttonColor={PURPLE}
              loading={applyMut.isPending}
              disabled={!pending || applyMut.isPending}
              onPress={() => applyMut.mutate()}
              style={styles.actionBtn}
            >
              Onayla
            </Button>
          )}
        </View>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#ede9fe',
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ddd6fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: '#5b21b6' },
  loading: { padding: 28, alignItems: 'center' },
  body: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  modeText: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 4 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748b',
    marginTop: 10,
    textTransform: 'uppercase',
  },
  rowLine: { fontSize: 15, color: '#334155', paddingVertical: 2 },
  infoText: { fontSize: 14, color: '#6d28d9', fontWeight: '600', marginTop: 8 },
  blockText: {
    fontSize: 15,
    color: '#b91c1c',
    fontWeight: '700',
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  actionBtn: { flex: 1, minHeight: 48, justifyContent: 'center' },
});
