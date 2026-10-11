// =============================================================================
// TEZGAH ALARMI — Tezgah ekranının üst şeridi (yalnız bu tezgahın açık alarmı)
// =============================================================================
// Okuma `mobile:dokuma` ile de açıktır (operatör kendi tezgahının alarmını görür); "Üstlendim" yalnız
// eylem izni olanda çizilir (`loom:alarm-ack` / `mobile:tezgah-uyari`), asıl kapı sunucuda. Ses/titreşim
// bildiriciyle aynı "çalındı" kümesini paylaşır — aynı alarm cihazda iki kez çalmaz.
// =============================================================================
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useLoomAlarmAccess, useLoomAlarmFeed, useNow } from '../../hooks/useLoomAlarms';
import { useLoomAlarmActions } from '../../hooks/useLoomAlarmActions';
import { consumeFreshSignals } from '../../lib/loomAlarm/dispatch';
import { alarmTierKey, stripLeadOf } from '../../lib/loomAlarm/signal';
import { durationVsTarget, reasonText, tierShort } from '../../lib/loomAlarm/format';
import { signalLoomAlarm } from '../../services/alarmFeedback';
import type { MainStackParamList } from '../../navigation/types';
import type { LoomAlarmItem } from '../../types/loomAlarm';
import { colors, radius, spacing, typography } from '../../theme';

export default function LoomAlarmStrip({ machineId }: { machineId: string | null }) {
  const access = useLoomAlarmAccess();
  const feed = useLoomAlarmFeed({ enabled: access.canSeeLoomStrip && machineId !== null, mine: false, machineId: machineId ?? undefined });
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const items = feed.data?.items ?? [];

  useEffect(() => {
    if (!feed.dataUpdatedAt) return;
    const fresh = consumeFreshSignals(feed.data?.items ?? [], Date.now(), access.renotifyMinutes);
    if (fresh.length > 0) signalLoomAlarm(fresh[0].tier);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız yeni veri geldiğinde
  }, [feed.dataUpdatedAt]);

  const lead = stripLeadOf(items, dismissed);
  if (!lead) return null;
  return <StripBody key={lead.id} alarm={lead} canAct={access.canAct} canOpen={access.canView} onDismiss={() => setDismissed(new Set(dismissed).add(alarmTierKey(lead)))} />;
}

function StripBody({ alarm: a, canAct, canOpen, onDismiss }: { alarm: LoomAlarmItem; canAct: boolean; canOpen: boolean; onDismiss: () => void }) {
  const now = useNow(15_000);
  const actions = useLoomAlarmActions(a.id);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  return (
    <View style={[styles.root, a.tier >= 2 && styles.rootK2]} accessibilityRole="alert">
      <Icon source="alarm-light" size={28} color={colors.textOnDark} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>{`${a.machine.code} · ${reasonText(a)} · ${tierShort(a.tier)}`}</Text>
        <Text style={styles.sub} numberOfLines={1}>{`${durationVsTarget(a, now)} duruyor`}</Text>
      </View>
      {canAct && (
        <Button mode="contained" buttonColor={colors.surface} textColor={colors.dangerDark} onPress={() => void actions.ack()} loading={actions.busy === 'ack'} disabled={actions.busy !== null} contentStyle={styles.tall} labelStyle={styles.label}>
          Üstlendim
        </Button>
      )}
      {canOpen && (
        <Button mode="outlined" textColor={colors.textOnDark} onPress={() => navigation.navigate('UyariDetay', { alarmId: a.id })} contentStyle={styles.tall} labelStyle={styles.label}>
          Aç
        </Button>
      )}
      <Button mode="text" textColor={colors.textOnDark} onPress={onDismiss} contentStyle={styles.tall} labelStyle={styles.label} accessibilityLabel="Şeridi kapat">
        Kapat
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.danger, borderRadius: radius.sm, margin: spacing.sm },
  rootK2: { backgroundColor: colors.dangerDark },
  text: { flex: 1 },
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.textOnDark },
  sub: { fontSize: typography.size.sm, color: colors.textOnDark },
  tall: { minHeight: 56 },
  label: { fontSize: typography.size.base, fontWeight: typography.weight.bold },
});
