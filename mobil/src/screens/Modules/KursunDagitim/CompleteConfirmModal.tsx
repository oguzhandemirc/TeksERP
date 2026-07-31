import React from 'react';
import { View, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Text, Button, IconButton, ActivityIndicator, Icon } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import AppModal from '../../../components/AppModal';
import {
  kursunBypassService,
  type KursunDistributionAssignedRow,
  type KursunBypassCompletePreview,
} from '../../../services/kursunBypass.service';
import { fmtMeters } from './dagitimUi';
import { colors, spacing, radius } from '../../../theme';

// =============================================================================
// "İŞİ BİTİR" ONAY MODALI — kurşun rotanın SON adımı olduğunda dağıtım ekranından
// kapanış. TamburUndoConfirmModal deseni: her şey CANLI ÖNİZLEMEDEN gelir.
//
// Neden önizleme güdümlü: bu yıkıcı-eşdeğeri bir işlem (iş emri kapanır, toplar
// depoya iner, barkodsuz açık kumaşa barkod basılır). Kök CLAUDE.md kuralı gereği
// "N kayıt etkilenecek" DEMİYORUZ — etkilenen HER top somut listelenir. Onaya
// giden `rollIds` de listenin kendisinden çıkar (elle küme kurmuyoruz): backend
// kapsamı tx içinde birebir doğrular, bayat liste 409 alır.
//
// staleTime/gcTime = 0: modal her açılışta TAZE önizleme çeker. Cache'lenmiş bir
// önizleme, bu arada başka tablette değişmiş bir adımı doğru sanmamıza yol açardı.
// =============================================================================

interface Props {
  /** null → modal kapalı. */
  row: KursunDistributionAssignedRow | null;
  onDismiss: () => void;
  /** Başarılı kapanıştan sonra (parent modalı kapatır). */
  onDone: () => void;
}

export default function CompleteConfirmModal({ row, onDismiss, onDone }: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const phone = Math.min(winW, winH) < 600;
  const qc = useQueryClient();
  const assignmentId = row?.assignmentId ?? null;

  const previewQ = useQuery({
    queryKey: ['kursun-bypass', 'complete-preview', assignmentId],
    queryFn: () => kursunBypassService.completePreview(assignmentId!),
    enabled: !!assignmentId,
    staleTime: 0,
    gcTime: 0,
  });
  const preview: KursunBypassCompletePreview | null = previewQ.data?.data ?? null;

  const completeMut = useMutation({
    mutationFn: () =>
      kursunBypassService.complete(assignmentId!, {
        // Kapsam ÖNİZLEMEDEN — ekranda gösterilen top kümesiyle birebir aynı.
        rollIds: (preview?.rolls ?? []).map((r) => r.rollId),
      }),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (res.data.alreadyDone) {
        Toast.show({
          type: 'info',
          text1: 'İş zaten bitirilmişti',
          text2: 'Başka bir cihaz bu dağıtımı kapatmış — liste tazelendi.',
        });
      } else {
        Toast.show({
          type: 'success',
          text1: 'İş bitirildi — toplar depoda',
          text2: `${res.data.finalizedRollCount} top · ${res.data.barcodesGenerated} yeni barkod`,
        });
      }
      void qc.invalidateQueries({ queryKey: ['kursun-bypass'] });
      void qc.invalidateQueries({ queryKey: ['rolls'] });
      void qc.invalidateQueries({ queryKey: ['work-orders'] });
      onDone();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'İş bitirilemedi', text2: e.message });
      // Yarışta kapsam değişmiş olabilir — önizlemeyi tazele, operatör görsün.
      void previewQ.refetch();
    },
  });

  const busy = completeMut.isPending;
  const canApply = !!preview?.canComplete && (preview?.rolls.length ?? 0) > 0 && !busy;

  return (
    <AppModal
      visible={row !== null}
      onDismiss={() => {
        if (!busy) onDismiss();
      }}
      dismissable={!busy}
    >
      <View
        style={[
          styles.sheet,
          { width: phone ? winW * 0.94 : Math.min(600, winW * 0.6), maxHeight: winH * 0.85 },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Icon source="check-decagram" size={20} color={colors.successText} />
          </View>
          <Text style={styles.title} numberOfLines={1}>
            İşi Bitir — {row?.workOrderNumber ?? ''}
          </Text>
          <IconButton icon="close" size={22} onPress={onDismiss} disabled={busy} style={styles.closeBtn} />
        </View>

        {previewQ.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : previewQ.isError ? (
          <Text style={styles.blockText}>⛔ {(previewQ.error as Error).message}</Text>
        ) : preview ? (
          <ScrollView contentContainerStyle={styles.body}>
            {/* Fiziksel bağlam — iş hangi MAKİNEDE yapıldı (atama makine bazında). */}
            <View style={styles.stationRow}>
              <Icon source="factory" size={16} color={colors.textSecondary} />
              <Text style={styles.stationText}>
                Kurşun makinesi: <Text style={styles.strong}>{preview.machineName}</Text>
              </Text>
            </View>

            <Text style={styles.summaryText}>
              {preview.rollCount} top · {fmtMeters(preview.totalMeters)} m depoya alınacak.
            </Text>

            <Text style={styles.sectionTitle}>Depoya alınacak toplar</Text>
            {preview.rolls.map((r) => (
              <Text key={r.rollId} style={styles.rowLine}>
                • {r.barcode ?? '(barkodsuz açık kumaş)'} — {fmtMeters(r.currentQty)} m
              </Text>
            ))}

            {preview.willFinalize.barcodesToGenerate > 0 && (
              <Text style={styles.infoText}>
                ℹ {preview.willFinalize.barcodesToGenerate} barkodsuz topa yeni barkod üretilecek.
              </Text>
            )}

            {/* Kalite bypass'ta ASLA yazılmaz — operatör "kalite girmedim" diye
                şaşırmasın, kuralı burada açıkça söylüyoruz. */}
            <Text style={styles.infoText}>
              ℹ Kalite BELİRSİZ kalır — kurşun dijital olarak izlenmedi, kalite kararı
              verilmiş sayılmaz.
            </Text>

            <View style={styles.warnBox}>
              <Icon source="alert" size={18} color={colors.warningDark} />
              <Text style={styles.warnText}>
                {preview.workOrderWillComplete
                  ? 'İş emri KAPANIR, toplar depoya alınır (Bitmiş Depo).'
                  : 'Toplar depoya alınır (Bitmiş Depo). İş emrinde başka açık adım kaldığı için iş emri kapanmaz.'}
              </Text>
            </View>

            {preview.blockReason && <Text style={styles.blockText}>⛔ {preview.blockReason}</Text>}
          </ScrollView>
        ) : null}

        <View style={styles.actions}>
          <Button mode="outlined" onPress={onDismiss} disabled={busy} style={styles.actionBtn}>
            Vazgeç
          </Button>
          <Button
            mode="contained"
            icon="check-decagram"
            buttonColor={colors.successDark}
            loading={busy}
            disabled={!canApply}
            onPress={() => completeMut.mutate()}
            style={styles.actionBtn}
          >
            İşi Bitir
          </Button>
        </View>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.successContainer,
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.successText },
  closeBtn: { margin: 0 },
  loading: { padding: spacing.xxxl, alignItems: 'center' },
  body: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 4 },
  stationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  stationText: { flex: 1, fontSize: 14, color: colors.textSecondary },
  strong: { fontWeight: '800', color: colors.text },
  summaryText: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 2 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textMuted,
    marginTop: spacing.md,
    textTransform: 'uppercase',
  },
  rowLine: { fontSize: 15, color: colors.textSecondary, paddingVertical: 2 },
  infoText: { fontSize: 13, color: colors.infoText, marginTop: spacing.sm, lineHeight: 18 },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.warningContainer,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  warnText: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.warningDark, lineHeight: 19 },
  blockText: {
    fontSize: 15,
    color: colors.dangerDark,
    fontWeight: '700',
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionBtn: { flex: 1, minHeight: 48, justifyContent: 'center' },
});
