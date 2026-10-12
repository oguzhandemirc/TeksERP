// =============================================================================
// TEZGAH ALARMI — aktif alarm listesi (Uyarılar; telefonda tek sütun, tablette sol bölme)
// =============================================================================
// Kapsam satırı sunucunun gerçekten ne yaptığını söyler: "Size bildirilenler" yalnız sunucu sorumlu
// süzgecini uyguladıysa; tanımıyorsa "İzninize göre tümü" (istemci süzmez — uydurulmaz).
// =============================================================================
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ActivityIndicator, Switch, Text, TouchableRipple } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { ALARM_STATE_LABEL, durationVsTarget, isPastTarget, isSnoozed, reasonText, tierShort } from '../../../lib/loomAlarm/format';
import type { LoomAlarmAudience, LoomAlarmItem } from '../../../types/loomAlarm';
import { colors, radius, spacing, typography } from '../../../theme';
import TruncatedText from '../../../components/TruncatedText';

interface Props {
  items: LoomAlarmItem[];
  audience: LoomAlarmAudience | null;
  loading: boolean;
  problemText: string | null;
  showAll: boolean;
  onShowAll: (v: boolean) => void;
  selectedId: string | null;
  onOpen: (alarmId: string) => void;
  now: number;
}

export default function AlarmListPane(p: Props) {
  // Anahtar yalnız sunucu süzdüğünde ya da kullanıcı "tümü"ne geçtiğinde anlamlıdır.
  const canToggle = p.showAll || p.audience === 'mine';
  return (
    <View style={styles.root}>
      <View style={styles.scopeRow}>
        <Text style={styles.scopeText}>{p.audience === 'mine' ? 'Size bildirilenler' : 'İzninize göre tümü'}</Text>
        {canToggle && (
          <View style={styles.toggle}>
            <Text style={styles.toggleText}>Tümünü göster</Text>
            <Switch value={p.showAll} onValueChange={p.onShowAll} accessibilityLabel="Tümünü göster" />
          </View>
        )}
      </View>
      {p.problemText && <Text style={styles.problem}>{p.problemText}</Text>}
      {p.loading && p.items.length === 0 ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <FlashList
          data={p.items}
          keyExtractor={(a) => a.id}
          extraData={`${p.selectedId}:${p.now}`}
          renderItem={({ item }) => <AlarmRow alarm={item} now={p.now} selected={item.id === p.selectedId} onPress={() => p.onOpen(item.id)} />}
          ListEmptyComponent={<Text style={styles.empty}>Açık tezgah alarmı yok.</Text>}
        />
      )}
    </View>
  );
}

function AlarmRow({ alarm: a, now, selected, onPress }: { alarm: LoomAlarmItem; now: number; selected: boolean; onPress: () => void }) {
  const late = isPastTarget(a, now);
  return (
    <TouchableRipple onPress={onPress} style={[styles.row, selected && styles.rowSelected]} accessibilityLabel={`${a.machine.code} alarmı`}>
      <View style={styles.rowInner}>
        <View style={styles.rowHead}>
          <TruncatedText style={styles.code} testID={`alarm-tezgah-${a.id}`}>{`${a.machine.code} · ${a.machine.hallName}`}</TruncatedText>
          <Text style={[styles.badge, a.tier >= 2 ? styles.badgeK2 : styles.badgeK1]}>{tierShort(a.tier)}</Text>
        </View>
        <Text style={styles.reason} numberOfLines={1}>{reasonText(a)}</Text>
        <View style={styles.rowHead}>
          <Text style={[styles.duration, late && styles.durationLate]}>{durationVsTarget(a, now)}</Text>
          <TruncatedText style={styles.state} testID={`alarm-durum-${a.id}`}>
            {a.state === 'ACKED' && a.ackedBy ? `${a.ackedBy.name} üstlendi` : (ALARM_STATE_LABEL[a.state] ?? a.state)}
            {isSnoozed(a, now) ? ' · susturuldu' : ''}
          </TruncatedText>
        </View>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scopeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  scopeText: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggleText: { fontSize: typography.size.sm, color: colors.textSecondary },
  problem: { fontSize: typography.size.sm, color: colors.warningText, backgroundColor: colors.warningContainer, padding: spacing.sm, textAlign: 'center' },
  spinner: { marginTop: spacing.xxl },
  empty: { fontSize: typography.size.base, color: colors.textMuted, textAlign: 'center', padding: spacing.xxl },
  row: { marginHorizontal: spacing.md, marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  rowSelected: { borderColor: colors.dangerDark, borderWidth: 2 },
  rowInner: { minHeight: 56, padding: spacing.md, gap: spacing.xs },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  code: { flexShrink: 1, fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text },
  badge: { fontSize: typography.size.xs, fontWeight: typography.weight.bold, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full, overflow: 'hidden' },
  badgeK1: { backgroundColor: colors.warningContainer, color: colors.warningText },
  badgeK2: { backgroundColor: colors.dangerContainer, color: colors.dangerText },
  reason: { fontSize: typography.size.base, color: colors.textSecondary },
  duration: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  durationLate: { color: colors.dangerDark },
  state: { flexShrink: 1, fontSize: typography.size.sm, color: colors.textMuted },
});
