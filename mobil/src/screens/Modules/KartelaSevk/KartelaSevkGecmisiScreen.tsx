import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { Text, Surface, TouchableRipple, Button, ActivityIndicator, Icon } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';

import ScreenChrome from '../../../components/ScreenChrome';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import ConfirmDialog from '../../../components/ConfirmDialog';
import AppModal from '../../../components/AppModal';
import { SkeletonList } from '../../../components/motion';
import { useKartelaFirms } from '../../../hooks/useKartelaFirms';
import {
  kartelaService,
  type KartelaDispatchListItem,
  type KartelaDispatchStatusFilter,
} from '../../../services/kartela.service';
import { colors, spacing, radius } from '../../../theme';
import type { MainStackParamList } from '../../../navigation/types';

const STATUS_TABS: { key: KartelaDispatchStatusFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'open', label: 'Açık' },
  { key: 'received', label: 'Kabul' },
  { key: 'cancelled', label: 'İptal' },
];

const PAGE = 30;

export default function KartelaSevkGecmisiScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();
  const [status, setStatus] = useState<KartelaDispatchStatusFilter>('all');
  const [firmId, setFirmId] = useState<string | null>(null);
  const [firmName, setFirmName] = useState('');
  const [firmPickerOpen, setFirmPickerOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<KartelaDispatchListItem | null>(null);
  const [cancelTarget, setCancelTarget] = useState<KartelaDispatchListItem | null>(null);

  const { firms } = useKartelaFirms();
  const firmOptions: PickerOption[] = useMemo(
    () => [
      { value: '', label: 'Tüm firmalar' },
      ...firms.map((f) => ({ value: f.id, label: f.name, sublabel: f.code ?? undefined })),
    ],
    [firms]
  );

  const query = useInfiniteQuery({
    queryKey: ['kartela', 'dispatches-history', status, firmId],
    queryFn: ({ pageParam }) =>
      kartelaService.listDispatchesCursor({
        status,
        subcontractorId: firmId ?? undefined,
        limit: PAGE,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : null),
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      kartelaService.cancelDispatch(id, reason),
    onSuccess: (_res, vars) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Sevk iptal edildi', text2: 'Toplar depoya döndü' });
      setCancelTarget(null);
      qc.invalidateQueries({ queryKey: ['kartela'] });
      void query.refetch();
      void vars;
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'İptal edilemedi', text2: err.message });
    },
  });

  return (
    <ScreenChrome title="Kartela Sevk Geçmişi" onBack={() => nav.goBack()}>
      {/* Filtreler */}
      <View style={styles.filterRow}>
        {STATUS_TABS.map((t) => {
          const active = status === t.key;
          return (
            <TouchableRipple
              key={t.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setStatus(t.key)}
              borderless
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
            </TouchableRipple>
          );
        })}
        <TouchableRipple style={styles.firmChip} onPress={() => setFirmPickerOpen(true)} borderless>
          <View style={styles.firmChipInner}>
            <Text style={styles.firmChipText} numberOfLines={1}>
              {firmId ? firmName : 'Tüm firmalar'}
            </Text>
            <Icon source="chevron-down" size={16} color={colors.textSecondary} />
          </View>
        </TouchableRipple>
      </View>

      {query.isLoading ? (
        <View style={styles.body}>
          <SkeletonList count={6} />
        </View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>Bu filtreyle kartela sevki bulunamadı.</Text>
          }
          ListFooterComponent={
            query.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: spacing.lg }} /> : null
          }
          renderItem={({ item }) => (
            <DispatchRow item={item} onOpen={() => setDetailTarget(item)} />
          )}
        />
      )}

      {/* Çeki detayı — alt sheet modal (okunaklı) */}
      <DispatchDetailModal
        item={detailTarget}
        onClose={() => setDetailTarget(null)}
        onCancel={() => {
          const t = detailTarget;
          setDetailTarget(null);
          setCancelTarget(t);
        }}
      />

      <PickerModal
        visible={firmPickerOpen}
        title="Firma Filtresi"
        options={firmOptions}
        selectedValue={firmId ?? ''}
        onSelect={(v) => {
          setFirmId(v || null);
          setFirmName(firmOptions.find((o) => o.value === v)?.label ?? '');
          setFirmPickerOpen(false);
        }}
        onDismiss={() => setFirmPickerOpen(false)}
      />

      <ConfirmDialog
        kind="destructive"
        visible={!!cancelTarget}
        title="Sevki İptal Et"
        description={
          cancelTarget
            ? `${cancelTarget.dispatchNo} (${cancelTarget.subcontractor.name}) iptal edilecek. Sevkteki toplar depoya geri dönecek.`
            : ''
        }
        reason={{ label: 'İptal sebebi', placeholder: 'Örn. yanlış firma seçildi', required: true, minLength: 3 }}
        confirmLabel="İptal Et"
        cancelLabel="Vazgeç"
        confirming={cancelMutation.isPending}
        onDismiss={() => setCancelTarget(null)}
        onConfirm={({ reason }) => {
          if (cancelTarget) cancelMutation.mutate({ id: cancelTarget.id, reason: reason ?? '' });
        }}
      />
    </ScreenChrome>
  );
}

function statusOf(item: KartelaDispatchListItem) {
  return item.cancelledAt
    ? { label: 'İptal', accent: colors.borderStrong, pillBg: colors.surfaceSunken, pillFg: colors.textMuted }
    : item.isReceived
      ? { label: 'Kabul edildi', accent: '#22c55e', pillBg: '#dcfce7', pillFg: '#15803d' }
      : { label: 'Açık', accent: '#f59e0b', pillBg: '#fef3c7', pillFg: '#b45309' };
}

// ---------------------------------------------------------------------------
// Satır — sade kart; tıklayınca çeki detayı modalı açılır
// ---------------------------------------------------------------------------
function DispatchRow({ item, onOpen }: { item: KartelaDispatchListItem; onOpen: () => void }) {
  const st = statusOf(item);
  return (
    <Surface style={styles.card} elevation={2}>
      <View style={styles.cardRow}>
        <View style={[styles.accent, { backgroundColor: st.accent }]} />
        <TouchableRipple style={styles.cardBody} onPress={onOpen} borderless>
          <View style={styles.cardInner}>
            <View style={styles.cardHeader}>
              <Text style={styles.no}>{item.dispatchNo}</Text>
              <View style={[styles.pill, { backgroundColor: st.pillBg }]}>
                <View style={[styles.dot, { backgroundColor: st.accent }]} />
                <Text style={[styles.pillText, { color: st.pillFg }]}>{st.label}</Text>
              </View>
            </View>

            <View style={styles.metaRow}>
              <Icon source="store-outline" size={15} color={colors.textMuted} />
              <Text style={styles.firmText} numberOfLines={1}>
                {item.subcontractor.name}
              </Text>
              <Text style={styles.dateText}>
                {dayjs(item.dispatchedAt).format('DD.MM.YYYY · HH:mm')}
              </Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Icon source="package-variant-closed" size={14} color={colors.textSecondary} />
                <Text style={styles.statText}>{item._count.items} top</Text>
              </View>
              <View style={styles.stat}>
                <Icon source="tape-measure" size={14} color={colors.textSecondary} />
                <Text style={styles.statText}>{item.totalQty.toFixed(1)} m</Text>
              </View>
              <View style={{ flex: 1 }} />
              <Text style={styles.detailHint}>Çeki</Text>
              <Icon source="chevron-right" size={20} color={colors.textMuted} />
            </View>
          </View>
        </TouchableRipple>
      </View>
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Çeki detayı — alt sheet (AppModal). Her rulo 2 satır: barkod+metraj /
// kumaş · renk → cramped değil, rahat okunur.
// ---------------------------------------------------------------------------
function DispatchDetailModal({
  item,
  onClose,
  onCancel,
}: {
  item: KartelaDispatchListItem | null;
  onClose: () => void;
  onCancel: () => void;
}) {
  const { height } = useWindowDimensions();
  // Çıkış animasyonu boyunca içerik görünsün diye son item'ı sakla.
  const [current, setCurrent] = useState<KartelaDispatchListItem | null>(item);
  useEffect(() => {
    if (item) setCurrent(item);
  }, [item]);

  const detail = useQuery({
    queryKey: ['kartela', 'dispatch', current?.id],
    queryFn: () => kartelaService.getDispatch(current!.id).then((r) => r.data),
    enabled: !!item && !!current,
    staleTime: 60_000,
  });

  const st = current ? statusOf(current) : null;
  const cancellable = !!current && !current.cancelledAt && !current.isReceived;

  return (
    <AppModal
      visible={!!item}
      onDismiss={onClose}
      position="bottom"
      contentStyle={styles.sheet}
      onHidden={() => setCurrent(null)}
    >
      {current && st ? (
        <View>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetNo}>{current.dispatchNo}</Text>
              <View style={styles.sheetSubRow}>
                <Icon source="store-outline" size={14} color={colors.textMuted} />
                <Text style={styles.sheetFirm} numberOfLines={1}>
                  {current.subcontractor.name}
                </Text>
                <Text style={styles.sheetDate}>
                  {dayjs(current.dispatchedAt).format('DD.MM.YYYY · HH:mm')}
                </Text>
              </View>
            </View>
            <View style={[styles.pill, { backgroundColor: st.pillBg }]}>
              <View style={[styles.dot, { backgroundColor: st.accent }]} />
              <Text style={[styles.pillText, { color: st.pillFg }]}>{st.label}</Text>
            </View>
          </View>

          <Text style={styles.detailTitle}>
            ÇEKİ LİSTESİ · {current._count.items} TOP · {current.totalQty.toFixed(1)} M
          </Text>

          {detail.isLoading ? (
            <ActivityIndicator style={{ marginVertical: spacing.xl }} />
          ) : detail.data ? (
            <ScrollView
              style={[styles.sheetScroll, { maxHeight: height * 0.5 }]}
              contentContainerStyle={styles.sheetScrollContent}
            >
              {detail.data.items.map((it) => (
                <View key={it.id} style={styles.rollCard}>
                  <View style={styles.rollCardTop}>
                    <View style={styles.rollBarcodeWrap}>
                      <Icon source="barcode" size={16} color={colors.textSecondary} />
                      <Text style={styles.rollBarcode} numberOfLines={1}>
                        {it.roll.barcode ?? it.roll.id.slice(0, 8)}
                      </Text>
                    </View>
                    <Text style={styles.rollQty}>{Number(it.dispatchedQty).toFixed(1)} m</Text>
                  </View>
                  <Text style={styles.rollFabric} numberOfLines={2}>
                    {it.roll.item.name}
                    {it.roll.color ? `  ·  ${it.roll.color.name}` : ''}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.sheetFooter}>
            {cancellable ? (
              <Button
                mode="contained"
                icon="close-circle-outline"
                buttonColor="#dc2626"
                textColor="#ffffff"
                style={styles.sheetCancelBtn}
                contentStyle={{ height: 48 }}
                onPress={onCancel}
              >
                Sevki İptal Et
              </Button>
            ) : (
              <View style={styles.lockRow}>
                <Icon
                  source={current.cancelledAt ? 'cancel' : 'lock-outline'}
                  size={15}
                  color={colors.textMuted}
                />
                <Text style={styles.notCancellable}>
                  {current.cancelledAt ? 'İptal edilmiş sevk' : 'Kabul edilmiş — iptal edilemez'}
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        <View />
      )}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md },
  // Tek satır: durum chip'leri sabit-kompakt, firma chip'i kalan alanı esnek alır.
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.brand },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: colors.textOnDark },
  firmChip: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
  },
  firmChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 5,
  },
  firmChipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, flexShrink: 1 },
  listContent: { padding: spacing.md, paddingBottom: spacing.xxxl },
  separator: { height: spacing.md },
  empty: { color: colors.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: spacing.xxl },

  // Modern kart — sol durum-renkli aksan + ferah içerik
  card: { borderRadius: radius.xl, backgroundColor: colors.surface, overflow: 'hidden' },
  cardRow: { flexDirection: 'row' },
  accent: { width: 5 },
  cardBody: { flex: 1 },
  cardInner: { paddingVertical: spacing.md, paddingHorizontal: spacing.md, gap: spacing.sm },

  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  no: { fontSize: 16, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'], letterSpacing: 0.2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  dot: { width: 7, height: 7, borderRadius: radius.full },
  pillText: { fontSize: 11.5, fontWeight: '700' },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  firmText: { fontSize: 13.5, fontWeight: '600', color: colors.text, flexShrink: 1 },
  dateText: { fontSize: 12, color: colors.textMuted, marginLeft: 'auto', fontVariant: ['tabular-nums'] },

  statsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
  },
  statText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  detailHint: { fontSize: 12, fontWeight: '700', color: colors.textMuted },

  // Çeki detay sheet (AppModal bottom)
  sheet: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSunken,
    marginBottom: spacing.md,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md },
  sheetNo: { fontSize: 18, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'], letterSpacing: 0.2 },
  sheetSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  sheetFirm: { fontSize: 13.5, fontWeight: '600', color: colors.textSecondary, flexShrink: 1 },
  sheetDate: { fontSize: 12, color: colors.textMuted, marginLeft: 'auto', fontVariant: ['tabular-nums'] },
  detailTitle: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.8, marginBottom: spacing.sm },
  sheetScroll: { flexGrow: 0 },
  sheetScrollContent: { gap: spacing.sm, paddingBottom: spacing.xs },
  rollCard: {
    backgroundColor: colors.appBg,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 4,
  },
  rollCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  rollBarcodeWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  rollBarcode: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'], flexShrink: 1 },
  rollQty: { fontSize: 14, fontWeight: '700', color: colors.brand, fontVariant: ['tabular-nums'] },
  rollFabric: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  sheetFooter: { marginTop: spacing.md },
  sheetCancelBtn: { borderRadius: radius.lg },
  lockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm },
  notCancellable: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
});
