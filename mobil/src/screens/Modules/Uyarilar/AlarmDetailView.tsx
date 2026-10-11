// =============================================================================
// TEZGAH ALARMI — alarm sayfası gövdesi (telefonda ayrı sayfa, tablette sağ bölme)
// =============================================================================
// 15 sn'de bir tazelenir (ön planda); sayaç saniyede bir akar. Eylemler online-only.
// =============================================================================
import React from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { useAuthStore } from '../../../store/authStore';
import { useLoomAlarmDetail, useNow } from '../../../hooks/useLoomAlarms';
import type { LoomAlarmAccessFull } from '../../../lib/loomAlarm/access';
import { useLoomAlarmActions } from '../../../hooks/useLoomAlarmActions';
import {
  ALARM_STATE_LABEL,
  alarmElapsedMs,
  formatClock,
  isLiveAlarm,
  isPastTarget,
  isSnoozed,
  reasonText,
  sourceLabel,
  tierLabel,
} from '../../../lib/loomAlarm/format';
import { fmtFactoryTime } from '../../../lib/factory-time';
import { queryProblem, QUERY_PROBLEM_TEXT } from '../../../utils/queryState';
import type { LoomAlarmItem } from '../../../types/loomAlarm';
import AlarmActionBar from './AlarmActionBar';
import { ContextSections, NotifiedSection, TimelineSection } from './AlarmDetailSections';
import { colors, radius, spacing, typography } from '../../../theme';

interface Props {
  alarmId: string;
  access: LoomAlarmAccessFull;
}

export default function AlarmDetailView({ alarmId, access }: Props) {
  const q = useLoomAlarmDetail(alarmId, access.canView);
  const meId = useAuthStore((s) => s.user?.userId ?? null);
  const actions = useLoomAlarmActions(alarmId);
  const now = useNow(1000);
  const problem = queryProblem(q);
  if (!q.data) {
    return (
      <View style={styles.center}>
        {problem ? <Text style={styles.muted}>{QUERY_PROBLEM_TEXT[problem]}</Text> : <ActivityIndicator />}
      </View>
    );
  }
  const d = q.data;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {problem && <Text style={styles.warn}>{QUERY_PROBLEM_TEXT[problem]} — gösterilen son bilinen durum.</Text>}
      <AlarmHeader alarm={d.alarm} now={now} nextDueAt={d.nextDueAt} />
      <AlarmActionBar alarm={d.alarm} access={access} meId={meId} now={now} actions={actions} />
      <NotifiedSection records={d.notifications} />
      <TimelineSection timeline={d.timeline} canAct={access.canAct} meId={meId} busy={actions.busy !== null} onRetract={(id) => void actions.retract(id)} />
      <ContextSections detail={d} />
    </ScrollView>
  );
}

function AlarmHeader({ alarm: a, now, nextDueAt }: { alarm: LoomAlarmItem; now: number; nextDueAt: string | null }) {
  const live = isLiveAlarm(a.state);
  const late = live && isPastTarget(a, now);
  return (
    <View style={[styles.header, a.tier >= 2 && live && styles.headerK2]}>
      <Text style={styles.title}>{`${a.machine.code} · ${a.machine.hallName}`}</Text>
      <Text style={styles.reason}>{reasonText(a)}</Text>
      <Text style={[styles.clock, late && styles.clockLate]}>{formatClock(alarmElapsedMs(a, now))}</Text>
      <Text style={styles.meta}>
        {`${a.targetMinutes === null ? 'Hedef süre yok' : `Hedef ${a.targetMinutes} dk`} · ${sourceLabel(a.stop.source)} · başlangıç ${fmtFactoryTime(a.stop.startedAt)}`}
      </Text>
      <Text style={styles.meta}>{`${ALARM_STATE_LABEL[a.state] ?? a.state} · ${tierLabel(a.tier)}`}</Text>
      {a.ackedBy && a.ackedAt && <Text style={styles.meta}>{`${a.ackedBy.name} ${fmtFactoryTime(a.ackedAt)}'de üstlendi`}</Text>}
      {isSnoozed(a, now) && <Text style={styles.meta}>{`Susturuldu — ${fmtFactoryTime(a.snoozedUntil)}'e kadar`}</Text>}
      {live && nextDueAt && <Text style={styles.meta}>{`Üst kademeye iletim: ${fmtFactoryTime(nextDueAt)}`}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  muted: { fontSize: typography.size.base, color: colors.textMuted, textAlign: 'center' },
  warn: { fontSize: typography.size.sm, color: colors.warningText, backgroundColor: colors.warningContainer, padding: spacing.sm, borderRadius: radius.sm },
  header: { backgroundColor: colors.dangerContainer, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  headerK2: { borderWidth: 2, borderColor: colors.dangerDark },
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.dangerText },
  reason: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.dangerText },
  clock: { fontSize: typography.size.display, fontWeight: typography.weight.bold, color: colors.text, fontVariant: ['tabular-nums'] },
  clockLate: { color: colors.dangerDark },
  meta: { fontSize: typography.size.sm, color: colors.textSecondary },
});
