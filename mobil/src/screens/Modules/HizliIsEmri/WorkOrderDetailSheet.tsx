import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, TouchableRipple, Icon, ActivityIndicator } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';

import AppModal from '../../../components/AppModal';
import WorkOrderHeaderFields, { type WoHeaderFieldValues } from './WorkOrderHeaderFields';
import { useCardPrinter } from './useCardPrinter';
import { buildWorkOrderCardData } from './printWorkOrder';
import { workOrderService } from '../../../services/workOrder.service';
import { useFeatureFlags } from '../../../hooks/useFeatureFlags';
import {
  WORK_ORDER_STATUS_LABEL,
  WORK_ORDER_STATUS_COLOR,
  WORK_ORDER_TYPE_LABEL,
  STEP_STATUS_LABEL,
  STATION_TYPE_LABEL,
  ROLL_STATUS_LABEL,
  isRetiredRoll,
  trLabel,
} from '../../../utils/labels';
import { colors, spacing, radius } from '../../../theme';

interface Props {
  workOrderId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

type Mode = 'detail' | 'edit' | 'cancel';

export default function WorkOrderDetailSheet({ workOrderId, onClose, onChanged }: Props) {
  const qc = useQueryClient();
  const companyName = useFeatureFlags().data?.companyName ?? 'Adnan Şahin Tekstil';
  const { QrSink, printCard, printing } = useCardPrinter();
  const [mode, setMode] = useState<Mode>('detail');
  const [edit, setEdit] = useState<WoHeaderFieldValues | null>(null);

  const visible = !!workOrderId;

  useEffect(() => {
    if (visible) setMode('detail');
  }, [visible, workOrderId]);

  const woQuery = useQuery({
    queryKey: ['work-order', workOrderId],
    queryFn: () => workOrderService.getById(workOrderId as string),
    enabled: visible,
  });
  const rollsQuery = useQuery({
    queryKey: ['work-order-rolls', workOrderId],
    queryFn: () => workOrderService.getAttachedRolls(workOrderId as string),
    enabled: visible,
  });
  const impactQuery = useQuery({
    queryKey: ['work-order-cancel-impact', workOrderId],
    queryFn: () => workOrderService.getCancelImpact(workOrderId as string),
    enabled: visible && mode === 'cancel',
  });

  const wo = woQuery.data?.data;
  // Tüketilmiş/emekli toplar (Tambur kesimi, fason açık-kumaş, kartela, iptal)
  // gizlenir — özellikle tamamlanan WO'da parent kayıtları karışıklık yaratıyordu.
  const rolls = (rollsQuery.data?.data ?? []).filter((r) => !isRetiredRoll(r.status));
  const editable = wo && wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED';

  // ── Düzenle: PATCH update ──────────────────────────────────────────────────
  const updateMut = useMutation({
    networkMode: 'always',
    mutationFn: (vals: WoHeaderFieldValues) =>
      workOrderService.update(workOrderId as string, {
        batchNumber: vals.batchNumber.trim() || undefined,
        targetColorId: vals.targetColorId,
        width: vals.width ? Number(vals.width) : null,
        targetQuantity: vals.targetQuantity ? Number(vals.targetQuantity) : null,
        targetWeight: vals.targetWeight ? Number(vals.targetWeight) : null,
        foldType: vals.foldType,
        dyehouseNote: vals.dyehouseNote.trim() || null,
      }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Toast.show({ type: 'success', text1: 'Güncellendi' });
      qc.invalidateQueries({ queryKey: ['work-order', workOrderId] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      onChanged();
      setMode('detail');
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      Toast.show({ type: 'error', text1: 'Güncellenemedi', text2: e?.response?.data?.message ?? e?.message });
    },
  });

  // ── İptal: DELETE (CANCELLED) ──────────────────────────────────────────────
  const cancelMut = useMutation({
    networkMode: 'always',
    mutationFn: () => workOrderService.cancel(workOrderId as string),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Toast.show({ type: 'success', text1: 'İş emri iptal edildi' });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      onChanged();
      onClose();
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      Toast.show({ type: 'error', text1: 'İptal edilemedi', text2: e?.response?.data?.message ?? e?.message });
    },
  });

  const startEdit = () => {
    if (!wo) return;
    setEdit({
      targetColorId: wo.targetColorId ?? null,
      width: wo.width != null ? String(wo.width) : '',
      targetQuantity: wo.targetQuantity != null ? String(wo.targetQuantity) : '',
      // Önceden sabit '' idi → düzenle/kaydet'te Hedef Kg sessizce siliniyordu. Mevcut değeri yükle.
      targetWeight: wo.targetWeight != null ? String(wo.targetWeight) : '',
      foldType: wo.foldType ?? null,
      batchNumber: wo.batchNumber,
      dyehouseNote: wo.dyehouseNote ?? '',
    });
    setMode('edit');
  };

  const doPrint = async () => {
    if (!workOrderId) return;
    try {
      const data = await buildWorkOrderCardData(workOrderId, companyName);
      await printCard(data);
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Çıktı alınamadı', text2: e instanceof Error ? e.message : '' });
    }
  };

  const statusColor = wo ? WORK_ORDER_STATUS_COLOR[wo.status] ?? colors.textMuted : colors.textMuted;
  const impact = impactQuery.data?.data;

  const infoRows = useMemo(() => {
    if (!wo) return [];
    return [
      ['Ürün', wo.targetItem?.name ?? rolls[0]?.item?.name ?? '—'],
      ['Renk', wo.targetColor?.name ?? 'Renksiz / Ham'],
      ['En', wo.width != null ? `${wo.width} cm` : '—'],
      ['Kat Tipi', wo.foldType ?? '—'],
      ['Tip', trLabel(WORK_ORDER_TYPE_LABEL, wo.type)],
      ['Hedef Metraj', wo.targetQuantity != null ? `${Math.round(wo.targetQuantity)} m` : '—'],
      ['Hedef Kg', wo.targetWeight != null ? `${Math.round(wo.targetWeight)} kg` : '—'],
      ['Oluşturma', wo.createdAt ? dayjs(wo.createdAt).format('DD.MM.YYYY HH:mm') : '—'],
    ];
  }, [wo, rolls]);

  return (
    <AppModal visible={visible} onDismiss={onClose} position="bottom" contentStyle={styles.sheet}>
      {QrSink}
      {/* Başlık */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerBatch} numberOfLines={1}>
            {wo?.batchNumber ?? 'İş Emri'}
          </Text>
          {wo ? (
            <View style={[styles.statusChip, { backgroundColor: statusColor }]}>
              <Text style={styles.statusChipText}>{trLabel(WORK_ORDER_STATUS_LABEL, wo.status)}</Text>
            </View>
          ) : null}
        </View>
        <TouchableRipple onPress={onClose} borderless style={styles.closeBtn}>
          <Icon source="close" size={24} color={colors.textSecondary} />
        </TouchableRipple>
      </View>

      {woQuery.isLoading || !wo ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : mode === 'edit' && edit ? (
        // ── DÜZENLE ──────────────────────────────────────────────────────────
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.note}>
            Renk, en, metraj, kat tipi, parti kodu ve boyahane notu güncellenir. Rota / sipariş bağı değişimi masaüstünden yapılır.
          </Text>
          <WorkOrderHeaderFields value={edit} onChange={(p) => setEdit((e) => (e ? { ...e, ...p } : e))} showBatchNumber />
          <View style={styles.actionsCol}>
            <Button
              mode="contained"
              icon="content-save"
              onPress={() => edit && updateMut.mutate(edit)}
              loading={updateMut.isPending}
              disabled={updateMut.isPending}
              contentStyle={styles.btnContent}
            >
              Kaydet
            </Button>
            <Button mode="text" onPress={() => setMode('detail')} disabled={updateMut.isPending}>
              Vazgeç
            </Button>
          </View>
        </ScrollView>
      ) : mode === 'cancel' ? (
        // ── İPTAL ÖNİZLEME ───────────────────────────────────────────────────
        <ScrollView contentContainerStyle={styles.body}>
          {impactQuery.isLoading || !impact ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.danger} />
            </View>
          ) : (
            <>
              <View style={styles.warnBox}>
                <Icon source="alert" size={20} color={colors.dangerDark} />
                <Text style={styles.warnText}>
                  {impact.canCancel
                    ? `Bu iş emri iptal edilecek. ${impact.rolls.length} top stoğa geri dönecek${
                        impact.travelerCardCount > 0 ? `, ${impact.travelerCardCount} refakat kartı geçersiz olacak` : ''
                      }.`
                    : impact.blockReason}
                </Text>
              </View>
              {impact.rolls.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Etkilenecek Toplar ({impact.rolls.length})</Text>
                  {impact.rolls.slice(0, 50).map((r) => (
                    <View key={r.id} style={styles.rollLine}>
                      <Text style={styles.rollLineBarcode} numberOfLines={1}>
                        {r.barcode ?? '—'}
                      </Text>
                      <Text style={styles.rollLineMeta}>
                        {trLabel(ROLL_STATUS_LABEL, r.status)} · {Math.round(r.currentQty)}m
                        {r.processed ? ' · işlenmiş' : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={styles.actionsCol}>
                {impact.canCancel ? (
                  <Button
                    mode="contained"
                    icon="cancel"
                    buttonColor={colors.danger}
                    onPress={() => cancelMut.mutate()}
                    loading={cancelMut.isPending}
                    disabled={cancelMut.isPending}
                    contentStyle={styles.btnContent}
                  >
                    İş Emrini İptal Et
                  </Button>
                ) : null}
                <Button mode="text" onPress={() => setMode('detail')} disabled={cancelMut.isPending}>
                  Vazgeç
                </Button>
              </View>
            </>
          )}
        </ScrollView>
      ) : (
        // ── DETAY ────────────────────────────────────────────────────────────
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.infoCard}>
            {infoRows.map(([k, v]) => (
              <View key={k} style={styles.infoRow}>
                <Text style={styles.infoKey}>{k}</Text>
                <Text style={styles.infoVal} numberOfLines={2}>
                  {v}
                </Text>
              </View>
            ))}
            {wo.dyehouseNote ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Boyahane</Text>
                <Text style={styles.infoVal}>{wo.dyehouseNote}</Text>
              </View>
            ) : null}
          </View>

          {/* Rota */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Üretim Rotası</Text>
            {(wo.steps ?? []).map((s) => (
              <View key={s.id} style={styles.stepLine}>
                <Text style={styles.stepSeq}>{s.stepSequence}</Text>
                <Text style={styles.stepName} numberOfLines={1}>
                  {s.station?.name ?? '—'}
                </Text>
                <Text style={styles.stepMeta}>
                  {trLabel(STATION_TYPE_LABEL, s.station?.type)} · {trLabel(STEP_STATUS_LABEL, s.status)}
                </Text>
              </View>
            ))}
          </View>

          {/* Bağlı toplar */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Bağlı Toplar ({rolls.length})</Text>
            {rollsQuery.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} />
            ) : rolls.length === 0 ? (
              <Text style={styles.muted}>Bağlı top yok.</Text>
            ) : (
              rolls.slice(0, 100).map((r) => (
                <View key={r.id} style={styles.rollLine}>
                  <Text style={styles.rollLineBarcode} numberOfLines={1}>
                    {r.barcode ?? '—'}
                  </Text>
                  <Text style={styles.rollLineMeta}>
                    {trLabel(ROLL_STATUS_LABEL, r.status)} · {Math.round(Number(r.currentQty))}m
                  </Text>
                </View>
              ))
            )}
          </View>

          {/* Aksiyonlar */}
          <View style={styles.actionGrid}>
            <Button
              mode="contained"
              icon="printer"
              onPress={doPrint}
              loading={printing}
              disabled={printing}
              style={styles.actionBtn}
              contentStyle={styles.btnContent}
            >
              Çıktı
            </Button>
            {editable ? (
              <Button mode="contained-tonal" icon="pencil" onPress={startEdit} style={styles.actionBtn} contentStyle={styles.btnContent}>
                Düzenle
              </Button>
            ) : null}
          </View>
          {editable ? (
            <Button
              mode="outlined"
              icon="cancel"
              textColor={colors.danger}
              onPress={() => setMode('cancel')}
              style={styles.cancelBtn}
              contentStyle={styles.btnContent}
            >
              İş Emrini İptal Et
            </Button>
          ) : null}
          <View style={{ height: spacing.lg }} />
        </ScrollView>
      )}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.appBg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    height: '90%',
    width: '100%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBatch: { fontSize: 18, fontWeight: '800', color: colors.text },
  statusChip: { alignSelf: 'flex-start', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, marginTop: 4 },
  statusChipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  closeBtn: { padding: spacing.xs, borderRadius: radius.full },
  center: { padding: spacing.xxxl, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.lg, gap: spacing.md },
  note: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },

  infoCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  infoRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  infoKey: { width: 110, color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  infoVal: { flex: 1, color: colors.text, fontWeight: '700', fontSize: 13 },

  section: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.sm },
  stepLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 },
  stepSeq: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandSoft, color: colors.brand, fontWeight: '800', fontSize: 12, textAlign: 'center', lineHeight: 22 },
  stepName: { flex: 1, fontWeight: '700', color: colors.text, fontSize: 14 },
  stepMeta: { fontSize: 11, color: colors.textMuted },
  muted: { color: colors.textMuted, fontSize: 13 },

  rollLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border },
  rollLineBarcode: { flex: 1, fontFamily: 'monospace', fontSize: 12, color: colors.text },
  rollLineMeta: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },

  warnBox: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.dangerContainer, borderRadius: radius.md, padding: spacing.md },
  warnText: { flex: 1, color: colors.dangerText, fontSize: 13, lineHeight: 18, fontWeight: '600' },

  actionGrid: { flexDirection: 'row', gap: spacing.md },
  actionBtn: { flex: 1, borderRadius: radius.md },
  cancelBtn: { borderRadius: radius.md, borderColor: colors.danger },
  actionsCol: { gap: spacing.sm, marginTop: spacing.md },
  btnContent: { height: 48 },
});
