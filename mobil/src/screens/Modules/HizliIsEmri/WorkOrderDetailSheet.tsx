import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, TouchableRipple, Icon, ActivityIndicator } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';

import AppModal from '../../../components/AppModal';
import WorkOrderDocumentsSheet from './WorkOrderDocumentsSheet';
import WorkOrderFixSheet, { type FixKind } from './WorkOrderFixSheet';
import TamburOrderLinkSheet from '../Tambur/TamburOrderLinkSheet';
import { tabletCancelAllowed } from './workOrderFix';
import { usePermissions } from '../../../hooks/usePermission';
import WorkOrderRecentEvents from './WorkOrderRecentEvents';
import { workOrderService } from '../../../services/workOrder.service';
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

type Mode = 'detail' | 'cancel';

export default function WorkOrderDetailSheet({ workOrderId, onClose, onChanged }: Props) {
  const qc = useQueryClient();
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('detail');
  const [fix, setFix] = useState<FixKind | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const { has } = usePermissions();

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
  // ⚠️ "Sahadaki kart güncel değil" BANDI KALDIRILDI (2026-08-06, kullanıcı kararı):
  // `contentDirty` ekrandaki belgenin değil sahadaki KÂĞIDIN eskidiğini söylüyordu,
  // ama operatör onu bastığı belgenin yanında görüp "ekrandaki eski" diye okuyordu
  // — içerik her baskıda canlı çözüldüğü için bu okuma her zaman yanlıştı. Bantla
  // birlikte onu besleyen `traveler-card-active` sorgusu da düştü (tek tüketicisiydi).
  // Gerekçenin tamamı: Electron `TravelerCardPrintDialog` başlığı.

  const wo = woQuery.data?.data;
  // Tüketilmiş/emekli toplar (Tambur kesimi, fason açık-kumaş, kartela, iptal)
  // gizlenir — özellikle tamamlanan WO'da parent kayıtları karışıklık yaratıyordu.
  const rolls = (rollsQuery.data?.data ?? []).filter((r) => !isRetiredRoll(r.status));
  const editable = wo && wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED';
  // Düzeltme menüsü ayrı yetenek (S7); panel yetkisi de açar.
  const canFix = !!editable && (has('mobile:is-emri-duzelt') || has('workorder:write'));
  // İptal yalnız hiç işlem görmemiş iş emrinde (S3); panel yetkisi her durumda.
  const canCancel = !!wo && !!editable && tabletCancelAllowed(wo, has('workorder:write'));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['work-order', workOrderId] });
    void qc.invalidateQueries({ queryKey: ['work-order-rolls', workOrderId] });
    void qc.invalidateQueries({ queryKey: ['work-order-events', workOrderId] });
    onChanged();
  };

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

  const statusColor = wo ? WORK_ORDER_STATUS_COLOR[wo.status] ?? colors.textMuted : colors.textMuted;
  const impact = impactQuery.data?.data;

  /** Hedef üretim özellikleri — pivot (`{property:{name}}`) ya da düz şekil. */
  const targetPropertyNames = useMemo<string[]>(() => {
    const raw = (wo?.targetProperties ?? []) as Array<
      { name?: string | null; property?: { name?: string | null } | null } | null
    >;
    return raw
      .map((tp) => tp?.property?.name ?? tp?.name ?? null)
      .filter((n): n is string => !!n);
  }, [wo]);

  const infoRows = useMemo(() => {
    if (!wo) return [];
    return [
      ['Ürün', wo.targetItem?.name ?? rolls[0]?.item?.name ?? '—'],
      ['Renk', wo.targetColor?.name ?? 'Renksiz / Ham'],
      ['En', wo.width != null ? `${wo.width} cm` : '—'],
      ['Kat Tipi', wo.foldType ?? '—'],
      // ÜRETİM ÖZELLİĞİ (2026-08-13 saha bulgusu: geçmiş iş emri detayında hiç
      // yazmıyordu). ⚠️ Backend pivotu `{ property: {...} }` ile döner; tip
      // düz `FabricProperty[]` olduğu için İKİ ŞEKLİ de karşıla — biri boş
      // çıkarsa satır sessizce "—" olur ve eksiklik yine görünmez.
      ['Üretim Özelliği', targetPropertyNames.length ? targetPropertyNames.join(', ') : '—'],
      ['Tip', trLabel(WORK_ORDER_TYPE_LABEL, wo.type)],
      ['Hedef Metraj', wo.targetQuantity != null ? `${Math.round(wo.targetQuantity)} m` : '—'],
      ['Hedef Kg', wo.targetWeight != null ? `${Math.round(wo.targetWeight)} kg` : '—'],
      ['Oluşturma', wo.createdAt ? dayjs(wo.createdAt).format('DD.MM.YYYY HH:mm') : '—'],
    ];
  }, [wo, rolls, targetPropertyNames]);

  return (
    <>
    <AppModal visible={visible} onDismiss={onClose} position="bottom" contentStyle={styles.sheet}>
      {/* Başlık */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerBatch} numberOfLines={1}>
            {wo?.workOrderNumber ?? 'İş Emri'}
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

          <WorkOrderRecentEvents workOrderId={wo.id} />

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
                  <Text style={styles.rollLineMeta} numberOfLines={1}>
                    {r.item?.name ?? '—'} · {Math.round(Number(r.currentQty))}m
                  </Text>
                </View>
              ))
            )}
          </View>

          {/* Aksiyonlar */}
          <View style={styles.actionGrid}>
            {/* "Belgeler" = iş emrinin TÜM belgeleri (refakat kartı + fason sevk /
                kabul / doğrudan sevk irsaliyeleri). Eski "Çıktı" butonu yalnız
                refakat kartını basıyordu; diğer belgelere mobilden hiç
                ulaşılamıyordu. Kart hâlâ bir dokunuş uzakta (listenin ilk satırı). */}
            <Button
              mode="contained"
              icon="file-document-multiple-outline"
              onPress={() => setDocumentsOpen(true)}
              style={styles.actionBtn}
              contentStyle={styles.btnContent}
            >
              Belgeler
            </Button>
          </View>
          {canFix ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Düzelt</Text>
              <View style={styles.fixGrid}>
                <Button mode="contained-tonal" icon="palette" onPress={() => setFix('color')} style={styles.fixBtn} contentStyle={styles.btnContent}>
                  Rengi Değiştir
                </Button>
                <Button mode="contained-tonal" icon="arrow-expand-horizontal" onPress={() => setFix('width')} style={styles.fixBtn} contentStyle={styles.btnContent}>
                  Eni Değiştir
                </Button>
                <Button mode="contained-tonal" icon="link-variant" onPress={() => setLinkOpen(true)} style={styles.fixBtn} contentStyle={styles.btnContent}>
                  Sipariş Bağla / Çöz
                </Button>
                <Button mode="contained-tonal" icon="printer" onPress={() => setFix('reprint')} style={styles.fixBtn} contentStyle={styles.btnContent}>
                  Kartı Yeniden Bas
                </Button>
                <Button mode="contained-tonal" icon="tray-remove" onPress={() => setFix('detach')} style={styles.fixBtn} contentStyle={styles.btnContent}>
                  Top Çıkar
                </Button>
              </View>
            </View>
          ) : null}
          {editable && !canCancel ? (
            <Text style={styles.note}>Bu iş emrinde üretim başladı — iptal panelden yapılır (toplar için karar ve sebep sorulur).</Text>
          ) : null}
          {canCancel ? (
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

    {/* Belgeler — detay modalının KARDEŞİ, İÇİNDE değil. AppModal Paper `Portal`
        kullanıyor: iki sheet de kök portal host'una taşınır, sonra mount olan
        üstte kalır ve detay arkada açık durur (kapatınca detaya dönülür).
        İç içe yerleştirme kod tabanında hiç emsali olmayan bir kurulumdu —
        `RemoteListSheet` bugüne dek hep AppModal DIŞINDA kullanıldı. */}
    {/* Düzeltme kartları detayın KARDEŞİ (Belgeler emsali): kapanınca detaya dönülür. */}
    <WorkOrderFixSheet
      kind={fix}
      wo={wo ?? null}
      onDismiss={() => setFix(null)}
      onDone={() => {
        setFix(null);
        refresh();
      }}
    />
    {wo ? (
      <TamburOrderLinkSheet visible={linkOpen} onDismiss={() => setLinkOpen(false)} workOrderId={wo.id} onLinked={refresh} />
    ) : null}
    <WorkOrderDocumentsSheet
      visible={documentsOpen}
      onDismiss={() => setDocumentsOpen(false)}
      workOrderId={workOrderId ?? null}
      workOrderNumber={wo?.workOrderNumber}
    />
    </>
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
  fixGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fixBtn: { flexGrow: 1, flexBasis: '45%', borderRadius: radius.md },
  actionBtn: { flex: 1, borderRadius: radius.md },
  cancelBtn: { borderRadius: radius.md, borderColor: colors.danger },
  actionsCol: { gap: spacing.sm, marginTop: spacing.md },
  btnContent: { height: 48 },
});
