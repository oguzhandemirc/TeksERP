// =============================================================================
// TEZGAH ALARMI — alarm sayfasının bölümleri (kime bildirildi · zaman çizgisi · bağlam · benzer · son duruşlar)
// =============================================================================
// Saat basımı yalnız fabrika diliminden (`lib/factory-time`). "Kime bildirildi" sorumlu ataması
// dilimiyle gelir; eski sunucu alanı göndermez → bölüm hiç çizilmez (uydurulmaz).
// =============================================================================
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { eventLabel, formatSeconds, tierShort } from '../../../lib/loomAlarm/format';
import { canRetractNote } from '../../../lib/loomAlarm/policy';
import { fmtFactoryDateTime, fmtFactoryTime } from '../../../lib/factory-time';
import type { LoomAlarmDetail, LoomAlarmNotificationRecord, LoomAlarmStopStat } from '../../../types/loomAlarm';
import { colors, radius, spacing, typography } from '../../../theme';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const modeText = (r: LoomAlarmNotificationRecord): string =>
  r.mode === 'LISTED' ? 'Atanan kişiler' : r.mode === 'BY_PERMISSION' ? 'İzni olan herkes' : r.mode;

export function NotifiedSection({ records }: { records: LoomAlarmNotificationRecord[] | undefined }) {
  if (!records || records.length === 0) return null;
  return (
    <Section title="Kime bildirildi">
      {records.map((r) => (
        <View key={`${r.tier}-${r.at}`} style={styles.line}>
          <Text style={styles.strong}>{`${tierShort(r.tier)} · ${fmtFactoryTime(r.at)} · ${modeText(r)}`}</Text>
          {r.recipients.length > 0 && <Text style={styles.body}>{r.recipients.map((x) => x.name).join(', ')}</Text>}
        </View>
      ))}
    </Section>
  );
}

interface TimelineProps {
  timeline: LoomAlarmDetail['timeline'];
  canAct: boolean;
  meId: string | null;
  busy: boolean;
  onRetract: (eventId: string) => void;
}

export function TimelineSection({ timeline, canAct, meId, busy, onRetract }: TimelineProps) {
  return (
    <Section title="Zaman çizgisi">
      {timeline.map((e) => (
        <View key={e.id} style={styles.line}>
          <Text style={styles.strong}>{`${fmtFactoryTime(e.at)} · ${eventLabel(e.kind, e.tier)}${e.user ? ` — ${e.user.name}` : ''}`}</Text>
          {e.snoozedUntil && <Text style={styles.body}>{`${fmtFactoryTime(e.snoozedUntil)}'e kadar`}</Text>}
          {e.note && <Text style={[styles.body, e.retracted && styles.struck]}>{e.note}</Text>}
          {canRetractNote(e, canAct, meId) && (
            <Button compact mode="text" icon="undo" onPress={() => onRetract(e.id)} disabled={busy} contentStyle={styles.tall} style={styles.retract}>
              Notu geri çek
            </Button>
          )}
        </View>
      ))}
    </Section>
  );
}

const statText = (label: string, s: LoomAlarmStopStat): string =>
  `${label}: ${s.count} duruş · ortalama ${formatSeconds(s.avgSec === null ? null : Math.round(s.avgSec))}`;

export function ContextSections({ detail }: { detail: LoomAlarmDetail }) {
  const job = detail.context.job;
  return (
    <>
      {job && (
        <Section title="Tezgahtaki iş">
          <Text style={styles.body}>{`${job.weavingOrderNumber} · ${job.itemName}${job.colorName ? ` · ${job.colorName}` : ''}`}</Text>
        </Section>
      )}
      {detail.similar && (
        <Section title="Aynı sebeple duruşlar">
          <Text style={styles.body}>{statText('Bu tezgah, 7 gün', detail.similar.machine7d)}</Text>
          <Text style={styles.body}>{statText('Bu tezgah, 30 gün', detail.similar.machine30d)}</Text>
          <Text style={styles.body}>{statText('Bütün salon, 30 gün', detail.similar.floor30d)}</Text>
        </Section>
      )}
      {detail.recentStops.length > 0 && (
        <Section title="Son duruşlar">
          {detail.recentStops.map((s) => (
            <Text key={s.id} style={styles.body}>
              {`${fmtFactoryDateTime(s.startedAt)} · ${formatSeconds(s.durationSec)} · ${s.reasonLabel ?? s.reasonCode ?? 'Sebep yok'}`}
            </Text>
          ))}
        </Section>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  sectionTitle: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text },
  line: { gap: 2, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  strong: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold, color: colors.text },
  body: { fontSize: typography.size.sm, color: colors.textSecondary },
  struck: { textDecorationLine: 'line-through', color: colors.textMuted },
  retract: { alignSelf: 'flex-start' },
  tall: { minHeight: 56 },
});
