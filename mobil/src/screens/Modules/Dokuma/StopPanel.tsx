// =============================================================================
// DURUŞ PANELİ — bu makinedeki açık duruş; bildir · kapat · sebep ata · geri al
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import { LOOM_STOP_REASONS } from '../../../constants/loomStopReasons';
import { colors, spacing, radius, typography } from '../../../theme';
import type { DoffEntry } from './useDoffEntry';
import { useStopPanel } from './useStopPanel';
import { formatElapsed } from './stopPayload';
import StopReasonModal from './StopReasonModal';
import RevokeReasonModal from './RevokeReasonModal';

function reasonLabel(code: string | null): string {
  if (!code) return 'Sebep bekliyor';
  return LOOM_STOP_REASONS.find((r) => r.code === code)?.label ?? code;
}

export default function StopPanel({ entry }: { entry: DoffEntry }) {
  const machineId = entry.machine?.id ?? null;
  const state = useStopPanel({ machineId, isOnline: entry.isOnline });
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const stop = state.openStop;

  return (
    <View style={[styles.card, stop && styles.cardStopped]}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.heading}>{stop ? `DURUŞTA · ${formatElapsed(stop.startedAt, state.now)}` : 'Tezgah çalışıyor'}</Text>
          <Text style={styles.meta}>{stop ? reasonLabel(stop.reasonCode) : 'Duruş bildirilmedi'}</Text>
        </View>
        {stop ? (
          <>
            {stop.requiresReason ? <Button compact icon="tag-outline" onPress={() => state.classifyModal(stop.id)}>Sebep ata</Button> : null}
            <Button mode="contained-tonal" icon="play" onPress={() => state.close(stop.id)} loading={state.closing} disabled={!entry.isOnline || state.closing}>Çalıştı</Button>
            {entry.canRevoke ? <Button compact icon="undo" onPress={() => setRevokeId(stop.id)}>Geri al</Button> : null}
          </>
        ) : (
          <Button mode="contained" icon="pause-circle-outline" buttonColor={colors.warning} onPress={state.openModal} disabled={!entry.isOnline || state.stopsLoading}>Duruş Bildir</Button>
        )}
      </View>
      <StopReasonModal state={state} />
      <ModuleSheet
        visible={state.collision !== null}
        onDismiss={state.dismissCollision}
        dismissable={false}
        size="sm"
        title="Bu deneme başka bir duruşla çakıştı"
        footer={
          <>
            <Button onPress={state.dismissCollision}>Vazgeç</Button>
            <Button mode="contained" onPress={state.resendAsNew}>Yeni duruş olarak aç</Button>
          </>
        }
      >
        <Text style={sheet.body_}>{state.collision}</Text>
      </ModuleSheet>
      <RevokeReasonModal
        visible={revokeId !== null}
        title="Duruş geri alınsın mı?"
        hint="Damga; duruş süresi randımandan düşer. Sebep zorunlu (en az 3 karakter)."
        busy={state.revoking}
        onClose={() => setRevokeId(null)}
        onConfirm={(why) => {
          if (revokeId) state.revoke(revokeId, why);
          setRevokeId(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { margin: spacing.lg, marginBottom: 0, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardStopped: { borderColor: colors.warning, backgroundColor: colors.warningContainer },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 160 },
  heading: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  meta: { fontSize: typography.size.sm, color: colors.textSecondary },
});
