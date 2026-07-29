import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { Text, Surface, TouchableRipple, Button, ActivityIndicator, Icon, TextInput, IconButton } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';

import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import ConfirmDialog from '../../../components/ConfirmDialog';
import AppModal from '../../../components/AppModal';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import { SkeletonList } from '../../../components/motion';
import { returnService, type ReturnRow, type ReturnCancelledFilter } from '../../../services/return.service';
import { colors, spacing, radius } from '../../../theme';
import type { MainStackParamList } from '../../../navigation/types';

const STATUS_TABS: { key: ReturnCancelledFilter; label: string }[] = [
  { key: 'active', label: 'Aktif' },
  { key: 'cancelled', label: 'İptal' },
  { key: 'all', label: 'Tümü' },
];

const PAGE = 30;
const ACCENT = '#d97706';

function statusOf(item: ReturnRow) {
  return item.cancelledAt
    ? { label: 'İptal', accent: colors.borderStrong, pillBg: colors.surfaceSunken, pillFg: colors.textMuted }
    : { label: 'İade', accent: '#d97706', pillBg: '#fef3c7', pillFg: '#b45309' };
}

export default function IadeGecmisiScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();
  const [status, setStatus] = useState<ReturnCancelledFilter>('active');
  const [detailTarget, setDetailTarget] = useState<ReturnRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ReturnRow | null>(null);
  const [editTarget, setEditTarget] = useState<ReturnRow | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['returns', 'history', status],
    queryFn: ({ pageParam }) =>
      returnService.listCursor({ cancelled: status, limit: PAGE, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : null),
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  const reasonsQuery = useQuery({
    queryKey: ['return-reasons'],
    queryFn: () => returnService.listReasons(),
    staleTime: 10 * 60 * 1000,
  });
  const reasonOptions: PickerOption[] = useMemo(
    () => (reasonsQuery.data?.data ?? []).map((r) => ({ value: r.id, label: r.name, sublabel: r.code })),
    [reasonsQuery.data],
  );

  const refresh = useManualRefresh(() => query.refetch(), 'Geçmiş güncellendi');

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => returnService.cancel(id, reason),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'İade iptal edildi', text2: 'Top sevkiyatına geri döndü' });
      setCancelTarget(null);
      qc.invalidateQueries({ queryKey: ['returns'] });
      qc.invalidateQueries({ queryKey: ['rolls'] });
      void query.refetch();
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'İptal edilemedi', text2: err.message });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, reasonId, reasonText, note }: { id: string; reasonId: string | null; reasonText: string | null; note: string | null }) =>
      returnService.edit(id, { reasonId, reasonText, note }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'İade güncellendi' });
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ['returns'] });
      void query.refetch();
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Güncellenemedi', text2: err.message });
    },
  });

  return (
    <ScreenChrome
      title="İade Geçmişi"
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
          ListEmptyComponent={<Text style={styles.empty}>Bu filtreyle iade kaydı bulunamadı.</Text>}
          ListFooterComponent={
            query.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: spacing.lg }} /> : null
          }
          renderItem={({ item }) => <ReturnHistoryRow item={item} onOpen={() => setDetailTarget(item)} />}
        />
      )}

      <ReturnDetailModal
        item={detailTarget}
        onClose={() => setDetailTarget(null)}
        onCancel={() => {
          const t = detailTarget;
          setDetailTarget(null);
          setCancelTarget(t);
        }}
        onEdit={() => {
          const t = detailTarget;
          setDetailTarget(null);
          setEditTarget(t);
        }}
      />

      <ConfirmDialog
        kind="destructive"
        visible={!!cancelTarget}
        title="İadeyi İptal Et"
        description={
          cancelTarget
            ? `${cancelTarget.roll?.barcode ?? 'Top'} iadesi geri alınacak. Top tekrar sevk edilmiş sayılacak (sevkiyatına geri döner).`
            : ''
        }
        reason={{ label: 'İptal sebebi', placeholder: 'Örn. yanlış top okutuldu', required: true, minLength: 3 }}
        confirmLabel="İptal Et"
        cancelLabel="Vazgeç"
        confirming={cancelMutation.isPending}
        onDismiss={() => setCancelTarget(null)}
        onConfirm={({ reason }) => {
          if (cancelTarget) cancelMutation.mutate({ id: cancelTarget.id, reason: reason ?? '' });
        }}
      />

      <EditReturnModal
        target={editTarget}
        reasonOptions={reasonOptions}
        saving={editMutation.isPending}
        onClose={() => setEditTarget(null)}
        onSave={(payload) => {
          if (editTarget) editMutation.mutate({ id: editTarget.id, ...payload });
        }}
      />
    </ScreenChrome>
  );
}

// ---------------------------------------------------------------------------
// Satır — sade kart; tıklayınca detay sheet açılır
// ---------------------------------------------------------------------------
function ReturnHistoryRow({ item, onOpen }: { item: ReturnRow; onOpen: () => void }) {
  const st = statusOf(item);
  return (
    <Surface style={styles.card} elevation={2}>
      <View style={styles.cardRow}>
        <View style={[styles.accent, { backgroundColor: st.accent }]} />
        <TouchableRipple style={styles.cardBody} onPress={onOpen} borderless>
          <View style={styles.cardInner}>
            <View style={styles.cardHeader}>
              <Text style={styles.no}>{item.roll?.barcode ?? item.roll?.id.slice(0, 8) ?? '—'}</Text>
              <View style={[styles.pill, { backgroundColor: st.pillBg }]}>
                <View style={[styles.dot, { backgroundColor: st.accent }]} />
                <Text style={[styles.pillText, { color: st.pillFg }]}>{st.label}</Text>
              </View>
            </View>

            <Text style={styles.fabric} numberOfLines={1}>
              {item.item?.name ?? '—'}
              {item.color ? `  ·  ${item.color.name}` : ''}
              {item.width != null ? `  ·  ${item.width} cm` : ''}
            </Text>

            <View style={styles.metaRow}>
              <Icon source="account-outline" size={15} color={colors.textMuted} />
              <Text style={styles.firmText} numberOfLines={1}>
                {item.customer?.name ?? '—'}
                {item.order ? `  ·  ${item.order.orderNumber}` : ''}
              </Text>
              <Text style={styles.dateText}>{dayjs(item.createdAt).format('DD.MM.YYYY · HH:mm')}</Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Icon source="tape-measure" size={14} color={colors.textSecondary} />
                <Text style={styles.statText}>{item.qty.toFixed(1)} m</Text>
              </View>
              {item.reason ? (
                <View style={[styles.stat, item.reason.color ? { backgroundColor: `${item.reason.color}22` } : null]}>
                  <Text style={[styles.statText, item.reason.color ? { color: item.reason.color } : null]}>
                    {item.reason.name}
                  </Text>
                </View>
              ) : item.reasonText ? (
                <Text style={styles.reasonFreeText} numberOfLines={1}>
                  {item.reasonText}
                </Text>
              ) : null}
              <View style={{ flex: 1 }} />
              <Icon source="chevron-right" size={20} color={colors.textMuted} />
            </View>
          </View>
        </TouchableRipple>
      </View>
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Detay — alt sheet (AppModal). Satır verisinden render edilir (ek fetch yok).
// ---------------------------------------------------------------------------
function ReturnDetailModal({
  item,
  onClose,
  onCancel,
  onEdit,
}: {
  item: ReturnRow | null;
  onClose: () => void;
  onCancel: () => void;
  onEdit: () => void;
}) {
  const { height } = useWindowDimensions();
  const [current, setCurrent] = useState<ReturnRow | null>(item);
  useEffect(() => {
    if (item) setCurrent(item);
  }, [item]);

  const st = current ? statusOf(current) : null;
  const cancellable = !!current && !current.cancelledAt;

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
              <Text style={styles.sheetNo}>{current.roll?.barcode ?? current.roll?.id.slice(0, 8) ?? '—'}</Text>
              <Text style={styles.sheetFabric} numberOfLines={2}>
                {current.item?.name ?? '—'}
                {current.color ? `  ·  ${current.color.name}` : ''}
                {current.width != null ? `  ·  ${current.width} cm` : ''}
              </Text>
            </View>
            <View style={[styles.pill, { backgroundColor: st.pillBg }]}>
              <View style={[styles.dot, { backgroundColor: st.accent }]} />
              <Text style={[styles.pillText, { color: st.pillFg }]}>{st.label}</Text>
            </View>
          </View>

          <ScrollView
            style={[styles.sheetScroll, { maxHeight: height * 0.5 }]}
            contentContainerStyle={styles.sheetScrollContent}
          >
            <DetailRow icon="tape-measure" label="Metraj" value={`${current.qty.toFixed(1)} m`} />
            <DetailRow icon="account-outline" label="Müşteri" value={current.customer?.name ?? '—'} />
            <DetailRow icon="file-document-outline" label="Sipariş" value={current.order?.orderNumber ?? '—'} />
            <DetailRow icon="truck-outline" label="Sevkiyat" value={current.fromShipment?.shipmentNo ?? '—'} />
            <DetailRow
              icon="alert-circle-outline"
              label="Neden"
              value={current.reason?.name ?? current.reasonText ?? '—'}
            />
            {current.qualityGrade && (
              <DetailRow icon="star-outline" label="Kalite" value={current.qualityGrade.name} />
            )}
            {current.note ? <DetailRow icon="note-text-outline" label="Not" value={current.note} /> : null}
            <DetailRow
              icon="account-check-outline"
              label="Teslim alan"
              value={current.receivedBy?.fullName ?? '—'}
            />
            <DetailRow
              icon="clock-outline"
              label="Tarih"
              value={dayjs(current.createdAt).format('DD.MM.YYYY · HH:mm')}
            />
            {current.cancelledAt && (
              <>
                <View style={styles.cancelBox}>
                  <Text style={styles.cancelTitle}>İPTAL EDİLDİ</Text>
                  <Text style={styles.cancelReason}>{current.cancelReason ?? '—'}</Text>
                  <Text style={styles.cancelMeta}>
                    {current.cancelledBy?.fullName ?? '—'} ·{' '}
                    {dayjs(current.cancelledAt).format('DD.MM.YYYY · HH:mm')}
                  </Text>
                </View>
              </>
            )}
          </ScrollView>

          <View style={styles.sheetFooter}>
            {cancellable ? (
              <View style={styles.footerRow}>
                <Button
                  mode="outlined"
                  icon="pencil-outline"
                  textColor={ACCENT}
                  style={styles.footerBtn}
                  contentStyle={{ height: 48 }}
                  onPress={onEdit}
                >
                  Düzelt
                </Button>
                <Button
                  mode="contained"
                  icon="close-circle-outline"
                  buttonColor="#dc2626"
                  textColor="#ffffff"
                  style={styles.footerBtn}
                  contentStyle={{ height: 48 }}
                  onPress={onCancel}
                >
                  İptal Et
                </Button>
              </View>
            ) : (
              <View style={styles.lockRow}>
                <Icon source="cancel" size={15} color={colors.textMuted} />
                <Text style={styles.notCancellable}>İptal edilmiş iade</Text>
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

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Icon source={icon} size={16} color={colors.textMuted} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Düzelt — yalnız neden + not (statü/sevkiyat/kalite DEĞİŞMEZ). Neden zorunlu.
// ---------------------------------------------------------------------------
function EditReturnModal({
  target,
  reasonOptions,
  saving,
  onClose,
  onSave,
}: {
  target: ReturnRow | null;
  reasonOptions: PickerOption[];
  saving: boolean;
  onClose: () => void;
  onSave: (payload: { reasonId: string | null; reasonText: string | null; note: string | null }) => void;
}) {
  const { height } = useWindowDimensions();
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [note, setNote] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (target) {
      setReasonId(target.reason?.id ?? null);
      setReasonText(target.reasonText ?? '');
      setNote(target.note ?? '');
    }
  }, [target]);

  const hasReason = !!reasonId || reasonText.trim().length > 0;

  return (
    <>
      <AppModal visible={!!target} onDismiss={onClose} position="bottom" contentStyle={styles.sheet}>
        <View>
          <View style={styles.grabber} />
          <Text style={styles.editTitle}>İadeyi Düzelt</Text>
          <Text style={styles.editSub}>Yalnız neden ve not değişir — topun durumu etkilenmez.</Text>

          {/* Alanlar maxHeight'li ScrollView'da: multiline inputlar büyüse de
              (veya tablet yatay kısa yükseklikte) sheet H küçük kalır → AppModal
              bottom lift'i klavyeyi geçer; Kaydet ScrollView DIŞINDA sabit footer. */}
          <ScrollView
            style={{ maxHeight: height * 0.4, flexGrow: 0 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: spacing.xs }}
          >
            <Text style={styles.editLabel}>İade Nedeni *</Text>
            <TouchableRipple style={styles.editSelect} onPress={() => setPickerOpen(true)} borderless>
              <View style={styles.editSelectInner}>
                <Icon source="alert-circle-outline" size={18} color={reasonId ? ACCENT : colors.textMuted} />
                <Text style={[styles.editSelectText, !reasonId && styles.editSelectPlaceholder]} numberOfLines={1}>
                  {reasonId ? reasonOptions.find((o) => o.value === reasonId)?.label ?? '—' : 'Neden seçin…'}
                </Text>
                {reasonId ? (
                  <IconButton icon="close-circle" size={18} onPress={() => setReasonId(null)} style={{ margin: 0 }} />
                ) : null}
              </View>
            </TouchableRipple>

            <TextInput
              mode="outlined"
              placeholder="Açıklama (katalog seçmediysen yaz)"
              value={reasonText}
              onChangeText={setReasonText}
              multiline
              outlineColor={colors.border}
              activeOutlineColor={ACCENT}
              style={styles.editInput}
            />

            <Text style={styles.editLabel}>Not</Text>
            <TextInput
              mode="outlined"
              placeholder="Teslim alan notu"
              value={note}
              onChangeText={setNote}
              multiline
              outlineColor={colors.border}
              activeOutlineColor={ACCENT}
              style={styles.editInput}
            />
          </ScrollView>

          <Button
            mode="contained"
            buttonColor={ACCENT}
            textColor="#fff"
            disabled={!hasReason || saving}
            loading={saving}
            style={styles.editSaveBtn}
            contentStyle={{ height: 48 }}
            onPress={() =>
              onSave({
                reasonId,
                reasonText: reasonText.trim() || null,
                note: note.trim() || null,
              })
            }
          >
            Kaydet
          </Button>
        </View>
      </AppModal>

      <PickerModal
        visible={pickerOpen}
        title="İade Nedeni Seç"
        options={reasonOptions}
        selectedValue={reasonId ?? undefined}
        emptyText="İade nedeni tanımlı değil"
        onSelect={(v) => {
          setReasonId(v);
          setPickerOpen(false);
        }}
        onDismiss={() => setPickerOpen(false)}
      />
    </>
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
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.surfaceMuted },
  chipActive: { backgroundColor: colors.brand },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: colors.textOnDark },
  listContent: { padding: spacing.md, paddingBottom: spacing.xxxl },
  separator: { height: spacing.md },
  empty: { color: colors.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: spacing.xxl },

  card: { borderRadius: radius.xl, backgroundColor: colors.surface, overflow: 'hidden' },
  cardRow: { flexDirection: 'row' },
  accent: { width: 5 },
  cardBody: { flex: 1 },
  cardInner: { paddingVertical: spacing.md, paddingHorizontal: spacing.md, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  no: { fontSize: 15, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'], letterSpacing: 0.2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  dot: { width: 7, height: 7, borderRadius: radius.full },
  pillText: { fontSize: 11.5, fontWeight: '700' },
  fabric: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  firmText: { fontSize: 13, fontWeight: '600', color: colors.text, flexShrink: 1 },
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
  reasonFreeText: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic', flexShrink: 1 },

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
  sheetFabric: { fontSize: 13.5, color: colors.textSecondary, fontWeight: '500', marginTop: 3 },
  sheetScroll: { flexGrow: 0 },
  sheetScrollContent: { gap: spacing.xs, paddingBottom: spacing.xs },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 5 },
  detailLabel: { fontSize: 13, color: colors.textMuted, width: 92 },
  detailValue: { fontSize: 14, color: colors.text, fontWeight: '600', flex: 1 },
  cancelBox: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSunken,
    gap: 3,
  },
  cancelTitle: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.8 },
  cancelReason: { fontSize: 14, color: colors.text, fontWeight: '600' },
  cancelMeta: { fontSize: 12, color: colors.textMuted },
  sheetFooter: { marginTop: spacing.md },
  sheetCancelBtn: { borderRadius: radius.lg },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  footerBtn: { flex: 1, borderRadius: radius.lg },
  lockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm },
  notCancellable: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },

  // Düzelt formu
  editTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  editSub: { fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: spacing.md },
  editLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.xs, marginLeft: 2 },
  editSelect: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  editSelectInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 52, paddingLeft: spacing.md, paddingRight: spacing.xs },
  editSelectText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  editSelectPlaceholder: { fontWeight: '500', color: colors.textMuted },
  editInput: { backgroundColor: colors.surface, minHeight: 52, marginTop: spacing.sm },
  editSaveBtn: { borderRadius: radius.lg, marginTop: spacing.lg },
});
