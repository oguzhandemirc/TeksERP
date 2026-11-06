// İş Emirleri — kompakt tablo (FlashList, cursor + sonsuz kaydırma). Görsel hiyerarşi: "Şu an nerede" rozeti en büyük
// öğe (≥20pt, istasyon renginde dolgulu, yanında istasyon/fasoncu adı — renk tek taşıyıcı değil). Geniş ekranda tablo
// satırı + başlık; dar ekranda (telefon dikey) aynı sütun kümesi kart satırına dizilir.
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import TruncatedText from '../../../components/TruncatedText';
import { formatCalendarDay } from '../../../lib/factory-time';
import { TERIM } from '../../../lib/terim';
import { QUERY_PROBLEM_TEXT, type QueryProblem } from '../../../utils/queryState';
import { WORK_ORDER_STATUS_COLOR, WORK_ORDER_STATUS_LABEL, trLabel } from '../../../utils/labels';
import { colors, radius, spacing, typography } from '../../../theme';
import { visibleDefs, type ColumnDef, type ColumnKey } from './columns';
import { batchText, customerText, fabricText, locationBadge, rollMeterText, typeBadgeText, type EmptyAction, type WorkOrderListRow } from './workOrderRow';

export const WIDE_MIN = 720;

interface Props {
  rows: WorkOrderListRow[];
  visible: ColumnKey[];
  loading: boolean;
  problem: QueryProblem | null;
  empty: { title: string; text: string; action: EmptyAction };
  refreshing: boolean;
  fetchingMore: boolean;
  onEndReached: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onEmptyAction: (a: Exclude<EmptyAction, null>) => void;
}

const EMPTY_ACTION_LABEL: Record<Exclude<EmptyAction, null>, { label: string; icon: string }> = {
  clearFilters: { label: 'Süzgeçleri temizle', icon: 'filter-remove-outline' },
  showAllStatuses: { label: 'Tüm durumları göster', icon: 'format-list-checks' },
};

export default function WorkOrderTable(p: Props) {
  const wide = useWindowDimensions().width >= WIDE_MIN;
  const defs = visibleDefs(p.visible);
  if (p.loading) {
    return (
      <View style={styles.center} testID="ie-liste-yukleniyor">
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.centerText}>{TERIM.terbiyeIsEmri.cogul} yükleniyor…</Text>
      </View>
    );
  }
  if (p.problem) {
    return (
      <View style={styles.center} testID="ie-liste-hata">
        <Icon source={p.problem === 'offline' ? 'wifi-off' : 'alert-circle-outline'} size={48} color={colors.dangerText} />
        <Text style={styles.centerTitle}>{p.problem === 'offline' ? 'Çevrimdışısınız' : 'Liste alınamadı'}</Text>
        <Text style={styles.centerText}>{QUERY_PROBLEM_TEXT[p.problem]}</Text>
        <Button mode="contained" onPress={p.onRetry} contentStyle={styles.bigBtn} icon="refresh">Tekrar dene</Button>
      </View>
    );
  }
  if (p.rows.length === 0) {
    return (
      <View style={styles.center} testID="ie-liste-bos">
        <Icon source="clipboard-search-outline" size={52} color={colors.textMuted} />
        <Text style={styles.centerTitle}>{p.empty.title}</Text>
        <Text style={styles.centerText}>{p.empty.text}</Text>
        {p.empty.action && (
          <Button mode="outlined" onPress={() => p.empty.action && p.onEmptyAction(p.empty.action)} contentStyle={styles.bigBtn} icon={EMPTY_ACTION_LABEL[p.empty.action].icon} testID="ie-liste-bos-eylem">
            {EMPTY_ACTION_LABEL[p.empty.action].label}
          </Button>
        )}
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      {wide && (
        <View style={styles.headRow}>
          {defs.map((d) => (
            <Text key={d.key} style={[styles.headCell, { flex: d.flex }]} numberOfLines={1}>{d.label}</Text>
          ))}
          <View style={styles.chevronSpace} />
        </View>
      )}
      <FlashList
        data={p.rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <Row row={item} defs={defs} wide={wide} onOpen={p.onOpen} />}
        onEndReachedThreshold={0.6}
        onEndReached={p.onEndReached}
        refreshing={p.refreshing}
        onRefresh={p.onRefresh}
        contentContainerStyle={styles.listContent}
        ListFooterComponent={p.fetchingMore ? <ActivityIndicator style={styles.more} color={colors.brand} /> : null}
      />
    </View>
  );
}

function Row({ row, defs, wide, onOpen }: { row: WorkOrderListRow; defs: ColumnDef[]; wide: boolean; onOpen: (id: string) => void }) {
  const cell = (k: ColumnKey) => <Cell key={k} k={k} row={row} />;
  return (
    <TouchableRipple onPress={() => onOpen(row.id)} style={styles.row} testID={`ie-satir-${row.id}`} accessibilityRole="button" accessibilityLabel={`${row.workOrderNumber} ayrıntısı`}>
      {wide ? (
        <View style={styles.rowWide}>
          {defs.map((d) => (
            <View key={d.key} style={[styles.cell, { flex: d.flex }]}>{cell(d.key)}</View>
          ))}
          <Icon source="chevron-right" size={22} color={colors.textMuted} />
        </View>
      ) : (
        <View style={styles.rowNarrow}>
          <View style={styles.narrowTop}>
            {cell('no')}
            {defs.some((d) => d.key === 'durum') && cell('durum')}
          </View>
          {cell('konum')}
          {defs.filter((d) => !['no', 'durum', 'konum'].includes(d.key)).map((d) => (
            <View key={d.key} style={styles.narrowLine}>
              <Text style={styles.narrowLabel}>{d.label}</Text>
              <View style={styles.fill}>{cell(d.key)}</View>
            </View>
          ))}
        </View>
      )}
    </TouchableRipple>
  );
}

function Cell({ k, row }: { k: ColumnKey; row: WorkOrderListRow }) {
  switch (k) {
    case 'no': {
      const tur = typeBadgeText(row);
      return (
        <View style={styles.noWrap}>
          <Text style={styles.no} numberOfLines={1}>{row.workOrderNumber}</Text>
          {tur && <Text style={styles.typeBadge} numberOfLines={1} testID={`ie-tur-rozet-${row.id}`}>{tur}</Text>}
        </View>
      );
    }
    case 'musteri':
      return <TruncatedText style={styles.text}>{customerText(row)}</TruncatedText>;
    case 'kumas':
      return <TruncatedText style={styles.text}>{fabricText(row)}</TruncatedText>;
    case 'parti':
      return <Text style={styles.text} numberOfLines={1}>{batchText(row)}</Text>;
    case 'topMetre':
      return <Text style={styles.text} numberOfLines={1}>{rollMeterText(row)}</Text>;
    case 'tarih':
      return <Text style={styles.sub} numberOfLines={1}>{formatCalendarDay(row.createdAt, 'dd.MM.yy')}</Text>;
    case 'durum':
      return (
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: WORK_ORDER_STATUS_COLOR[row.status] ?? colors.textMuted }]} />
          <Text style={styles.statusText} numberOfLines={1}>{trLabel(WORK_ORDER_STATUS_LABEL, row.status)}</Text>
        </View>
      );
    case 'konum':
      return <LocationCell row={row} />;
  }
}

function LocationCell({ row }: { row: WorkOrderListRow }) {
  const b = locationBadge(row.konum, row.status);
  if (b.kind === 'plain') return <Text style={styles.plainBadge} numberOfLines={1}>{b.text}</Text>;
  return (
    <View style={styles.badgeWrap}>
      <View style={[styles.badge, { backgroundColor: b.tone.bg }]}>
        <TruncatedText style={[styles.badgeText, { color: b.tone.fg }]}>{b.text}</TruncatedText>
        {b.extra > 0 && (
          <View style={[styles.extra, { borderColor: b.tone.fg }]}>
            <Text style={[styles.extraText, { color: b.tone.fg }]}>+{b.extra}</Text>
          </View>
        )}
      </View>
      <Text style={styles.sub} numberOfLines={1}>{b.detail}{b.extra > 0 ? ` · ${b.extra} istasyon daha` : ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xxl },
  centerTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, textAlign: 'center' },
  centerText: { fontSize: typography.size.base, color: colors.textSecondary, textAlign: 'center' },
  bigBtn: { minHeight: 56, paddingHorizontal: spacing.lg },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  headCell: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.textMuted, textTransform: 'uppercase' },
  chevronSpace: { width: 22 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  row: { borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  rowWide: { flexDirection: 'row', alignItems: 'center', minHeight: 72, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.md },
  rowNarrow: { paddingHorizontal: spacing.sm, paddingVertical: spacing.md, gap: spacing.sm },
  narrowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  narrowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  narrowLabel: { width: 104, fontSize: typography.size.sm, color: colors.textMuted },
  cell: { justifyContent: 'center' },
  no: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text },
  noWrap: { gap: 2, alignItems: 'flex-start' },
  typeBadge: { fontSize: typography.size.xs, fontWeight: typography.weight.bold, color: colors.infoText, backgroundColor: colors.infoContainer, borderRadius: radius.sm, paddingHorizontal: spacing.xs, overflow: 'hidden' },
  text: { fontSize: typography.size.sm, color: colors.text },
  sub: { fontSize: typography.size.sm, color: colors.textSecondary },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  statusText: { fontSize: typography.size.sm, color: colors.text, fontWeight: typography.weight.medium },
  badgeWrap: { gap: 2, alignItems: 'flex-start' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, maxWidth: '100%' },
  badgeText: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, flexShrink: 1 },
  extra: { borderWidth: 1.5, borderRadius: radius.full, paddingHorizontal: spacing.sm },
  extraText: { fontSize: typography.size.sm, fontWeight: typography.weight.bold },
  plainBadge: { fontSize: typography.size.xl, fontWeight: typography.weight.semibold, color: colors.textSecondary },
  more: { marginVertical: spacing.lg },
});
