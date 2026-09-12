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
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import ConfirmDialog from '../../../components/ConfirmDialog';
import AppModal from '../../../components/AppModal';
import { SkeletonList } from '../../../components/motion';
import { useKartelaFirms } from '../../../hooks/useKartelaFirms';
import {
  kartelaService,
  type KartelaReceiptListItem,
  type KartelaReceiptStatusFilter,
} from '../../../services/kartela.service';
import { blockedSwatchCardNumbers } from './blockedSwatches.helper';
import { colors, spacing, radius } from '../../../theme';
import type { MainStackParamList } from '../../../navigation/types';

const STATUS_TABS: { key: KartelaReceiptStatusFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'active', label: 'Aktif' },
  { key: 'cancelled', label: 'İptal' },
];

const PAGE = 30;

function statusOf(item: KartelaReceiptListItem) {
  return item.cancelledAt
    ? { label: 'İptal', accent: colors.borderStrong, pillBg: colors.surfaceSunken, pillFg: colors.textMuted }
    : { label: 'Aktif', accent: '#22c55e', pillBg: '#dcfce7', pillFg: '#15803d' };
}

export default function KartelaKabulGecmisiScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();
  const [status, setStatus] = useState<KartelaReceiptStatusFilter>('all');
  const [firmId, setFirmId] = useState<string | null>(null);
  const [firmName, setFirmName] = useState('');
  const [firmPickerOpen, setFirmPickerOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<KartelaReceiptListItem | null>(null);
  const [cancelTarget, setCancelTarget] = useState<KartelaReceiptListItem | null>(null);
  /** Engel dökümü — dolu olduğu sürece "hangi kartelalar engelliyor" dialogu açık. */
  const [blockedCards, setBlockedCards] = useState<string[] | null>(null);

  const { firms } = useKartelaFirms();
  const firmOptions: PickerOption[] = useMemo(
    () => [
      { value: '', label: 'Tüm firmalar' },
      ...firms.map((f) => ({ value: f.id, label: f.name, sublabel: f.code ?? undefined })),
    ],
    [firms]
  );

  const query = useInfiniteQuery({
    queryKey: ['kartela', 'receipts-history', status, firmId],
    queryFn: ({ pageParam }) =>
      kartelaService.listReceiptsCursor({
        status,
        subcontractorId: firmId ?? undefined,
        limit: PAGE,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : null),
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  const refresh = useManualRefresh(() => query.refetch(), 'Geçmiş güncellendi');

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      kartelaService.cancelReceipt(id, reason),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Kabul geri alındı', text2: 'Toplar hâlâ fasonda (AT_KARTELA)' });
      setCancelTarget(null);
      qc.invalidateQueries({ queryKey: ['kartela'] });
      void query.refetch();
    },
    onError: (err: Error) => {
      // Engel DÖKÜMLÜ geldiyse Toast yerine LİSTE dialogu: yıkıcı işlem
      // engellenince operatör hangi kayıtların engellediğini görmek zorunda,
      // "N kartela" soyut sayısı hangi kartelayı çıkaracağını söylemiyor.
      const cards = blockedSwatchCardNumbers(err);
      if (cards) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setCancelTarget(null);
        setBlockedCards(cards);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Geri alınamadı', text2: err.message });
    },
  });

  return (
    <ScreenChrome
      title="Kartela Kabul Geçmişi"
      onBack={() => nav.goBack()}
      headerExtras={
        <RefreshButton
          headerStyle
          label="Yenile"
          onPress={refresh.onRefresh}
          refreshing={refresh.refreshing}
          isError={refresh.isError}
          errorMessage={refresh.errorMessage}
          successMessage={refresh.successMessage}
        />
      }
    >
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
            <Text style={styles.empty}>Bu filtreyle kartela kabulü bulunamadı.</Text>
          }
          ListFooterComponent={
            query.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: spacing.lg }} /> : null
          }
          renderItem={({ item }) => (
            <ReceiptRow item={item} onOpen={() => setDetailTarget(item)} />
          )}
        />
      )}

      <ReceiptDetailModal
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
        title="Kabulü Geri Al"
        description={
          cancelTarget
            ? `${cancelTarget.receiptNo} geri alınacak. Doğan kartelalar silinecek; toplar "kartelada" (fasonda) durumuna döner. Bu malı reddetmek DEĞİL — yanlış kabul edildiyse geri almaktır.`
            : ''
        }
        reason={{ label: 'Geri alma sebebi', placeholder: 'Örn. yanlış kabul edildi', required: true, minLength: 3 }}
        confirmLabel="Geri Al"
        cancelLabel="Vazgeç"
        confirming={cancelMutation.isPending}
        onDismiss={() => setCancelTarget(null)}
        onConfirm={({ reason }) => {
          if (cancelTarget) cancelMutation.mutate({ id: cancelTarget.id, reason: reason ?? '' });
        }}
      />

      {/* Engel dökümü — kartelalar TEK TEK listelenir (liste gövdedeki ScrollView'da
          akar, kırpılmaz). Emsal: FasonSevk ürün uyuşmazlığı dialogu. */}
      <ConfirmDialog
        kind="simple"
        visible={blockedCards !== null}
        title="Kabul geri alınamadı"
        description={
          blockedCards ? (
            <View>
              <Text style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 20 }}>
                {blockedCards.length} kartela sevkiyatta ya da çuvalda olduğu için kabul geri
                alınamıyor. Önce aşağıdaki kartelaları sevkiyattan/çuvaldan çıkarın:
              </Text>
              <View style={{ marginTop: spacing.sm, gap: 4 }}>
                {blockedCards.map((card) => (
                  <Text key={card} style={{ fontSize: 13, color: colors.text, fontWeight: '600' }}>
                    • {card}
                  </Text>
                ))}
              </View>
            </View>
          ) : (
            ''
          )
        }
        confirmLabel="Anladım"
        cancelLabel="Kapat"
        onDismiss={() => setBlockedCards(null)}
        onConfirm={() => setBlockedCards(null)}
      />
    </ScreenChrome>
  );
}

// ---------------------------------------------------------------------------
// Satır — sade kart; tıklayınca detay modalı
// ---------------------------------------------------------------------------
function ReceiptRow({ item, onOpen }: { item: KartelaReceiptListItem; onOpen: () => void }) {
  const st = statusOf(item);
  return (
    <Surface style={styles.card} elevation={2}>
      <View style={styles.cardRow}>
        <View style={[styles.accent, { backgroundColor: st.accent }]} />
        <TouchableRipple style={styles.cardBody} onPress={onOpen} borderless>
          <View style={styles.cardInner}>
            <View style={styles.cardHeader}>
              <Text style={styles.no}>{item.receiptNo}</Text>
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
                {dayjs(item.receivedAt).format('DD.MM.YYYY · HH:mm')}
              </Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Icon source="package-variant-closed" size={14} color={colors.textSecondary} />
                <Text style={styles.statText}>{item._count.items} top</Text>
              </View>
              <Icon source="arrow-right-thin" size={16} color={colors.textMuted} />
              <View style={styles.stat}>
                <Icon source="palette-swatch" size={14} color={colors.textSecondary} />
                <Text style={styles.statText}>{item._count.swatches} kartela</Text>
              </View>
              <View style={{ flex: 1 }} />
              <Text style={styles.detailHint}>Detay</Text>
              <Icon source="chevron-right" size={20} color={colors.textMuted} />
            </View>
          </View>
        </TouchableRipple>
      </View>
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Kabul detayı — alt sheet (AppModal): tüketilen toplar + dönen kartelalar
// ---------------------------------------------------------------------------
function ReceiptDetailModal({
  item,
  onClose,
  onCancel,
}: {
  item: KartelaReceiptListItem | null;
  onClose: () => void;
  onCancel: () => void;
}) {
  const { height } = useWindowDimensions();
  const [current, setCurrent] = useState<KartelaReceiptListItem | null>(item);
  useEffect(() => {
    if (item) setCurrent(item);
  }, [item]);

  const detail = useQuery({
    queryKey: ['kartela', 'receipt', current?.id],
    queryFn: () => kartelaService.getReceipt(current!.id).then((r) => r.data),
    enabled: !!item && !!current,
    staleTime: 60_000,
  });

  const st = current ? statusOf(current) : null;

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
              <Text style={styles.sheetNo}>{current.receiptNo}</Text>
              <View style={styles.sheetSubRow}>
                <Icon source="store-outline" size={14} color={colors.textMuted} />
                <Text style={styles.sheetFirm} numberOfLines={1}>
                  {current.subcontractor.name}
                </Text>
                <Text style={styles.sheetDate}>
                  {dayjs(current.receivedAt).format('DD.MM.YYYY · HH:mm')}
                </Text>
              </View>
            </View>
            <View style={[styles.pill, { backgroundColor: st.pillBg }]}>
              <View style={[styles.dot, { backgroundColor: st.accent }]} />
              <Text style={[styles.pillText, { color: st.pillFg }]}>{st.label}</Text>
            </View>
          </View>

          {detail.isLoading ? (
            <ActivityIndicator style={{ marginVertical: spacing.xl }} />
          ) : detail.data ? (
            <ScrollView
              style={[styles.sheetScroll, { maxHeight: height * 0.5 }]}
              contentContainerStyle={styles.sheetScrollContent}
            >
              <Text style={styles.detailTitle}>
                TÜKETİLEN TOPLAR · {current._count.items}
              </Text>
              {detail.data.items.map((it) => (
                <View key={it.id} style={styles.rollCard}>
                  <View style={styles.rollCardTop}>
                    <View style={styles.rollBarcodeWrap}>
                      <Icon source="barcode" size={16} color={colors.textSecondary} />
                      <Text style={styles.rollBarcode} numberOfLines={1}>
                        {it.consumedRoll.barcode ?? it.consumedRoll.id.slice(0, 8)}
                      </Text>
                    </View>
                    <Text style={styles.rollCount}>→ {it.kartelaCount} kartela</Text>
                  </View>
                  <Text style={styles.rollFabric} numberOfLines={2}>
                    {it.consumedRoll.item.name}
                    {it.consumedRoll.color ? `  ·  ${it.consumedRoll.color.name}` : ''}
                  </Text>
                </View>
              ))}

              <Text style={[styles.detailTitle, { marginTop: spacing.md }]}>
                DÖNEN KARTELALAR · {detail.data.swatches.length}
              </Text>
              {detail.data.swatches.map((s) => (
                <View key={s.id} style={styles.swatchRow}>
                  <Text style={styles.swatchNo} numberOfLines={1}>
                    {s.cardNumber}
                  </Text>
                  <Text style={styles.swatchFabric} numberOfLines={1}>
                    {s.item.name}
                    {s.color ? ` · ${s.color.name}` : ''}
                  </Text>
                  <Text style={styles.swatchMeasure}>
                    {s.length != null ? `${s.length} cm` : '—'}
                    {s.weightKg != null ? ` · ${s.weightKg} kg` : ''}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.sheetFooter}>
            {current.cancelledAt ? (
              <View style={styles.lockRow}>
                <Icon source="cancel" size={15} color={colors.textMuted} />
                <Text style={styles.notCancellable}>Geri alınmış kabul</Text>
              </View>
            ) : current.cancellable ? (
              <Button
                mode="contained"
                icon="undo-variant"
                buttonColor="#dc2626"
                textColor="#ffffff"
                style={styles.sheetCancelBtn}
                contentStyle={{ height: 48 }}
                onPress={onCancel}
              >
                Kabulü Geri Al
              </Button>
            ) : (
              <View style={styles.lockRow}>
                <Icon source="truck-fast-outline" size={15} color={colors.textMuted} />
                <Text style={styles.notCancellable}>
                  Kartelalar sevkiyatta/çuvalda — geri alınamaz
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
  firmChip: { flex: 1, minWidth: 0, borderRadius: radius.full, backgroundColor: colors.surfaceMuted },
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

  // Detay sheet
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
  rollCount: { fontSize: 13, fontWeight: '700', color: colors.brand },
  rollFabric: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    backgroundColor: colors.appBg,
    borderRadius: radius.md,
  },
  swatchNo: { fontSize: 12.5, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  swatchFabric: { fontSize: 12.5, color: colors.textMuted, flex: 1 },
  swatchMeasure: { fontSize: 12.5, fontWeight: '600', color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  sheetFooter: { marginTop: spacing.md },
  sheetCancelBtn: { borderRadius: radius.lg },
  lockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm },
  notCancellable: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
});
